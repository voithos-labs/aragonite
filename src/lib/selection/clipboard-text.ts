/**
 * Cross-block clipboard text collection.
 */

import type { SelectionPoint } from './primitives';
import { makeBlockNode, metadataOf, type CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { cloneMetadata } from '../tree-operations/clone';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
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
 * The plain text of a cross-block selection: the start block's tail, every middle block's
 * blank lines plus raw, the end block's head. A container's raw already holds its children,
 * so its descendants are skipped. A leaf endpoint at a block boundary is promoted to its
 * outermost container inside the selection so list markers and blockquote prefixes survive.
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

	// On a table an offset is a cell index, not a character (see `SelectionPoint`). A same-path
	// pair inside one table reads the offsets directly; a cross-block pair goes through
	// `cellIndexOf`.
	if (pathsEqual(start.path, end.path) && isBlockNode(startNode) && startNode.kind === 'table') {
		// Cell offsets are inclusive at both ends, hence the `+ 1`. Equal offsets are a caret in
		// one cell, not a rectangle, so the cell's own native copy handles it.
		if (start.offset === end.offset) return '';
		return emitTablePortion(startNode, start.offset, end.offset + 1);
	}

	const startRaw = isBlockNode(startNode) ? startNode.raw : '';
	const endRaw = isBlockNode(endNode) ? endNode.raw : '';

	// One block selected whole (`SelectionState.wholeUnitPath`) is the only same-path pair outside
	// a table, and the head/tail split below would emit its bytes twice.
	if (pathsEqual(start.path, end.path) && !start.cellCoordinate) {
		return startRaw.slice(start.offset, end.offset);
	}

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
	if (isBlockNode(endNode) && endNode.kind === 'table') {
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
 * The list or quote marker a partial slice of a sole-child leaf keeps ("3. thi" rather than
 * "thi"): without it, CommonMark lets a following "N." line join the paragraph and the pasted
 * text collapses into one block. Only a sole child qualifies, since an earlier sibling would
 * sit between the marker and this leaf's raw.
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
 * The kind's `rebuildRaw` when a copy endpoint inside `container`'s title line can be re-emitted
 * as a truncated opener, or null. Only an `'opaque'` container qualifies: its syntax is an
 * opener plus a closer, so a shortened title is still a valid opener. Both endpoints consult
 * this one function, so the rule cannot hold at one end and not the other.
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
 * The bytes for a copy that ends inside a container's title line. A plain `raw.slice` would
 * paste back as a bare paragraph, so a container with the truncated title and an empty body is
 * built and the kind's own `rebuildRaw` serializes it. Metadata is copied first (it holds only
 * primitives, so a shallow copy suffices, G1.6) because `rebuildRaw` is plugin code that must
 * not alias the live tree.
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
	/** The title line from the start offset on. */
	chromeTail: string;
	rebuildRaw: (node: CstNode) => void;
}

/**
 * The container whose title line the copy starts inside, when its opener can be re-emitted
 * around the collected body; null otherwise.
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
 * Re-emits the container around `body` with the truncated title in the opener line. One
 * `rebuildRaw` call over the real body keeps opener and closer in agreement: a directive fence
 * widens when its body contains the terminator. `exited` means the selection ran past the
 * container's end, so its trailing blank lines belong to the copy; otherwise the body gets a
 * line ending instead.
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
		// The live raw, so the rebuild copies the closer line's own line ending (G4.20).
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
 * Walks up from a leaf endpoint to the outermost container that lies entirely inside the
 * selection: on the start side every step must be a first child, on the end side a last child.
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
