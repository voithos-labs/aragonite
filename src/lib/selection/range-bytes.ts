/**
 * A selection read as the bytes the range-edit core takes (`range-edit/edit-range.ts :: Range`):
 * each end's byte in the document, kept off a block its start can't join, then widened to every
 * block the coverage holds whole (G1.212). Copy, cut and the overlay read a range through here.
 * The other way, a place the core names reads back as the caret the editor puts down there
 * (`landingAt`, `heldGapOf`), and a paste is named a place (`placeInBlock` and its siblings, read
 * through `placeRead`).
 */

import { untrack } from 'svelte';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import type { DocumentView, NodeView } from '../core/node-views';
import { displayLength, isBlankText, ownTrailingLineEnding, type LineEnding } from '../core/lines';
import { metadataOf } from '../core/nodes';
import { docPathFrom, type DocPath } from '../core/coordinate-spaces';
import { countsCells, isGridKind } from '../schema/block-kind-descriptor';
import { isMergeEligible } from '../schema/merge-rules';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { documentByteMap, leafAtByte } from '../tree-operations/container-offsets';
import type { Measured } from '../tree-operations/top-level-starts';
import {
	gapEligibleAt,
	gapScopeChildren,
	type GapCaretPosition,
	type GapCaretSelection
} from './gap-caret';
import { blockFacts } from '../schema/block-facts';
import { getContentRange, isProseKind } from '../core/inline';
import type { Held, Range } from '../range-edit/edit-range';
import type { SpliceCaret } from '../action-contracts';
import { documentLayout, type LaidBlock, type Layout } from '../range-edit/layout';
import type { CurrentDocument } from '../range-edit/host';
import { pathsEqual } from './path-math';
import { boundaryHidden, previousCaretPath } from './path-lookup';
import type { Landing, SelectionPoint } from './primitives';
import { caretTargetFor } from './caret-target';
import { CURSOR_END } from '../block-component';
import type { RangeCoverage } from './range-coverage';
import { checkRangeHoldsWhole } from '../invariants/range-holds-whole';

/** The editor's document as a range edit reads it: its tree, its bytes and their layout. */
export interface DocumentBytes {
	doc(): DocumentView;
	source(): string;
	layout(): Layout;
	/** The document with the starts of its top-level blocks, kept across writes. */
	measured(): Measured;
	/** The caret the core named for the last cut and the measure the cut left, which a paste back
	 *  at that caret reads; null once anything else is known to have written. */
	cut: { caret: SpliceCaret; of: Measured } | null;
	/** Whether what is kept of top-level blocks `[from, to]` is what the tree holds; a record found
	 *  wrong is forgotten, so the next read is fresh (`KeptStarts.vouch`). */
	vouch(from: number, to: number): boolean;
}

/** The layout is made once per measured document, which every byte writer's announcement
 *  replaces (G1.52); `version` is read so a reactive caller follows the announcements. */
export function documentBytes(deps: {
	version(): number;
	doc(): DocumentView;
	source(): string;
	measured(): Measured;
	vouch(from: number, to: number): boolean;
}): DocumentBytes {
	let laid: { of: Measured; layout: Layout } | undefined;
	return {
		doc: deps.doc,
		source: deps.source,
		measured: deps.measured,
		cut: null,
		vouch: deps.vouch,
		layout() {
			deps.version();
			const of = deps.measured();
			if (laid?.of !== of) laid = { of, layout: documentLayout(of) };
			return laid.layout;
		}
	};
}

/** `doc`, bytes a gesture answered and has not committed, read as the editor reads its own; no cut
 *  is remembered there. */
export function answeredBytes(doc: CurrentDocument): DocumentBytes {
	const layout = doc.layout ?? documentLayout(doc.measured);
	return {
		doc: () => doc.measured.doc,
		source: () => doc.source,
		layout: () => layout,
		measured: () => doc.measured,
		cut: null,
		vouch: () => true
	};
}

/** A range and the document it was read from, as the range-edit core takes them. */
export interface RangeRead {
	range: Range;
	source: string;
	measured: Measured;
	layout: Layout;
}

/** The one read every range gesture starts from: the range `rangeOf` finds for `named`, the paths
 *  it was asked by, and its document. A record wrong for their blocks or the range's reads twice. */
