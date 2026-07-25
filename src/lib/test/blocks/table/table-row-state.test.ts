// @vitest-environment jsdom
//
// A column edit scopes the table plus ONE SCOPE PER MOUNTED ROW, resolved from
// the state registry (`editor-actions/table-context.ts` § mountedColumnScopes) —
// a row registers its BlockListState on mount and a windowed-out row has none,
// which is exactly why the scope list is built by probing rather than by row
// count. That registration only happens inside the mounted components, so
// nothing below the mount can prove it holds.
//
// The windowed-OUT half stays an e2e residual: row windowing activates on
// measured height, and jsdom reports zero for every box, so no slice this suite
// can build ever leaves a row unmounted (`test:e2e:vr` owns that case).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { getStateForNode } from '$lib/reactivity/state-registry';
import { installTableLayoutStubs, mountTable, type MountedTable } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedTable | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

const THREE_ROWS = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

describe('a mounted table registers the row state its column ops scope through', () => {
	it('registers one state per row, each holding an id per cell', () => {
		mounted = mountTable(THREE_ROWS);

		const rows = mounted.table.children!;
		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(getStateForNode(row)?.innerBlockIds).toHaveLength(2);
		}
	});

	it('registers the table’s own state, keyed by cell-id-per-row', () => {
		mounted = mountTable(THREE_ROWS);

		expect(getStateForNode(mounted.table)?.innerBlockIds).toHaveLength(3);
	});

	it('publishes a row ref per mounted row, so focusCell has a target', () => {
		mounted = mountTable(THREE_ROWS);

		const refs = getStateForNode(mounted.table)!.innerBlockRefs;
		expect(refs.filter(Boolean)).toHaveLength(3);
		expect(refs[0]?.editable).toBe(true);
	});

	it('gives each row its own state, so a column scope can pair state to row', () => {
		// commitColumnEdit asserts every row scope's node IS the table child at the
		// index it covers; one state shared across rows would satisfy the probe and
		// then splice the same id list three times.
		mounted = mountTable(THREE_ROWS);

		const states = mounted.table.children!.map((row) => getStateForNode(row));
		expect(new Set(states).size).toBe(3);
	});

	it('reports a mounted row window covering every row of a small table', () => {
		// The scope list and the window must agree about which rows exist; a table
		// under the activation threshold windows nothing.
		mounted = mountTable(THREE_ROWS);

		expect(mounted.block.mountedRowWindow()).toEqual({ start: 0, end: 3 });
	});
});
