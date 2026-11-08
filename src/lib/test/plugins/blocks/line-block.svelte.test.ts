// @vitest-environment jsdom
// A plugin's `lineBlock` read by the editors that run the plugin: parsed there and nowhere else,
// named after the plugin, its facts lent to the page while an editor runs it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { builtin } from '#lib/components/block-makers/builtin.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { blockKindLabel } from '#lib/a11y-strings.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

/** A plugin whose one line block opens on `marker`. */
function notes(name = 'notes') {
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		defaults: { marker: '%%' },
		contributes: ({ marker }) => ({
			blocks: [
				lineBlock({
					name: 'note',
					label: 'Note',
					match: new RegExp(`^${marker}note(?: (?<text>.*))?$`),
					interrupts: true,
					body: 'markdown',
					sample: `${marker}note hello`
				})
			]
		})
	});
}

const kindAt = (m: ReturnType<typeof mountEditor>, i: number) => m.instance.getBlockKindAt([i]);

describe('a line block', () => {
	it('parses in the editor that runs its plugin and as a paragraph in one that does not', async () => {
		const a = mountEditor({ source: 'text\n%%note hi\n', plugins: [notes()] });
		const b = mountEditor({ source: 'text\n%%note hi\n', plugins: [] });
		await a.settle();
		expect([kindAt(a, 0), kindAt(a, 1)]).toEqual(['paragraph', 'notes/note']);
		expect(kindAt(b, 0)).toBe('paragraph');
		expect(b.instance.getSource()).toBe('text\n%%note hi\n');
	});

	it('takes each editor its own options', async () => {
		const plugin = notes();
		const a = mountEditor({ source: '%%note a\n', plugins: [plugin] });
		const b = mountEditor({
			source: '@@note b\n\n%%note b\n',
			plugins: [plugin({ marker: '@@' })]
		});
		await a.settle();
		expect(kindAt(a, 0)).toBe('notes/note');
		expect([kindAt(b, 0), kindAt(b, 1)]).toEqual(['notes/note', 'paragraph']);
	});

	it('lends its facts to the page while an editor runs it, and only then', async () => {
		const kind = 'notes/note' as AnyBlockKind;
		const m = mountEditor({ source: '%%note a\n', plugins: [notes()] });
		await m.settle();
		expect(tryGetBlockKindDescriptor(kind)?.mergeRole).toBe('prose-absorber');
		expect(blockKindLabel(kind)).toBe('Note');
		await m.destroy();
		expect(tryGetBlockKindDescriptor(kind)).toBeUndefined();
	});

	it('warns where two editors derive different facts for one name', async () => {
		const a = definePlugin({
			name: 'twin',
			version: '1.0.0',
			editor: '*',
			defaults: { role: 'prose' as 'prose' | 'object' },
			contributes: ({ role }) => ({
				blocks: [lineBlock({ name: 't', label: 'T', match: /^%%t$/, role, sample: '%%t' })]
			})
		});
		mountEditor({ source: '%%t\n', plugins: [a] });
		mountEditor({ source: '%%t\n', plugins: [a({ role: 'object' })] });
		expect(takeDevWarns().map((w) => w.tag)).toContain('block-type-facts');
	});

	it('is named after the plugin that lists it; a second plugin listing it is reported', async () => {
		const shared = lineBlock({ name: 'shared', label: 'S', match: /^%%s$/, sample: '%%s' });
		const plugin = (name: string) =>
			definePlugin({
				name,
				version: '1.0.0',
				editor: '*',
				contributes: () => ({ blocks: [shared] })
			});
		const errors: PluginError[] = [];
		const m = mountEditor({
			source: '%%s\n',
			plugins: [plugin('first'), plugin('second')],
			onError: (error) => errors.push(error)
		});
		await m.settle();
		expect(shared.name).toBe('first/shared');
		expect(kindAt(m, 0)).toBe('first/shared');
		expect(errors.map((e) => [e.plugin, String(e.cause)])).toEqual([
			['second', expect.stringContaining("'first/shared', which plugin 'first' made")]
		]);
	});

	it('is reported when one plugin names two of its types alike', async () => {
		const errors: PluginError[] = [];
		const twice = definePlugin({
			name: 'twice',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					lineBlock({ name: 'x', label: 'X', match: /^%%x$/, sample: '%%x' }),
					lineBlock({ name: 'x', label: 'X', match: /^%%y$/, sample: '%%y' })
				]
			})
		});
		const m = mountEditor({ source: '%%y\n', plugins: [twice], onError: (e) => errors.push(e) });
		await m.settle();
		expect(kindAt(m, 0)).toBe('paragraph');
		expect(errors.map((e) => String(e.cause))).toEqual([
			expect.stringContaining("two block types named 'x'")
		]);
	});

	it('goes before the built-in it names', async () => {
		// A `>` line is a quote unless a type placed before the quote claims it.
		const callouts = definePlugin({
			name: 'callouts',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					lineBlock({
						name: 'flag',
						label: 'Flag',
						match: /^> !flag$/,
						before: builtin.blocks.blockquote,
						sample: '> !flag'
					})
				]
			})
		});
		const m = mountEditor({ source: '> !flag\n', plugins: [callouts] });
		await m.settle();
		expect(kindAt(m, 0)).toBe('callouts/flag');
	});

	it('splits at Enter, as a paragraph does', async () => {
		const m = mountEditor({ source: '%%note abcd\n', plugins: [notes()] });
		await m.settle();
		await pressKeyAt(m, [0], '%%note ab'.length, { key: 'Enter' });
		await m.settle();
		expect([kindAt(m, 0), kindAt(m, 1)]).toEqual(['notes/note', 'paragraph']);
		expect(m.instance.getSource()).toMatch(/^%%note ab\n\n?cd\n$/);
	});

	it('cuts a paragraph short only where it says so', async () => {
		const m = mountEditor({ source: 'text\n%%note hi\n', plugins: [notes()] });
		await m.settle();
		expect(kindAt(m, 1)).toBe('notes/note');
		const quiet = definePlugin({
			name: 'quiet',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [lineBlock({ name: 'q', label: 'Q', match: /^%%q$/, sample: '%%q' })]
			})
		});
		const n = mountEditor({ source: 'text\n%%q\n', plugins: [quiet] });
		await n.settle();
		expect(kindAt(n, 0)).toBe('paragraph');
		expect(n.instance.getSource()).toBe('text\n%%q\n');
	});
});

describe('the built-in block types', () => {
	it('carry the names a screen reader reads', () => {
		expect(builtin.blocks.blockquote).toEqual({ name: 'blockquote', label: 'Quote' });
	});
});
