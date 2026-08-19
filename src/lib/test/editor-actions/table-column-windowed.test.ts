import { describe, it, expect, vi, afterEach } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import { makeTableMutations } from './table-mutations-harness';

afterEach(() => vi.restoreAllMocks());

// A row windowed out of the table's mounted slice has no BlockListState, so scoping
// every row unconditionally throws on the first unmounted one. Only mounted rows are
// scoped; the rest ride the table scope's unshare + raw rebuild and must still change bytes.

const TALL = '| a | b |\n| --- | --- |\n| c | d |\n| e | f |\n';

/** A table where only `mountedRows` carry a BlockListState, as windowing leaves it. */
const makeWindowedTable = (mountedRows: number[] = [0]) =>
	makeTableMutations(TALL, {
		mountedRows,
		rowIds: ['row-0', 'row-1', 'row-2'],
		focusedCell: { rowIdx: 0, colIdx: 0 }
	});

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
		const { mutations } = makeWindowedTable([0, 2]);

		await mutations.insertColumnRight(0);

		expect(takeDevWarns()).toEqual([]);
	});
});
