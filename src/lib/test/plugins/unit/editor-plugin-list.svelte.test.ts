// @vitest-environment jsdom
// What a mounted editor does with its own plugin list: two editors apart, errors heard from mount
// on, what a plugin adds dying with it, and `use` turning plugins on and off in a running editor.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';
import type { PluginBlockKind } from '#lib/core/nodes.js';
import type { Editor, PluginError } from '#lib/schema/plugin-unit.js';
import { createEditor } from '#lib/create-editor.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { testView } from '#lib/test/harness/test-view.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	typeInFirstBlock
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const markerOpener = (kind: PluginBlockKind): BlockOpener => ({
	priority: 5,
	tryOpen: (ctx) =>
		ctx.line.text.startsWith('@b')
			? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
			: null,
	interruptsParagraph: (t) => t.startsWith('@b')
});

// A `setup` plugin with block syntax, installed once for the file by the first editor listing it.
const marks = definePlugin({
	name: 'unit-marks',
	setup: () =>
		void testLeaf('unit-marks-block', (kind) => ({ opener: markerOpener(kind), view: testView() }))
});

/** A plugin value that records, per editor, the options it got and the edits it heard. */
function recorder(name = 'unit-recorder') {
	const seen: { tag: string; editor: Editor; edits: number }[] = [];
	const plugin = definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		defaults: { tag: '' },
		contributes: ({ tag }) => ({
			setup(editor) {
				const entry = { tag, editor, edits: 0 };
				seen.push(entry);
				editor.on('edit', () => entry.edits++);
			}
		})
	});
	return { plugin, seen };
}

const kinds = (m: ReturnType<typeof mountEditor>) =>
	[0, 1].map((i) => m.instance.getBlockKindAt([i]));

describe('two editors on one page', () => {
	it('run their own plugins with their own options', async () => {
		const { plugin, seen } = recorder();
		const a = mountEditor({ source: 'text\n\n@b hi\n', plugins: [marks, plugin({ tag: 'a' })] });
		const b = mountEditor({ source: 'text\n\n@b hi\n', plugins: [plugin({ tag: 'b' })] });
		await a.settle();

		expect(seen.map((s) => s.tag)).toEqual(['a', 'b']);
		expect(a.instance.plugins).toEqual(['unit-marks', 'unit-recorder']);
		expect(b.instance.plugins).toEqual(['unit-recorder']);
		expect(kinds(a)).toEqual(['paragraph', 'unit-marks-block']);
		expect(kinds(b)).toEqual(['paragraph', 'paragraph']);
	});

	it('end a paragraph only at their own plugin syntax', async () => {
		const { plugin } = recorder();
		const a = mountEditor({ source: 'text\n@b hi\n', plugins: [marks, plugin] });
		const b = mountEditor({ source: 'text\n@b hi\n', plugins: [plugin] });
		await a.settle();

		expect(kinds(a)).toEqual(['paragraph', 'unit-marks-block']);
		expect(kinds(b)).toEqual(['paragraph', null]);
		expect(b.target.querySelectorAll('.text-editable-block')).toHaveLength(1);
	});
});

// Miss-analysis (#657): every error case subscribed with `getEvents().on('error')` before the
// error fired, so none was raised while the editor mounted.
describe('an error raised while the editor mounts', () => {
	const throwingValue = definePlugin({
		name: 'unit-throws',
		version: '1.0.0',
		editor: '*',
		contributes: () => {
			throw new Error('contributes failed');
		}
	});
	const rejectsOptions = definePlugin({
		name: 'unit-rejects',
		defaults: { size: 1 },
		parseOptions: () => {
			throw new Error('bad size');
		},
		setup: (ctx) => ctx.onEditor((editor) => void editor.options)
	});
	const throwingHook = definePlugin({
		name: 'unit-hook-throws',
		setup: (ctx) =>
			ctx.onEditor(() => {
				throw new Error('hook failed');
			})
	});
	const plugins = [throwingValue, { plugin: rejectsOptions, options: { size: -1 } }, throwingHook];
	const heard = (errors: PluginError[]) => errors.map((e) => `${e.plugin} ${e.doing}`);

	it('reaches onError on a mounted component with no error listener', async () => {
		const errors: PluginError[] = [];
		const m = mountEditor({ source: 'text\n', plugins, onError: (e) => errors.push(e) });
		await m.settle();
		expect(heard(errors)).toEqual([
			'unit-throws contributes',
			'unit-rejects validate',
			'unit-hook-throws setup'
		]);
		expect(m.instance.plugins).toEqual(['unit-rejects', 'unit-hook-throws']);
	});

	// A Svelte parent's `onMount` runs after the editor's own, so only `onError` serves it.
	it('reaches an error listener a createEditor caller adds before the editor mounts', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const handle = createEditor(target, { source: 'x\n', plugins });
		const heard: unknown[] = [];
		handle.on('error', (e) => heard.push(e.context?.plugin));
		await settleEditor();
		expect(heard).toEqual(['unit-throws', 'unit-rejects', 'unit-hook-throws']);
		handle.destroy();
		target.remove();
	});

	it('reaches onError through createEditor', () => {
		const errors: PluginError[] = [];
		const target = document.body.appendChild(document.createElement('div'));
		const handle = createEditor(target, { source: 'x\n', plugins, onError: (e) => errors.push(e) });
		expect(heard(errors)).toContain('unit-throws contributes');
		handle.destroy();
		target.remove();
	});
});

