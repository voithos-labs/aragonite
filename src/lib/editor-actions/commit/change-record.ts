/**
 * What a write changed, kept only while a draft is open. The document is read as parts (its prefix,
 * each top-level block's blank lines and bytes, its suffix); a record holds the run of parts a
 * write changed, before and after, so no write measures the whole document. A draft holds its
 * ranges as part positions and maps them through each record.
 */

import type { DocumentView, NodeView } from '../../core/node-views';
import { sharedPrefixLength, sharedSuffixLength, writtenSpan } from '../../core/written-span';
import { documentByteMap } from '../../tree-operations/container-offsets';
import { measured, type Measured } from '../../tree-operations/top-level-starts';
import { splitLines } from '../../core/lines';
import { unfinishedReadings, type GrammarView } from '../../schema/block-openers';

/** Each part as two pieces (blank lines, then bytes), so an unchanged part compares by reference. */
export interface RecordedChange {
	/** The first part the run holds. */
	readonly lo: number;
	readonly before: readonly string[];
	readonly after: readonly string[];
	/** Where a keystroke's typed text ends in the run's new bytes; null when the write can't say. */
	readonly typedEnd: number | null;
}

/** A byte of the document as one of its parts and an offset into it, short of the part's end. */
export interface PartPosition {
	readonly part: number;
	readonly offset: number;
}

export interface PartRange {
	readonly from: PartPosition;
	readonly to: PartPosition;
}

/** Top-level blocks `[from, to)`, as the document stood before a write. */
export interface BlockReach {
	from: number;
	to: number;
}

/** The parts a write may change, read before it runs. */
export interface ChangeCapture {
	readonly lo: number;
	readonly before: string[];
	readonly parts: number;
}

// ── Recording a write ────────────────────────────────────────────────────────

/** The parts `reach` names and a block either side, since the fix-up rewrites the block above, or
 *  every part with no reach. */
export function captureChange(doc: DocumentView, reach: BlockReach | null): ChangeCapture {
	const parts = doc.children.length + 2;
	const lo = reach ? Math.max(0, reach.from) : 0;
	const hi = reach ? Math.min(parts, reach.to + 2) : parts;
	return { lo, before: piecesOf(doc, lo, hi), parts };
}

/** The run the write changed, trimmed to the parts that differ; null when none does. `typedEnd` is
 *  a top-level block after the write and an offset into its blank lines and bytes. */
export function changeAfter(
	doc: DocumentView,
	capture: ChangeCapture,
	typedEnd: { block: number; offset: number } | null
): RecordedChange | null {
	const { before } = capture;
	const hi = capture.lo + before.length / 2 + doc.children.length + 2 - capture.parts;
	const after = piecesOf(doc, capture.lo, hi);
	let head = 0;
	while (head < Math.min(before.length, after.length) && samePart(before, after, head, head))
		head += 2;
	let tail = 0;
	while (
		tail < Math.min(before.length, after.length) - head &&
		samePart(before, after, before.length - 2 - tail, after.length - 2 - tail)
	)
		tail += 2;
	if (head === before.length && head === after.length) return null;
	const lo = capture.lo + head / 2;
	const kept = after.slice(head, after.length - tail);
	let end: number | null = null;
	if (typedEnd) {
		const pieces = (typedEnd.block + 1 - lo) * 2;
		if (pieces >= 0 && pieces < kept.length) end = lengthOf(kept, pieces) + typedEnd.offset;
	}
	return { lo, before: before.slice(head, before.length - tail), after: kept, typedEnd: end };
}

/** Whether a block written from `before` to `after` leaves the pairing of openers and closers as
 *  it was: neither leaves a reading waiting, and the lines that open or close one are the same. */
export function pairsStay(before: string, after: string, grammar: GrammarView): boolean {
	const readings = unfinishedReadings(grammar);
	if (readings.some((r) => r.notFinal(before) || r.notFinal(after))) return false;
	// A line that opens a reading on its own, or could close one.
	const pairing = (text: string) =>
		splitLines(text)
			.map((line) => line.text)
			.filter((line) =>
				readings.some((r) => (r.closer !== null && r.mayClose(line)) || r.notFinal(line + '\n'))
			);
	const [was, now] = [pairing(before), pairing(after)];
	return was.length === now.length && was.every((line, i) => line === now[i]);
}

// ── Positions ────────────────────────────────────────────────────────────────

/** The length of each part of the document. */
export function partLengths(doc: DocumentView): number[] {
	const lengths = [doc.prefix.length];
	for (const block of doc.children) lengths.push(block.leadingTrivia.length + block.raw.length);
	lengths.push(doc.suffix.length);
	return lengths;
}

/** `lengths` as they stood before `changes`, the newest undone first. */
export function lengthsBefore(lengths: number[], changes: readonly RecordedChange[]): number[] {
	let undone = lengths;
	for (let i = changes.length - 1; i >= 0; i--) {
		const { lo, before, after } = changes[i];
		undone = [
			...undone.slice(0, lo),
			...partLengthsOf(before),
			...undone.slice(lo + after.length / 2)
		];
	}
	return undone;
}

/** Byte `at` of bytes whose parts measure `lengths`, as a part position; the end is the part past
 *  the last. */
export function positionAt(lengths: readonly number[], at: number): PartPosition {
	let part = 0;
	while (part < lengths.length && at >= lengths[part]) at -= lengths[part++];
	return { part, offset: at };
}

/** Position `at` as a byte of `of`'s document by its kept starts, the coordinates the byte splice
 *  reads its text in, so a commit's offsets and the bytes it changes come from one record. */
export function byteIn(of: Measured, at: PartPosition): number {
	const blocks = of.doc.children.length;
	if (at.part === 0) return at.offset;
	// The part past the blocks is the suffix, and the one past that the document's end.
	return (at.part <= blocks + 1 ? of.starts.start(at.part - 1) : of.starts.length) + at.offset;
}

