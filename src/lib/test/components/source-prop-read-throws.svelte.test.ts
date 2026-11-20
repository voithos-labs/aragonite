// @vitest-environment jsdom
// A `source` write whose read throws (a plugin's opener blowing up on some text) changes nothing:
// the document the editor held still takes keys, and the next write that reads loads.
// Miss-analysis: the swap's order was held over stand-in steps, so no row typed into a mounted
// editor after a read that threw, where a document retired first refuses every key.
import { afterEach, beforeAll, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { definePlugin } from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const boom = definePlugin({
	name: 'boom',
	setup: () => {
		testLeaf('boom', {
			opener: {
				priority: 25,
				interruptsParagraph: false,
				tryOpen: (ctx) => {
					if (ctx.line.text.startsWith('@@boom')) throw new Error('the opener blew up');
					return null;
				}
			}
		});
	}
});

it('a source write whose read throws leaves the held document taking keys', async () => {
	const editor = mountEditor({ source: 'old\n', plugins: [boom] });
	await editor.settle();
	const typeAtEnd = async (key: string) => {
		const el = surfaceAt(editor, [0]);
		placeCaret(el, el.textContent!.length);
		await pressHardwareKey(el, { key });
		await editor.settle();
	};

	expect(() => {
		editor.props.source = 'new\n\n@@boom\n';
		flushSync();
	}).toThrow('the opener blew up');
	await editor.settle();
	expect(editor.source()).toBe('old\n');
	await typeAtEnd('x');
	expect(editor.source()).toBe('oldx\n');

	editor.props.source = 'good\n';
	await editor.settle();
	expect(editor.source()).toBe('good\n');
	await typeAtEnd('y');
	expect(editor.source()).toBe('goody\n');
});
