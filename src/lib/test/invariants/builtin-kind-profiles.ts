/**
 * What the generic battery (`$lib/testing/kind-conformance`) needs BEYOND each built-in
 * descriptor. A profile exists only where a kind's mechanism is unobservable generically:
 * `table.clipboard` synthesizes a fresh GFM sub-table, which no byte-slice check reaches.
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
 * Drives `copyRectangleAsSubTable`, the function the closure `via` names. The
 * single-column sub-rectangle is the discriminating case: reparsing to a NARROWER table
 * is something no raw byte slice could produce, so the copy genuinely synthesizes.
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
