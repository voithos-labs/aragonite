/**
 * The fence grammar: the line predicates, the closer search and a fenced block's anatomy, apart
 * from the block parser so the write rule (`schema/fenced-code-raw.ts`) and plugins read the one
 * definition without pulling `core/parser` in.
 */

import { escalateTerminatorRun } from '../terminator-escalation';
import { splitLines } from '../lines';

/**
 * The fence-open shape, re-exported on `@voithos-labs/aragonite/plugin` for fence-claiming openers:
 * `info` is the trimmed dispatch string; `indent`/`infoRaw` are the verbatim rebuild bytes.
 */
export interface FenceOpen {
	marker: '`' | '~';
	length: number;
	info: string;
	indent: string;
	infoRaw: string;
}

// Backtick info may not contain backticks (CommonMark §4.5); tilde info may.
const BACKTICK_OPEN = /^( {0,3})(`{3,})([^`]*)$/;
const TILDE_OPEN = /^( {0,3})(~{3,})(.*)$/;

export function matchFenceOpen(text: string): FenceOpen | null {
	const m = text.match(BACKTICK_OPEN) ?? text.match(TILDE_OPEN);
	if (!m) return null;
	const [, indent, fence, infoRaw] = m;
	return {
		marker: fence[0] as '`' | '~',
		length: fence.length,
		info: infoRaw.trim(),
		indent,
		infoRaw
	};
}

export function matchFenceClose(text: string, marker: '`' | '~', minLength: number): boolean {
	const pattern = marker === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/;
	const m = text.match(pattern);
	return Boolean(m && m[1].length >= minLength);
}

/**
 * The fence length needed to wrap `body`: one past every body line the parser would read
 * as this block's closer, never below `minimum`. Without it a body line reproducing the
 * terminator closes the block early and ejects everything below it on reparse. A floor,
 * not a target: it never shortens an existing fence.
 */
export function escalatedFenceLength(body: string, marker: '`' | '~', minimum: number): number {
	return escalateTerminatorRun(body, minimum, (text, required) =>
		matchFenceClose(text, marker, required) ? fenceRunLength(text, marker) : null
	);
}

function fenceRunLength(text: string, marker: '`' | '~'): number {
	let index = 0;
	while (text[index] === ' ') index++;
	let run = 0;
	while (text[index + run] === marker) run++;
	return run;
}

// ── Fence anatomy ─────────────────────────────────────────────────────────────

/** A fence's marker and run length: what its closer has to repeat, at that length or longer. */
export interface FenceRun {
	marker: '`' | '~';
	length: number;
}

/** The first line in `[from, end)` that closes `fence`, or -1: the closer the parser takes. */
export function findFenceCloser(
	lines: readonly { text: string }[],
	from: number,
	end: number,
	fence: FenceRun
): number {
	for (let i = from; i < end; i++) {
		if (matchFenceClose(lines[i].text, fence.marker, fence.length)) return i;
	}
	return -1;
}

/**
 * Where a fenced block's parts sit in its bytes: the opener's indent, marker run and info string,
 * the body, and the closer line. Offsets are into the bytes as given, trailing ending included.
 */
export interface FenceAnatomy extends FenceRun {
	/** End of the opener's indent; its marker run ends at `runEnd`, its info string at `openerEnd`. */
	indentEnd: number;
	runEnd: number;
	openerEnd: number;
	/** Past the opener's line ending, where the body starts. */
	bodyStart: number;
	/** Where the closer line starts, or the end of the bytes for a fence nothing closes. */
	closerStart: number;
	closed: boolean;
}

/**
 * Reads `raw` as a fenced block. Line 0 must open with a run of `fence`'s marker at least
 * `fence.length` long (any fence marker when `fence` is omitted). The fence is closed when the
 * last line, below line 0, closes that run. Null when line 0 opens no such run.
 */
export function fenceAnatomy(raw: string, fence?: FenceRun): FenceAnatomy | null {
	const lines = splitLines(raw);
	if (lines.length === 0) return null;
	const opener = lines[0];
	const indentEnd = /^ {0,3}/.exec(opener.text)![0].length;
	const marker = fence?.marker ?? opener.text[indentEnd];
	if (marker !== '`' && marker !== '~') return null;
	let runEnd = indentEnd;
	while (opener.text[runEnd] === marker) runEnd++;
	const length = runEnd - indentEnd;
	if (length < Math.max(3, fence?.length ?? 3)) return null;

	const last = lines[lines.length - 1];
	const closed = lines.length > 1 && matchFenceClose(last.text, marker, length);
	return {
		marker,
		length,
		indentEnd,
		runEnd,
		openerEnd: opener.text.length,
		bodyStart: opener.end,
		closerStart: closed ? last.start : raw.length,
		closed
	};
}

/** A fence opener whose info string's first word is `token`: how a plugin claims its fences. */
export function matchFenceInfo(token: string): (text: string) => FenceOpen | null {
	return (text) => {
		const fence = matchFenceOpen(text);
		return fence && fence.info.split(/\s+/)[0] === token ? fence : null;
	};
}