export function byteAt(lengths: readonly number[], at: PartPosition): number {
	let byte = at.offset;
	for (let part = 0; part < at.part; part++) byte += lengths[part];
	return byte;
}

/** The bytes of the block at `path`, without the blank lines above it. */
export function blockRange(doc: DocumentView, path: readonly number[]): PartRange | null {
	const top = doc.children[path[0]];
	if (!top) return null;
	const part = path[0] + 1;
	const blank = top.leadingTrivia.length;
	if (path.length === 1)
		return { from: { part, offset: blank }, to: { part: part + 1, offset: 0 } };
	// A document of the one block is its part: a byte of it counts the block's blank lines too.
	const alone = documentByteMap(
		measured({ kind: 'document', prefix: '', children: [top], suffix: '' })
	);
	const inner = [0, ...path.slice(1)];
	const node = blockAt(top, path.slice(1));
	if (!node) return null;
	const start = alone.byteOf(inner, 0);
	const end = alone.endOf(inner, node.raw.length);
	if (start === null || end === null) return null;
	const to = end === blank + top.raw.length ? { part: part + 1, offset: 0 } : { part, offset: end };
	return { from: { part, offset: start }, to };
}

/** `range` after `change`, or null when the change wrote inside it. Text written at either edge
 *  lands outside it; an empty range moves past text written where it stands. */
export function rangeThrough(range: PartRange, change: RecordedChange): PartRange | null {
	const x = spanOffset(range.from, change.lo, change.before);
	const y = spanOffset(range.to, change.lo, change.before);
	let [nx, ny] = [x, y];
	// A range wholly before or after the run needs no diff.
	if (y !== -Infinity && x !== Infinity) {
		const { from, to, inserted } = runOf(change);
		const touched = from < to ? from < y && to > x : x < from && from < y;
		if (touched || (x === y && from < x && x < to)) return null;
		const delta = inserted - (to - from);
		const at = (v: number, right: boolean) =>
			v < from || (v === from && !(right && from === to)) ? v : v + delta;
		nx = at(x, true);
		ny = x === y ? nx : at(y, false);
	}
	return { from: positionIn(nx, change, range.from), to: positionIn(ny, change, range.to) };
}

// ── Internal ─────────────────────────────────────────────────────────────────

function piecesOf(doc: DocumentView, lo: number, hi: number): string[] {
	const pieces: string[] = [];
	const last = doc.children.length + 1;
	for (let part = lo; part < hi; part++) {
		if (part === 0) pieces.push('', doc.prefix);
		else if (part === last) pieces.push('', doc.suffix);
		else pieces.push(doc.children[part - 1].leadingTrivia, doc.children[part - 1].raw);
	}
	return pieces;
}

const samePart = (a: readonly string[], b: readonly string[], i: number, j: number) =>
	a[i] === b[j] && a[i + 1] === b[j + 1];

function lengthOf(pieces: readonly string[], count = pieces.length): number {
	let length = 0;
	for (let i = 0; i < count; i++) length += pieces[i].length;
	return length;
}

function partLengthsOf(pieces: readonly string[]): number[] {
	const lengths: number[] = [];
	for (let i = 0; i < pieces.length; i += 2) lengths.push(pieces[i].length + pieces[i + 1].length);
	return lengths;
}

function blockAt(top: NodeView, path: readonly number[]): NodeView | undefined {
	let node: NodeView | undefined = top;
	for (const index of path) node = node?.children?.[index];
	return node;
}

/** A position as a byte of the run's old bytes; outside the run, as far as it lies. */
function spanOffset(at: PartPosition, lo: number, pieces: readonly string[]): number {
	const end = lo + pieces.length / 2;
	if (at.part < lo) return -Infinity;
	if (at.part > end || (at.part === end && at.offset > 0)) return Infinity;
	return lengthOf(pieces, (at.part - lo) * 2) + at.offset;
}

function positionIn(x: number, change: RecordedChange, was: PartPosition): PartPosition {
	if (x === -Infinity) return was;
	if (x === Infinity) {
		return {
			part: was.part + (change.after.length - change.before.length) / 2,
			offset: was.offset
		};
	}
	const at = positionAt(partLengthsOf(change.after), x);
	return { part: change.lo + at.part, offset: at.offset };
}

interface Run {
	/** The run's old bytes `[from, to)` gave way to `inserted` new bytes. */
	from: number;
	to: number;
	inserted: number;
}

const runs = new WeakMap<RecordedChange, Run>();

/** What the change replaced. Text equal to its neighbours could have gone in at several places:
 *  a keystroke's caret says which, and otherwise every place counts as changed. */
function runOf(change: RecordedChange): Run {
	let run = runs.get(change);
	if (run) return run;
	const a = change.before.join('');
	const b = change.after.join('');
	const { start: head, end, removedEnd } = writtenSpan(a, b);
	const inserted = end - head;
	const removed = removedEnd - head;
	const typedFrom = change.typedEnd === null ? -1 : change.typedEnd - inserted;
	if (
		typedFrom >= 0 &&
		typedFrom <= head &&
		a.slice(typedFrom + removed) === b.slice(typedFrom + inserted)
	) {
		run = { from: typedFrom, to: typedFrom + removed, inserted };
	} else {
		// The leftmost place the text could have gone, and the rightmost one's end.
		const shorter = Math.min(a.length, b.length);
		const headAfter = sharedPrefixLength(a, b, shorter - sharedSuffixLength(a, b, shorter));
		run = { from: headAfter, to: removedEnd, inserted: end - headAfter };
	}
	runs.set(change, run);
	return run;
}