export function rangeRead(
	bytes: DocumentBytes,
	named: readonly (readonly number[])[],
	rangeOf: (layout: Layout) => Range | null
): RangeRead | null {
	for (let fresh = false; ; fresh = true) {
		const source = bytes.source();
		const measured = bytes.measured();
		const layout = bytes.layout();
		const range = rangeOf(layout);
		if (!range) return null;
		const { starts } = measured;
		let from = starts.holding(range.from);
		let to = starts.holding(Math.max(range.to - 1, range.from));
		// A named block the record holds at another length puts its bytes in other blocks.
		for (const [top] of named) {
			from = Math.min(from, top);
			to = Math.max(to, top);
		}
		if (bytes.vouch(from, to) || fresh) return { range, source, measured, layout };
	}
}

/** The paths a coverage's range was asked by. */
export const endsOf = ({ range }: RangeCoverage) => [range.start.path, range.end.path];

/** The range's bytes; null for a rectangle of cells inside one table, which never reaches the core. */
export function rangeBytes(
	doc: DocumentView,
	coverage: RangeCoverage,
	layout: Layout
): Range | null {
	if (coverage.grid) return null;
	const { start, end } = coverage.range;
	let from = endByte(doc, layout, start, 'start');
	let to = endByte(doc, layout, end, 'end');
	if (from === null || to === null) return null;
	to = Math.max(from, endBesideText(doc, layout, coverage, to));
	// After the end steps back, so it never stops inside a block held whole (a closed details).
	const held = heldSpans(doc, coverage, layout);
	if (!held) return null;
	for (const span of held) {
		from = Math.min(from, span.from);
		to = Math.max(to, span.to);
	}
	// A range across blocks from the first caret position to the last is select-all's, which takes
	// every container's markers with it.
	const edges = !pathsEqual(start.path, end.path) && caretEdges(doc, layout);
	if (edges && from <= edges.first && to >= edges.last) from = 0;
	assertInvariant('range-holds-whole', () => checkRangeHoldsWhole({ from, to }, held));
	return { from, to };
}

/** The bytes a removal takes: the range's, or a table whose every cell the range holds. */
export function removalBytes(
	doc: DocumentView,
	coverage: RangeCoverage,
	layout: Layout
): Range | null {
	if (coverage.grid?.kind !== 'table') return rangeBytes(doc, coverage, layout);
	return wholeBlockBytes(doc, layout, coverage.grid.path);
}

/** The bytes of the block at `path` taken whole: its first byte to its last line's text. */
export function wholeBlockBytes(
	doc: DocumentView,
	layout: Layout,
	path: readonly number[]
): Range | null {
	const block = layout.block(path);
	return block ? { from: block.from, to: textEnd(doc, block) } : null;
}

/** The selection point naming byte `at`: the text block holding it and the offset there. */
export function pointAtByte(measured: Measured, at: number): SelectionPoint | null {
	const leaf = leafAtByte(measured, at);
	return leaf && { path: leaf.path.slice(), offset: leaf.offset };
}

/** How a range across blocks paints: one box over each block whose bytes lie inside the range's
 *  while its parent's don't. A table's rows paint through its cells, never as boxes, and a range
 *  inside one block boxes only a unit it holds whole. */
export interface RangePaint {
	readonly coverage: RangeCoverage;
	/** The block holding `path`, itself included, that paints as one box; null for none. */
	boxHolding(path: readonly number[]): DocPath | null;
}

/** Reads nothing until asked, and untracked: a caller makes a new paint for each coverage and
 *  content version. */
