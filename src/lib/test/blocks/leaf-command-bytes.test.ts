// @vitest-environment jsdom
// A leaf's command changes its metadata by rewriting the leaf's bytes with `replaceRaw`, so the
// change survives a reload. Miss-analysis: a leaf command could only write metadata, which never
// reached a leaf's bytes, and no test reloaded what a leaf command left.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { ADMONITION } from '#packages/admonitions/src/kinds.js';
import { definePlugin, registerBlockCommand, type PluginBlockKind } from '#lib/plugin.js';
import type { PluginCommandId } from '#lib/schema/command-id.js';
import { TAG_KEY, tagLeafPlugin } from './fixtures/tag-leaf';

beforeEach(() => {
	installLayoutStubs();
	// Showing a source measures the caret through Range rects, which jsdom lacks.
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(destroyMountedEditors);

const SCOPES = [
	{ name: 'at the top level', source: 'x\n\n%% memo\n', path: [1], tagged: 'x\n\n%%! memo\n' },
	{ name: 'in a blockquote', source: '> %% memo\n', path: [0, 0], tagged: '> %%! memo\n' }
];

describe('a leaf command that rewrites its bytes', () => {
	for (const scope of SCOPES) {
		it(`tags the leaf ${scope.name}, and a reload reads the same metadata`, async () => {
			const plugin = tagLeafPlugin();
			const editor = mountEditor<EditorTestSurface>({ source: scope.source, plugins: [plugin] });
			await editor.settle();
			const surface = surfaceAt(editor, scope.path);
			placeCaret(surface, 2);

			await pressKey(surface, TAG_KEY);
			await editor.settle();

			expect(editor.source()).toBe(scope.tagged);
			const live = blockNodeAt(editor.instance.__test.getDocument(), scope.path)?.metadata;
			expect(live).toEqual({ tagged: true });
			const reloaded = mountEditor<EditorTestSurface>({ source: scope.tagged, plugins: [plugin] });
			expect(blockNodeAt(reloaded.instance.__test.getDocument(), scope.path)?.metadata).toEqual(
				live
			);
		});
	}

	// Miss-analysis: the rows above read only the bytes, so a caret thrown to the block's start
	// by the rewrite went unseen.
	for (const scope of SCOPES) {
		it(`keeps the caret on the text it was in ${scope.name}`, async () => {
			const editor = mountEditor<EditorTestSurface>({
				source: scope.source,
				plugins: [tagLeafPlugin()]
			});
			await editor.settle();
			const surface = surfaceAt(editor, scope.path);
			placeCaret(surface, 6); // `%% me|mo`

			await pressKey(surface, TAG_KEY);
			await editor.settle();

			const caret = { path: scope.path, offset: 7 }; // `%%! me|mo`
			expect(editor.instance.getSelection()).toEqual({ anchor: caret, focus: caret });
		});
	}

	// The handler reads the leaf's bytes, so it runs once the open source is written.
	it('keeps an edit in a shown source, writing it before the command', async () => {
		const editor = mountEditor<EditorTestSurface>({
			source: '%% old\n\nnext\n',
			plugins: [tagLeafPlugin('reveal')]
		});
		await editor.settle();
		editor.instance.__test.getBlockComponent([0])?.focus?.(3);
		await editor.settle();
		const source = editor.target.querySelector<HTMLElement>('.reveal-leaf-source');
		expect(source, 'the leaf source is not showing').not.toBeNull();
		source!.textContent = '%% new';

		await pressKey(source!, TAG_KEY);
		await editor.settle();
		await editor.settle();

		expect(editor.source()).toBe('%%! new\n\nnext\n');
		// The source hid before the write, so the rewrite has no caret to put back into it.
		expect(editor.target.querySelector('.reveal-leaf-source')).toBeNull();
	});
});

// Miss-analysis: only a leaf's own command waited for its shown source, and no row pressed a
// container's command from a block inside it, so the container's rewrite dropped the edit.
describe('a container command over a shown source inside it', () => {
	const REWRITE = 'probe.rewriteNote' as PluginCommandId;
	const rewriteNote = definePlugin({
		name: 'rewrite-note',
		setup: () => {
			registerBlockCommand(ADMONITION as PluginBlockKind, REWRITE, (ctx) => {
				ctx.replaceRaw(ctx.node.raw.replace(':::note', ':::tip'));
				return true;
			});
		}
	});

	it('writes the inner edit before the command rewrites the container', async () => {
		const editor = mountEditor<EditorTestSurface>({
			source: ':::note Heads up\n\n%% old\n\n:::\n',
			plugins: [admonitionsPlugin(), tagLeafPlugin('reveal'), rewriteNote],
			keybindings: [{ chord: 'Mod+Shift+L', command: REWRITE, kind: ADMONITION as PluginBlockKind }]
		});
		await editor.settle();
		editor.instance.__test.getBlockComponent([0, 1])?.focus?.(3);
		await editor.settle();
		const source = editor.target.querySelector<HTMLElement>('.reveal-leaf-source');
		expect(source, 'the leaf source is not showing').not.toBeNull();
		source!.textContent = '%% new';

		await pressKey(source!, { key: 'L', ctrlKey: true, shiftKey: true });
		await editor.settle();
		await editor.settle();

		expect(editor.source()).toBe(':::tip Heads up\n\n%% new\n\n:::\n');
	});
});
