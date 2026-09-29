// @vitest-environment jsdom
// Miss-analysis: every whole-table, row and column Backspace test used a top-level table, so the
// gate that sent a nested table's coverage to the cell clear was never crossed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { settleEditor } from '../../harness/settle';
import { registerChromePluginsForTests } from '../chrome-plugins';
import { cell, placedPaths, rangeKey, rangeKeyEnv, select } from './range-key-env';

const TABLE = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
const ROW_GONE = '| A | B | C |\n| --- | --- | --- |\n| 4 | 5 | 6 |\n';
const COLUMN_GONE = '| A | C |\n| --- | --- |\n| 1 | 3 |\n| 4 | 6 |\n';

const lines = (text: string) => text.trimEnd().split('\n');

interface Wrapper {
	wrap: (table: string) => string;
	/** The table's path inside the wrapper. */
	path: number[];
	/** What the whole table's removal leaves before the paragraph below, and where Backspace
	 *  lands: the end of the block before it, or the paragraph below when there is none. */
	emptied: string;
	landsIn: number[];
}

const WRAPPERS: Record<string, Wrapper> = {
	'at the top level': { wrap: (t) => t, path: [0], emptied: '', landsIn: [0] },
	'in a quote': {
		wrap: (t) =>
			lines(t)
				.map((l) => `> ${l}\n`)
				.join(''),
		path: [0, 0],
		emptied: '',
		landsIn: [0]
	},
	'in a list item': {
		wrap: (t) =>
			lines(t)
				.map((l, i) => `${i === 0 ? '-' : ' '} ${l}\n`)
				.join(''),
		path: [0, 0, 0],
		emptied: '',
		landsIn: [0]
	},
	'in a quote in a quote': {
		wrap: (t) =>
			lines(t)
				.map((l) => `> > ${l}\n`)
				.join(''),
		path: [0, 0, 0],
		emptied: '',
		landsIn: [0]
	},
	'in an open details': {
		wrap: (t) => `<details open>\n<summary>S</summary>\n\n${t}\n</details>\n`,
		path: [0, 1],
		emptied: '<details open>\n<summary>S</summary>\n</details>\n',
		landsIn: [0, 0]
	}
};

interface Coverage {
	cells: [number, number];
	/** What stands where the table stood, before the wrapper goes around it. */
	left: string;
	/** Where the caret lands, under the table's path. */
	caret: number[];
}

const COVERAGES: Record<string, Coverage> = {
	'a whole row': { cells: [3, 5], left: ROW_GONE, caret: [1, 0] },
	'a whole column': { cells: [1, 7], left: COLUMN_GONE, caret: [0, 1] }
};

const AFTER = '\nafter\n';

describe('Backspace over a table held whole, or a whole row or column of it, at any depth', () => {
	beforeEach(() => {
		registerChromePluginsForTests();
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	});
	afterEach(() => vi.unstubAllGlobals());

	for (const [where, { wrap, path, emptied, landsIn }] of Object.entries(WRAPPERS)) {
		for (const [what, { cells, left, caret }] of Object.entries(COVERAGES)) {
			it(`${what} ${where}`, async () => {
				const source = wrap(TABLE) + AFTER;
				const env = rangeKeyEnv(source);
				select(env, cell(path, cells[0]), cell(path, cells[1]));
				await rangeKey(env, 'Backspace');
				await settleEditor();

				expect(serialize(env.h.deps.doc)).toBe(wrap(left) + AFTER);
				expect(placedPaths(env)).toEqual([[...path, ...caret]]);
				await createHistoryActions(env.h.deps, env.h.controller).requestUndo();
				await settleEditor();
				expect(serialize(env.h.deps.doc)).toBe(source);
			});
		}

		it(`the whole table ${where}`, async () => {
			const source = wrap(TABLE) + AFTER;
			const env = rangeKeyEnv(source);
			select(env, cell(path, 0), cell(path, 8));
			await rangeKey(env, 'Backspace');
			await settleEditor();

			expect(serialize(env.h.deps.doc)).toBe(emptied + (emptied ? AFTER : 'after\n'));
			expect(placedPaths(env)).toEqual([landsIn]);
			await createHistoryActions(env.h.deps, env.h.controller).requestUndo();
			await settleEditor();
			expect(serialize(env.h.deps.doc)).toBe(source);
		});
	}
});