export function rangePaint(doc: DocumentView, coverage: RangeCoverage, layout: Layout): RangePaint {
	const { start, end } = coverage.range;
	let range: Range | null | undefined;
	const boxHolding = (path: readonly number[]): DocPath | null => {
		if (range === undefined) {
			range = pathsEqual(start.path, end.path) ? null : rangeBytes(doc, coverage, layout);
		}
		if (!range) return coverage.rootHolding(path);
		for (let depth = 1; depth <= path.length; depth++) {
			const block = layout.block(path.slice(0, depth));
			if (!block) return null;
			if (range.from <= block.from && textEnd(doc, block) <= range.to)
				return docPathFrom(block.path);
			if (countsCells(blockNodeAt(doc, block.path)!)) return null;
		}
		return null;
	};
	return { coverage, boxHolding: (path) => untrack(() => boxHolding(path)) };
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Where a block's own bytes end: its last line's text, since its line ending reads as the next
 *  line's edge. */
const textEnd = (doc: DocumentView, block: LaidBlock) =>
	block.to - ownTrailingLineEnding(blockNodeAt(doc, block.path)!.raw).length;

/** The bytes of each block the coverage holds whole: a container's to its last line's text, a
 *  leaf's to its last character, since a title row's line goes on into its container's tags. */
function heldSpans(doc: DocumentView, coverage: RangeCoverage, layout: Layout): Range[] | null {
	const spans: Range[] = [];
	for (const root of coverage.wholeRoots) {
		const block = layout.block(root);
		const node = blockNodeAt(doc, root);
		if (!block || !node) return null;
		const last = node.children?.length ? null : layout.byteOf(root, displayLength(node.raw));
		spans.push({ from: block.from, to: last ?? textEnd(doc, block) });
	}
	return spans;
}

/** A text end's byte; a cell end's row, or its whole table where the range enters by the first row
 *  or leaves by the last; any other block's own edge, since its offsets address no text. */
function endByte(
	doc: DocumentView,
	layout: Layout,
	point: SelectionPoint,
	side: 'start' | 'end'
): number | null {
	const node = blockNodeAt(doc, point.path);
	if (!node) return null;
	// No end sits between a line's `\r` and its `\n`.
	const { raw } = node;
	const offset =
		raw[point.offset - 1] === '\r' && raw[point.offset] === '\n' ? point.offset - 1 : point.offset;
	const byte = point.cellCoordinate ? null : layout.byteOf(point.path, offset);
	if (byte !== null) return byte;
	const row = point.cellCoordinate
		? Math.floor(point.offset / metadataOf(node, 'table').columnCount)
		: null;
	const whole = row !== null && row === (side === 'end' ? 0 : (node.children?.length ?? 0) - 1);
	const block = layout.block(row === null || whole ? point.path : [...point.path, row]);
	if (!block) return null;
	return side === 'start' ? block.from : row === null || whole ? textEnd(doc, block) : block.to;
}

/** An end on the first byte of a block the start's block can't join moves back to the text before
 *  that block, so the range takes neither the block nor the blank lines that keep it apart. */
function endBesideText(
	doc: DocumentView,
	layout: Layout,
	coverage: RangeCoverage,
	to: number
): number {
	const { start, end } = coverage.range;
	if (start.cellCoordinate || end.cellCoordinate || layout.block(end.path)?.from !== to) return to;
	const startKind = blockNodeAt(doc, start.path)?.kind;
	const endKind = blockNodeAt(doc, end.path)?.kind;
	if (!startKind || !endKind || isMergeEligible(startKind, endKind)) return to;
	const before = previousCaretPath(doc, end.path);
	if (!before) return to;
	// A cell's text ends where its table does.
	const table = before.findIndex((_, i) => countsCells(blockNodeAt(doc, before.slice(0, i + 1))!));
	if (table < 0) return layout.byteOf(before, displayLength(blockNodeAt(doc, before)!.raw)) ?? to;
	const block = layout.block(before.slice(0, table + 1));
	return block ? textEnd(doc, block) : to;
}

/** The document's first and last caret positions, as bytes. */
function caretEdges(doc: DocumentView, layout: Layout): { first: number; last: number } | null {
	const firstPath = edgeLeaf(doc, 0);
	const lastPath = edgeLeaf(doc, -1);
	if (!firstPath || !lastPath) return null;
	const first = layout.byteOf(firstPath, 0);
	const last = layout.byteOf(lastPath, displayLength(blockNodeAt(doc, lastPath)!.raw));
	return first === null || last === null ? null : { first, last };
}

/** The first or last block with no children, outermost path first. */
function edgeLeaf(doc: DocumentView, at: 0 | -1): number[] | null {
	const path: number[] = [];
	let children = doc.children;
	while (children.length > 0) {
		path.push(at === 0 ? 0 : children.length - 1);
		children = children.at(at)!.children ?? [];
	}
	return path.length > 0 ? path : null;
}

/** The byte a gap caret stands at: where the block after it starts, or where its container ends. */
export function byteOfGap(
	measured: Measured,
	{ parentPath, index }: GapCaretPosition
): number | null {
	const { doc, starts } = measured;
	const parent = parentPath.length === 0 ? doc : blockNodeAt(doc, parentPath);
	if (!parent?.children) return null;
	const map = documentByteMap(measured);
	if (index < parent.children.length) return map.byteOf([...parentPath, index], 0);
	if (parentPath.length === 0) return starts.length;
	return map.endOf(parentPath, (parent as { raw: string }).raw.length);
}

// ── Where a paste goes ──────────────────────────────────────────────────────

/** Where a paste goes, as the range-edit core takes it: the bytes it replaces, and for a caret what
 *  sits there. Made only by the readers below, so a caret on a block's syntax is never called text.
 *  `back`, on a caret where the last cut left it, is that cut's own caret: the one place the entry
 *  the cut wrote fits, so only a paste of that entry goes there. */
export type PastePlace = { range: Range; ending?: LineEnding; back?: SpliceCaret } & Held;

/** A paste's place as one of the readers below finds it, and the paths it was asked by, which
 *  `placeRead` vouches with the place's own blocks. */
export interface PasteAim {
	named: readonly (readonly number[])[];
	place(): PastePlace | null;
}

/** `rangeRead` for a paste: the place `aim` finds and its document, both read again where the
 *  record is found wrong for the blocks they reach. */
export function placeRead(
	bytes: DocumentBytes,
	aim: PasteAim
): (RangeRead & { place: PastePlace }) | null {
	const found: { place?: PastePlace | null } = {};
	const read = rangeRead(bytes, aim.named, () => (found.place = aim.place())?.range ?? null);
	return read && found.place ? { ...read, place: found.place } : null;
}

/** The place of raw offsets `[start, end]` of the text block at `path`. A live caret outside the
 *  block's text names the boundary beside it; a live range's ends stand at the text's edges. */
export function placeInBlock(
	bytes: DocumentBytes,
	path: readonly number[],
	start: number,
	end: number,
	live: boolean
): PastePlace | null {
	const layout = bytes.layout();
	const from = layout.byteOf(path, start);
	const to = start === end ? from : layout.byteOf(path, end);
	if (from === null || to === null) return null;
	const place = textPlace(bytes, path, from, to, live);
	const back = from === to ? cutCaretAt(bytes, from) : null;
	return place && back ? { ...place, back } : place;
}

function textPlace(
	bytes: DocumentBytes,
	path: readonly number[],
	from: number,
	to: number,
	live: boolean
): PastePlace | null {
	const text = bytes.layout().block(path)?.text;
	if (!live || !text) return { range: { from, to }, holds: 'text' };
	const inText = (at: number) => Math.min(Math.max(at, text.from), text.to);
	if (from !== to) return { range: { from: inText(from), to: inText(to) }, holds: 'text' };
	if (from === inText(from)) return { range: { from, to }, holds: 'text' };
	return from < text.from ? placeBeside(bytes, path, 0) : placeBeside(bytes, path, 1);
}

/** The bytes a range the editor holds covers, which a paste over it replaces. */
export function placeOverRange(bytes: DocumentBytes, coverage: RangeCoverage): PastePlace | null {
	const range = removalBytes(bytes.doc(), coverage, bytes.layout());
	return range && { range, holds: 'text' };
}

/** The boundary a gap caret stands at, among its parent's children. */
export function placeOfGap(bytes: DocumentBytes, gap: GapCaretPosition): PastePlace | null {
	const at = byteOfGap(bytes.measured(), gap);
	if (at === null) return null;
	const back = cutCaretAt(bytes, at);
	return { ...boundary(at, gap.parentPath), ...(back && { back }) };
}

/** The boundary under the block at `path`, where a paste on a block focused whole lands. */
export function placeAfterBlock(bytes: DocumentBytes, path: readonly number[]): PastePlace | null {
	const place = placeBeside(bytes, path, 1);
	const block = bytes.layout().block(path);
	const cut = bytes.cut;
	// A cut that left the caret on this block took from above it, where its entry goes back.
	if (place && block && cut?.of === bytes.measured() && cut.caret.holds === 'block')
		if (cut.caret.at === block.from) return { ...place, back: cut.caret };
	return place;
}

/** The core's own caret for the last cut, where a caret at byte `at` stands where that cut left it.
 *  Null for any other byte, or once the document moved on. */
function cutCaretAt(bytes: DocumentBytes, at: number): SpliceCaret | null {
	const cut = bytes.cut;
	if (!cut || cut.of !== bytes.measured() || cut.caret.holds === 'block') return null;
	const measured = bytes.measured();
	const landing = landingAt(measured, cut.caret);
	if (!landing || landedByte(measured, landing) !== at) return null;
	// A gap stands where its line starts, which the core's byte for a container's end comes before.
	return 'gapCaret' in landing ? { ...cut.caret, at } : cut.caret;
}

/** The byte the editor puts a landing down at: a gap's, a stored caret's, or where the block's own
 *  landing rule moves a caret (out of a body a closed container hides). */
function landedByte(measured: Measured, landing: Landing | GapCaretSelection): number | null {
	if ('gapCaret' in landing) return byteOfGap(measured, landing.gapCaret);
	const at = 'anchor' in landing ? landing.anchor : landing;
	const target = caretTargetFor(measured.doc, { path: docPathFrom(at.path), offset: at.offset });
	if (!target) return null;
	const raw = blockNodeAt(measured.doc, target.leafPath)?.raw ?? '';
	const offset = target.offset === CURSOR_END ? displayLength(raw) : target.offset;
	return documentByteMap(measured).byteOf(target.leafPath, offset);
}

const boundary = (at: number, parent: readonly number[]): PastePlace => ({
	range: { from: at, to: at },
	holds: 'boundary',
	parent
});

function placeBeside(
	bytes: DocumentBytes,
	path: readonly number[],
	after: 0 | 1
): PastePlace | null {
	const parentPath = path.slice(0, -1);
	const at = byteOfGap(bytes.measured(), { parentPath, index: path[path.length - 1] + after });
	return at === null ? null : boundary(at, parentPath);
}

/** The boundary a place names among `parent`'s children, or a child's own where `at` falls ahead
 *  of them: before the first starting at or past `at`, else after the last. */
export function gapOfPlace(
	measured: Measured,
	place: { at: number; parent: readonly number[] }
): GapCaretPosition {
	const { doc } = measured;
	// A table's rows, or a path holding no blocks, stand for the block around them.
	let parentPath = [...place.parent];
	const grid = parentPath.findIndex((_, i) => {
		const node = blockNodeAt(doc, parentPath.slice(0, i + 1));
		return !!node && isGridKind(node.kind);
	});
	if (grid >= 0) parentPath = parentPath.slice(0, grid);
	while (parentPath.length > 0 && !gapScopeChildren(doc, parentPath))
		parentPath = parentPath.slice(0, -1);
	const map = documentByteMap(measured);
	for (;;) {
		const children = gapScopeChildren(doc, parentPath) ?? [];
		let index = 0;
		for (let past = children.length; index < past;) {
			const mid = (index + past) >> 1;
			if (map.byteOf([...parentPath, mid], 0)! >= place.at) past = mid;
			else index = mid + 1;
		}
		const inside = [...parentPath, index - 1];
		const child = children[index - 1];
		const own = child && !isGridKind(child.kind) ? gapScopeChildren(doc, inside) : null;
		// The byte sits inside the child before, ahead of one of that child's own children.
		const within = !!own?.length && map.byteOf([...inside, own.length - 1], 0)! >= place.at;
		if (!within) return { parentPath, index };
		parentPath = inside;
	}
}

/** The boundary where a block the removal took stood, `place` read on the bytes after; null where
 *  the text below joined a block above, whose own bytes then run on both sides of the byte. */
export function takenGapOf(
	measured: Measured,
	place: { at: number; parent: readonly number[] }
): GapCaretPosition | null {
	const leaf = leafAtByte(measured, place.at);
	const node = leaf && blockNodeAt(measured.doc, leaf.path);
	if (node && leaf.offset > 0 && leaf.offset < node.raw.trimEnd().length) return null;
	return gapOfPlace(measured, place);
}

/** The gap caret a removal's boundary place is held as, `held` where no arrow stops; null where
 *  the caret goes to the text at its byte (prose a typed letter joins, or a hidden body). */
export function heldGapOf(
	measured: Measured,
	place: { at: number; parent: readonly number[]; line?: true }
): GapCaretPosition | null {
	const gap = gapOfPlace(measured, place);
	const { doc } = measured;
	if (gapEligibleAt(doc, gap.parentPath, gap.index)) return gap;
	// The line a range emptied at the document's end is a place of its own, whatever stands above.
	const rootEnd = gap.parentPath.length === 0 && gap.index === doc.children.length;
	const docEnd = rootEnd || place.at === measured.starts.length;
	if (!docEnd && joinsProse(measured, place.at, gap.parentPath, place.line)) return null;
	if (boundaryHidden(doc, gap.parentPath, gap.index)) return null;
	// A list's children are its items, which no paragraph stands among.
	const parent = blockNodeAt(doc, gap.parentPath);
	if (parent && blockFacts(parent.kind).lines === 'items') return null;
	return { ...gap, held: true };
}

/** The caret at byte `caret.at`: the gap caret a boundary is held as, else text at that byte
 *  exactly, else the block's own landing (a block held whole, or a picture of its source). */
export function landingAt(
	measured: Measured,
	caret: SpliceCaret
): Landing | GapCaretSelection | null {
	if (caret.holds === 'boundary') {
		const gap = heldGapOf(measured, caret);
		if (gap) return { gapCaret: gap };
	}
	const leaf = leafAtByte(measured, caret.at);
	if (!leaf) return null;
	const point = { path: docPathFrom(leaf.path), offset: leaf.offset };
	// On the line a pasted last line ending opened, the caret lands as Enter's does: types plain.
	if (caret.line) return { ...point, fresh: true };
	const kind = blockNodeAt(measured.doc, leaf.path)?.kind;
	const exact = caret.holds === 'text' && kind && blockFacts(kind).textPosition === 'always';
	// Put down as a stored caret is, since a kind's own landing rule would move it off the byte.
	return exact ? { anchor: point, focus: point } : point;
}

/** Whether a letter typed on a line of its own at byte `at` joins a prose block's text inside
 *  `parent`; a pasted ending's `line` joins only a child of `parent`, never text starting below. */
function joinsProse(
	measured: Measured,
	at: number,
	parent: readonly number[],
	line?: true
): boolean {
	const map = documentByteMap(measured);
	const leaf = map.leafAt(at);
	const inside = leaf && parent.every((index, depth) => leaf.path[depth] === index);
	const node = inside && blockNodeAt(measured.doc, leaf.path);
	if (!node || (line && leaf.path.length !== parent.length + 1)) return false;
	// An empty paragraph there is that line itself.
	if (line && map.byteOf(leaf.path, leaf.offset)! > at && !isBlankText(node.raw)) return false;
	return blockFacts(node.kind).joins === 'text' && readsAsText(node, leaf.offset);
}

/** Whether text written at `offset` of `node` reads as its text: a prose block, inside its content. */
export function readsAsText(node: NodeView, offset: number): boolean {
	const content = getContentRange(node);
	return isProseKind(node.kind) && offset >= content.start && offset <= content.end;
}

/** The deepest boundary a gap caret may take where a block starts, or a container ends, at byte
 *  `at`, for a caller holding only the byte; null where none may. */
export function gapAtByte(measured: Measured, at: number): GapCaretPosition | null {
	const { doc, starts } = measured;
	const map = documentByteMap(measured);
	let found: GapCaretPosition | null = null;
	let parentPath: number[] = [];
	let children = doc.children;
	const startOf = (k: number) => map.byteOf([...parentPath, k], 0)!;
	// A child starting at or past `at`, or holding it; inside a container, the map's answer alone.
	let near = 0;
	for (let past = children.length; near < past;) {
		const mid = (near + past) >> 1;
		if (startOf(mid) >= at) past = mid;
		else near = mid + 1;
	}
	if (near === children.length) near = children.length - 1;
	let end = starts.length;
	// Where the container the walk is in reads `at`: the child it goes to and the offset there.
	let held: { index: number; offset: number } | null = null;
	for (;;) {
		const index = at === end ? children.length : startOf(near) === at ? near : -1;
		if (index >= 0 && gapEligibleAt(doc, parentPath, index)) found = { parentPath, index };
		// The last child starting at or before `at`.
		let i = near;
		while (i + 1 < children.length && startOf(i + 1) <= at) i++;
		if (i > 0 && startOf(i) > at) i--;
		const child = children[i];
		const inner = child?.children?.length ? map.containerMap(child) : null;
		if (!inner) return found;
		// `at` in the child's raw: a top-level block's raw is its bytes, and a byte the container
		// gave a later child lies past this one's end.
		let offset = at - startOf(i);
		if (held) offset = i === held.index ? held.offset : i < held.index ? child.raw.length : 0;
		parentPath = [...parentPath, i];
		end = map.endOf(parentPath, child.raw.length)!;
		children = child.children!;
		held = inner.childAt(offset);
		near = held.index;
	}
}
