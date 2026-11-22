// @vitest-environment jsdom
// A plugin list read with no editor reads as a mounted editor running it does: its inline
// constructs and block types alike, and none of a plugin the editor leaves out. Installing its own
// syntax holds all of it or none, through every route that installs it.
// Miss-analysis: `grammar` was only run over block types, and an install that threw was only ever
// read for its message, never for what it left held.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { command, container, definePlugin, inline, lineBlock, type Plugin } from '#lib/plugin.js';
import { grammar } from '#lib/components/editor-root/headless-grammar.js';
import type { Editor } from '#lib/schema/plugin-unit.js';
import type { Piece } from '#lib/schema/doc-view.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { check, isCheckFailure } from '#lib/testing/check.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const NOT_INSERTED = { none: 'a fixture of the list grammar suite' };

const mention = () =>
	inline({
		name: 'mention',
		label: 'Mention',
		prefix: '@',
		sample: 'hi @ann',
		match: /@(\w+)/,
		read: (m) => m[1],
		class: 'mention'
	});

const memo = () =>
	lineBlock({
		name: 'memo',
		label: 'Memo',
		sample: '%%x',
		insert: NOT_INSERTED,
		match: /^%%(?<text>.*)$/
	});

function pluginOf(name: string, contributes: () => object): Plugin {
	return definePlugin({ name, version: '1.0.0', editor: '*', contributes });
}

/** `text` as an editor running `plugins` reads it. */
async function mounted(text: string, plugins: Plugin[]) {
	let editor: Editor | undefined;
	const reader = pluginOf('reader', () => ({ setup: (e: Editor) => void (editor = e) }));
	const m = mountEditor({ source: text, plugins: [reader, ...plugins] });
	await m.settle();
	return editor!.doc;
}

const kinds = (pieces: readonly Piece[]): string[] =>
	pieces.flatMap((piece) => [piece.kind, ...kinds(piece.children)]);

describe('a plugin list read with no editor', () => {
	it("reads a plugin's inline construct as its own, as the editor does", async () => {
		const tags = pluginOf('tags', () => ({ inlines: [mention()] }));
		const [block] = grammar([tags]).parse('hi @ann\n').blocks;
		expect(kinds(block.pieces)).toEqual(['text', 'tags/mention']);
		expect(block.pieces[1]).toMatchObject({ data: 'ann', from: 3, to: 7 });
		const [shown] = (await mounted('hi @ann\n', [tags])).blocks;
		expect(kinds(shown.pieces)).toEqual(kinds(block.pieces));
	});

	it('reads none of a plugin the editor leaves out', async () => {
		const twice = command({ id: 'go', title: 'Go', run: () => true });
		const again = command({ id: 'go', title: 'Go again', run: () => true });
		const broken = pluginOf('broken', () => ({ blocks: [memo()], commands: [twice, again] }));
		const [block] = grammar([broken]).parse('%%x\n').blocks;
		expect(block.type.name).toBe('paragraph');
		const [shown] = (await mounted('%%x\n', [broken])).blocks;
		expect(shown.type.name).toBe('paragraph');
		expect(takeDevWarnsOf('plugin-error')).toHaveLength(2);
	});
});

describe("an install holds all of a list's own syntax or none", () => {
	/** A plugin whose second block type the editor refuses as it holds it (G1.191). */
	const halfRefused = (name: string) =>
		pluginOf(name, () => ({
			blocks: [
				memo(),
				container({
					name: 'cut',
					label: 'Cut',
					sample: '%> one',
					insert: NOT_INSERTED,
					lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%>/, lazy: true }
				})
			]
		}));
	const REFUSED = /must read the marker "%> " whole/;

	it.each<[string, (plugin: Plugin) => Promise<unknown>]>([
		['grammar', async (plugin) => expect(() => grammar([plugin])).toThrow(REFUSED)],
		[
			'check',
			async (plugin) => {
				const failure = await check(plugin).catch((error: unknown) => error);
				expect(isCheckFailure(failure) && failure.report.rows[0].detail).toMatch(REFUSED);
			}
		],
		[
			'a mounted editor',
			async (plugin) =>
				expect(() => mountEditor({ source: '', plugins: [plugin] })).toThrow(REFUSED)
		],
		[
			'use',
			async (plugin) => {
				const { instance } = mountEditor<{ use(next: Plugin[]): void }>({ source: '' });
				expect(() => instance.use([plugin])).toThrow(REFUSED);
			}
		]
	])('through %s, holds none of it where one is refused', async (route, attempt) => {
		const name = `half-${route.replaceAll(' ', '-')}`;
		await attempt(halfRefused(name));
		expect(tryGetBlockKindDescriptor(`${name}/memo` as never)).toBeUndefined();
	});
});
