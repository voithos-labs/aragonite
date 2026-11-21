// @vitest-environment jsdom
// A paint that reads the rest of the document declares `paintDepends`: it's handed the answers as
// `ctx.depends`, equal to asking every block again after every write route, a paragraph's key
// paints no other block again, and a plugin turned off asks nothing.
// Miss-analysis: a new home; a paint that read the document had only `editor.repaint` to call.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { Block } from '#lib/schema/doc-view.js';
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
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { WRITE_ROUTES, written } from '#lib/test/harness/write-routes.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	disablePerfInstruments();
});

/** A plugin whose paint logs the block and the answers it was handed. */
function painter(paintDepends: (block: Block) => string) {
	const log: { text: string; depends: readonly string[] }[] = [];
	let editor: Editor | undefined;
	const plugin = definePluginUnit({
		name: 'painter',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			setup: (e) => void (editor = e),
			paintDepends,
			paint(block, ctx) {
				log.push({ text: block.text, depends: ctx.depends });
				return [];
			}
		})
	});
	return { plugin, log, editor: () => editor! };
}

const N = 12;

describe('a paint with paintDepends', () => {
	it.each(WRITE_ROUTES)('is handed answers equal to a fresh evaluation: $name', async (route) => {
		const { plugin, log, editor } = painter((block) => block.text);
		const plugins = [plugin, ...((route.plugins ?? []) as [])];
		const m = mountEditor<EditorTestSurface>({ source: route.source(N), plugins });
		await m.settle();
		await route.setUp?.(m, N);
		const before = written(m);
		const calls = log.length;
		await route.write(m, N);
		expect(written(m), 'the route wrote nothing').not.toEqual(before);
		// `use` turns this plugin off with the rest of the list.
		if (!m.instance.plugins.includes('painter')) return;
		expect(log.length).toBeGreaterThan(calls);
		expect(log.at(-1)!.depends).toEqual(editor().doc.blocks.map((block) => block.text));
	});

	// Miss-analysis: the row above has every block say something, so every write is a change there
	// and one left untold stays hidden; no route row ran answers that are '' for most blocks.
	describe.each([
		[
			'a few blocks either side of the write',
			(b: Block) => (/line (1|6|10)\n/.test(b.text) ? b.text : '')
		],
		['one answer many blocks give', (b: Block) => (b.text.length % 2 ? 'odd' : '')]
	])('whose answers come from %s', (_name, depends) => {
		it.each(WRITE_ROUTES)('leaves no block painted with what went: $name', async (route) => {
			const handed = new Map<Block, readonly string[]>();
			let editor: Editor | undefined;
			const keep = (block: Block, ctx: { depends: readonly string[] }) => {
				handed.set(block, ctx.depends);
				return [];
			};
			const plugin = definePluginUnit({
				name: 'painter',
				version: '1.0.0',
				editor: '*',
				contributes: () => ({
					setup: (e) => void (editor = e),
					paintDepends: depends,
					paint: keep,
					paintContainer: keep
				})
			});
			const plugins = [plugin, ...((route.plugins ?? []) as [])];
			const m = mountEditor<EditorTestSurface>({ source: route.source(N), plugins });
			await m.settle();
			await route.setUp?.(m, N);
			await route.write(m, N);
			await m.settle();
			if (!m.instance.plugins.includes('painter')) return;
			const said = (answers: readonly string[]) => answers.filter(Boolean);
			const now = said(editor!.doc.blocks.map(depends));
			const painted = [...editor!.doc.walk()].filter((block) => handed.has(block));
			expect(painted.length).toBeGreaterThan(0);
			for (const block of painted) expect(said(handed.get(block)!)).toEqual(now);
		});
	});

	const DOC = '# Top\n\npara one\n\npara two\n\n## Mid\n';
	const headings = (block: Block) => (block.text.startsWith('#') ? block.text.trim() : '');

	it("paints only the block a paragraph's key changed, and every block for a heading's", async () => {
		const { plugin, log } = painter(headings);
		const m = mountEditor({ source: DOC, plugins: [plugin] });
		await m.settle();
		enablePerfInstruments();
		resetPerfInstruments();
		let calls = log.length;
		typeInto(surfaceAt(m, [1]), 'para oneX');
		await m.settle();
		expect([log.slice(calls).map((c) => c.text), perfSnapshot().keysAsked]).toEqual([
			['para oneX\n'],
			1
		]);
		calls = log.length;
		typeInto(surfaceAt(m, [0]), '# TopX');
		await m.settle();
		expect(log.slice(calls).length).toBe(4);
		expect(log.at(-1)!.depends).toEqual(['# TopX', '', '', '## Mid']);
	});

	// Miss-analysis: the row above counts `paint` calls, which a kept paint never reaches; none
	// counted the blocks the editor looked a paint up for, so every block was looked up on each key.
	it("looks up no other block's paint on a paragraph's key, and every block's on a heading's", async () => {
		let lookups = 0;
		const paint = () => [];
		const plugin = definePluginUnit({
			name: 'painter',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				paintDepends: headings,
				// Read once each time the editor looks a block's paint up, kept or painted again.
				get paint() {
					lookups++;
					return paint;
				}
			})
		});
		const blocks = 13;
		const body = Array.from({ length: blocks - 1 }, (_, i) => `para ${i}\n`).join('\n');
		const m = mountEditor({ source: `# Top\n\n${body}`, plugins: [plugin] });
		await m.settle();
		lookups = 0;
		typeInto(surfaceAt(m, [1]), 'para 0X');
		await m.settle();
		const onParagraphKey = lookups;
		lookups = 0;
		typeInto(surfaceAt(m, [0]), '# TopX');
		await m.settle();
		expect(onParagraphKey).toBeLessThan(blocks);
		expect(lookups).toBeGreaterThanOrEqual(blocks);
	});

	it('asks nothing once its plugin is turned off', async () => {
		const { plugin } = painter(headings);
		const m = mountEditor({ source: DOC, plugins: [plugin] });
		await m.settle();
		m.instance.use([]);
		await m.settle();
		enablePerfInstruments();
		resetPerfInstruments();
		typeInto(surfaceAt(m, [1]), 'para oneX');
		await m.settle();
		expect(perfSnapshot().keysAsked).toBe(0);
	});

	it('hands every paint the same answers, empty without paintDepends', async () => {
		const { plugin, log } = painter(headings);
		const plain = painter(headings);
		const bare = definePluginUnit({
			name: 'bare',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				paint: (block, ctx) => (plain.log.push({ text: block.text, depends: ctx.depends }), [])
			})
		});
		const m = mountEditor({ source: DOC, plugins: [plugin, bare] });
		await m.settle();
		expect(new Set(log.map((c) => c.depends)).size).toBe(1);
		expect(plain.log.every((c) => c.depends.length === 0)).toBe(true);
	});
});
