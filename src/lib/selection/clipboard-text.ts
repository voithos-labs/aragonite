/**
 * Cross-block clipboard text collection.
 */

import type { SelectionPoint } from './primitives';
import { makeBlockNode, metadataOf, type CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { cloneMetadata } from '../tree-operations/clone';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import { walkBetween, normalize, charOffsetOf, cellIndexOf } from './primitives';
import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { isStrictAncestorOf, pathHasPrefix, pathsEqual, sharedPrefixLength } from './path-math';
import { cellRowCol } from '../cursor/coordinate-spaces';
import { displayLength, terminateLine } from '../core/lines';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import { isReservedChromeChild } from '../schema/reserved-chrome';
import { getBlockKindDescriptor, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Plain text spanning a cross-block selection: the start block's tail, every middle block's
 * leadingTrivia + raw, the end block's head. Descendants of an already-collected container
 * are skipped, since a container's raw already holds its children's text. Full-boundary leaf
 * endpoints promote to their deepest non-shared container ancestor so list markers and
 * blockquote prefixes survive; a start inside reserved chrome re-emits its container once.
 */
export function collectCrossBlockText(
	doc: DocumentView,
	anchor: SelectionPoint,
	focus: SelectionPoint
): string {
	const normalized = normalize({ anchor, focus });
	const { start, end } = snapCrossBlockTableEndpoints(doc, normalized.start, normalized.end);
	const startNode = nodeAt(doc, start.path);
	const endNode = nodeAt(doc, end.path);
	if (!startNode || !endNode) return '';

	// On a table, offsets index half-open cell ranges (see `SelectionPoint`), not characters,
	// so the three table branches route through emitTablePortion. Same-path intra-table offsets
	// are context-established (unflagged) and read directly; cross-block ones use cellIndexOf.
	if (pathsEqual(start.path, end.path) && isBlockNode(startNode) && startNode.kind === 'table') {
		// Cell offsets are inclusive on both ends (hence the `+ 1`). A collapsed pair is a caret
		// in a cell, not a rect, so copy nothing and let the cell's native copy handle it.
		if (start.offset === end.offset) return '';
		return emitTablePortion(startNode, start.offset, end.offset + 1);
	}

	const startRaw = isBlockNode(startNode) ? startNode.raw : '';
	const endRaw = isBlockNode(endNode) ? endNode.raw : '';

	let effectiveStartPath = start.path;
	let chromeStart: ChromeStartContainer | null = null;
	let startTail = '';
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
			// A chrome start emits nothing here: its wrapper needs the body it encloses,
			// which only the walk below knows.
			chromeStart = startChromeContainer(doc, start, startRaw, startOffset);
			if (!chromeStart) {
				const marker = soleChildContainerPrefix(doc, start.path, startRaw);
				startTail = (marker ?? '') + startRaw.slice(startOffset);
			}
		} else {
			startTail = startRaw.slice(startOffset);
		}
	}

	let effectiveEndPath = end.path;
	let endHead: string;
	if (isBlockNode(endNode) && endNode.kind === 'table') {
		// Snapped end cell is the inclusive last cell of its row; emitTablePortion takes an
		// exclusive end, so +1 makes the captured rows match the delete.
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
			const marker = soleChildContainerPrefix(doc, end.path, endRaw);
			endHead = (marker ?? '') + endRaw.slice(0, endOffset);
		} else {
			endHead = endRaw.slice(0, endOffset);
		}
	}

	let middle = '';
	let chromeBody = '';
	const collectedContainers: number[][] = [];

	for (const path of walkBetween(doc, effectiveStartPath, effectiveEndPath)) {
		if (isStrictAncestorOf(path, effectiveStartPath)) continue;
		if (isStrictAncestorOf(path, effectiveEndPath)) continue;
		if (isStrictAncestorOf(effectiveStartPath, path)) continue;
		if (isStrictAncestorOf(effectiveEndPath, path)) continue;

		if (collectedContainers.some((cp) => isStrictAncestorOf(cp, path))) continue;

		const node = nodeAt(doc, path);
		if (!node || !isBlockNode(node)) continue;
		if (chromeStart && pathHasPrefix(path, chromeStart.path)) {
			chromeBody += node.leadingTrivia + node.raw;
		} else {
			middle += node.leadingTrivia + node.raw;
		}

		if (node.children && node.children.length > 0) {
			collectedContainers.push(path);
		}
	}

	// Without endLead, blank lines between paragraphs drop and paste reparses as one paragraph.
	let endLead = '';
	if (!pathsEqual(effectiveStartPath, effectiveEndPath)) {
		const endNode = nodeAt(doc, effectiveEndPath);
		if (endNode && isBlockNode(endNode)) {
			endLead = endNode.leadingTrivia;
		}
	}

	if (chromeStart) {
		// The container's subtree is one contiguous doc-order run, so an end inside it
		// leaves `middle` empty and puts the end's own bytes inside the wrapper too.
		const exited = !pathHasPrefix(effectiveEndPath, chromeStart.path);
		const tail = endLead + endHead;
		const wrapped = wrapChromeStartContainer(
			chromeStart,
			exited ? chromeBody : chromeBody + tail,
			exited
		);
		return exited ? wrapped + middle + tail : wrapped;
	}

	return startTail + middle + endLead + endHead;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Table portion for the half-open cell range `[startCellIdx, endCellIdxExclusive)`. Selection
 * is row-rectangular by GFM constraint, so emit `[startRow..endRow] × all columns`.
 */
