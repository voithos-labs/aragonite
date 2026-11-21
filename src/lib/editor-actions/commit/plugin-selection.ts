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

/** `selection` as a plugin reads it; null for none, or for a point the document doesn't place.
 *  An end in a cell covers that cell: the lower end at its text's start, the upper at its end. */
export function selectionOf(reads: Reads, selection: EditorSelection | null): Selection | null {
	if (!selection) return null;
	const anchor = placed(reads, selection.anchor);
	const head = placed(reads, selection.focus);
	if (!anchor || !head) return null;
	const node = reads.nodeAt(head.path);
	const sameTable = anchor.cell && head.cell && anchor.table === head.table;
	const forward = anchor.byte <= head.byte;
	const [from, to] = forward ? [anchor.byte, head.end] : [head.byte, anchor.end];
	return {
		anchor: forward ? from : to,
		head: forward ? to : from,
		from,
		to,
		empty: from === to,
		block: node ? reads.blockOf(node, head.path) : null,
		cells: sameTable
			? {
					table: reads.blockOf(head.table!, selection.focus.path),
					anchor: anchor.cell!,
					head: head.cell!
				}
			: null
	};
}

/** The editor selection `input` names; null where it names no place in the document. */
export function selectionTarget(reads: Reads, input: SelectionInput): EditorSelection | null {
	const point = (at: number): SelectionPoint | null => {
		const leaf = reads.leafAt(at);
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
		const rows = table.children?.length ?? 0;
		const within = (n: number, count: number) => Number.isInteger(n) && n >= 0 && n < count;
		const cell = ([row, column]: readonly [number, number]) =>
			within(row, rows) && within(column, columns) ? cellPoint(path, row * columns + column) : null;
		return pair(cell(input.anchor), cell(input.head));
	}
	return pair(point(input.anchor), point(input.head));
}

/** Where one end of the selection sits: its byte (a cell's text start, with `end` past its text),
 *  its block's path, and its cell for a cell end. */
function placed(reads: Reads, point: SelectionPoint) {
	if (!point.cellCoordinate) {
		const byte = reads.byteOf(point.path, point.offset);
		return byte === null ? null : { byte, end: byte, path: point.path, cell: null, table: null };
	}
	const table = reads.nodeAt(point.path);
	if (!table || table.kind !== 'table') return null;
	const columns = metadataOf(table, 'table').columnCount;
	const cell = [Math.floor(point.offset / columns), point.offset % columns] as const;
	const path = [...point.path, ...cell];
	const node = reads.nodeAt(path);
	const byte = reads.byteOf(path, 0);
	const end = node ? reads.blockOf(node, path).to : -1;
	return byte === null || end < 0 ? null : { byte, end, path, cell, table };
}
