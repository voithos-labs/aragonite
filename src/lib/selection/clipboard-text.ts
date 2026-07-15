/**
 * Cross-block clipboard text collection.
 */

import type { SelectionPoint } from './primitives';
import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import { walkBetween, normalize, charOffsetOf, cellIndexOf } from './primitives';
import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { isStrictAncestorOf, pathsEqual, sharedPrefixLength } from './path-math';
import { displayLength } from '../core/lines';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import { isReservedChromeChild } from '../schema/reserved-chrome';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Collect the plain-text content spanning a cross-block selection. Includes
 * the tail of the start block's raw, the full leadingTrivia + raw of every
 * middle block, and the head of the end block's raw.
 *
 * walkBetween yields containers AND their children; a container's raw already
 * includes its children's text, so we skip descendants of already-collected
 * containers to avoid duplication.
 *
 * Leaf endpoints at full-boundary offsets promote to their deepest non-shared
 * container ancestor so structural formatting (list markers, blockquote
 * prefixes) is preserved.
 */
export function collectCrossBlockText(
	doc: Document,
	anchor: SelectionPoint,
	focus: SelectionPoint
): string {
	const normalized = normalize({ anchor, focus });
	const { start, end } = snapCrossBlockTableEndpoints(doc, normalized.start, normalized.end);
	const startNode = nodeAt(doc, start.path);
	const endNode = nodeAt(doc, end.path);
	if (!startNode || !endNode) return '';

	// On a table, offsets index half-open cell ranges (see `SelectionPoint`),
	// not character positions; the three table branches below route through
	// emitTablePortion so the generic raw.slice paths don't return garbage.
	// Same-path intra-table copy: the endpoints' cell offsets are context-
	// established (same table, unflagged), so they read directly. The cross-block
	// table branches below carry the flag and use cellIndexOf.
	if (pathsEqual(start.path, end.path) && isBlockNode(startNode) && startNode.kind === 'table') {
		return emitTablePortion(startNode, start.offset, end.offset);
	}

	const startRaw = 'raw' in startNode ? (startNode as CstNode).raw : '';
	const endRaw = 'raw' in endNode ? (endNode as CstNode).raw : '';

	let effectiveStartPath = start.path;
	let startTail: string;
	if (isBlockNode(startNode) && startNode.kind === 'table') {
		const tableNode = startNode;
		const colCount = metadataOf(tableNode, 'table').columnCount;
		const allCellsCount = tableNode.children!.length * colCount;
		startTail = emitTablePortion(
			tableNode,
			cellIndexOf(start, 'collectCrossBlockText:startTable'),
			allCellsCount
		);
	} else {
		const startOffset = charOffsetOf(start, 'collectCrossBlockText:start');
		if (startOffset === 0 && start.path.length > 1) {
			const promoted = promoteToContainer(doc, start.path, end.path, 'start');
			if (promoted) {
				effectiveStartPath = promoted.path;
				startTail = promoted.raw;
			} else {
				startTail = startRaw.slice(startOffset);
			}
		} else if (startOffset > 0 && start.path.length > 1) {
			startTail =
				startPartialWithContainerMarker(doc, start, startRaw) ?? startRaw.slice(startOffset);
		} else {
			startTail = startRaw.slice(startOffset);
		}
	}

	let effectiveEndPath = end.path;
	let endHead: string;
	if (isBlockNode(endNode) && endNode.kind === 'table') {
		// Snapped end cell is the inclusive last cell of its row; emitTablePortion
		// takes an exclusive end. +1 makes the captured rows match the delete.
		endHead = emitTablePortion(endNode, 0, cellIndexOf(end, 'collectCrossBlockText:endTable') + 1);
	} else {
		const endOffset = charOffsetOf(end, 'collectCrossBlockText:end');
		const chromeBytes = endOffset > 0 ? endChromeContainerBytes(doc, end, endRaw, endOffset) : null;
		if (chromeBytes !== null) {
			endHead = chromeBytes;
		} else if (endOffset === displayLength(endRaw) && end.path.length > 1) {
			const promoted = promoteToContainer(doc, end.path, start.path, 'end');
			if (promoted) {
				effectiveEndPath = promoted.path;
				endHead = promoted.raw;
			} else {
				endHead = endRaw.slice(0, endOffset);
			}
		} else if (endOffset > 0 && endOffset < displayLength(endRaw) && end.path.length > 1) {
			endHead = endPartialWithContainerMarker(doc, end, endRaw) ?? endRaw.slice(0, endOffset);
		} else {
			endHead = endRaw.slice(0, endOffset);
		}
	}

	let middle = '';
	const collectedContainers: number[][] = [];

	for (const path of walkBetween(doc, effectiveStartPath, effectiveEndPath)) {
		if (isStrictAncestorOf(path, effectiveStartPath)) continue;
		if (isStrictAncestorOf(path, effectiveEndPath)) continue;
		if (isStrictAncestorOf(effectiveStartPath, path)) continue;
		if (isStrictAncestorOf(effectiveEndPath, path)) continue;

		if (collectedContainers.some((cp) => isStrictAncestorOf(cp, path))) continue;

		const node = nodeAt(doc, path);
		if (!node || !('raw' in node)) continue;
		const lead = 'leadingTrivia' in node ? (node as CstNode).leadingTrivia : '';
		middle += lead + (node as CstNode).raw;

		if (node.children && node.children.length > 0) {
			collectedContainers.push(path);
		}
	}

	// Without endLead, blank lines between paragraphs get dropped and paste reparses as a single merged paragraph.
	let endLead = '';
	if (!pathsEqual(effectiveStartPath, effectiveEndPath)) {
		const endNode = nodeAt(doc, effectiveEndPath);
		if (endNode && 'leadingTrivia' in endNode) {
			endLead = (endNode as CstNode).leadingTrivia;
		}
	}

	return startTail + middle + endLead + endHead;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Emit a table portion for the half-open cell-index range
 * `[startCellIdx, endCellIdxExclusive)` in row-major order. Selection is
 * row-rectangular by GFM constraint; emit `[startRow..endRow] × all columns`.
 */
function emitTablePortion(
	table: CstNode,
	startCellIdx: number,
	endCellIdxExclusive: number
): string {
	if (startCellIdx >= endCellIdxExclusive) return '';
	const colCount = metadataOf(table, 'table').columnCount;
	const allCellsCount = table.children!.length * colCount;
	if (startCellIdx === 0 && endCellIdxExclusive === allCellsCount) {
		return table.raw;
	}
	const startRow = Math.floor(startCellIdx / colCount);
	const endRow = Math.floor((endCellIdxExclusive - 1) / colCount);
	return copyRectangleAsSubTable(
		table,
		{ rowIdx: startRow, colIdx: 0 },
		{ rowIdx: endRow, colIdx: colCount - 1 }
	);
}

/**
 * Mirror of {@link endPartialWithContainerMarker} for the start endpoint.
 * Without the container marker, CommonMark §5.2 prevents subsequent "N."
 * lines from interrupting the paragraph, collapsing the round-trip into a
 * single multi-line block.
 */
function startPartialWithContainerMarker(
	doc: Document,
	start: SelectionPoint,
	startRaw: string
): string | null {
	const parentPath = start.path.slice(0, -1);
	const parent = nodeAt(doc, parentPath);
	if (!parent || !('children' in parent) || !parent.children) return null;
	if (parent.kind !== 'listItem' && parent.kind !== 'blockquote') return null;

	if (parent.children.length !== 1) return null;
	if (start.path[start.path.length - 1] !== 0) return null;

	const parentRaw = (parent as CstNode).raw;
	if (!parentRaw.endsWith(startRaw)) return null;

	const prefix = parentRaw.slice(0, parentRaw.length - startRaw.length);
	return prefix + startRaw.slice(charOffsetOf(start, 'startPartialWithContainerMarker'));
}

/**
 * Prepend the container marker to a partial leaf slice when the leaf is the
 * sole child of a listItem / blockquote, so the clipboard retains structural
 * formatting (e.g. "3. thi" rather than "thi"). Returns null when the
 * container isn't eligible; callers fall back to the plain leaf slice.
 */
function endPartialWithContainerMarker(
	doc: Document,
	end: SelectionPoint,
	endRaw: string
): string | null {
	const parentPath = end.path.slice(0, -1);
	const parent = nodeAt(doc, parentPath);
	if (!parent || !('children' in parent) || !parent.children) return null;
	if (parent.kind !== 'listItem' && parent.kind !== 'blockquote') return null;

	// Prefix recovery requires the leaf be the sole child — otherwise earlier
	// siblings' text sits between the marker and the leaf's raw.
	if (parent.children.length !== 1) return null;
	if (end.path[end.path.length - 1] !== 0) return null;

	const parentRaw = (parent as CstNode).raw;
	if (!parentRaw.endsWith(endRaw)) return null;

	const prefix = parentRaw.slice(0, parentRaw.length - endRaw.length);
	return prefix + endRaw.slice(0, charOffsetOf(end, 'endPartialWithContainerMarker'));
}

/**
 * Bytes for a copy endpoint that lands inside a container's reserved chrome (a
 * title/summary whose syntax lives in the container's own raw). The generic
 * raw.slice emits wrapper-less bytes that reparse to a bare paragraph — the kind
 * lost on paste — and the marker-recovery seam above can't help (it derives the
 * prefix by suffix arithmetic and gates on a single body child, which no chrome
 * container with a body satisfies). Instead synthesize a chrome-only container —
 * truncated chrome raw, empty body, the live node's metadata — and run the
 * kind's own rebuildRaw, yielding canonical reparseable bytes (`:::note Ti\n:::\n`)
 * generically off the chrome predicate. The gesture means "copy into a title" →
 * a container with that title and an empty body.
 *
 * rebuildRaw is contractually read-only over metadata (rebuildCalloutRaw /
 * rebuildDetailsRaw read `calloutType`/`open` and write only `raw`), but here it
 * is plugin code fed a node aliasing the LIVE tree — shallow-copy the metadata
 * (primitive-valued by the G1.6 convention) so a misbehaving plugin cannot write
 * through the clipboard path into the document.
 */
function endChromeContainerBytes(
	doc: Document,
	end: SelectionPoint,
	endRaw: string,
	endOffset: number
): string | null {
	const childIndex = end.path[end.path.length - 1];
	const parent = nodeAt(doc, end.path.slice(0, -1));
	if (!parent || !isBlockNode(parent) || !isReservedChromeChild(parent, childIndex)) return null;

	const rebuildRaw = getBlockKindDescriptor(parent.kind).rebuildRaw;
	if (!rebuildRaw) return null;

	const synthetic: CstNode = {
		kind: parent.kind,
		leadingTrivia: '',
		raw: '',
		metadata: parent.metadata ? { ...parent.metadata } : parent.metadata,
		innerPrefix: '',
		innerSuffix: '',
		children: [
			{
				kind: parent.children![childIndex].kind,
				leadingTrivia: '',
				raw: endRaw.slice(0, endOffset)
			}
		]
	};
	rebuildRaw(synthetic);
	return synthetic.raw;
}

/**
 * Walk up from a leaf endpoint, promoting to the deepest container ancestor
 * whose content is entirely within the selection scope. Start-side promotion
 * is safe only while each child is the first; end-side, only while last.
 */
function promoteToContainer(
	doc: Document,
	leafPath: number[],
	otherPath: number[],
	side: 'start' | 'end'
): { path: number[]; raw: string } | null {
	const lcaDepth = sharedPrefixLength(leafPath, otherPath);

	let bestPath: number[] | null = null;

	for (let depth = leafPath.length - 1; depth > lcaDepth; depth--) {
		const parentPath = leafPath.slice(0, depth);
		const parent = nodeAt(doc, parentPath);
		if (!parent || !parent.children) break;

		const childIndex = leafPath[depth];

		if (side === 'start' && childIndex !== 0) break;
		if (side === 'end' && childIndex !== parent.children.length - 1) break;

		bestPath = parentPath;
	}

	if (!bestPath || bestPath.length <= lcaDepth) return null;
	const node = nodeAt(doc, bestPath);
	if (!node || !('raw' in node)) return null;
	return { path: bestPath, raw: (node as CstNode).raw };
}
