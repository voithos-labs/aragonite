/**
 * The rule for writing a fenced block's bytes, declared on the kind as `rawWrite`. It puts back a
 * closer a truncating write dropped, removes one such a write stranded, grows both marker runs past
 * a body line that would read as the closer, and drops backticks from a backtick fence's info
 * string (CommonMark §4.5), moving the caret with every byte it adds or drops. A fence the user is
 * still typing (open, `authored`) is left alone.
 */

import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { WriteContext, WriteRule } from './block-kind-descriptor';
import {
	displayLines,
	firstDisplayLine,
	firstLineEnding,
	joinDisplayLines,
	ownTrailingLineEnding,
	trailingLineEnding,
	trimTrailingLineEnding,
	type DisplayLine,
	type LineEnding
} from '../core/lines';
import {
	escalatedFenceLength,
	fenceAnatomy,
	matchFenceClose,
	matchFenceOpen
} from '../core/parsers/fence-syntax';

export interface FenceShape {
	marker: '`' | '~';
	/** The block's own marker-run length. A literal write re-reads it off the written opener. */
	length: number;
	closed: boolean;
}

/** Whether the written bytes are the user authoring the block's syntax, or content. */
export type FenceWriteMode = WriteContext['mode'];

export interface FenceWriteInput {
	/** Display text about to be committed: raw without its trailing line ending. */
	display: string;
	/** Caret offset in `display`, mapped onto the reconciled bytes on the way out. */
	caret: number;
	fence: FenceShape;
	mode: FenceWriteMode;
	/** The line ending a restored closer line takes: the block's own. */
	ending: LineEnding;
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

/** The fence write rule for a kind whose fence shape `shapeOf` reads off the block. */
export function fenceRawWrite(shapeOf: (node: NodeView) => FenceShape): WriteRule {
	return {
		normalize: (raw, ctx) => reconcileFenceRaw(raw, 0, shapeOf(ctx.node), ctx).raw,
		mapOffset: (raw, offset, ctx) => reconcileFenceRaw(raw, offset, shapeOf(ctx.node), ctx).offset
	};
}

/** The built-in code block's rule, sized by its parsed metadata. */
export const fencedCodeWrite: WriteRule = fenceRawWrite(fenceShapeOf);

/**
 * The shape of a fenced block that keeps no fence metadata, read off its own opener line. A
 * plugin kind declares its rule as `fenceRawWrite(fenceShapeOfRaw)`.
 */
export function fenceShapeOfRaw(node: NodeView): FenceShape {
	const anatomy = fenceAnatomy(node.raw);
	return anatomy
		? { marker: anatomy.marker, length: anatomy.length, closed: anatomy.closed }
		: { marker: '`', length: 3, closed: false };
}

/**
 * The display text of a fenced block made legal, the caret carried along. The fence lines are
 * fixed before the runs grow, so growing measures a body that ends where the closer does.
 */
export function reconcileFenceWrite(input: FenceWriteInput): FenceWriteResult {
	const { mode, ending } = input;
	const fence = writtenFence(input.display, input.fence, mode);
	if (!fence.closed && mode === 'authored') return { display: input.display, caret: input.caret };
	const unglued = separateGluedCloser({ ...input, fence });
	const lines = reconcileFenceLines(unglued, fence, ending);
	const sanitized = sanitizeInfoString({ ...input, ...lines, fence });
	return escalateFenceRuns({ ...input, ...sanitized, fence });
}

/**
 * The bytes with `info` written onto the opening fence line. Only that span moves, so the
 * indent, both marker runs, the body and the closer come through byte-identical. Null when
 * line 0 does not read as this block's opener at all.
 */
export function writeFenceInfo(display: string, info: string, fence: FenceShape): string | null {
	const first = firstDisplayLine(display);
	const opener = splitOpener(first.text, fence);
	if (!opener) return null;
	return (
		display.slice(0, opener.runEnd) + legalInfo(info, fence) + display.slice(first.text.length)
	);
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * A whole `raw` through the rule, with an offset into it carried along. The trailing line ending
 * is the written one, else the block's own: an unterminated last block stays unterminated.
 */
function reconcileFenceRaw(
	raw: string,
	offset: number,
	fence: FenceShape,
	ctx: WriteContext
): { raw: string; offset: number } {
	const ending = trailingLineEnding(ctx.node.raw, ctx.lineEnding);
	const display = trimTrailingLineEnding(raw);
	const tail = ownTrailingLineEnding(raw) || ownTrailingLineEnding(ctx.node.raw);
	const caret = Math.min(offset, display.length);
	const written = reconcileFenceWrite({ display, caret, fence, mode: ctx.mode, ending });
	const intoTail = Math.min(Math.max(offset - display.length, 0), tail.length);
	return { raw: written.display + tail, offset: written.caret + intoTail };
}

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

/**
 * The fence the written bytes carry. Content arriving whole is read as the grammar reads it, so an
 * opener run a replace grew or shrank sizes the fence; typing keeps the block's own run, since a
 * marker typed at the start of the info string is info, not a longer run.
 */
function writtenFence(display: string, fence: FenceShape, mode: FenceWriteMode): FenceShape {
	if (mode === 'authored') return fence;
	const anatomy = fenceAnatomy(firstDisplayLine(display).text, { marker: fence.marker, length: 3 });
	return anatomy ? { ...fence, length: anatomy.length } : fence;
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
function reconcileFenceLines(
	written: FenceWriteResult,
	fence: FenceShape,
	blockEnding: LineEnding
): FenceWriteResult {
	if (!fence.closed) return written;
	const lines = displayLines(written.display);
	const opener = ownOpener(lines, fence);
	if (!opener) return droppedStrandedCloser(lines, fence, written.caret) ?? written;
	const restored = restoredCloser(lines, fence, opener, blockEnding);
	// The closer goes in after every written byte, so no offset moves.
	return restored === null ? written : { display: restored, caret: written.caret };
}

/**
 * Line 0 read as the block's own opener, at the run {@link writtenFence} sized. A write whose
 * only line reads as this fence's closer is not one: an opener never doubles as a closer.
 */
function ownOpener(lines: DisplayLine[], fence: FenceShape): OpenerParts | null {
	const opener = splitOpener(lines[0].text, fence);
	if (!opener) return null;
	if (lines.length === 1 && matchFenceClose(lines[0].text, fence.marker, fence.length)) return null;
	return opener;
}

/**
 * Puts back the closer a truncating write dropped, or null when one is still there. The line
 * ending is the block's, not the written slice's, which may have none.
 */
function restoredCloser(
	lines: DisplayLine[],
	fence: FenceShape,
	opener: OpenerParts,
	blockEnding: string
): string | null {
	if (lastCloserIndex(lines, fence) !== -1) return null;
	const closer = opener.indent + fence.marker.repeat(fence.length);
	return joinDisplayLines(lines) + blockEnding + closer;
}

/**
 * Drops the closer a write stranded by removing the block's own opener, since as text it would
 * open a fence over the blocks below. Null when there is none, or when a line above could close on
 * that run (same marker, run no longer than the closer's).
 */
function droppedStrandedCloser(
	lines: DisplayLine[],
	fence: FenceShape,
	caret: number
): FenceWriteResult | null {
	const closer = lastCloserIndex(lines, fence, 0);
	if (closer === -1) return null;
	const run = /^ {0,3}([`~]+)/.exec(lines[closer].text)![1].length;
	const claimed = (line: DisplayLine): boolean => {
		const open = matchFenceOpen(line.text);
		return open !== null && open.marker === fence.marker && open.length <= run;
	};
	if (lines.slice(0, closer).some(claimed)) return null;
	return withoutLine(lines, closer, caret);
}

/**
 * The lines with one removed; dropping the last line takes the ending above it too. A caret inside
 * the removed span lands where the span was.
 */
function withoutLine(lines: DisplayLine[], index: number, caret: number): FenceWriteResult {
	let from = lineStartOffset(joinDisplayLines(lines), index);
	let to = from + lines[index].text.length + lines[index].ending.length;
	const kept = lines.slice(0, index).concat(lines.slice(index + 1));
	if (index === lines.length - 1 && kept.length > 0) {
		const above = kept[kept.length - 1];
		from -= above.ending.length;
		to = from + above.ending.length + lines[index].text.length;
		kept[kept.length - 1] = { ...above, ending: '' };
	}
	const moved = caret <= from ? caret : Math.max(from, caret - (to - from));
	return { display: joinDisplayLines(kept), caret: moved };
}

function sanitizeInfoString(input: FenceWriteInput): FenceWriteResult {
	const { display, caret, fence } = input;
	if (fence.marker !== '`') return { display, caret };
	const first = firstDisplayLine(display);
	const opener = splitOpener(first.text, fence);
	if (!opener || !opener.info.includes('`')) return { display, caret };

	const kept = opener.info.replaceAll('`', '');
	const dropped = countDroppedBefore(opener.info, opener.runEnd, caret);
	return {
		display:
			opener.indent + fence.marker.repeat(fence.length) + kept + display.slice(first.text.length),
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
	const lines = displayLines(display);
	// A closer still on its own line needs nothing; so does a display too short to hold one.
	if (lines.length < 2 || lastCloserIndex(lines, fence) >= 1) return { display, caret };
	const run = new RegExp(`[${fence.marker}]{${fence.length},}[ \t]*$`).exec(
		lines[lines.length - 1].text
	);
	// `index === 0` is a bare run another rule handles, not one the write ran into.
	if (!run || run.index === 0) return { display, caret };
	const at = display.length - run[0].length;
	// Two lines at least, so the display holds the ending the new line takes.
	const ending = firstLineEnding(display) ?? '\n';
	return {
		display: display.slice(0, at) + ending + display.slice(at),
		// The caret sits at the end of the typed text, exactly where the line ending goes in: it
		// stays put, and only a caret already inside the closer run moves.
		caret: caret > at ? caret + ending.length : caret
	};
}

function escalateFenceRuns(input: FenceWriteInput): FenceWriteResult {
	const { display, caret, fence } = input;
	const lines = displayLines(display);
	const opener = splitOpener(lines[0].text, fence);
	if (!opener || lines.length < 2) return { display, caret };

	// An open fence has no closer line, so a literal write measures everything below
	// the opener; a closed one measures only what sits above its own closer.
	const closerIndex = fence.closed ? lastCloserIndex(lines, fence) : -1;
	if (fence.closed && closerIndex < 1) return { display, caret };
	const bodyEnd = closerIndex === -1 ? lines.length : closerIndex;
	const body = joinDisplayLines(lines.slice(1, bodyEnd));

	const grown = escalatedFenceLength(body, fence.marker, fence.length);
	const delta = grown - fence.length;
	if (delta === 0) return { display, caret };

	const run = fence.marker.repeat(grown);
	lines[0] = { ...lines[0], text: opener.indent + run + opener.info };
	let closerRunStart = -1;
	if (closerIndex !== -1) {
		const closerText = lines[closerIndex].text;
		const closerIndent = /^ {0,3}/.exec(closerText)![0];
		const tail = closerText.slice(closerIndent.length).replace(/^[`~]+/, '');
		closerRunStart = lineStartOffset(display, closerIndex) + closerIndent.length;
		lines[closerIndex] = { ...lines[closerIndex], text: closerIndent + run + tail };
	}

	// The run grows in place, so a caret past an insertion point moves with it.
	let moved = caret;
	if (caret > opener.runEnd) moved += delta;
	if (closerRunStart !== -1 && caret > closerRunStart) moved += delta;
	return { display: joinDisplayLines(lines), caret: moved };
}

/** Last line reading as this fence's closer at or after `from`; line 0 is the opener's line. */
function lastCloserIndex(lines: DisplayLine[], fence: FenceShape, from = 1): number {
	for (let i = lines.length - 1; i >= from; i--) {
		if (matchFenceClose(lines[i].text, fence.marker, fence.length)) return i;
	}
	return -1;
}

function lineStartOffset(display: string, lineIndex: number): number {
	let offset = 0;
	for (let i = 0; i < lineIndex; i++) offset = display.indexOf('\n', offset) + 1;
	return offset;
}
