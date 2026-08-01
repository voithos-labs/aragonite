/**
 * The fencedCode raw-write rule, declared on the kind as `normalizeRawWrite` and applied at every
 * write sink. RESTORE re-appends a closer a truncating write dropped and DROP removes one it
 * stranded, ESCALATE grows both runs past a body line that would read as the closer, SANITIZE
 * drops backticks from a backtick fence's info string (CommonMark §4.5) — all off the block's OWN
 * fence shape, which is why the pass takes a node. An authored open fence is exempt.
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
	/** The block's own run length, from its metadata — not re-scanned from the write. */
	length: number;
	closed: boolean;
}

/** Whether the written bytes are the user authoring the block's syntax, or content. */
export type FenceWriteMode = 'authored' | 'literal';

export interface FenceWriteInput {
	/** Display text about to be committed — raw without its trailing line ending. */
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
	return escalateFenceRuns({ ...input, ...sanitizeInfoString(input) });
}

/**
 * A whole fencedCode `raw` made legal — the kind's `normalizeRawWrite`. Literal by
 * construction: a sink reaching a node's bytes without its surface is never the author
 * typing the block's own syntax. The fence lines reconcile first, so ESCALATE measures a
 * body that ends where the closer does.
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

// ── Internal ────────────────────────────────────────────────────────────────

interface OpenerParts {
	indent: string;
	info: string;
	/** Offset just past the opener's marker run — where an escalation inserts. */
	runEnd: number;
}

/**
 * Split by the block's OWN run length, not by re-scanning the written line: a backtick
 * typed at the head of the info string must read as info, not as a longer run.
 */
function splitOpener(line: string, fence: FenceShape): OpenerParts | null {
	const indent = /^ {0,3}/.exec(line)![0];
	const runEnd = indent.length + fence.length;
	if (line.slice(indent.length, runEnd) !== fence.marker.repeat(fence.length)) return null;
	return { indent, info: line.slice(runEnd), runEnd };
}

/**
 * The block's fence lines against a write that took one of them — an unclosed fence absorbs every
 * block below it at the next parse, from either half. With the block's own opener still at line 0
 * a missing closer comes back; without it a surviving closer is machinery the write stranded and
 * goes. The arms split on {@link ownOpener}, so exactly one can fire.
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
 * Line 0 read as the block's OWN opener: its exact run, and info that is not a longer run. A
 * write's only line reading as this fence's CLOSER is not it — an opener never doubles as one,
 * and no metadata claims a block to size a fence to (issue #58).
 */
function ownOpener(lines: string[], fence: FenceShape): OpenerParts | null {
	const opener = splitOpener(lines[0], fence);
	if (!opener || opener.info.startsWith(fence.marker)) return null;
	if (lines.length === 1 && matchFenceClose(lines[0], fence.marker, fence.length)) return null;
	return opener;
}

/**
 * The closer a truncating write dropped, re-appended, or null when one is still there. The ending
 * is the BLOCK's, not the written slice's, which may be unterminated (G4.20).
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
 * The closer a write left behind after taking the block's own opener — machinery no metadata
 * claims, removed rather than kept, since as text it re-opens a fence over the live siblings
 * below (issue #58). Null when there is none, or when an opener above could CLOSE on the run:
 * same marker, run no longer than the closer's — a foreign-marker or longer-run open line is
 * body text the run never terminated.
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

/** Last line reading as this fence's closer at or after `from`; line 0 is the opener's slot. */
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