function emitTablePortion(
	table: NodeView,
	startCellIdx: number,
	endCellIdxExclusive: number
): string {
	if (startCellIdx >= endCellIdxExclusive) return '';
	const colCount = metadataOf(table, 'table').columnCount;
	const allCellsCount = table.children!.length * colCount;
	if (startCellIdx === 0 && endCellIdxExclusive === allCellsCount) {
		return table.raw;
	}
	const startRow = cellRowCol(startCellIdx, colCount).row;
	const endRow = cellRowCol(endCellIdxExclusive - 1, colCount).row;
	return copyRectangleAsSubTable(
		table,
		{ rowIdx: startRow, colIdx: 0 },
		{ rowIdx: endRow, colIdx: colCount - 1 }
	);
}

/**
 * The container marker prefix a partial-leaf slice must keep when the leaf is the sole child
 * of a strip container ("3. " so "3. thi" survives rather than "thi"). Without it CommonMark
 * §5.2 stops a following "N." line from interrupting the paragraph and the round-trip
 * collapses into one block. Eligibility is the descriptor's `strip` contract, not a kind list.
 * Sole-child is required: earlier siblings sit between the marker and the leaf's raw.
 */
function soleChildContainerPrefix(
	doc: DocumentView,
	leafPath: number[],
	leafRaw: string
): string | null {
	const parent = nodeAt(doc, leafPath.slice(0, -1));
	if (!parent || !isBlockNode(parent) || !parent.children) return null;
	if (tryGetBlockKindDescriptor(parent.kind)?.containerContract !== 'strip') return null;
	if (parent.children.length !== 1) return null;
	if (leafPath[leafPath.length - 1] !== 0) return null;
	if (!parent.raw.endsWith(leafRaw)) return null;
	return parent.raw.slice(0, parent.raw.length - leafRaw.length);
}

/**
 * The rebuild a chrome-wrapper synthesis may run for `container`, or null when re-emitting its
 * wrapper isn't faithful. Both chrome endpoint paths consult this and nothing else, so the
 * rule cannot hold on one endpoint and not the other. Only `'opaque'` qualifies: its syntax is
 * an opener plus a closer, so a truncated chrome IS an opener. `'strip'` has nothing to close
 * (`soleChildContainerPrefix` is its seam); `'grid'` declares no chrome and rides the table arm.
 */
function chromeWrapperRebuild(
	container: NodeView,
	childIndex: number
): ((node: CstNode) => void) | null {
	if (!isReservedChromeChild(container, childIndex)) return null;
	const descriptor = getBlockKindDescriptor(container.kind);
	if (descriptor.containerContract !== 'opaque') return null;
	return descriptor.rebuildRaw ?? null;
}

