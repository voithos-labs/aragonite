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

let thrown = 0;
const boom = definePlugin({
	name: 'boom',
	setup: () => {
		testLeaf('boom', {
			opener: {
				priority: 25,
				interruptsParagraph: false,
				tryOpen: (ctx) => {
					if (!ctx.line.text.startsWith('@@boom')) return null;
					thrown++;
					throw new Error('the opener blew up');
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

	// Where the throw surfaces is no part of the row: only that the read threw and changed nothing.
	try {
		editor.props.source = 'new\n\n@@boom\n';
		flushSync();
	} catch {
		// the opener's own throw
	}
	await editor.settle();
	expect(thrown).toBeGreaterThan(0);
	expect(editor.source()).toBe('old\n');
	await typeAtEnd('x');
	expect(editor.source()).toBe('oldx\n');

	editor.props.source = 'good\n';
	await editor.settle();
	expect(editor.source()).toBe('good\n');
	await typeAtEnd('y');
	expect(editor.source()).toBe('goody\n');
});
