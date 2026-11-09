// @vitest-environment jsdom
// `Block.from`/`to`, read when asked: a box writes its own bytes through `edit().replace` with the
// block its first `draw` got, after an edit above moved them and no `update` came.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

let drawn: Block<unknown> | null = null;

const boxes = definePlugin({
	name: 'boxes',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'box',
				label: 'Box',
				match: /^%%box(?: .*)?$/,
				sample: '%%box',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: (block) => {
					drawn = block;
					return { dom: document.createElement('div') };
				}
			})
		]
	})
});

describe('Block.from and Block.to', () => {
	it('place a box’s own bytes after an edit above moved them', async () => {
		const editor = mountEditor({ source: 'above\n\n%%box one\n\nbelow\n', plugins: [boxes] });
		await editor.settle();
		const held = drawn!;
		expect([held.from, held.to]).toEqual([7, 17]);

		typeInto(surfaceAt(editor, [0]), 'above, longer');
		await editor.settle();
		const result = await editor.instance
			.edit()
			.replace({ from: held.from, to: held.to }, '%%box two\n')
			.commit();
		await editor.settle();
		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe('above, longer\n\n%%box two\n\nbelow\n');
	});

	it('read -1 once the block has left the document', async () => {
		const editor = mountEditor({ source: 'above\n\n%%box one\n', plugins: [boxes] });
		await editor.settle();
		const held = drawn!;
		editor.props.source = 'above\n';
		await editor.settle();
		expect([held.from, held.to]).toEqual([-1, -1]);
	});
});
