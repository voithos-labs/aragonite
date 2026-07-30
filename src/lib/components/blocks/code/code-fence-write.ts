/**
 * Write-side fence reconciliation for a fenced code block — the one seam every route
 * that commits new display text consults: typing and IME (the surface's
 * `commitInput`) and paste (`computeCodePaste`). `code-fence-boundary.ts` polices
 * WHERE an edit may land; this polices what the block's grammar can hold once it has
 * landed, and rewrites the fence lines when it must. That rewrite is the system
 * answering a legal content edit, not a user editing structure — the same shape as a
 * directive's colon escalation (`escalatedColonCount`).
 *
 * Two rules, both scoped to a CLOSED fence, because a closed fence is what a bad
 * write turns into a block that absorbs the rest of the document:
 *
 *  - ESCALATE. A body line the parser would read as this block's closer grows BOTH
 *    fence runs past it, so the line stays content. Typing ` ``` ` inside a closed
 *    block is then what pasting one has always been: literal text, not a terminator.
 *  - SANITIZE. A backtick anywhere in a backtick fence's info string is
 *    unrepresentable at any fence length (CommonMark §4.5 — the info string may not
 *    contain one), so it is dropped: typing one is inert, and a paste carrying one
 *    lands without it. Tilde fences have no such rule and are left alone.
 *
 * An UNCLOSED fence is left alone by both: its marker run is editable content
 * (`crossesFenceBoundary`), typing a closer there is the authoring gesture that ends
 * the block, and it has no closer to fall out of agreement with. The one exception is
 * a LITERAL write — a paste, whose bytes are content by contract — where an open
 * fence still grows its opener rather than letting the pasted run terminate the
 * block.
 */

import { escalatedFenceLength, matchFenceClose } from '../../../core/parsers/fenced-code';

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

export function reconcileFenceWrite(input: FenceWriteInput): FenceWriteResult {
	const { fence, mode } = input;
	if (!fence.closed && mode === 'authored') return { display: input.display, caret: input.caret };
	const sanitized = fence.closed ? sanitizeInfoString(input) : input;
	return escalateFenceRuns({ ...input, ...sanitized });
}

// ── Internal ────────────────────────────────────────────────────────────────

interface OpenerParts {
	indent: string;
	info: string;
	/** Offset just past the opener's marker run — where an escalation inserts. */
	runEnd: number;
}

/**
 * The opener line split by the block's OWN run length rather than by re-scanning the
 * written line. A backtick typed at the head of the info string reads as a longer run
 * once written (` ```js ` + `` ` `` is ` ````js `), and the whole point is to see it
 * as what it was: a character typed into the info string.
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
