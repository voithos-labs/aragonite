/** Builds the plain text a cross-block selection puts on the clipboard. */

import { makeBlockNode, metadataOf } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { cloneMetadata } from '../tree-operations/clone';
import { blockNodeAt, isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { charOffsetOf } from './primitives';
import type { RangeCoverage } from './range-coverage';
import { gridClipboard } from './grid-selection';
import { pathHasPrefix, pathsEqual } from './path-math';
import { cellRowCol } from '../core/coordinate-spaces';
import {
	displayLength,
	documentLineEnding,
	ownTrailingLineEnding,
	terminateLine,
	trailingLineEnding,
	trimTrailingLineEnding
} from '../core/lines';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import {
	isReservedChromeChild,
	reservedChromeKindOf,
	rowKeepingTitleFrom,
	rowKeepingTitleTo
} from '../schema/reserved-chrome';
import {
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from '../schema/block-kind-descriptor';
import type { Reading } from '../schema/reading';
import { bytesLeavingLeaf } from '../tree-operations/leaf-range';
import { storedAsAt } from '../tree-operations/stored-as';

// ── Public API ─────────────────────────────────────────────────────────────

/** The plain text of a covered range: what it covers whole is copied whole, an edge block cut
 *  part-way gives what a cut there takes, a container it enters or leaves comes along around it. */
export function collectCrossBlockText(
	doc: DocumentView,
	coverage: RangeCoverage,
	reading: Reading
): string {
	const { start, end } = coverage.range;
	if (coverage.grid) return gridClipboard(doc, coverage.grid)?.text ?? '';
	const startNode = nodeAt(doc, start.path);
	if (!startNode || !nodeAt(doc, end.path)) return '';

	// A character pair on one path is one piece: a block held whole is its bytes, a range inside
	// one (a finger's word) what a cut there takes.
	if (pathsEqual(start.path, end.path)) {
		const raw = isBlockNode(startNode) ? startNode.raw : '';
		if (coverage.coveredRootHolding(start.path)) return raw.slice(start.offset, end.offset);
		return carried(doc, start.path, start.offset, end.offset, reading);
	}

	const startRoot = coverage.coveredRootHolding(start.path);
	const endRoot = coverage.coveredRootHolding(end.path);
	if (startRoot && endRoot && pathsEqual(startRoot, endRoot)) return rawAt(doc, startRoot);

	return createRangeSlice(doc, coverage, reading).copy();
}

// ── The slice ──────────────────────────────────────────────────────────────

/** What the range covers of any node, a container written around its covered children by its own
 *  rebuild (`docs/design/selection.md` § Clipboard). */
function createRangeSlice(doc: DocumentView, coverage: RangeCoverage, reading: Reading) {
	const { start, end } = coverage.range;
	const ending = documentLineEnding(doc);

	/** The copy, relative to the deepest container holding both ends, or the one above it where the
	 *  range starts on that container's title row, since it then covers its opening line. */
	function copy(): string {
		let depth = 0;
		const deepest = Math.min(start.path.length, end.path.length) - 1;
		while (depth < deepest && start.path[depth] === end.path[depth]) depth++;
		const shared = start.path.slice(0, depth);
		return within(startsOnTitleRow(shared) ? shared.slice(0, -1) : shared);
	}

	/** What the range covers of the container at `path`'s children, each behind its leading trivia
	 *  but the one the range starts inside. */
	function within(path: number[]): string {
		let text = '';
		for (const { node, at, lead } of coveredChildren(path)) text += lead + part(at, node);
		return text;
	}

	function coveredChildren(path: number[]): { node: NodeView; at: number[]; lead: string }[] {
		const children = (nodeAt(doc, path)?.children ?? []) as readonly NodeView[];
		const depth = path.length;
		const first = pathHasPrefix(start.path, path) ? start.path[depth] : 0;
		const last = pathHasPrefix(end.path, path) ? end.path[depth] : children.length - 1;
		const out: { node: NodeView; at: number[]; lead: string }[] = [];
		for (let i = first; i <= last; i++) {
			const at = [...path, i];
			const node = children[i];
			out.push({ node, at, lead: pathHasPrefix(start.path, at) ? '' : node.leadingTrivia });
		}
		return out;
	}

	function part(path: number[], node: NodeView): string {
		const holdsStart = pathHasPrefix(start.path, path);
		const holdsEnd = pathHasPrefix(end.path, path);
		const isEnd = pathsEqual(path, end.path);
		const root = coverage.coveredRootHolding(path);
		// The end block keeps its line ending out, as a slice does; anything else covered whole
		// brings its own.
		if ((!holdsStart && !holdsEnd) || (root && pathsEqual(root, path))) {
			return isEnd ? carried(doc, path, 0, end.offset, reading) : node.raw;
		}
		if (pathsEqual(path, start.path)) return startPiece(path, node);
		// A range that only touches a block, ending before its first byte, takes none of it.
		if (!holdsStart && touchesOnly(path)) return '';
		if (isEnd) return endPiece(path, node);
		return containerPiece(path, node);
	}

	function startPiece(path: number[], node: NodeView): string {
		if (coverage.startCells) {
			return emitTablePortion(node, coverage.startCells.from, coverage.startCells.to);
		}
		const offset = charOffsetOf(start, 'collectCrossBlockText:start');
		const parent = parentWrapping(path);
		if (parent) return rowKeepingTitleFrom(parent, node, offset) + ownTrailingLineEnding(node.raw);
		const display = displayLength(node.raw);
		return carried(doc, path, offset, display, reading) + node.raw.slice(display);
	}

	function endPiece(path: number[], node: NodeView): string {
		if (coverage.endCells) {
			return emitTablePortion(node, coverage.endCells.from, coverage.endCells.to);
		}
		const offset = charOffsetOf(end, 'collectCrossBlockText:end');
		const parent = parentWrapping(path);
		return parent
			? rowKeepingTitleTo(parent, node, offset)
			: carried(doc, path, 0, offset, reading);
	}

	function containerPiece(path: number[], node: NodeView): string {
		const descriptor = wrapping(node, path);
		if (!descriptor) return within(path);
		const exited = !pathHasPrefix(end.path, path);
		const onTitle = pathHasPrefix(end.path, [...path, 0]) && isReservedChromeChild(node, 0);
		// A fenced body the range ends inside is closed on a line of its own.
		const closesBody = !exited && !onTitle && descriptor.containerContract !== 'strip';
		const lineEnding = trailingLineEnding(node.raw, ending);
		const children = coveredChildren(path).map(({ node: child, at, lead }, i, all) => {
			const raw = part(at, child);
			return makeBlockNode({
				kind: child.kind,
				leadingTrivia: lead,
				raw: closesBody && i === all.length - 1 ? terminateLine(raw, lineEnding) : raw,
				// A rebuild is plugin code, so it gets a copy of the metadata, never the live tree's.
				metadata: child.metadata ? cloneMetadata(child.metadata) : undefined
			});
		});
		const synthetic = makeBlockNode({
			kind: node.kind,
			leadingTrivia: '',
			// The live raw, which the rebuild reads its spelling and line endings from.
			raw: node.raw,
			metadata: node.metadata ? cloneMetadata(node.metadata) : undefined,
			innerPrefix: onTitle ? '' : (node.innerPrefix ?? ''),
			innerSuffix: exited ? (node.innerSuffix ?? '') : '',
			children
		});
		descriptor.rebuildRaw?.(synthetic);
		// A closer the range never reached ends the copy without a line ending, as any end does.
		return exited ? synthetic.raw : trimTrailingLineEnding(synthetic.raw);
	}

	/** The kind whose rebuild writes `container` around the copy: a line-prefixed one always, a fenced
	 *  one only where the range covers its opening line, so no closer stands without its opener. */
	function wrapping(container: NodeView, path: number[]): BlockKindDescriptor | null {
		const descriptor = tryGetBlockKindDescriptor(container.kind);
		if (!descriptor?.rebuildRaw) return null;
		if (descriptor.containerContract === 'strip') return descriptor;
		if (descriptor.containerContract !== 'opaque') return null;
		if (reservedChromeKindOf(container.kind) === undefined) return null;
		const opener = !pathHasPrefix(start.path, path) || startsOnTitleRow(path);
		return opener ? descriptor : null;
	}

	function startsOnTitleRow(path: number[]): boolean {
		const container = blockNodeAt(doc, path);
		return (
			container !== null &&
			start.path.length === path.length + 1 &&
			pathHasPrefix(start.path, path) &&
			isReservedChromeChild(container, start.path[path.length])
		);
	}

	/** The container whose title row sits at `path`, when the copy writes that container. */
	function parentWrapping(path: number[]): NodeView | null {
		const parentPath = path.slice(0, -1);
		const parent = blockNodeAt(doc, parentPath);
		if (!parent || !isReservedChromeChild(parent, path[path.length - 1])) return null;
		return wrapping(parent, parentPath) ? parent : null;
	}

	/** Whether the range ends at the very start of the node at `path`, before any of its bytes. */
	function touchesOnly(path: number[]): boolean {
		if (end.offset !== 0 || end.cellCoordinate) return false;
		return end.path.slice(path.length).every((index) => index === 0);
	}

	return { copy };
}

// ── Internal ───────────────────────────────────────────────────────────────

/** The bytes `[start, end)` of the leaf at `path` carry, as a cut there would take them. */
function carried(
	doc: DocumentView,
	path: number[],
	start: number,
	end: number,
	reading: Reading
): string {
	const node = nodeAt(doc, path);
	if (!node || !isBlockNode(node)) return '';
	return bytesLeavingLeaf(node, { start, end }, storedAsAt(doc, path, reading));
}

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

function rawAt(doc: DocumentView, path: number[]): string {
	const node = nodeAt(doc, path);
	return node && isBlockNode(node) ? node.raw : '';
}
