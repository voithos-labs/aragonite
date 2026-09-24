/**
 * Split a table at a row boundary. `rowGoes` sends the anchor row to whichever half
 * preserves caret continuity for the break-and-splice paste path.
 */

import type { CstNode, TableMetadata, TableRowMetadata } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { rebuildContainerRaw } from '../../schema/container-raw';
import { trailingLineEnding } from '../../core/lines';

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

	const ending = trailingLineEnding(table.raw);
	const firstHalf = buildHalf(firstRows, meta, ending);
	const secondHalf = buildHalf(secondRows, meta, ending);

	if (firstHalf) rebuildContainerRaw(firstHalf);
	if (secondHalf) rebuildContainerRaw(secondHalf);

	return { firstHalf, secondHalf };
}

function buildHalf(
	rows: CstNode[],
	sourceMeta: TableMetadata,
	ending: '\n' | '\r\n'
): CstNode | null {
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
		// The rebuild reads the line ending off the raw it replaces (G4.20).
		raw: ending,
		metadata: {
			columnCount: sourceMeta.columnCount,
			alignments: sourceMeta.alignments.slice()
		} as TableMetadata,
		children: cloned
	};
}
