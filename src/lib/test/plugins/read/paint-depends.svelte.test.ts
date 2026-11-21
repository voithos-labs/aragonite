// @vitest-environment jsdom
// A paint that reads the rest of the document declares `paintDepends`: it's handed the answers as
// `ctx.depends`, equal to asking every block again after every write route, a paragraph's key
// paints no other block again, an answer moved paints every block again, and a plugin turned off
// asks nothing.
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
	pressKeyAt,
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

	it('paints every block again on an Enter above a heading, each handed answers that index the blocks', async () => {
		const { plugin, log, editor } = painter(headings);
		const m = mountEditor({ source: DOC, plugins: [plugin] });
		await m.settle();
		const calls = log.length;
		await pressKeyAt(m, [1], 4, { key: 'Enter' });
		await m.settle();
		const after = log.slice(calls);
		const blocks = editor().doc.blocks;
		expect(new Set(after.map((c) => c.text))).toEqual(new Set(blocks.map((block) => block.text)));
		for (const call of after) expect(call.depends).toEqual(blocks.map(headings));
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
