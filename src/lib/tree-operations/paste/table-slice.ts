/**
 * Split a table at a row boundary. `rowGoes` sends the anchor row to whichever half
 * preserves caret continuity for the break-and-splice paste path.
 */

import type { CstNode, TableRowMetadata } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { rebuildTableRaw } from '../../schema/container-rebuilders';
import { promoteFirstRowToHeader } from '../table-mutations';

export type RowGoes = 'first' | 'second';

export function sliceTableAtRow(
	table: CstNode,
	sliceRow: number,
	rowGoes: RowGoes
): { firstHalf: CstNode | null; secondHalf: CstNode | null } {
	const rows = table.children!;
	const splitAt = rowGoes === 'first' ? sliceRow + 1 : sliceRow;
	const firstHalf = buildHalf(rows.slice(0, splitAt), table);
	const secondHalf = buildHalf(rows.slice(splitAt), table);

	if (firstHalf) rebuildTableRaw(firstHalf);
	if (secondHalf) rebuildTableRaw(secondHalf);

	return { firstHalf, secondHalf };
}

function buildHalf(rows: CstNode[], table: CstNode): CstNode | null {
	if (rows.length === 0) return null;
	const sourceMeta = metadataOf(table, 'table');
	const cloned: CstNode[] = rows.map(
		(row) =>
			({
				...row,
				metadata: { ...metadataOf(row, 'tableRow'), isHeader: false } as TableRowMetadata,
				children: row.children!.map((cell) => ({ ...cell }) as CstNode)
			}) as CstNode
	);
	const half: CstNode = {
		kind: 'table',
		leadingTrivia: '',
		// The rebuild reads the delimiter line and the line ending off the raw it replaces.
		raw: table.raw,
		metadata: {
			columnCount: sourceMeta.columnCount,
			alignments: sourceMeta.alignments.slice()
		},
		children: cloned
	};
	promoteFirstRowToHeader(half);
	return half;
}
