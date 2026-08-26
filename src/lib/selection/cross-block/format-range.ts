/**
 * The per-block spans a cross-block format toggle rewrites, and the write over them. Pure over
 * the tree, like `../range-delete`: the commit ceremony lives in `./format-toggle`. Direction is
 * coverage across the WHOLE range — every span covered unapplies, anything else applies — so an
 * apply leaves an already-marked block alone instead of toggling it the other way. Each span goes
 * through the single-block seam, so its arms, candidates and mode verification are the same ones.
 * A grid joins by its cells, which the range covers whole.
 */

import {
	activeInlineFormats,
	inlineFormatsCovering,
	isInlineFormatActive,
	isInlineFormatActiveAfter,
	toggleInlineFormat,
	type InlineFormatEdit,
	type ToggleInlineFormatResult
} from '../../core/inline/format-toggle';
import { getContentRange, type ContentRange } from '../../core/inline';
import { displayLength, trimTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';
import type { PresentationMode } from '../../presentation-mode';
import type { GrammarView } from '../../schema/block-openers';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { normalizeBodyWrite, writeOwnRaw, type NodeParent } from '../../tree-operations/node-ops';
import type { SharingState } from '../../tree-operations/sharing';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../../tree-operations/unshare';
import { comparePaths } from '../path-math';
import { charOffsetOf, type SelectionPoint } from '../primitives';
import { coveredGridCells } from '../table-endpoint-snap';

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
	/** The range's own endpoints after the rewrite, in document order, each in the space its own
	 *  block addresses: a char offset in prose, a cell index inside a grid. */
	startOffset: number;
	endOffset: number;
}

/** Null where no block participates: the press is still consumed, but nothing is written. */
export function planCrossBlockFormat(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint,
	format: InlineMarkKind,
	mode: PresentationMode | undefined
): CrossBlockFormatPlan | null {
	const spans = spansInRange(doc, start, end);
	if (spans.length === 0) return null;
	// Read once per span: the vote and the per-span skip below ask the same question, and the
	// answer costs a parse of the block's inlines.
	const covered = spans.map((span) => isInlineFormatActive(span.edit, format));
	const unapply = covered.every(Boolean);

	// Each endpoint's own space, carried rather than read: a span that participates overwrites its
	// side with a char offset, and one inside a grid never does, so its cell index stands.
	const plan: CrossBlockFormatPlan = {
		writes: [],
		startOffset: start.offset,
		endOffset: end.offset
	};
	for (const [index, span] of spans.entries()) {
		if (covered[index] !== unapply) continue;
		const toggled = toggleInlineFormat(span.edit, format, mode);
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

/** The pressed-state a toolbar paints over a range, every mark at once: one is active where
 *  EVERY participating span carries it. All marks together, because a toolbar asks once per
 *  button against the same range and the decomposition is the cost. */
export function crossBlockActiveFormats(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint
): ReadonlySet<InlineMarkKind> {
	const spans = spansInRange(doc, start, end);
	if (spans.length === 0) return new Set();
	// The running intersection is the next span's candidate set, so a span costs one parse and a
	// walk per mark still standing, and it empties where a per-mark `every` would stop.
	let active = activeInlineFormats(spans[0].edit);
	for (let index = 1; index < spans.length && active.size > 0; index++)
		active = inlineFormatsCovering(spans[index].edit, active);
	return active;
}

/** Write a plan into the tree, copy-path-on-write. The caller owns the commit ceremony. */
export function applyCrossBlockFormat(
	root: NodeParent,
	plan: CrossBlockFormatPlan,
	sharing: SharingState,
	grammar: GrammarView | undefined
): void {
	const chains: CstNode[][] = [];
	for (const write of plan.writes) {
		const chain = ensureUnsharedPath(root, write.path, sharing);
		const owned = chain[chain.length - 1];
		if (!owned) continue;
		// The node's OWN ending back, not a minted one: a grid cell carries none, and a line
		// ending reaching its raw would be normalized into a space at the write sink.
		const raw = write.newDisplay + owned.raw.slice(displayLength(owned.raw));
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
 * The anchor block's tail, every middle block's content, the focus block's head — in document
 * order. Participation is the kind's own declaration, never its name: an editable, inline-bearing
 * leaf with a non-blank span joins, and a grid hands over its covered cells, which are leaves of
 * that same shape.
 */
function spansInRange(doc: DocumentView, start: SelectionPoint, end: SelectionPoint): RangeSpan[] {
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
					spans.push(...gridSpans(child, here, start, end));
				} else {
					visit(child, here);
				}
				continue;
			}
			const span = spanFor(child, here, start, end);
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
	end: SelectionPoint
): RangeSpan | null {
	if (comparePaths(path, start.path) < 0 || comparePaths(path, end.path) > 0) return null;
	const isStart = comparePaths(path, start.path) === 0;
	const isEnd = comparePaths(path, end.path) === 0;
	const body = contentSpan(
		node,
		path,
		isStart ? charOffsetOf(start, TAG) : null,
		isEnd ? charOffsetOf(end, TAG) : null
	);
	return body && { ...body, isStart, isEnd };
}

/**
 * A grid's covered cells, each contributing its WHOLE content. An endpoint inside a grid carries
 * a cell index rather than a char offset, so no cell is ever cut in half and neither is the span
 * the range's own offset-bearing edge — the plan leaves such an endpoint on its cell.
 */
function gridSpans(
	grid: NodeView,
	path: number[],
	start: SelectionPoint,
	end: SelectionPoint
): RangeSpan[] {
	if (comparePaths(path, start.path) < 0) return [];
	const cells = coveredGridCells(
		grid,
		path,
		comparePaths(path, start.path) === 0 ? start.offset : null,
		comparePaths(path, end.path) === 0 ? end.offset : null
	);
	const spans: RangeSpan[] = [];
	for (const cell of cells) {
		const body = contentSpan(cell.node, cell.path, null, null);
		if (body) spans.push({ ...body, isStart: false, isEnd: false });
	}
	return spans;
}

/**
 * What one leaf contributes between two char offsets — null on a side meaning the block's own
 * content edge. Null where the kind declares itself out of inline marking, or where the boundary
 * trim leaves nothing to mark.
 */
function contentSpan(
	node: NodeView,
	path: number[],
	from: number | null,
	to: number | null
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
	return selection && { path, edit: { display, content, selection } };
}

/** The span minus its boundary whitespace, null once nothing is left. Markdown opens and closes a
 *  run against a word, never a space, so an untrimmed edge yields delimiters that form no
 *  construct — which the modes that paint them write anyway (`wrapCandidates` is unverified there). */
function withoutBoundaryWhitespace(
	display: string,
	from: number,
	to: number
): { start: number; end: number } | null {
	let start = from;
	let end = to;
	while (start < end && /\s/.test(display[start])) start++;
	while (end > start && /\s/.test(display[end - 1])) end--;
	return start === end ? null : { start, end };
}

const clampToContent = (offset: number, content: ContentRange): number =>
	Math.min(Math.max(offset, content.start), content.end);

/**
 * Whether the span actually changed sides. The single-block seam decides its own arm from the
 * span alone, so a block whose write disagreed with the range's direction is dropped rather than
 * committed against the press the user made.
 */
function landedOnIntendedSide(
	edit: InlineFormatEdit,
	toggled: ToggleInlineFormatResult,
	format: InlineMarkKind,
	unapply: boolean
): boolean {
	return isInlineFormatActiveAfter(edit, toggled, format) !== unapply;
}
