// @vitest-environment jsdom
// A block type that reads the rest of the document declares `depends`: `draw` is handed the
// answers, each top-level block is asked once for every drawing of the type and then only the
// blocks a write changed, `update` runs when an answer that says something comes, goes, changes or
// moves, and the answers it's handed equal asking every block again after every kind of write.
// Miss-analysis: a new home; a drawing that read the document walked it on every key instead.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { BoxDrawContext } from '#lib/schema/drawing.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { dispatchPaste } from '#lib/test/harness/insertion-routes.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	disablePerfInstruments();
});

// The drawing comes first, so a block put in below leaves its place, and its update, alone.
const DOC = '[[keys]]\n\n# Top\n\npara one\n\n## Mid\n\npara two\n';
const KEYS_LINE = '[[keys]]\n\n';
const headingsIn = (block: Block) => (block.text.startsWith('#') ? block.text.trim() : '');

/** A `[[keys]]` box whose drawing logs the answers each `draw` and `update` got, as handed. */
function keysPlugin(depends: (block: Block) => string, log: string[][] = []) {
	return definePlugin({
		name: 'keys',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				lineBlock({
					name: 'toc',
					label: 'Keys',
					match: /^\[\[keys\]\]$/,
					sample: '[[keys]]',
					insert: { none: 'a test block type' },
					edit: 'box',
					depends,
					draw: (_block, ctx: BoxDrawContext) => {
						const dom = document.createElement('nav');
						const show = (answers: readonly string[]) => {
							log.push(answers as string[]);
							dom.textContent = answers.filter(Boolean).join('|');
						};
						show(ctx.depends);
						return { dom, update: (_b, next) => show(next.depends) };
					}
				})
			]
		})
	});
}

type Mounted = MountedEditor<EditorTestSurface>;

async function mounted(source = DOC, depends = headingsIn) {
	const log: string[][] = [];
	const plugin = keysPlugin(depends, log);
	const m = mountEditor<EditorTestSurface>({ source, plugins: [plugin] });
	await m.settle();
	return { m, log, plugin };
}

const nav = (m: Mounted) => m.target.querySelector('nav')!;
const asked = () => perfSnapshot().keysAsked;
const counting = () => {
	enablePerfInstruments();
	resetPerfInstruments();
};

describe('a drawing with depends', () => {
	it('is handed the answers in draw, so nothing shows without them', () => {
		const log: string[][] = [];
		const m = mountEditor<EditorTestSurface>({
			source: DOC,
			plugins: [keysPlugin(headingsIn, log)]
		});
		flushSync();
		expect([log.map((answers) => answers.join('|')), nav(m).textContent]).toEqual([
			['|# Top||## Mid|'],
			'# Top|## Mid'
		]);
	});

	it('asks one block per key, and updates on a heading key, not a paragraph key', async () => {
		const { m, log } = await mounted();
		expect(nav(m).textContent).toBe('# Top|## Mid');
		const calls = log.length;
		counting();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect([asked(), log.length]).toEqual([1, calls]);
		resetPerfInstruments();
		typeInto(surfaceAt(m, [1]), '# TopX');
		await m.settle();
		expect([asked(), log.length, nav(m).textContent]).toEqual([1, calls + 1, '# TopX|## Mid']);
	});

	it('updates on an Enter above a heading, holding answers that index the blocks', async () => {
		const { m, log } = await mounted('[[keys]]\n\n# A\n\nparagraph\n\n# B\n');
		const calls = log.length;
		await pressKeyAt(m, [2], 4, { key: 'Enter' });
		await m.settle();
		const held = log.at(-1)!;
		expect(log.length).toBe(calls + 1);
		expect(held).toEqual(m.instance.doc.blocks.map(headingsIn));
		expect(m.instance.doc.blocks[held.indexOf('# B')].text).toBe('# B\n');
	});

	it('runs no update on an Enter below the last heading', async () => {
		const { m, log } = await mounted();
		const calls = log.length;
		await pressKeyAt(m, [4], 4, { key: 'Enter' });
		await m.settle();
		expect(log.length).toBe(calls);
	});

	it('hands an array it never changes after', async () => {
		const { m, log } = await mounted(DOC, (block) => block.text);
		const held = log.at(-1)!;
		const was = [...held];
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		await pressKeyAt(m, [2], 2, { key: 'Enter' });
		await m.settle();
		expect([held, log.at(-1) === held]).toEqual([was, false]);
	});
});

