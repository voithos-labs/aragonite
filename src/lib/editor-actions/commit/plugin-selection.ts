/**
 * The selection in document bytes, both ways: the editor's selection as a plugin reads it, and the
 * selection a plugin's `select` names, as the editor places it. Table cells count by row and
 * column, as the author sees them.
 */
import { metadataOf } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { cellPoint, type EditorSelection, type SelectionPoint } from '../../selection/primitives';
import { pathOfBlock } from '../../schema/doc-view';
import type { Selection, SelectionInput } from '../../schema/selection-read';
import type { DocumentRead } from './document-read';

type Reads = Pick<DocumentRead, 'byteOf' | 'leafAt' | 'blockOf'> & {
	nodeAt(path: readonly number[]): NodeView | null;
};

/** `selection` as a plugin reads it; null for none, or for a point the document doesn't place. */
export function selectionOf(reads: Reads, selection: EditorSelection | null): Selection | null {
	if (!selection) return null;
	const { anchor, focus } = selection;
	const cells =
		anchor.cellCoordinate && focus.cellCoordinate ? cellsOf(reads, anchor, focus) : null;
	const a = cells ? cells.anchorByte : reads.byteOf(anchor.path, anchor.offset);
	const h = cells ? cells.headByte : reads.byteOf(focus.path, focus.offset);
	if (a === null || h === null) return null;
	const leaf = cells ? cells.headPath : focus.path;
	const node = reads.nodeAt(leaf);
	return {
		anchor: a,
		head: h,
		from: Math.min(a, h),
		to: Math.max(a, h),
		empty: a === h,
		block: node ? reads.blockOf(node, leaf) : null,
		cells: cells && { table: cells.table, anchor: cells.anchor, head: cells.head }
	};
}

/** The editor selection `input` names; null where it names no place in the document. */
export function selectionTarget(reads: Reads, input: SelectionInput): EditorSelection | null {
	const point = (at: number): SelectionPoint | null => {
		const leaf = Number.isInteger(at) && at >= 0 ? reads.leafAt(at) : null;
		return leaf && { path: leaf.path, offset: leaf.offset };
	};
	const pair = (a: SelectionPoint | null, h: SelectionPoint | null) =>
		a && h ? { anchor: a, focus: h } : null;
	if (typeof input === 'number') return pair(point(input), point(input));
	if ('block' in input) {
		const { block } = input;
		const end = block.text.length - (block.text.match(/\r?\n$/)?.[0].length ?? 0);
		return block.from < 0 ? null : pair(point(block.from), point(block.byteAt(end)));
	}
	if ('cells' in input) {
		const path = pathOfBlock(input.cells);
		const table = path && reads.nodeAt(path);
		if (!path || !table || table.kind !== 'table') return null;
		const columns = metadataOf(table, 'table').columnCount;
		const index = ([row, column]: readonly [number, number]) => row * columns + column;
		return {
			anchor: cellPoint(path, index(input.anchor)),
			focus: cellPoint(path, index(input.head))
		};
	}
	return pair(point(input.anchor), point(input.head));
}

function cellsOf(reads: Reads, anchor: SelectionPoint, focus: SelectionPoint) {
	const table = reads.nodeAt(anchor.path);
	if (!table || table.kind !== 'table') return null;
	const columns = metadataOf(table, 'table').columnCount;
	const at = (index: number) => [Math.floor(index / columns), index % columns] as const;
	const [anchorCell, headCell] = [at(anchor.offset), at(focus.offset)];
	const headPath = [...anchor.path, ...headCell];
	return {
		table: reads.blockOf(table, anchor.path),
		anchor: anchorCell,
		head: headCell,
		anchorByte: reads.byteOf([...anchor.path, ...anchorCell], 0),
		headByte: reads.byteOf(headPath, 0),
		headPath
	};
}
