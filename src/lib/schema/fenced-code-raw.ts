/**
 * The fencedCode raw-write rule, declared on the kind as `normalizeRawWrite` and applied at
 * every write sink. ESCALATE grows both runs past a body line that would read as the closer;
 * SANITIZE drops backticks from a backtick fence's info string (CommonMark §4.5). Both read
 * the block's OWN fence shape, which is why the pass takes a node and not just bytes. An
 * authored open fence is exempt: typing the closer is the gesture.
 */

import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { escalatedFenceLength, matchFenceClose } from '../core/parsers/fence-syntax';

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
 * typing the block's own syntax.
 */
export function normalizeFencedRaw(raw: string, node: NodeView): string {
	const written = reconcileFenceWrite({
		display: trimTrailingLineEnding(raw),
		caret: 0,
		fence: fenceShapeOf(node),
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

function lastCloserIndex(lines: string[], fence: FenceShape): number {
	for (let i = lines.length - 1; i >= 1; i--) {
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
