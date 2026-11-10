// @vitest-environment jsdom
// A typed letter and the caret move the browser reports after it place no document byte, so neither
// reads a whole list of blocks, whatever container the caret sits in and whatever actions are listed.
// Miss-analysis: the keystroke cost rows drove the commit alone, never the `selectionchange` that
// follows it, where the selection toolbar read the caret's byte through the container around it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import type { SelectionAction } from '#lib/schema/selection-action.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt } from '../blocks/table/mount-table';

beforeAll(installLayoutStubs);
beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const lines = (prefix: string, between: string) =>
	Array.from({ length: 12 }, (_, i) => `${prefix}line ${i}\n`).join(between);
const QUOTE = lines('> ', '>\n');
const TABLE = '| a | b |\n| - | - |\n' + lines('| ', '').replaceAll('\n', ' | x |\n');

/** A document per place a caret can sit, and a text surface in the middle of it. */
const PLACES: { name: string; source: string; surface(m: MountedEditor): HTMLElement }[] = [
	{ name: 'a top-level paragraph', source: lines('', '\n'), surface: (m) => surfaceAt(m, [5]) },
	{ name: 'a quoted paragraph', source: QUOTE, surface: (m) => surfaceAt(m, [0, 5]) },
	{ name: 'a list item', source: lines('- ', ''), surface: (m) => surfaceAt(m, [0, 5, 0]) },
	{ name: 'a table cell', source: TABLE, surface: (m) => cellAt(m, 5, 0) }
];

const actionPlugin = (action: SelectionAction) =>
	definePlugin({
		name: 'acts',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ actions: [action] })
	});

/** The browser's report of a selection it moved, which reaches the editor on a later task. */
async function reportSelection(m: MountedEditor): Promise<void> {
	document.dispatchEvent(new Event('selectionchange'));
	await m.settle();
}

/** Whole-list reads the byte map made while a letter was typed into `el` and its caret reported. */
async function listReadsTyping(m: MountedEditor, el: HTMLElement): Promise<number> {
	const before = m.source();
	const reads = perfSnapshot().byteMapReads;
	typeInto(el, el.textContent + 'x');
	await m.settle();
	await reportSelection(m);
	expect(m.source()).not.toBe(before);
	return perfSnapshot().byteMapReads - reads;
}

describe('G4.339 a typed letter and its caret move read no whole list through the byte map', () => {
	for (const { name, source, surface } of PLACES) {
		it(`in ${name}, with no plugin`, async () => {
			const m = mountEditor({ source });
			await m.settle();
			expect(await listReadsTyping(m, surface(m))).toBe(0);
		});

		it(`in ${name}, with a selection action listed`, async () => {
			const action: SelectionAction = { label: 'Shout', rows: () => [] };
			const m = mountEditor({ source, plugins: [actionPlugin(action)] });
			await m.settle();
			expect(await listReadsTyping(m, surface(m))).toBe(0);
		});
	}
});

describe('the selection toolbar asks the actions about each range the browser reports', () => {
	// Proves the rows above reach the toolbar's read: a range is the one selection it measures.
	it('captures a selected range once per report, and reads its bytes for it', async () => {
		const captured: { from: number; to: number }[] = [];
		const action: SelectionAction = {
			label: 'Shout',
			capture: (_editor, range) => (captured.push({ ...range }), range),
			rows: () => []
		};
		const m = mountEditor({ source: QUOTE, plugins: [actionPlugin(action)] });
		await m.settle();
		selectRange(surfaceAt(m, [0, 5]), 1, 3);
		const reads = perfSnapshot().byteMapReads;
		await reportSelection(m);

		const start = QUOTE.indexOf('line 5');
		expect(captured).toEqual([{ from: start + 1, to: start + 3 }]);
		expect(perfSnapshot().byteMapReads).toBeGreaterThan(reads);
	});
});