describe("a block type's drawings", () => {
	const LONG = KEYS_LINE + Array.from({ length: 40 }, (_, i) => `para ${i}\n`).join('\n');

	it('ask each block once between them', () => {
		counting();
		mountEditor({ source: KEYS_LINE + LONG, plugins: [keysPlugin(headingsIn)] });
		flushSync();
		expect(asked()).toBe(42);
	});

	it('ask nothing the watch holds when one is drawn again', async () => {
		const { m, log } = await mounted(LONG);
		await m.instance.edit().replace({ from: 0, to: KEYS_LINE.length }, '').commit();
		await m.settle();
		expect(nav(m)).toBeNull();
		counting();
		m.instance.runCommand('history.undo');
		await m.settle();
		// The blocks the undo put back, never the 41 a mount would ask.
		expect([nav(m) !== null, asked()]).toEqual([true, 2]);
		expect(log.at(-1)).toEqual(m.instance.doc.blocks.map(headingsIn));
	});

	it('let go of the writes once 65 pass with none drawn, then ask every block afresh', async () => {
		const { m, log } = await mounted();
		await m.instance.edit().replace({ from: 0, to: KEYS_LINE.length }, '').commit();
		await m.settle();
		for (let i = 0; i < 65; i++) {
			typeInto(surfaceAt(m, [1]), `para one${'x'.repeat(i + 1)}`);
			await m.settle();
		}
		await m.instance.load(m.source().replace('para two', '# Two'));
		await m.settle();
		counting();
		typeInto(surfaceAt(m, [1]), 'para oneY');
		await m.settle();
		expect(perfSnapshot().keyWritesHeard).toBe(0);
		await m.instance.edit().replace({ from: 0, to: 0 }, KEYS_LINE).commit();
		await m.settle();
		expect(log.at(-1)).toEqual(m.instance.doc.blocks.map(headingsIn));
		expect(nav(m).textContent).toBe('# Top|## Mid|# Two');
	});
});

describe('an editor with no drawing that declares depends', () => {
	it('asks nothing and keeps nothing on a key', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		counting();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect([asked(), perfSnapshot().stringsKept]).toEqual([0, 0]);
	});

	it('asks nothing once its drawing is gone', async () => {
		const { m } = await mounted();
		m.instance.use([]);
		await m.settle();
		counting();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect(asked()).toBe(0);
	});
});

/** The answers asked of every block now, as a fresh evaluation. */
const fresh = (m: Mounted) => m.instance.doc.blocks.map((block) => block.text);

const WRITES: [string, (m: Mounted) => Promise<unknown>][] = [
	['a key', async (m) => typeInto(surfaceAt(m, [2]), 'para oneX')],
	['Enter', (m) => pressKeyAt(m, [2], 2, { key: 'Enter' })],
	[
		'a paste across blocks',
		async (m) => {
			await m.instance.setSelection({
				anchor: { path: [2], offset: 2 },
				focus: { path: [4], offset: 2 }
			});
			await m.settle();
			dispatchPaste(surfaceAt(m, [2]), 'pasted\n\nmore');
		}
	],
	['a block moved', (m) => pressKeyAt(m, [4], 2, { key: 'ArrowUp', altKey: true })],
	[
		'an undo',
		async (m) => {
			typeInto(surfaceAt(m, [2]), 'para oneX');
			await m.settle();
			m.instance.runCommand('history.undo');
		}
	],
	['a document swap', async (m) => void m.instance.load('[[keys]]\n\n# New\n\nbody\n')],
	['a use', async (m) => m.instance.use([KEYS, EXTRA])]
];

const EXTRA = definePlugin({
	name: 'extra',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({})
});
const TEXT_LOG: string[][] = [];
const KEYS = keysPlugin((block) => block.text, TEXT_LOG);

describe('the answers update is handed', () => {
	it.each(WRITES)('equal a fresh evaluation after %s', async (_name, write) => {
		TEXT_LOG.length = 0;
		const m = mountEditor<EditorTestSurface>({ source: DOC, plugins: [KEYS] });
		await m.settle();
		const log = TEXT_LOG;
		const calls = log.length;
		await write(m);
		await m.settle();
		expect(log.length).toBeGreaterThan(calls);
		expect(log.at(-1)).toEqual(fresh(m));
	});
});
