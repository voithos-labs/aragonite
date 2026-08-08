/**
 * The fence grammar's line predicates, split from the block parser so the write-side rule
 * (`schema/fenced-code-raw.ts`) can read them without pulling `core/parser` into schema.
 */

import { escalateTerminatorRun } from '../terminator-escalation';

/**
 * The fence-open shape, re-exported on `aragonite/plugin` for fence-claiming openers:
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
