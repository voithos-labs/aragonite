/**
 * Per-kind conformance profiles for the BUILT-IN kinds — the profile the generic
 * battery (`$lib/testing/kind-conformance`) needs BEYOND each descriptor. Kept in
 * test-land, out of the shipped kit: the descriptor's `closure` block and
 * `conformanceFixture` already carry everything the runner derives generically, so
 * a profile exists only where a kind has a mechanism the runner cannot observe
 * generically and must supply a custom check.
 *
 * Today that is exactly one cell: `table.clipboard` synthesizes a fresh GFM
 * sub-table on a rectangular copy (its declared `implemented` mechanism), which no
 * generic byte-slice check exercises — the false-cell gap this whole battery
 * exists to close.
 */

import type { BlockKind } from '$lib/core/nodes';
import { metadataOf } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { copyRectangleAsSubTable } from '$lib/tree-operations/sub-table-copy';
import type { KindCellContext, KindConformanceProfile } from '$lib/testing';

// ── table: rectangular copy → synthesized sub-table ──────────────────────────

function parsesToTable(payload: string, columns: number, rows: number, label: string): void {
	const doc = parse(payload);
	if (doc.children.length !== 1 || doc.children[0].kind !== 'table') {
		throw new Error(`${label}: payload does not parse to a single table — got ${payload}`);
	}
	const table = doc.children[0];
	const colCount = metadataOf(table, 'table').columnCount;
	if (colCount !== columns)
		throw new Error(`${label}: expected ${columns} columns, got ${colCount}`);
	if (table.children!.length !== rows) {
		throw new Error(`${label}: expected ${rows} rows, got ${table.children!.length}`);
	}
	if (serialize(parse(payload)) !== payload)
		throw new Error(`${label}: payload is not lossless GFM`);
}

/**
 * Drive `copyRectangleAsSubTable` — the function the closure `via` names — over the
 * fixture table's cell grid. A full-rectangle copy must reparse to a table of the
 * fixture's shape; a single-column sub-rectangle must reparse to a NARROWER table,
 * which no raw byte slice could produce — proving the copy genuinely synthesizes.
 */
function checkTableRectCopy(ctx: KindCellContext): void {
	const table = ctx.node;
	const cols = metadataOf(table, 'table').columnCount;
	const rows = table.children!.length;
	if (cols < 2 || rows < 2) {
		throw new Error(`table rect-copy check needs a ≥2×2 fixture; got ${rows}×${cols}`);
	}

	const full = copyRectangleAsSubTable(
		table,
		{ rowIdx: 0, colIdx: 0 },
		{ rowIdx: rows - 1, colIdx: cols - 1 }
	);
	parsesToTable(full, cols, rows, 'full-rectangle copy');

	const oneColumn = copyRectangleAsSubTable(
		table,
		{ rowIdx: 0, colIdx: 0 },
		{ rowIdx: rows - 1, colIdx: 0 }
	);
	parsesToTable(oneColumn, 1, rows, 'single-column sub-rectangle copy');
	if (oneColumn === table.raw)
		throw new Error('single-column copy equals the source raw — no synthesis');
}

export const BUILTIN_KIND_PROFILES: Partial<Record<BlockKind, KindConformanceProfile>> = {
	table: { cells: { clipboard: { check: checkTableRectCopy } } }
};
