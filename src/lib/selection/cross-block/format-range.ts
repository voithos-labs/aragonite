/**
 * The per-block spans a cross-block format toggle rewrites, and the write over them; pure over
 * the tree, with the commit in `./format-toggle`. The direction is decided over the whole range:
 * every span already marked removes the mark, anything else adds it. Each span goes through the
 * single-block toggle, and a grid joins by its covered cells.
 */

import {
	activeInlineFormats,
	inlineFormatsCovering,
	isInlineFormatActive,
	isInlineFormatActiveAfter,
	toggleInlineFormat,
	withoutBoundaryWhitespace,
	type InlineFormatEdit,
	type ToggleInlineFormatResult
} from '../../core/inline/format-toggle';
import { getContentRange, type ContentRange } from '../../core/inline';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';
import type { Reading } from '../../schema/reading';
import type { GrammarView } from '../../schema/block-openers';
import { isGridKind, tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { blockNodeAt, type BodyParent } from '../../tree-operations/node-primitives';
import type { SharingState } from '../../tree-operations/sharing';
import { rewriteLeafInPlace } from '../../tree-operations/content-write';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import { rebuildUnsharedChain } from '../../tree-operations/chain-rebuild';
import { pathsEqual } from '../path-math';
import { charOffsetOf, type SelectionPoint } from '../primitives';
import {
	rangeCoverage,
	type CellRun,
	type CoveredRange,
	type RangeCoverage
} from '../range-coverage';
import { gridCellsInRect, gridCellsInRun, type GridCell } from '../table-endpoint-snap';

const TAG = 'cross-block-format';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockFormatWrite {
	path: number[];
	/** The block's display bytes after the toggle: its raw minus the trailing line ending. */
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

export interface CrossBlockFormatPlan {
	writes: CrossBlockFormatWrite[];
	/** The range's endpoints after the rewrite, each in its own space: a character offset in a
	 *  text block or a path-named grid cell, a cell index where the endpoint counts cells. */
	startOffset: number;
	endOffset: number;
}

/** Null where no block participates: the keystroke is still consumed, but nothing is written. */
export function planCrossBlockFormat(
	doc: DocumentView,
	range: CoveredRange,
	format: InlineMarkKind,
	reading: Reading
): CrossBlockFormatPlan | null {
	const coverage = rangeCoverage(doc, range);
	const { start, end } = range;
	const spans = spansInRange(doc, coverage, reading);
	if (spans.length === 0) return null;
	// Read once per span: the vote and the per-span skip below ask the same question, and the
	// answer costs a parse of the block's inlines.
	const covered = spans.map((span) => isInlineFormatActive(span.edit, format));
	const unapply = covered.every(Boolean);

	// Each endpoint keeps its own space: a participating span overwrites its side with a
	// character offset, and an endpoint counting cells owns no span, so its index stands.
	const plan: CrossBlockFormatPlan = {
		writes: [],
		startOffset: start.offset,
		endOffset: end.offset
	};
	for (const [index, span] of spans.entries()) {
		if (covered[index] !== unapply) continue;
		const toggled = toggleInlineFormat(span.edit, format);
		if (!toggled || !landedOnIntendedSide(span.edit, toggled, format, unapply)) continue;
		plan.writes.push({
			path: span.path,
			newDisplay: toggled.newDisplay,
			newSelStart: toggled.newSelStart,
			newSelEnd: toggled.newSelEnd
		});
		if (span.isStart) plan.startOffset = toggled.newSelStart;
		if (span.isEnd) plan.endOffset = toggled.newSelEnd;
		// An end block held whole stays held at its new last byte.
		if (!coverage.endEdge && pathsEqual(span.path, end.path)) {
			plan.endOffset = toggled.newDisplay.length;
		}
	}
	return plan.writes.length === 0 ? null : plan;
}

/** A mark is active where every participating span carries it. All marks at once, since
 *  splitting the range into spans is the cost and a toolbar asks once per button. */
export function crossBlockActiveFormats(
	doc: DocumentView,
	range: CoveredRange,
	reading: Reading
): ReadonlySet<InlineMarkKind> {
	const spans = spansInRange(doc, rangeCoverage(doc, range), reading);
	if (spans.length === 0) return new Set();
	// The running intersection is the next span's candidate set, so a span costs one parse and a
	// walk per mark still standing, and it empties where a per-mark `every` would stop.
	let active = activeInlineFormats(spans[0].edit);
	for (let index = 1; index < spans.length && active.size > 0; index++)
		active = inlineFormatsCovering(spans[index].edit, active);
	return active;
}

/** Writes a plan into the document body, copying each chain before writing. The caller owns the
 *  commit. */
export function applyCrossBlockFormat(
	body: BodyParent,
	plan: CrossBlockFormatPlan,
	sharing: SharingState,
	grammar: GrammarView
): void {
	const chains: CstNode[][] = [];
	for (const write of plan.writes) {
		const chain = ensureUnsharedPath(body, write.path, sharing);
		const owned = chain[chain.length - 1];
		if (!owned) continue;
		const owner: CstNode | undefined = chain[chain.length - 2];
		const holder = owner ? { children: owner.children!, owner, lineEnding: body.lineEnding } : body;
		// A line ending reaching a cell's raw would be turned into a space by the cell's write rule.
		const raw = write.newDisplay + ownTrailingLineEnding(owned.raw);
		rewriteLeafInPlace(holder, write.path[write.path.length - 1], raw, grammar, sharing);
		chains.push(chain);
	}
	// Every write lands before any rebuild, and a chain rebuild re-emits its whole ancestry from
	// children that are already current, so chain order is free.
	for (const chain of chains) rebuildUnsharedChain(body, chain, sharing, null, grammar);
}

// ── Range decomposition ────────────────────────────────────────────────────

interface RangeSpan {
	path: number[];
	edit: InlineFormatEdit;
	isStart: boolean;
	isEnd: boolean;
}

/** The start edge's tail, every block the range holds whole and the end edge's head, in document
 *  order, read off `rangeCoverage`. A kind joins by what its descriptor declares, never by name. */
function spansInRange(doc: DocumentView, coverage: RangeCoverage, reading: Reading): RangeSpan[] {
	const { start, end } = coverage.range;
	const spans: RangeSpan[] = [];
	// Pushed one by one, never spread: a large grid's cells can exceed the argument-list limit
	// (G4.60).
	const push = (cells: Iterable<RangeSpan>) => {
		for (const span of cells) spans.push(span);
	};
	if (coverage.grid) {
		const { path, rect } = coverage.grid;
		const table = blockNodeAt(doc, path);
		if (table) push(cellSpans(gridCellsInRect(table, path, rect), reading));
		return spans;
	}
	if (coverage.startEdge && coverage.endEdge && pathsEqual(start.path, end.path)) {
		push(edgeSpans(doc, start, end, null, reading));
		return spans;
	}
	if (coverage.startEdge) push(edgeSpans(doc, start, null, coverage.startCells, reading));
	for (const root of coverage.wholeRoots) push(wholeSpans(doc, root, reading));
	if (coverage.endEdge) push(edgeSpans(doc, null, end, coverage.endCells, reading));
	return spans;
}

/** A kept edge's part of its block: the text from the start or up to the end, or a table's rows
 *  the range covers. A cell of a plugin grid is taken whole, so no cell is cut in half. */
function edgeSpans(
	doc: DocumentView,
	start: SelectionPoint | null,
	end: SelectionPoint | null,
	cells: CellRun | null,
	reading: Reading
): RangeSpan[] {
	const point = (start ?? end)!;
	const node = blockNodeAt(doc, point.path);
	if (!node) return [];
	if (cells) return cellSpans(gridCellsInRun(node, point.path, cells.from, cells.to - 1), reading);
	const grid = enclosingGrid(doc, point.path);
	if (grid) {
		const cell = reachableCell(grid, point.path, node);
		const body = cell && contentSpan(cell, point.path, null, null, reading);
		return body ? [{ ...body, isStart: start !== null, isEnd: end !== null }] : [];
	}
	const body = contentSpan(
		node,
		point.path,
		start ? charOffsetOf(start, TAG) : null,
		end ? charOffsetOf(end, TAG) : null,
		reading
	);
	return body ? [{ ...body, isStart: start !== null, isEnd: end !== null }] : [];
}

/** Every leaf of a subtree the range holds whole, each whole, in document order; a row or cell of
 *  a grid reaches only the cells row 0's width indexes. */
function wholeSpans(doc: DocumentView, root: readonly number[], reading: Reading): RangeSpan[] {
	const path = [...root];
	const node = blockNodeAt(doc, path);
	if (!node) return [];
	const grid = enclosingGrid(doc, path);
	if (grid && path.length === grid.path.length + 1) {
		const cells = (node.children ?? []).slice(0, grid.width);
		return cellSpans(
			cells.map((cell, col) => ({ node: cell, path: [...path, col] })),
			reading
		);
	}
	if (grid) {
		const cell = reachableCell(grid, path, node);
		return cell ? cellSpans([{ node: cell, path }], reading) : [];
	}
	const spans: RangeSpan[] = [];
	const visit = (at: NodeView, atPath: number[]): void => {
		if (isGridKind(at.kind)) {
			for (const span of cellSpans(gridCellsInRun(at, atPath, null, null), reading))
				spans.push(span);
		} else if (at.children) {
			at.children.forEach((child, index) => visit(child, [...atPath, index]));
		} else {
			const body = contentSpan(at, atPath, null, null, reading);
			if (body) spans.push({ ...body, isStart: false, isEnd: false });
		}
	};
	visit(node, path);
	return spans;
}

/** Each cell whole; a table endpoint counting cells never names a cell path (G1.29). */
function cellSpans(cells: readonly GridCell[], reading: Reading): RangeSpan[] {
	const spans: RangeSpan[] = [];
	for (const cell of cells) {
		const body = contentSpan(cell.node, cell.path, null, null, reading);
		if (body) spans.push({ ...body, isStart: false, isEnd: false });
	}
	return spans;
}

interface EnclosingGrid {
	path: number[];
	/** Row 0's cell count, the width every row's index space shares. */
	width: number;
}

/** The outermost grid strictly above `path`, or null. */
function enclosingGrid(doc: DocumentView, path: readonly number[]): EnclosingGrid | null {
	for (let depth = 1; depth < path.length; depth++) {
		const node = blockNodeAt(doc, path.slice(0, depth));
		if (node && isGridKind(node.kind)) {
			return { path: path.slice(0, depth), width: node.children?.[0]?.children?.length ?? 0 };
		}
	}
	return null;
}

/** A cell of `grid`, or null for one past row 0's width, which no cell index reaches. */
function reachableCell(grid: EnclosingGrid, path: readonly number[], cell: NodeView) {
	const col = path[grid.path.length + 1] ?? 0;
	return col < grid.width ? cell : null;
}

/** What one leaf contributes between two character offsets, a null side meaning its content
 *  edge. Null for a kind outside inline marking, or when trimming whitespace leaves nothing. */
function contentSpan(
	node: NodeView,
	path: number[],
	from: number | null,
	to: number | null,
	reading: Reading
): Omit<RangeSpan, 'isStart' | 'isEnd'> | null {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (!descriptor?.supportsInline || !descriptor.editable || descriptor.isContainer) return null;

	const display = trimTrailingLineEnding(node.raw);
	const content = getContentRange(node);
	const selection = withoutBoundaryWhitespace(
		display,
		clampToContent(from ?? content.start, content),
		clampToContent(to ?? content.end, content)
	);
	return selection && { path, edit: { display, content, selection, reading } };
}

const clampToContent = (offset: number, content: ContentRange): number =>
	Math.min(Math.max(offset, content.start), content.end);

/** Whether the span's toggle went the range's way. The single-block toggle decides from the span
 *  alone, so a block that went the other way is dropped rather than written. */
function landedOnIntendedSide(
	edit: InlineFormatEdit,
	toggled: ToggleInlineFormatResult,
	format: InlineMarkKind,
	unapply: boolean
): boolean {
	return isInlineFormatActiveAfter(edit, toggled, format) !== unapply;
}