// Miss-analysis: no listener a plugin added ever threw, so a throw reported without its plugin passed.
describe('a listener a plugin added that throws', () => {
	const fail = () => {
		throw new Error('listener failed');
	};
	const value = definePlugin({
		name: 'unit-listens',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (editor) => void editor.on('edit', fail) })
	});
	const old = definePlugin({
		name: 'unit-old-listens',
		setup: (ctx) => ctx.onEditor((editor) => editor.events.on('edit', fail))
	});

	it('reaches onError naming the plugin, from either plugin shape', async () => {
		const errors: PluginError[] = [];
		const m = mountEditor({
			source: 'text\n',
			plugins: [value, old],
			onError: (e) => errors.push(e)
		});
		await m.settle();
		typeInFirstBlock(m.target, 'texts');
		await m.settle();
		expect(errors.map((e) => `${e.plugin} ${e.doing}`).sort()).toEqual([
			"unit-listens on('edit')",
			"unit-old-listens on('edit')"
		]);
	});
});

describe('use', () => {
	it('reads the document again without a plugin, keeping its bytes, and back with it', async () => {
		const m = mountEditor({ source: 'text\n\n@b hi\n', plugins: [marks] });
		await m.settle();
		m.instance.use([]);
		await m.settle();
		expect(kinds(m)).toEqual(['paragraph', 'paragraph']);
		expect(m.source()).toBe('text\n\n@b hi\n');
		expect(m.instance.plugins).toEqual([]);

		m.instance.use([marks]);
		await m.settle();
		expect(kinds(m)).toEqual(['paragraph', 'unit-marks-block']);
	});

	it('takes away what a plugin turned off added, and keeps a plugin still listed as it was', async () => {
		const { plugin, seen } = recorder();
		const kept = recorder('unit-kept');
		const m = mountEditor({ source: 'text\n', plugins: [plugin, kept.plugin] });
		await m.settle();
		m.instance.use([kept.plugin]);
		await m.settle();
		typeInFirstBlock(m.target, 'texts');
		await m.settle();

		expect(seen[0].edits).toBe(0);
		expect(kept.seen).toHaveLength(1);
		expect(kept.seen[0].edits).toBe(1);
	});

	// Miss-analysis: every `use` row listed plugin values, where new options are a new value.
	it('gives a setup plugin listed again with new options a fresh start on them', async () => {
		const attached: string[] = [];
		const old = definePlugin<{ tag: string }>({
			name: 'unit-old-options',
			defaults: { tag: '' },
			setup: (ctx) => ctx.onEditor((editor) => void attached.push(editor.options.tag))
		});
		const m = mountEditor({ source: 'x\n', plugins: [{ plugin: old, options: { tag: 'a' } }] });
		await m.settle();
		m.instance.use([{ plugin: old, options: { tag: 'b' } }]);
		await m.settle();
		expect(attached).toEqual(['a', 'b']);
	});

	// Miss-analysis: every `use` row mounted with a list, where the names on before `use` don't
	// move when a plugin installs.
	it('attaches a setup plugin new to the page in an editor mounted with no list', async () => {
		const attached: string[] = [];
		const late = definePlugin({
			name: 'unit-late',
			setup: (ctx) => ctx.onEditor((editor) => void attached.push(editor.editorId))
		});
		const m = mountEditor({ source: 'x\n' });
		await m.settle();
		m.instance.use([late]);
		await m.settle();
		expect(attached).toHaveLength(1);
	});

	it('is read live through a createEditor handle', () => {
		const target = document.body.appendChild(document.createElement('div'));
		const handle = createEditor(target, { source: 'x\n', plugins: [marks] });
		handle.use([]);
		expect(handle.plugins).toEqual([]);
		handle.destroy();
		target.remove();
	});

	// Lands with undo entries that remember their grammar (D2): until then a restore installs the
	// tree parsed before `use`.
	it.fails('restores an undo step under the grammar the editor reads now', async () => {
		const m = mountEditor({ source: 'text\n\n@b hi\n', plugins: [marks] });
		await m.settle();
		typeInFirstBlock(m.target, 'texts');
		await m.settle();
		m.instance.use([]);
		await m.settle();
		m.instance.run('history.undo');
		await m.settle();
		expect(m.source()).toBe('text\n\n@b hi\n');
		expect(kinds(m)).toEqual(['paragraph', 'paragraph']);
	});
});
