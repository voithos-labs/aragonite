/**
 * Split a table at a row boundary into two halves. Sole caller is the
 * break-and-splice paste path: the cell containing the cursor anchors the
 * slice and the row goes to whichever half preserves caret continuity.
 */

import type { CstNode, TableMetadata, TableRowMetadata } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { rebuildContainerRaw } from '../../schema/container-raw';

export type RowGoes = 'first' | 'second';

export function sliceTableAtRow(
	table: CstNode,
	sliceRow: number,
	rowGoes: RowGoes
): { firstHalf: CstNode | null; secondHalf: CstNode | null } {
	const rows = table.children!;
	const meta = metadataOf(table, 'table');

	const splitAt = rowGoes === 'first' ? sliceRow + 1 : sliceRow;
	const firstRows = rows.slice(0, splitAt);
	const secondRows = rows.slice(splitAt);

	const firstHalf = buildHalf(firstRows, meta);
	const secondHalf = buildHalf(secondRows, meta);

	if (firstHalf) rebuildContainerRaw(firstHalf);
	if (secondHalf) rebuildContainerRaw(secondHalf);

	return { firstHalf, secondHalf };
}

function buildHalf(rows: CstNode[], sourceMeta: TableMetadata): CstNode | null {
	if (rows.length === 0) return null;
	const cloned: CstNode[] = rows.map(
		(row, idx) =>
			({
				...row,
				metadata: { isHeader: idx === 0 } as TableRowMetadata,
				children: row.children!.map((cell) => ({ ...cell }) as CstNode)
			}) as CstNode
	);
	return {
		kind: 'table',
		leadingTrivia: '',
		raw: '',
		metadata: {
			columnCount: sourceMeta.columnCount,
			alignments: sourceMeta.alignments.slice()
		} as TableMetadata,
		children: cloned
	};
}
