// @vitest-environment jsdom
// A plugin value's insert rows in a mounted editor: one list for the host, the plugin's own editor
// and a `setup` plugin's context, listed only where the plugin is on.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin, type EditorContext } from '#lib/schema/plugin-install.js';
import type { InsertRow } from '#lib/schema/insert-catalogue.js';
import type { Editor, PluginError } from '#lib/schema/plugin-unit.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const BUILT_IN = ['bullet', 'numbered', 'todo', 'quote', 'divider', 'code', 'table'];

const callout: InsertRow = {
	id: 'callout',
	label: 'Callout',
	icon: 'plus',
	insert: ':::note\n:::\n'
};

function rowsPlugin(name: string, inserts: InsertRow[]) {
	const editors: Editor[] = [];
	const plugin = definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ inserts, setup: (editor) => void editors.push(editor) })
	});
	return { plugin, editors };
}

// A `setup` plugin reading the list through its old context, as the slash list does.
const contexts: EditorContext[] = [];
const reader = definePlugin({
	name: 'row-reader',
	setup: (ctx) => ctx.onEditor((editor) => void contexts.push(editor))
});

const ids = (rows: readonly InsertRow[]) => rows.map((row) => row.id);

describe("a plugin value's insert rows", () => {
	it('list after the built-ins as plugin/id, the same for every reader', async () => {
		const callouts = rowsPlugin('callouts', [callout]);
		const m = mountEditor({ source: 'text\n', plugins: [reader, callouts.plugin] });
		await m.settle();

		const listed = [...BUILT_IN, 'callouts/callout'];
		expect(ids(m.instance.inserts)).toEqual(listed);
		expect(ids(callouts.editors[0].inserts)).toEqual(listed);
		expect(ids(contexts.at(-1)!.insertCatalogue)).toEqual(listed);
		expect(m.instance.inserts.at(-1)).toMatchObject({ label: 'Callout', insert: ':::note\n:::\n' });
	});

	it("list a block type's row as plugin/name, ahead of the plugin's own, and none for `none`", async () => {
		const block = (name: string, insert: Parameters<typeof lineBlock>[0]['insert']) =>
			lineBlock({
				name,
				label: name,
				match: new RegExp(`^%%${name}$`),
				sample: `%%${name}`,
				insert
			});
		const plugin = definePlugin({
			name: 'notes',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					block('note', { label: 'Note', icon: 'plus', insert: '%%note\n' }),
					block('hidden', { none: 'only a paste makes one' })
				],
				inserts: [callout]
			})
		});
		const m = mountEditor({ source: 'text\n', plugins: [plugin] });
		await m.settle();
		expect(ids(m.instance.inserts)).toEqual([...BUILT_IN, 'notes/note', 'notes/callout']);
		expect(m.instance.inserts.at(-2)).toMatchObject({ label: 'Note', insert: '%%note\n' });
	});

	it('list nowhere their plugin is off, and come and go with `use`', async () => {
		const callouts = rowsPlugin('callouts', [callout]);
		const listing = mountEditor({ source: 'text\n', plugins: [callouts.plugin] });
		const other = mountEditor({ source: 'text\n', plugins: [] });
		await listing.settle();
		expect(ids(other.instance.inserts)).toEqual(BUILT_IN);

		listing.instance.use([]);
		expect(ids(listing.instance.inserts)).toEqual(BUILT_IN);
		listing.instance.use([callouts.plugin]);
		expect(ids(listing.instance.inserts)).toContain('callouts/callout');
	});

	it('leave their plugin out when one is unusable', async () => {
		const errors: PluginError[] = [];
		const odd = rowsPlugin('odd', [{ ...callout, icon: 'no-such-glyph' as InsertRow['icon'] }]);
		const caps = rowsPlugin('caps', [{ ...callout, id: 'Callout' }]);
		const twice = rowsPlugin('twice', [callout, callout]);
		const m = mountEditor({
			source: 'text\n',
			plugins: [odd.plugin, caps.plugin, twice.plugin],
			onError: (e) => errors.push(e)
		});
		await m.settle();

		expect(m.instance.plugins).toEqual([]);
		expect(errors.map((e) => (e.cause as Error).message)).toEqual([
			`plugin 'odd' names icon 'no-such-glyph', which the menu cannot draw`,
			`plugin 'caps' has an insert row id "Callout"; lowercase first letter, then letters/digits/hyphens`,
			`plugin 'twice' lists two insert rows with the id "callout"`
		]);
	});
});
