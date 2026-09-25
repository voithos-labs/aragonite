/**
 * The per-block spans a cross-block format toggle rewrites, and the write over them. Pure over
 * the tree, like `../range-delete`; the commit lives in `./format-toggle`. The direction is
 * decided over the whole range (every span already marked removes the mark, anything else adds
 * it), so adding leaves an already-marked block alone. Each span goes through the single-block
 * toggle, so the rules are the same ones. A grid joins by its cells, covered whole.
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
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import {
	normalizeBodyWrite,
	writeOwnRaw,
	type NodeParent
} from '../../tree-operations/node-primitives';
import type { SharingState } from '../../tree-operations/sharing';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import { rebuildUnsharedChain } from '../../tree-operations/chain-rebuild';
import { comparePaths } from '../path-math';
import { charOffsetOf, type SelectionPoint } from '../primitives';
import { coveredGridCells, gridEndpointCellIndex } from '../table-endpoint-snap';

const TAG = 'cross-block-format';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockFormatWrite {
	path: number[];
	/** The block's display bytes after the toggle — its raw minus the trailing line ending. */
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

export interface CrossBlockFormatPlan {
	writes: CrossBlockFormatWrite[];
	/** The range's endpoints after the rewrite, in document order, each in its own space: a
	 *  character offset in a text block or in the grid cell a path names, a cell index where the
	 *  endpoint counts cells. */
	startOffset: number;
	endOffset: number;
}

/** Null where no block participates: the keystroke is still consumed, but nothing is written. */
export function planCrossBlockFormat(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint,
	format: InlineMarkKind,
	reading: Reading
): CrossBlockFormatPlan | null {
	const spans = spansInRange(doc, start, end, reading);
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
	}
	return plan.writes.length === 0 ? null : plan;
}

/** The active marks a toolbar shows for a range, all at once: a mark is active where every
 *  participating span carries it. All marks together, because a toolbar asks once per button
 *  against the same range and splitting the range into spans is the cost. */
export function crossBlockActiveFormats(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint,
	reading: Reading
): ReadonlySet<InlineMarkKind> {
	const spans = spansInRange(doc, start, end, reading);
	if (spans.length === 0) return new Set();
	// The running intersection is the next span's candidate set, so a span costs one parse and a
	// walk per mark still standing, and it empties where a per-mark `every` would stop.
	let active = activeInlineFormats(spans[0].edit);
	for (let index = 1; index < spans.length && active.size > 0; index++)
		active = inlineFormatsCovering(spans[index].edit, active);
	return active;
}

/** Writes a plan into the tree, copying each chain before writing. The caller owns the commit. */
export function applyCrossBlockFormat(
	root: NodeParent,
	plan: CrossBlockFormatPlan,
	sharing: SharingState,
	grammar: GrammarView
): void {
	const chains: CstNode[][] = [];
	for (const write of plan.writes) {
		const chain = ensureUnsharedPath(root, write.path, sharing);
		const owned = chain[chain.length - 1];
		if (!owned) continue;
		// A line ending reaching a cell's raw would be turned into a space by the cell's write rule.
		const raw = write.newDisplay + ownTrailingLineEnding(owned.raw);
		writeOwnRaw(owned, normalizeBodyWrite(chain[chain.length - 2]?.kind, raw), grammar);
		chains.push(chain);
	}
	// Every write lands before any rebuild, and a chain rebuild re-emits its whole ancestry from
	// children that are already current, so chain order is free.
	for (const chain of chains) rebuildUnsharedChain(root, chain, sharing, null, grammar);
}

// ── Range decomposition ────────────────────────────────────────────────────

interface RangeSpan {
	path: number[];
	edit: InlineFormatEdit;
	isStart: boolean;
	isEnd: boolean;
}

/**
 * The start block's tail, every middle block's content, the end block's head, in document
 * order. A kind joins by what its descriptor declares, never by name: an editable leaf that
 * supports inline marks and has a non-blank span joins, and a grid hands over its covered
 * cells, which are leaves of that same shape.
 */
