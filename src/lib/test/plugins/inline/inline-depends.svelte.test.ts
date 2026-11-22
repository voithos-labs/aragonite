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
import { WRITE_ROUTES } from '#lib/test/harness/write-routes.js';
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

	it('renders no other block on a key that changes no answer, a widget in each', async () => {
		const source = 'plain\n\n' + Array.from({ length: 8 }, (_, i) => `p${i} [^a]`).join('\n\n');
		const { m, log } = await mounted(source);
		const calls = log.length;
		counting();
		typeInto(surfaceAt(m, [0]), 'plainX');
		await m.settle();
		const others = perfSnapshot().blockRenderPaths.filter((path) => path !== '0');
		expect([asked(), others, log.length]).toEqual([1, [], calls]);
	});

	it('keeps hearing once the block whose widget asked first is gone', async () => {
		const { m } = await mounted('plain\n\n[^a] two\n\n# Top\n');
		typeInto(surfaceAt(m, [0]), '[^a] plain');
		await m.settle();
		await pressKeyAt(m, [1], 0, { key: 'Backspace' });
		await m.settle();
		typeInto(surfaceAt(m, [1]), '# TopX');
		await m.settle();
		const widgets = [...m.target.querySelectorAll('[data-inline-widget]')];
		expect(widgets.map((widget) => widget.textContent)).toEqual(['# TopX', '# TopX']);
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

const N = 12;
// A block no route writes in, as a paragraph and as a table's cell: the two pools.
const HOSTS: [string, string][] = [
	['a paragraph', 'line 7 [^a]\n'],
	['a table cell', '| h |\n| - |\n| line 7 [^a] |\n']
];
const fewSay = (block: Block) => (/line (1|6|10)\r?\n/.test(block.text) ? block.text : '');

/** Whether two lists of answers say the same at every index, '' and no slot alike. */
function aligned(a: readonly string[], b: readonly string[]): boolean {
	for (let i = 0, end = Math.max(a.length, b.length); i < end; i++) {
		if ((a[i] ?? '') !== (b[i] ?? '')) return false;
	}
	return true;
}

describe('the answers a widget is handed', () => {
	// Miss-analysis: the widget's rows wrote by four routes beside one host, where the paint's and
	// the drawing's run every route; a route or a pool that left the widget untold had no row.
	describe.each(HOSTS)('in %s, after every write route', (_host, hostText) => {
		it.each(WRITE_ROUTES)('$name', async (route) => {
			const log: string[][] = [];
			const plugins = [refPlugin(fewSay, log), ...((route.plugins ?? []) as [])];
			const base = route.source(N);
			const eol = base.includes('\r\n') ? '\r\n' : '\n';
			const source = base.replace(/line 7\r?\n/, hostText.replaceAll('\n', eol));
			const m = mountEditor<EditorTestSurface>({ source, plugins, presentationMode: 'live' });
			await m.settle();
			await route.setUp?.(m, N);
			const widget = () => m.target.querySelector('[data-inline-widget]');
			expect(widget(), 'a widget before the write').not.toBeNull();
			const was = m.instance.doc.blocks.map(fewSay);
			const calls = log.length;
			await route.write(m, N);
			await m.settle();
			// Only a route that reads the document again, without the plugin or the block, drops it.
			if (route.announces === 'whole' && !widget()) return;
			expect(widget(), 'a widget after the write').not.toBeNull();
			const now = m.instance.doc.blocks.map(fewSay);
			expect(aligned(log.at(-1)!, now), 'the answers held').toBe(true);
			const drawn = log.length - calls;
			if (!aligned(was, now)) expect(drawn, 'an answer moved').toBeGreaterThan(0);
			else if (route.announces === 'exact') expect(drawn, 'no answer moved').toBe(0);
		});
	});

	const BESIDE = definePlugin({
		name: 'beside',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({})
	});

	// The two routes above that read the document again drop the widget; these keep it.
	it.each<[string, (m: Mounted, plugin: ReturnType<typeof refPlugin>) => unknown]>([
		['a load', (m) => m.instance.load(m.source().replace('para two', '## Low'))],
		['a use that keeps the plugin', (m, plugin) => m.instance.use([plugin, BESIDE])]
	])('equal a fresh evaluation after %s', async (_name, write) => {
		const log: string[][] = [];
		const plugin = refPlugin(headingsIn, log);
		const m = mountEditor<EditorTestSurface>({
			source: DOC,
			plugins: [plugin],
			presentationMode: 'live'
		});
		await m.settle();
		await write(m, plugin);
		await m.settle();
		expect(shown(m)).not.toBeUndefined();
		expect(log.at(-1)).toEqual(m.instance.doc.blocks.map(headingsIn));
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
