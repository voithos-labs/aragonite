/**
 * The rule for writing a fenced code block's bytes, declared on the kind as `normalizeRawWrite`
 * and applied wherever content is written. It puts back a closer a truncating write dropped,
 * removes one such a write stranded, grows both marker runs past a body line that would read as
 * the closer, and drops backticks from a backtick fence's info string (CommonMark §4.5). All of it
 * reads the block's own fence shape, which is why the pass takes a node. A fence the user left
 * open is exempt.
 */

import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import {
	escalatedFenceLength,
	matchFenceClose,
	matchFenceOpen
} from '../core/parsers/fence-syntax';

export interface FenceShape {
	marker: '`' | '~';
	/** The block's own marker-run length, from its metadata, not re-scanned from the write. */
	length: number;
	closed: boolean;
}

/** Whether the written bytes are the user authoring the block's syntax, or content. */
export type FenceWriteMode = 'authored' | 'literal';

export interface FenceWriteInput {
	/** Display text about to be committed: raw without its trailing line ending. */
	display: string;
	/** Caret offset in `display`, mapped onto the reconciled bytes on the way out. */
	caret: number;
	fence: FenceShape;
	mode: FenceWriteMode;
}

export interface FenceWriteResult {
	display: string;
	caret: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function fenceShapeOf(node: NodeView): FenceShape {
	const meta = metadataOf(node, 'fencedCode');
	return { marker: meta.fenceMarker, length: meta.fenceLength, closed: meta.closed };
}

export function reconcileFenceWrite(input: FenceWriteInput): FenceWriteResult {
	const { fence, mode } = input;
	if (!fence.closed && mode === 'authored') return { display: input.display, caret: input.caret };
	const unglued = separateGluedCloser(input);
	return escalateFenceRuns({ ...input, ...sanitizeInfoString({ ...input, ...unglued }) });
}

/**
 * A whole fenced-code `raw` made legal, the kind's `normalizeRawWrite`. Always treated as content
 * rather than typed syntax: code reaching a node's bytes without going through its editable
 * element is never the user typing the block's own fence. The fence lines are fixed first, so
 * growing the runs measures a body that ends where the closer does.
 */
export function normalizeFencedRaw(raw: string, node: NodeView): string {
	const fence = fenceShapeOf(node);
	const written = reconcileFenceWrite({
		display: reconcileFenceLines(trimTrailingLineEnding(raw), fence, trailingLineEnding(node.raw)),
		caret: 0,
		fence,
		mode: 'literal'
	});
	return written.display + trailingLineEnding(raw);
}

/**
 * The bytes with `info` written onto the opening fence line. Only that span moves, so the
 * indent, both marker runs, the body and the closer come through byte-identical. Null when
 * line 0 does not read as this block's opener at all.
 */
export function writeFenceInfo(display: string, info: string, fence: FenceShape): string | null {
	const lineEnd = firstLineEnd(display);
	const line = display.slice(0, lineEnd);
	const opener = splitOpener(line, fence);
	if (!opener) return null;
	// A CRLF separator's `\r` sits inside the line; the info span ends before it.
	const infoEnd = lineEnd - (line.endsWith('\r') ? 1 : 0);
	return display.slice(0, opener.runEnd) + legalInfo(info, fence) + display.slice(infoEnd);
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * What the info string may hold: one line, no backtick under a backtick fence (CommonMark §4.5),
 * and no leading run of the fence's own marker, which would lengthen the fence instead: `~~~` plus
 * `~x` reparses as a four-tilde run its own closer no longer closes. The characters are dropped
 * rather than the write refused, the same rule typing and pasting already use.
 */
function legalInfo(info: string, fence: FenceShape): string {
	const oneLine = info.replace(/[\r\n]/g, '');
	const kept = fence.marker === '`' ? oneLine.replaceAll('`', '') : oneLine;
	let start = 0;
	while (kept[start] === fence.marker) start++;
	return kept.slice(start);
}

interface OpenerParts {
	indent: string;
	info: string;
	/** Offset just past the opener's marker run, where a longer run is inserted. */
	runEnd: number;
}

/**
 * Split by the block's own run length rather than by re-scanning the written line: a backtick
 * typed at the start of the info string must read as info, not as a longer run.
 */
function splitOpener(line: string, fence: FenceShape): OpenerParts | null {
	const indent = /^ {0,3}/.exec(line)![0];
	const runEnd = indent.length + fence.length;
	if (line.slice(indent.length, runEnd) !== fence.marker.repeat(fence.length)) return null;
	return { indent, info: line.slice(runEnd), runEnd };
}

/**
 * The block's fence lines against a write that removed one of them: a fence left open swallows
 * every block below it at the next parse, whichever half went missing. With the block's own opener
 * still on line 0 the missing closer comes back; without it, a surviving closer is syntax the
 * write stranded and goes. {@link ownOpener} decides which, so only one of the two can run.
 */
function reconcileFenceLines(display: string, fence: FenceShape, blockEnding: string): string {
	if (!fence.closed) return display;
	const lines = display.split('\n');
	const opener = ownOpener(lines, fence);
	const reconciled = opener
		? restoredCloser(lines, fence, opener, blockEnding)
		: droppedStrandedCloser(lines, fence);
	return reconciled ?? display;
}

/**
 * Line 0 read as the block's own opener: its exact run, and info that is not a longer run. A
 * write whose only line reads as this fence's closer is not one: an opener never doubles as a
 * closer, and no block's metadata is left to size a fence from.
 */
function ownOpener(lines: string[], fence: FenceShape): OpenerParts | null {
	const opener = splitOpener(lines[0], fence);
	if (!opener || opener.info.startsWith(fence.marker)) return null;
	if (lines.length === 1 && matchFenceClose(lines[0], fence.marker, fence.length)) return null;
	return opener;
}

/**
 * Puts back the closer a truncating write dropped, or null when one is still there. The line
 * ending is the block's, not the written slice's, which may have none (G4.20).
 */
function restoredCloser(
	lines: string[],
	fence: FenceShape,
	opener: OpenerParts,
	blockEnding: string
): string | null {
	if (lastCloserIndex(lines, fence) !== -1) return null;
	return lines.join('\n') + blockEnding + opener.indent + fence.marker.repeat(fence.length);
}

/**
 * Drops the closer a write stranded by removing the block's own opener, since as text it would
 * open a fence over the blocks below. Null when there is none, or when a line above could close on
 * that run (same marker, run no longer than the closer's).
 */
function droppedStrandedCloser(lines: string[], fence: FenceShape): string | null {
	const closer = lastCloserIndex(lines, fence, 0);
	if (closer === -1) return null;
	const run = /^ {0,3}([`~]+)/.exec(lines[closer])![1].length;
	const claimed = (line: string): boolean => {
		const open = matchFenceOpen(line);
		return open !== null && open.marker === fence.marker && open.length <= run;
	};
	if (lines.slice(0, closer).some(claimed)) return null;
	return withoutLine(lines, closer);
}

/** Splitting on `\n` leaves a CRLF separator's `\r` above; dropping the last line orphans it. */
function withoutLine(lines: string[], index: number): string {
	const kept = lines.slice(0, index).concat(lines.slice(index + 1));
	if (index === lines.length - 1 && kept.length > 0) {
		kept[kept.length - 1] = kept[kept.length - 1].replace(/\r$/, '');
	}
	return kept.join('\n');
}

function sanitizeInfoString(input: FenceWriteInput): FenceWriteResult {
	const { display, caret, fence } = input;
	if (fence.marker !== '`') return { display, caret };
	const lineEnd = firstLineEnd(display);
	const opener = splitOpener(display.slice(0, lineEnd), fence);
	if (!opener || !opener.info.includes('`')) return { display, caret };

	const kept = opener.info.replaceAll('`', '');
	const dropped = countDroppedBefore(opener.info, opener.runEnd, caret);
	return {
		display: opener.indent + fence.marker.repeat(fence.length) + kept + display.slice(lineEnd),
		caret: caret - dropped
	};
}

/** Backticks removed from the info string that sat before the caret. */
function countDroppedBefore(info: string, infoStart: number, caret: number): number {
	let dropped = 0;
	for (let i = 0; i < info.length && infoStart + i < caret; i++) {
		if (info[i] === '`') dropped++;
	}
	return dropped;
}

/**
 * Separate a closer the write ran into: text typed at the start of an empty fence's closer line
 * lands in front of the run (```` ```\nAB``` ````), so a line ending goes back before the run.
 */
function separateGluedCloser(input: FenceWriteInput): FenceWriteResult {
	const { display, caret, fence } = input;
	if (!fence.closed) return { display, caret };
	const lines = display.split('\n');
	// A closer still on its own line needs nothing; so does a display too short to hold one.
	if (lines.length < 2 || lastCloserIndex(lines, fence) >= 1) return { display, caret };
	const run = new RegExp(`[${fence.marker}]{${fence.length},}[ \t]*$`).exec(
		lines[lines.length - 1]
	);
	// `index === 0` is a bare run another rule handles, not one the write ran into.
	if (!run || run.index === 0) return { display, caret };
	const at = display.length - run[0].length;
	const ending = display.includes('\r\n') ? '\r\n' : '\n';
	return {
		display: display.slice(0, at) + ending + display.slice(at),
		// The caret sits at the end of the typed text, exactly where the line ending goes in: it
		// stays put, and only a caret already inside the closer run moves.
		caret: caret > at ? caret + ending.length : caret
	};
}

function escalateFenceRuns(input: FenceWriteInput): FenceWriteResult {
	const { display, caret, fence } = input;
	const lines = display.split('\n');
	const opener = splitOpener(lines[0], fence);
	if (!opener || lines.length < 2) return { display, caret };

	// An open fence has no closer line, so a literal write measures everything below
	// the opener; a closed one measures only what sits above its own closer.
	const closerIndex = fence.closed ? lastCloserIndex(lines, fence) : -1;
	if (fence.closed && closerIndex < 1) return { display, caret };
	const bodyEnd = closerIndex === -1 ? lines.length : closerIndex;
	const body = lines.slice(1, bodyEnd).join('\n');

	const grown = escalatedFenceLength(body, fence.marker, fence.length);
	const delta = grown - fence.length;
	if (delta === 0) return { display, caret };

	const run = fence.marker.repeat(grown);
	lines[0] = opener.indent + run + opener.info;
	let closerRunStart = -1;
	if (closerIndex !== -1) {
		const closerIndent = /^ {0,3}/.exec(lines[closerIndex])![0];
		const tail = lines[closerIndex].slice(closerIndent.length).replace(/^[`~]+/, '');
		closerRunStart = lineStartOffset(display, closerIndex) + closerIndent.length;
		lines[closerIndex] = closerIndent + run + tail;
	}

	// The run grows in place, so a caret past an insertion point moves with it.
	let moved = caret;
	if (caret > opener.runEnd) moved += delta;
	if (closerRunStart !== -1 && caret > closerRunStart) moved += delta;
	return { display: lines.join('\n'), caret: moved };
}

/** Last line reading as this fence's closer at or after `from`; line 0 is the opener's line. */
function lastCloserIndex(lines: string[], fence: FenceShape, from = 1): number {
	for (let i = lines.length - 1; i >= from; i--) {
		if (matchFenceClose(lines[i], fence.marker, fence.length)) return i;
	}
	return -1;
}

function firstLineEnd(display: string): number {
	const index = display.indexOf('\n');
	return index === -1 ? display.length : index;
}

function lineStartOffset(display: string, lineIndex: number): number {
	let offset = 0;
	for (let i = 0; i < lineIndex; i++) offset = display.indexOf('\n', offset) + 1;
	return offset;
}
