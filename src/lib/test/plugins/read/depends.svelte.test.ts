// @vitest-environment jsdom
// A drawing that reads the rest of the document declares `depends`: each top-level block is asked
// once as it mounts and then only the blocks a write changed, `update` runs when an answer that
// says something changes, and the answers it's handed equal asking every block again after every
// kind of write. An editor with no such drawing asks nothing.
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
const headingsIn = (block: Block) => (block.text.startsWith('#') ? block.text.trim() : '');

/** A `[[keys]]` box whose drawing logs the answers each call got, as handed. */
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
					draw: (_block, ctx: BoxDrawContext) => {
						const dom = document.createElement('nav');
						const show = (answers: readonly string[]) => {
							log.push(answers as string[]);
							dom.textContent = answers.filter(Boolean).join('|');
						};
						show(ctx.depends);
						return { dom, depends, update: (_b, next) => show(next.depends) };
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

describe('a drawing with depends', () => {
	// A frame paints only between tasks, so answers in place as the mount's flush ends are what
	// the first frame shows.
	it('is handed the answers in the flush that draws it, so no frame shows the empty draw', () => {
		const log: string[][] = [];
		const m = mountEditor<EditorTestSurface>({
			source: DOC,
			plugins: [keysPlugin(headingsIn, log)]
		});
		flushSync();
		expect([log.map((answers) => answers.join('|')), nav(m).textContent]).toEqual([
			['', '|# Top||## Mid|'],
			'# Top|## Mid'
		]);
	});

	it('asks one block per key, and updates on a heading key, not a paragraph key', async () => {
		const { m, log } = await mounted();
		expect(nav(m).textContent).toBe('# Top|## Mid');
		const calls = log.length;
		enablePerfInstruments();
		resetPerfInstruments();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect([perfSnapshot().keysAsked, log.length]).toEqual([1, calls]);
		await pressKeyAt(m, [2], 2, { key: 'Enter' });
		await m.settle();
		expect(log.length).toBe(calls);
		resetPerfInstruments();
		typeInto(surfaceAt(m, [1]), '# TopX');
		await m.settle();
		expect([perfSnapshot().keysAsked, log.length, nav(m).textContent]).toEqual([
			1,
			calls + 1,
			'# TopX|## Mid'
		]);
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

describe('an editor with no drawing that declares depends', () => {
	it('asks nothing and keeps nothing on a key', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		enablePerfInstruments();
		resetPerfInstruments();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect([perfSnapshot().keysAsked, perfSnapshot().stringsKept]).toEqual([0, 0]);
	});

	it('asks nothing once its drawing is gone', async () => {
		const { m } = await mounted();
		m.instance.use([]);
		await m.settle();
		enablePerfInstruments();
		resetPerfInstruments();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect(perfSnapshot().keysAsked).toBe(0);
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
