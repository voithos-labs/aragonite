/** Builds the plain text a cross-block selection puts on the clipboard. */

import type { SelectionPoint } from './primitives';
import { makeBlockNode, metadataOf, type CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { cloneMetadata } from '../tree-operations/clone';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { charOffsetOf } from './primitives';
import type { RangeCoverage } from './range-coverage';
import { gridClipboard } from './grid-selection';
import { pathHasPrefix, pathsEqual } from './path-math';
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

/** The plain text of a covered range: whatever the coverage says is covered end to end is copied
 *  whole, markers included, and a selection inside one table copies its rectangle. */
export function collectCrossBlockText(doc: DocumentView, coverage: RangeCoverage): string {
	const { start, end } = coverage.range;
	if (coverage.grid) return gridClipboard(doc, coverage.grid)?.text ?? '';
	const startNode = nodeAt(doc, start.path);
	const endNode = nodeAt(doc, end.path);
	if (!startNode || !endNode) return '';

	const startRaw = isBlockNode(startNode) ? startNode.raw : '';
	const endRaw = isBlockNode(endNode) ? endNode.raw : '';

	// One block selected whole (`SelectionState.wholeUnitPath`) is the only character pair on one
	// path, and the head/tail split below would emit its bytes twice.
	if (pathsEqual(start.path, end.path)) {
		return startRaw.slice(start.offset, end.offset);
	}

	const startRoot = coverage.coveredRootHolding(start.path);
	const endRoot = coverage.coveredRootHolding(end.path);
	if (startRoot && endRoot && pathsEqual(startRoot, endRoot)) return rawAt(doc, startRoot);

	let effectiveStartPath: number[] = start.path;
	let chromeStart: ChromeStartContainer | null = null;
	let startTail = '';
	if (startRoot) {
		effectiveStartPath = startRoot;
		startTail = rawAt(doc, startRoot);
	} else if (coverage.startCells && isBlockNode(startNode)) {
		startTail = emitTablePortion(startNode, coverage.startCells.from, coverage.startCells.to);
	} else {
		const startOffset = charOffsetOf(start, 'collectCrossBlockText:start');
		// A start inside a container's title line emits nothing yet: the container's opener
		// is rebuilt around the body, which the walk below collects.
		chromeStart =
			start.path.length > 1 ? startChromeContainer(doc, start, startRaw, startOffset) : null;
		if (!chromeStart) {
			const marker =
				start.path.length > 1 ? soleChildContainerPrefix(doc, start.path, startRaw) : null;
			startTail = (marker ?? '') + startRaw.slice(startOffset);
		}
	}

	// An end block covered to its last byte and held by no container keeps its line ending out, as
	// a slice does; a container covered whole brings its own.
	let effectiveEndPath: number[] = end.path;
	let endHead: string;
	if (endRoot && endRoot.length < end.path.length) {
		effectiveEndPath = endRoot;
		endHead = rawAt(doc, endRoot);
	} else if (coverage.endCells && isBlockNode(endNode)) {
		endHead = emitTablePortion(endNode, coverage.endCells.from, coverage.endCells.to);
	} else {
		const endOffset = charOffsetOf(end, 'collectCrossBlockText:end');
		const chromeBytes = endOffset > 0 ? endChromeContainerBytes(doc, end, endRaw, endOffset) : null;
		const partial = endOffset > 0 && endOffset < displayLength(endRaw) && end.path.length > 1;
		const marker = partial ? soleChildContainerPrefix(doc, end.path, endRaw) : null;
		endHead = chromeBytes ?? (marker ?? '') + endRaw.slice(0, endOffset);
	}

	let middle = '';
	let chromeBody = '';
	for (const root of coverage.coveredWhole) {
		if (pathHasPrefix(effectiveStartPath, root) || pathHasPrefix(effectiveEndPath, root)) continue;
		const node = nodeAt(doc, root);
		if (!node || !isBlockNode(node)) continue;
		if (chromeStart && pathHasPrefix(root, chromeStart.path)) {
			chromeBody += node.leadingTrivia + node.raw;
		} else {
			middle += node.leadingTrivia + node.raw;
		}
	}

	// Without endLead, blank lines between paragraphs drop and paste reparses as one paragraph.
	const effectiveEnd = nodeAt(doc, effectiveEndPath);
	const endLead = effectiveEnd && isBlockNode(effectiveEnd) ? effectiveEnd.leadingTrivia : '';

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

/** The table rows a kept table edge's cells touch, every column included, as a sub-table. */
function emitTablePortion(
	table: NodeView,
	startCellIdx: number,
	endCellIdxExclusive: number
): string {
	if (startCellIdx >= endCellIdxExclusive) return '';
	const colCount = metadataOf(table, 'table').columnCount;
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

function rawAt(doc: DocumentView, path: number[]): string {
	const node = nodeAt(doc, path);
	return node && isBlockNode(node) ? node.raw : '';
}
