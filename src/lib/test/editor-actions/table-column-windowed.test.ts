import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createTableMutationsContext } from '$lib/editor-actions/table-context';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import { makeBlockListState, makeEditorActionsDeps } from '../harness/editor-actions';

// A row windowed out of the table's mounted slice has no BlockListState, so scoping
// every row unconditionally throws on the first unmounted one. Only mounted rows are
// scoped; the rest ride the table scope's unshare + raw rebuild and must still change bytes.

const TALL = '| a | b |\n| --- | --- |\n| c | d |\n| e | f |\n';

/** A table where only `mountedRows` carry a BlockListState, as windowing leaves it. */
function makeWindowedTable(mountedRows: number[] = [0]) {
	const { deps } = makeEditorActionsDeps([parse(TALL).children[0]]);
	const liveTable = () => deps.doc.children[0];
	const rowsState = makeBlockListState(liveTable, ['row-0', 'row-1', 'row-2']);
	registerBlockListState(liveTable(), rowsState);
	for (const rowIdx of mountedRows) {
		registerBlockListState(
			liveTable().children![rowIdx],
			makeBlockListState(() => liveTable().children![rowIdx])
		);
	}
	const controller = createUndoController(deps);
	const mutations = createTableMutationsContext({
		get node() {
			return liveTable();
		},
		get myPath() {
			return [0];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return { rowIdx: 0, colIdx: 0 };
		},
		parentContainerEdit: createContainerEditActions(deps, controller),
		controller,
		focusCell: vi.fn(),
		announceReorder: vi.fn()
	});
	return { deps, mutations };
}

describe('column ops on a row-windowed table', () => {
	it('insertColumnRight adds the cell to the unmounted rows too', async () => {
		const { deps, mutations } = makeWindowedTable();

		await mutations.insertColumnRight(0);

		expect(serialize(deps.doc)).toBe(
			'| a |  | b |\n| --- | --- | --- |\n| c |  | d |\n| e |  | f |\n'
		);
	});

	it('deleteColumn removes the cell from the unmounted rows too', async () => {
		const { deps, mutations } = makeWindowedTable();

		await mutations.deleteColumn(0);

		expect(serialize(deps.doc)).toBe('| b |\n| --- |\n| d |\n| f |\n');
	});

	it('reorderColumnTo permutes the unmounted rows too', async () => {
		const { deps, mutations } = makeWindowedTable();

		await mutations.reorderColumnTo(0, 1);

		expect(serialize(deps.doc)).toBe('| b | a |\n| --- | --- |\n| d | c |\n| f | e |\n');
	});

	it('the op still pushes exactly one undo entry', async () => {
		const { deps, mutations } = makeWindowedTable();

		await mutations.insertColumnRight(0);

		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});
});

// A single mounted row 0 makes the per-row change lookup an identity map, the one
// arrangement under which mispairing scopes with changes is invisible. These mount the
// arrangements a real window leaves behind.
describe('column ops pair each row scope with its own change', () => {
	it('commits when the mounted slice starts past row 0', async () => {
		const { deps, mutations } = makeWindowedTable([2]);

		await mutations.insertColumnRight(0);

		expect(serialize(deps.doc)).toBe(
			'| a |  | b |\n| --- | --- | --- |\n| c |  | d |\n| e |  | f |\n'
		);
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});

	it('commits when the mounted rows straddle an unmounted one', async () => {
		const { deps, mutations } = makeWindowedTable([0, 2]);

		await mutations.deleteColumn(0);

		expect(serialize(deps.doc)).toBe('| b |\n| --- |\n| d |\n| f |\n');
		expect(deps.undoManager.getStacks().undo.length).toBe(1);
	});

	it('reorders columns with a straddling mounted slice', async () => {
		const { deps, mutations } = makeWindowedTable([0, 2]);

		await mutations.reorderColumnTo(0, 1);

		expect(serialize(deps.doc)).toBe('| b | a |\n| --- | --- |\n| d | c |\n| f | e |\n');
	});

	// Identical per-row changes make the pairing invisible in the bytes, so only the
	// alignment invariant's channel can see it (armed to fire in commit-invariant-wiring).
	it('the scope-alignment invariant stays silent on a straddling window', async () => {
		const fires: string[] = [];
		configureEditorEnv({ isTest: false });
		vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
			const head = typeof args[0] === 'string' ? args[0] : '';
			if (head.includes('[invariant:')) fires.push(head);
		});
		const { mutations } = makeWindowedTable([0, 2]);

		await mutations.insertColumnRight(0);

		expect(fires).toEqual([]);
	});
});

afterEach(() => {
	resetEditorEnv();
	vi.restoreAllMocks();
});
