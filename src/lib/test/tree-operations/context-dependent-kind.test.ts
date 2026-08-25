import { describe, it, expect, beforeEach } from 'vitest';
import { updateNodeContent, splitNode } from '../../tree-operations/node-ops';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { rebuildTableRowRaw } from '../../schema/container-rebuilders';
import { parse } from '../../core/parser';
import { testClosure } from '$lib/test/support/closure';
import type { CstNode } from '../../core/nodes';

function registerChromeKind() {
	const chrome = declarePluginKind('spec-chrome');
	registerBlockKind(chrome, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	return chrome;
}

describe('updateNodeContent — contextDependentKind stickiness', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('keeps a context-dependent kind through a content edit (no downgrade)', () => {
		const chrome = registerChromeKind();
		const parent = { children: [{ kind: chrome, leadingTrivia: '', raw: 'Title\n' }] as CstNode[] };

		const { change } = updateNodeContent(parent as never, 0, 'TitleX\n');

		expect(parent.children[0].kind).toBe(chrome);
		expect(parent.children[0].raw).toBe('TitleX\n');
		expect(change).toEqual({ op: 'noop' });
	});

	it('still reparses an ordinary kind (paragraph→heading on marker insert)', () => {
		const parent = {
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'hi\n' }] as CstNode[]
		};
		updateNodeContent(parent as never, 0, '# hi\n');
		expect(parent.children[0].kind).toBe('heading');
	});
});

// Every cell gesture's text reaches the row's verbatim bytes through the write branch
// above, so the legality pass belongs there. Three gestures carried it individually and
// each lost it; these pin the sink so a fourth cannot.
describe('updateNodeContent — the kind’s normalizeRawWrite runs at the write', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	/**
	 * Read back the way the user gets it: the row's rebuilt bytes reparsed in their own table.
	 */
	function writeCellAndReparse(cellRaws: string[], at: number, text: string): string[] {
		const row: CstNode = {
			kind: 'tableRow',
			leadingTrivia: '',
			raw: '',
			metadata: { isHeader: false },
			children: cellRaws.map((raw) => ({ kind: 'tableCell', leadingTrivia: '', raw }))
		};
		updateNodeContent(row as never, at, text);
		rebuildTableRowRaw(row, '\n');
		return bodyCellsOf(cellRaws.length, row.raw);
	}

	/** Body-cell raws of a `columns`-wide table whose single body row is `rowRaw`. */
	function bodyCellsOf(columns: number, rowRaw: string): string[] {
		const header = '|' + ' h |'.repeat(columns) + '\n';
		const delimiter = '|' + ' --- |'.repeat(columns) + '\n';
		const table = parse(header + delimiter + rowRaw).children[0];
		return (table.children?.[1].children ?? []).map((cell) => cell.raw);
	}

	it('a bare pipe written into a cell costs the row no column', () => {
		// Written bare the row is one cell too wide for the delimiter, so the parser truncates
		// and the last column's content is gone.
		expect(bodyCellsOf(3, '| d|X | e | f |\n')).toEqual(['d', 'X', 'e']);

		expect(writeCellAndReparse(['d', 'e', 'f'], 0, 'd|X')).toEqual(['d\\|X', 'e', 'f']);
	});

	it('a newline written into a cell cannot spill into the next row', () => {
		expect(writeCellAndReparse(['d', 'e'], 0, 'd\nX')).toEqual(['d X', 'e']);
	});

	it('is idempotent through the seam — rewriting an escaped cell adds no backslash', () => {
		expect(writeCellAndReparse(['a\\|b', 'keep'], 0, 'a\\|bY')).toEqual(['a\\|bY', 'keep']);
	});

	it('leaves a context-dependent kind that declares no rule writing raw verbatim', () => {
		const chrome = registerChromeKind();
		const parent = { children: [{ kind: chrome, leadingTrivia: '', raw: 'Title\n' }] as CstNode[] };

		updateNodeContent(parent as never, 0, 'a|b\n');

		expect(parent.children[0].raw).toBe('a|b\n');
	});
});

describe('splitNode — contextDependentKind is unsplittable', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('no-ops on a context-dependent kind without mutating children', () => {
		const chrome = registerChromeKind();
		const parent = { children: [{ kind: chrome, leadingTrivia: '', raw: 'Title\n' }] as CstNode[] };

		const { change } = splitNode(parent as never, 0, 3, undefined, undefined, undefined);

		expect(change).toEqual({ op: 'noop' });
		expect(parent.children).toHaveLength(1);
		expect(parent.children[0].kind).toBe(chrome);
		expect(parent.children[0].raw).toBe('Title\n');
	});

	it('still splits an ordinary paragraph into two reparsed halves', () => {
		const parent = {
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'hello world\n' }] as CstNode[]
		};
		const { change } = splitNode(parent as never, 0, 5, undefined, undefined, undefined);
		expect(change).toMatchObject({ op: 'replace', newCount: 2 });
		expect(parent.children).toHaveLength(2);
	});
});