/**
 * Bytes for a copy endpoint landing inside a container's reserved chrome. A generic raw.slice
 * emits wrapper-less bytes that reparse to a bare paragraph, losing the kind on paste, so
 * synthesize a chrome-only container (truncated chrome, empty body) and run the kind's own
 * rebuildRaw. Metadata is shallow-copied (primitive-valued by G1.6) because rebuildRaw is
 * plugin code fed a node that would otherwise alias the LIVE tree.
 */
function endChromeContainerBytes(
	doc: DocumentView,
	end: SelectionPoint,
	endRaw: string,
	endOffset: number
): string | null {
	const childIndex = end.path[end.path.length - 1];
	const parent = nodeAt(doc, end.path.slice(0, -1));
	if (!parent || !isBlockNode(parent)) return null;

	const rebuildRaw = chromeWrapperRebuild(parent, childIndex);
	if (!rebuildRaw) return null;

	const synthetic = makeBlockNode({
		kind: parent.kind,
		leadingTrivia: '',
		raw: '',
		metadata: parent.metadata ? cloneMetadata(parent.metadata) : undefined,
		innerPrefix: '',
		innerSuffix: '',
		children: [
			makeBlockNode({
				kind: parent.children![childIndex].kind,
				leadingTrivia: '',
				raw: endRaw.slice(0, endOffset)
			})
		]
	});
	rebuildRaw(synthetic);
	return synthetic.raw;
}

interface ChromeStartContainer {
	path: number[];
	node: NodeView;
	/** The chrome leaf from the start offset on — the truncated title/summary. */
	chromeTail: string;
	rebuildRaw: (node: CstNode) => void;
}

/**
 * The container a copy STARTS inside the chrome of, when re-emitting its wrapper around the
 * collected body is faithful; null when it isn't. Eligibility is `chromeWrapperRebuild`'s.
 */
function startChromeContainer(
	doc: DocumentView,
	start: SelectionPoint,
	startRaw: string,
	startOffset: number
): ChromeStartContainer | null {
	const containerPath = start.path.slice(0, -1);
	const container = nodeAt(doc, containerPath);
	if (!container || !isBlockNode(container)) return null;

	const rebuildRaw = chromeWrapperRebuild(container, start.path[start.path.length - 1]);
	if (!rebuildRaw) return null;
	return {
		path: containerPath,
		node: container,
		chromeTail: startRaw.slice(startOffset),
		rebuildRaw
	};
}

/**
 * Re-emit the container around `body` with the truncated chrome back in the opener line. ONE
 * rebuildRaw call over the real body is what makes the closer trustworthy: a directive fence
 * widens when its body reproduces the terminator, so opener and closer derived in the same call
 * cannot disagree about width. `exited` means the walk left the subtree, i.e. the body ran to
 * the end, so the trailing inner trivia belongs to the copy; otherwise line-terminate instead.
 */
function wrapChromeStartContainer(
	start: ChromeStartContainer,
	body: string,
	exited: boolean
): string {
	const { node } = start;
	const innerSuffix = exited ? (node.innerSuffix ?? '') : '';
	const synthetic = makeBlockNode({
		kind: node.kind,
		leadingTrivia: '',
		// The live raw, so the rebuild reads the authored closer line ending (G4.20).
		raw: node.raw,
		metadata: node.metadata ? cloneMetadata(node.metadata) : undefined,
		innerPrefix: node.innerPrefix ?? '',
		innerSuffix,
		children: [
			makeBlockNode({ kind: node.children![0].kind, leadingTrivia: '', raw: start.chromeTail }),
			// One stand-in for the whole collected body: a rebuild serializes its
			// children's bytes, so the kind is immaterial and only the bytes travel.
			makeBlockNode({
				kind: 'paragraph',
				leadingTrivia: '',
				raw: innerSuffix === '' && body !== '' ? terminateLine(body, node.raw) : body
			})
		]
	});
	start.rebuildRaw(synthetic);
	return synthetic.raw;
}

/**
 * Walk up from a leaf endpoint to the deepest container ancestor entirely inside the
 * selection. Start-side promotion is safe only while each child is first; end-side, last.
 */
function promoteToContainer(
	doc: DocumentView,
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
	if (!node || !isBlockNode(node)) return null;
	return { path: bestPath, raw: node.raw };
}
