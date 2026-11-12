// @vitest-environment jsdom
// A plugin's `lineBlock` read by the editors that run the plugin: parsed there and nowhere else,
// named after the plugin, its facts lent to the page while an editor runs it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { builtin } from '#lib/components/block-makers/builtin.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { blockKindLabel } from '#lib/a11y-strings.js';
import { getPluginMetadata, type AnyBlockKind } from '#lib/core/nodes.js';
import type { NodeView } from '#lib/core/node-views.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { noTransforms } from '../../range-edit/test-host';

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
					sample: `${marker}note hello`,
					insert: { none: 'a test block type' }
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

	it('warns where two editors derive different facts for one name (G1.192)', async () => {
		const a = definePlugin({
			name: 'twin',
			version: '1.0.0',
			editor: '*',
			defaults: { role: 'prose' as 'prose' | 'object' },
			contributes: ({ role }) => ({
				blocks: [
					lineBlock({
						name: 't',
						label: 'T',
						match: /^%%t$/,
						role,
						sample: '%%t',
						insert: { none: 'a test block type' }
					})
				]
			})
		});
		mountEditor({ source: '%%t\n', plugins: [a] });
		mountEditor({ source: '%%t\n', plugins: [a({ role: 'object' })] });
		expect(takeDevWarns().map((w) => w.tag)).toContain('block-type-facts');
	});

	it('is named after the plugin that lists it; a second plugin listing it is reported', async () => {
		const shared = lineBlock({
			name: 'shared',
			label: 'S',
			match: /^%%s$/,
			sample: '%%s',
			insert: { none: 'a test block type' }
		});
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
					lineBlock({
						name: 'x',
						label: 'X',
						match: /^%%x$/,
						sample: '%%x',
						insert: { none: 'a test block type' }
					}),
					lineBlock({
						name: 'x',
						label: 'X',
						match: /^%%y$/,
						sample: '%%y',
						insert: { none: 'a test block type' }
					})
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
						sample: '> !flag',
						insert: { none: 'a test block type' }
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

	// Miss-analysis: every row a paste cut a block in cut a built-in's text, so none asked the
	// range host's cut about a plugin block type's leaf.
	it.each(
		(['source', 'live'] as const).flatMap((mode) =>
			[
				['%%note a **bold** z\n', '%%note a **bo'.length],
				['%%note see <http://xy.z> w\n', '%%note see <http://x'.length],
				['%%note ab\n', '%%note a'.length]
			].map(([source, at]) => ({ mode, source: source as string, at: at as number }))
		)
	)(
		'is cut by pasted blocks where Enter splits it: $mode, $source',
		async ({ mode, source, at }) => {
			const m = mountEditor<EditorTestSurface>({
				source,
				plugins: [notes()],
				presentationMode: mode
			});
			await m.settle();
			const reading = fixtureReading({ grammar: m.instance.__test.getGrammar() }, mode);
			const pasted = editRange(
				source,
				{ from: at, to: at },
				{ paste: 'one\n\ntwo', plain: false, holds: 'text' },
				mode,
				noTransforms(rangeHost(reading))
			).source;
			await pressKeyAt(m, [0], at, { key: 'Enter' });
			await m.settle();

			// The pasted paragraphs taken back out leave Enter's two halves.
			const halves = pasted.replace('one', '').replace('two', '').replace('\n\n', '\n');
			expect(halves).toBe(m.instance.getSource());
		}
	);

	it('cuts a paragraph short only where it says so', async () => {
		const m = mountEditor({ source: 'text\n%%note hi\n', plugins: [notes()] });
		await m.settle();
		expect(kindAt(m, 1)).toBe('notes/note');
		const quiet = definePlugin({
			name: 'quiet',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					lineBlock({
						name: 'q',
						label: 'Q',
						match: /^%%q$/,
						sample: '%%q',
						insert: { none: 'a test block type' }
					})
				]
			})
		});
		const n = mountEditor({ source: 'text\n%%q\n', plugins: [quiet] });
		await n.settle();
		expect(kindAt(n, 0)).toBe('paragraph');
		expect(n.instance.getSource()).toBe('text\n%%q\n');
	});

	it('reads a line through a function, its text short of a closing run and its data its own', async () => {
		// A closing `!` run counts only after a space, as a heading's closing `#` run does.
		const titled = (line: string) => {
			const open = /^(!{1,3}) /.exec(line);
			if (!open) return null;
			let end = line.length;
			while (end > open[0].length && line[end - 1] === '!') end--;
			const closed = end < line.length && line[end - 1] === ' ';
			const text = [open[0].length, closed ? end - 1 : line.length] as const;
			return { text, data: open[1].length };
		};
		const titles = definePlugin({
			name: 'titles',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					lineBlock<number>({
						name: 'title',
						label: 'Title',
						match: titled,
						write: (level, text) => `${'!'.repeat(level)} ${text}`,
						sample: '! hi',
						insert: { none: 'a test block type' }
					})
				]
			})
		});
		const m = mountEditor({ source: '!! Big news !!!\n\n! a!b\n', plugins: [titles] });
		await m.settle();
		expect([kindAt(m, 0), kindAt(m, 1)]).toEqual(['titles/title', 'titles/title']);
		const doc = (m.instance.__test as { getDocument(): { children: NodeView[] } }).getDocument();
		const range = tryGetBlockKindDescriptor('titles/title' as AnyBlockKind)!.getContentRange!;
		expect([range(doc.children[0]), range(doc.children[1])]).toEqual([
			{ start: 3, end: 11 },
			{ start: 2, end: 5 }
		]);
		expect([getPluginMetadata(doc.children[0]), getPluginMetadata(doc.children[1])]).toEqual([
			2, 1
		]);
	});
});

describe('the built-in block types', () => {
	it('carry the names a screen reader reads', () => {
		expect(builtin.blocks.blockquote).toEqual({ name: 'blockquote', label: 'Quote' });
	});
});
