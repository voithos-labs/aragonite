// @vitest-environment jsdom
// A typed letter and the caret move the browser reports after it place no document byte, so neither
// reads a whole list of blocks, whatever container the caret sits in and whatever actions are listed.
// A plugin that asks where the selection is does place one, and in a quote, a list or a table that
// pairs one child's lines with the container's, however many siblings the child has.
// Miss-analysis: the keystroke cost rows drove the commit alone, never the `selectionchange` that
// follows it, where the selection toolbar read the caret's byte through the container around it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import type { SelectionAction } from '#lib/schema/selection-action.js';
import type { Editor } from '#lib/schema/plugin-unit.js';
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
	placeCaret,
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
		contributes: () => ({ selectionActions: [action] })
	});

/** The browser's report of a selection it moved, which reaches the editor on a later task. */
async function reportSelection(m: MountedEditor): Promise<void> {
	document.dispatchEvent(new Event('selectionchange'));
	await m.settle();
}

/** Whole lists read to place a byte: containers the byte map paired, top-level blocks measured. */
function listReads(): number {
	const { byteMapReads, topBlocksMeasured } = perfSnapshot();
	return byteMapReads + topBlocksMeasured;
}

/** Whole-list reads made while a letter was typed into `el` and its caret reported. */
async function listReadsTyping(m: MountedEditor, el: HTMLElement): Promise<number> {
	const before = m.source();
	const reads = listReads();
	typeInto(el, el.textContent + 'x');
	await m.settle();
	await reportSelection(m);
	expect(m.source()).not.toBe(before);
	return listReads() - reads;
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

// ── A plugin that reads the selection as the author types ────────────────────

/** A container `n` children long, and the text surface of child `c`. */
const SIBLINGS: {
	name: string;
	source(n: number): string;
	surface(m: MountedEditor, c: number): HTMLElement;
}[] = [
	{
		name: 'a quoted paragraph',
		source: (n) => '> line\n>\n'.repeat(n),
		surface: (m, c) => surfaceAt(m, [0, c])
	},
	{
		name: 'a list item',
		source: (n) => '- line\n'.repeat(n),
		surface: (m, c) => surfaceAt(m, [0, c, 0])
	},
	{
		name: 'a table cell',
		source: (n) => '| a | b |\n| - | - |\n' + '| line | x |\n'.repeat(n),
		surface: (m, c) => cellAt(m, c, 0)
	}
];

/** Container lines the byte map paired over a click into child 3 of `n` and the first letter typed
 *  there, with a plugin asking where the selection is on every caret move and every edit. */
async function linesPairedFollowing(place: (typeof SIBLINGS)[number], n: number): Promise<number> {
	const seen: ({ from: number; to: number } | null)[] = [];
	const ask = (editor: Pick<Editor, 'selection'>) => () => seen.push(editor.selection);
	const follower = definePlugin({
		name: 'follows-typing',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			setup(editor) {
				const offs = [editor.on('selection', ask(editor)), editor.on('edit', ask(editor))];
				return () => offs.forEach((off) => off());
			}
		})
	});
	const m = mountEditor({ source: place.source(n), plugins: [follower] });
	await m.settle();
	const before = perfSnapshot();
	const el = place.surface(m, 3);
	// The click comes first: a container nobody has typed in yet answers from what its parse left.
	placeCaret(el, 2);
	await reportSelection(m);
	typeInto(el, el.textContent + 'x');
	await m.settle();
	await reportSelection(m);
	// Every read placed a byte, so the count below is of a map that was asked each time.
	expect(seen.length).toBeGreaterThanOrEqual(2);
	expect(seen).not.toContain(null);
	expect(perfSnapshot().byteMapReads).toBeGreaterThan(before.byteMapReads);
	const paired = perfSnapshot().linesPaired - before.linesPaired;
	await m.destroy();
	return paired;
}

// Miss-analysis: the rows above hold the editor's own listeners at no read at all, so nothing
// priced a read a plugin makes, least of all in a quote no keystroke had rebuilt yet.
describe('G4.339 a plugin reading editor.selection on every caret move and edit maps no whole container', () => {
	it.each(SIBLINGS)(
		"in $name it pairs one child's lines, at 40 siblings as at 400",
		async (place) => {
			expect(await linesPairedFollowing(place, 400)).toBe(await linesPairedFollowing(place, 40));
		}
	);
});
