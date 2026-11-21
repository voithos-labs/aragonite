// @vitest-environment jsdom
// An `inline()` widget that reads the rest of the document declares `depends` beside `draw`: it's
// handed the answers at its first draw, a key asks one block, it redraws only when an answer that
// says something comes, goes, changes or moves, and what it's handed equals asking every block.
// Miss-analysis: a new home; a widget that read the document had nothing to redraw it on.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, inline, type Block, type WidgetProps } from '#lib/plugin.js';
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

type Mounted = MountedEditor<EditorTestSurface>;
type Ref = { label: string };

// The widget comes first, so a block put in below leaves its place alone.
const DOC = 'see [^a] here\n\n# Top\n\npara one\n\n## Mid\n\npara two\n';
const headingsIn = (block: Block) => (block.text.startsWith('#') ? block.text.trim() : '');

/** A `[^label]` widget whose drawing logs the answers each draw and update got, as handed. */
function refPlugin(depends: ((block: Block) => string) | undefined, log: string[][] = []) {
	const show = (target: HTMLElement, props: WidgetProps<Ref>) => {
		log.push(props.depends as string[]);
		target.textContent = props.depends.filter(Boolean).join('|') || props.data.label;
	};
	const ref = inline({
		name: 'ref',
		label: 'Reference',
		prefix: '[^',
		match: /\[\^(\w+)\]/,
		read: (m) => ({ label: m[1] }),
		sample: '[^a]',
		widget: { delete: 'whole', arrows: 'over', click: 'none' },
		depends,
		draw(target, props) {
			show(target, props);
			return { update: (next) => show(target, next) };
		}
	});
	return definePlugin({
		name: 'refs',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ inlines: [ref] })
	});
}

async function mounted(source = DOC, depends: ((block: Block) => string) | null = headingsIn) {
	const log: string[][] = [];
	const m = mountEditor<EditorTestSurface>({
		source,
		plugins: [refPlugin(depends ?? undefined, log)],
		presentationMode: 'live'
	});
	await m.settle();
	return { m, log };
}

const shown = (m: Mounted) => m.target.querySelector('[data-inline-widget]')?.textContent;
const asked = () => perfSnapshot().keysAsked;
const counting = () => {
	enablePerfInstruments();
	resetPerfInstruments();
};

describe('an inline widget with depends', () => {
	it('is handed the answers at its first draw', async () => {
		const { m, log } = await mounted();
		expect([log[0].join('|'), shown(m)]).toEqual(['|# Top||## Mid|', '# Top|## Mid']);
	});

	it('asks one block per key, and redraws on a heading key, not a paragraph key', async () => {
		const { m, log } = await mounted();
		const calls = log.length;
		counting();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		expect([asked(), log.length]).toEqual([1, calls]);
		resetPerfInstruments();
		typeInto(surfaceAt(m, [1]), '# TopX');
		await m.settle();
		expect([asked(), log.length, shown(m)]).toEqual([1, calls + 1, '# TopX|## Mid']);
	});

	it('redraws on an Enter above a heading, holding answers that index the blocks', async () => {
		const { m, log } = await mounted('see [^a]\n\n# A\n\nparagraph\n\n# B\n');
		const calls = log.length;
		await pressKeyAt(m, [2], 4, { key: 'Enter' });
		await m.settle();
		const held = log.at(-1)!;
		expect(log.length).toBe(calls + 1);
		expect(held).toEqual(m.instance.doc.blocks.map(headingsIn));
		expect(m.instance.doc.blocks[held.indexOf('# B')].text).toBe('# B\n');
	});

	it('hears a key in a table cell beside it', async () => {
		const { m, log } = await mounted('| a |\n| - |\n| [^a] |\n\n# Top\n');
		const calls = log.length;
		typeInto(surfaceAt(m, [1]), '# TopX');
		await m.settle();
		expect([log.length, shown(m)]).toEqual([calls + 1, '# TopX']);
	});
});

describe('an editor whose widgets declare no depends', () => {
	it('asks nothing on a key, and renders only the block typed in', async () => {
		const { m } = await mounted(DOC, null);
		counting();
		typeInto(surfaceAt(m, [2]), 'para oneX');
		await m.settle();
		const others = perfSnapshot().blockRenderPaths.filter((path) => path !== '2');
		expect([asked(), others]).toEqual([0, []]);
	});
});

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
	[
		'an undo',
		async (m) => {
			typeInto(surfaceAt(m, [2]), 'para oneX');
			await m.settle();
			m.instance.runCommand('history.undo');
		}
	]
];

describe('the answers a widget is handed', () => {
	it.each(WRITES)('equal a fresh evaluation after %s', async (_name, write) => {
		const { m, log } = await mounted(DOC, (block) => block.text);
		const calls = log.length;
		await write(m);
		await m.settle();
		expect(log.length).toBeGreaterThan(calls);
		expect(log.at(-1)).toEqual(fresh(m));
	});

	it('are never changed after they are handed over', async () => {
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