function spansInRange(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint,
	reading: Reading
): RangeSpan[] {
	const spans: RangeSpan[] = [];
	const visit = (holder: DocumentView | NodeView, path: number[]): void => {
		const children = holder.children ?? [];
		for (let index = 0; index < children.length; index++) {
			const here = [...path, index];
			// Everything past the end endpoint is out of the range, subtrees included.
			if (comparePaths(here, end.path) > 0) return;
			const child = children[index];
			if (child.children) {
				if (tryGetBlockKindDescriptor(child.kind)?.containerContract === 'grid') {
					// Pushed one by one, never spread: a large grid's covered cells can exceed the
					// argument-list limit (G4.60).
					for (const span of gridSpans(child, here, start, end, reading)) spans.push(span);
				} else {
					visit(child, here);
				}
				continue;
			}
			const span = spanFor(child, here, start, end, reading);
			if (span) spans.push(span);
		}
	};
	visit(doc, []);
	return spans;
}

function spanFor(
	node: NodeView,
	path: number[],
	start: SelectionPoint,
	end: SelectionPoint,
	reading: Reading
): RangeSpan | null {
	if (comparePaths(path, start.path) < 0 || comparePaths(path, end.path) > 0) return null;
	const isStart = comparePaths(path, start.path) === 0;
	const isEnd = comparePaths(path, end.path) === 0;
	const body = contentSpan(
		node,
		path,
		isStart ? charOffsetOf(start, TAG) : null,
		isEnd ? charOffsetOf(end, TAG) : null,
		reading
	);
	return body && { ...body, isStart, isEnd };
}

/**
 * A grid's covered cells, each contributing its whole content. An endpoint inside a grid resolves
 * to one of its cells, so no cell is ever cut in half: an endpoint counting cells stays on the one
 * it named, while one naming its cell by path follows that cell's own write.
 */
function gridSpans(
	grid: NodeView,
	path: number[],
	start: SelectionPoint,
	end: SelectionPoint,
	reading: Reading
): RangeSpan[] {
	const from = gridEndpointCellIndex(grid, path, start);
	// No endpoint of its own, and the range starts after it: the grid sits wholly before the range.
	if (from === null && comparePaths(path, start.path) < 0) return [];
	const cells = coveredGridCells(grid, path, from, gridEndpointCellIndex(grid, path, end));
	const spans: RangeSpan[] = [];
	for (const cell of cells) {
		const body = contentSpan(cell.node, cell.path, null, null, reading);
		if (body)
			spans.push({
				...body,
				isStart: addressesCell(start, cell.path),
				isEnd: addressesCell(end, cell.path)
			});
	}
	return spans;
}

/** Whether the endpoint names this cell by path, which is the same question as whether its
 *  offset is a character offset: only the `[grid, row, col]` endpoint G1.29 permits can match a
 *  cell path, so a table's cell index keeps its own space while a plugin grid's edge follows its
 *  cell's rewrite, as a text edge follows its block's. */
function addressesCell(point: SelectionPoint, cellPath: number[]): boolean {
	return comparePaths(point.path, cellPath) === 0;
}

/**
 * What one leaf contributes between two character offsets, null on a side meaning the block's
 * own content edge. Null where the kind declares itself out of inline marking, or where
 * trimming boundary whitespace leaves nothing to mark.
 */
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

/**
 * Whether the span actually changed sides. The single-block toggle decides add or remove from
 * the span alone, so a block whose write disagreed with the range's direction is dropped rather
 * than committed against what the user asked for.
 */
function landedOnIntendedSide(
	edit: InlineFormatEdit,
	toggled: ToggleInlineFormatResult,
	format: InlineMarkKind,
	unapply: boolean
): boolean {
	return isInlineFormatActiveAfter(edit, toggled, format) !== unapply;
}
