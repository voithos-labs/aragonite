// @vitest-environment jsdom
// The spell check's waves in a mounted editor: a mark over each misspelled word of prose, painted
// again when an answer lands late or the dictionary's words change, in every editor sharing it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spellcheckPlugin } from '#packages/spellcheck/src/index.js';
import type { Dictionary } from '#packages/spellcheck/src/dictionary.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { paintedMarks } from '#lib/test/harness/painted-marks.js';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const MISSPELLED = new Set(['tset', 'speling']);

/** A dictionary that knows every word but two, answering late when asked to, sharing `add`s. */
function dictionary(late = false) {
	const added = new Set<string>();
	const watchers = new Set<() => void>();
	const known = (word: string) => !MISSPELLED.has(word) || added.has(word);
	const dict: Dictionary = {
		check: (word) => (late ? Promise.resolve(known(word)) : known(word)),
		suggest: () => [],
		add(word) {
			added.add(word);
			for (const changed of watchers) changed();
		},
		watch(changed) {
			watchers.add(changed);
			return () => void watchers.delete(changed);
		}
	};
	return { dict, watchers };
}

async function mounted(source: string, dict: Dictionary): Promise<MountedEditor> {
	const m = mountEditor({ source, plugins: [spellcheckPlugin({ dictionary: dict })] });
	await m.settle();
	return m;
}

const waves = (m: MountedEditor, path: number[]) => paintedMarks(m, path, 'spell-overlay');

describe('the waves', () => {
	it('mark each misspelled word of prose, and none in code', async () => {
		const m = await mounted('A tset of speling, `tset`.\n\n```\ntset\n```\n', dictionary().dict);
		expect(waves(m, [0])).toEqual(['tset', 'speling']);
		expect(waves(m, [1])).toEqual([]);
	});

	it('mark two misspellings in one table cell', async () => {
		const m = await mounted('| a | b |\n| - | - |\n| tset speling | ok |\n', dictionary().dict);
		expect(waves(m, [0, 1, 0])).toEqual(['tset', 'speling']);
	});

	it('come once a late answer lands', async () => {
		const m = await mounted('A tset here.\n', dictionary(true).dict);
		await m.settle();
		expect(waves(m, [0])).toEqual(['tset']);
	});

	it('leave a word added in one editor in every editor sharing the dictionary', async () => {
		const { dict } = dictionary();
		const a = await mounted('A tset here.\n', dict);
		const b = await mounted('Another tset.\n', dict);
		expect([waves(a, [0]), waves(b, [0])]).toEqual([['tset'], ['tset']]);
		void dict.add!('tset');
		await a.settle();
		expect([waves(a, [0]), waves(b, [0])]).toEqual([[], []]);
	});

	it('stop watching the dictionary once the editor goes', async () => {
		const { dict, watchers } = dictionary();
		const m = await mounted('A tset here.\n', dict);
		expect(watchers.size).toBe(1);
		await m.destroy();
		expect(watchers.size).toBe(0);
	});
});
