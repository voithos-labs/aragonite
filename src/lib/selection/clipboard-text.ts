/** Builds the plain text a cross-block selection puts on the clipboard. */

import type { SelectionPoint } from './primitives';
import { makeBlockNode, metadataOf, type CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { cloneMetadata } from '../tree-operations/clone';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { walkBetween, normalize, charOffsetOf, cellIndexOf } from './primitives';
import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { tableCellCount } from '../schema/block-kind-descriptor';
import { isStrictAncestorOf, pathHasPrefix, pathsEqual, sharedPrefixLength } from './path-math';
import { cellRowCol } from '../cursor/coordinate-spaces';
import {
	displayLength,
	documentLineEnding,
	terminateLine,
	trailingLineEnding,
	type LineEnding
} from '../core/lines';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import { isReservedChromeChild } from '../schema/reserved-chrome';
import { getBlockKindDescriptor, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

// ── Public API ─────────────────────────────────────────────────────────────

/** The plain text of a cross-block selection. A leaf endpoint at a block boundary is promoted
 *  to its outermost container inside the selection, so list and quote markers survive. */
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

	// A cell point's offset is a cell index, not a character (see `SelectionPoint`).
	if (pathsEqual(start.path, end.path) && start.cellCoordinate && isBlockNode(startNode)) {
		const from = cellIndexOf(start, 'collectCrossBlockText:rectStart');
		const to = cellIndexOf(end, 'collectCrossBlockText:rectEnd');
		// Cell offsets are inclusive at both ends, hence the `+ 1`. Equal offsets are a caret in
		// one cell, not a rectangle, so the cell's own native copy handles it.
		if (from === to) return '';
		return emitTablePortion(startNode, from, to + 1);
	}

	const startRaw = isBlockNode(startNode) ? startNode.raw : '';
	const endRaw = isBlockNode(endNode) ? endNode.raw : '';

	// One block selected whole (`SelectionState.wholeUnitPath`) is the only character pair on one
	// path, and the head/tail split below would emit its bytes twice.
	if (pathsEqual(start.path, end.path)) {
		return startRaw.slice(start.offset, end.offset);
	}

	let effectiveStartPath = start.path;
	let chromeStart: ChromeStartContainer | null = null;
	let startTail = '';
	if (start.cellCoordinate && isBlockNode(startNode)) {
		const tableNode = startNode;
		const allCellsCount = tableCellCount(tableNode);
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
			// A start inside a container's title line emits nothing yet: the container's opener
			// is rebuilt around the body, which the loop below collects.
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
	if (end.cellCoordinate && isBlockNode(endNode)) {
		// The snapped end cell is inclusive and `emitTablePortion` takes an exclusive end, so the
		// `+ 1` makes the copied rows match what a delete would remove.
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
			exited,
			documentLineEnding(doc)
		);
		return exited ? wrapped + middle + tail : wrapped;
	}

	return startTail + middle + endLead + endHead;
}

// ── Internal ───────────────────────────────────────────────────────────────

/** The table rows the half-open cell range touches, every column included, since a table
 *  selection is row-rectangular by GFM constraint. */
function emitTablePortion(
	table: NodeView,
	startCellIdx: number,
	endCellIdxExclusive: number
): string {
	if (startCellIdx >= endCellIdxExclusive) return '';
	const colCount = metadataOf(table, 'table').columnCount;
	if (startCellIdx === 0 && endCellIdxExclusive === tableCellCount(table)) {
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

/** The list or quote marker a partial slice of a sole-child leaf keeps ("3. thi", not "thi"):
 *  without it, a following "N." line joins the pasted paragraph and the text becomes one block. */
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

/** The kind's `rebuildRaw` when a copy endpoint in `container`'s title line can be re-emitted as
 *  a truncated opener; only an `'opaque'` container's shortened title stays a valid opener. */
function chromeWrapperRebuild(
	container: NodeView,
	childIndex: number
): ((node: CstNode) => void) | null {
	if (!isReservedChromeChild(container, childIndex)) return null;
	const descriptor = getBlockKindDescriptor(container.kind);
	if (descriptor.containerContract !== 'opaque') return null;
	return descriptor.rebuildRaw ?? null;
}

/** The bytes for a copy that ends inside a container's title line, rebuilt as a container with
 *  an empty body, since a plain `raw.slice` would paste back as a bare paragraph. */
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
		// `rebuildRaw` is plugin code, so it gets a copy of the metadata, never the live tree's.
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
	/** The title line from the start offset on. */
	chromeTail: string;
	rebuildRaw: (node: CstNode) => void;
}

/** The container whose title line the copy starts inside, when its opener can be re-emitted
 *  around the collected body. */
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

/** Re-emits the container around `body` in one `rebuildRaw` call, so a fence that widens for its
 *  body keeps opener and closer in agreement. `exited`: the selection ran past the container. */
function wrapChromeStartContainer(
	start: ChromeStartContainer,
	body: string,
	exited: boolean,
	ending: LineEnding
): string {
	const { node } = start;
	const innerSuffix = exited ? (node.innerSuffix ?? '') : '';
	const synthetic = makeBlockNode({
		kind: node.kind,
		leadingTrivia: '',
		// The live raw, so the rebuild copies the closer line's own line ending.
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
				raw:
					innerSuffix === '' && body !== ''
						? terminateLine(body, trailingLineEnding(node.raw, ending))
						: body
			})
		]
	});
	start.rebuildRaw(synthetic);
	return synthetic.raw;
}

/** The outermost container above a leaf endpoint that lies entirely inside the selection: each
 *  step up is a first child on the start side, a last child on the end side. */
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
