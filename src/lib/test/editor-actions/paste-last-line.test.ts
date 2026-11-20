// @vitest-environment jsdom
// G1.41 mounted: blocks pasted after the last block's text keep the document's last line as it
// was, open or ended, through the editor's own paste route.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

it.each([
	['one\n\nabc', 'x\n\ny', 'one\n\nabcx\n\ny'],
	['one\n\nabc\n', 'x\n\ny', 'one\n\nabcx\n\ny\n'],
	['one\n\nabc', '# h\n\n- a\n- b', 'one\n\nabc\n\n# h\n\n- a\n- b'],
	['one\n\nabc\n', '# h\n\n- a\n- b', 'one\n\nabc\n\n# h\n\n- a\n- b\n'],
	['one\n\n- abc', '- x\n- y', 'one\n\n- abcx\n- y']
])('%j, blocks %j pasted after the last text, is %j', async (source, clip, pasted) => {
	for (const mode of ['source', 'live'] as const) {
		const editor = mountCase(source, mode);
		await editor.settle();
		// The last leaf, which holds `abc`.
		const path: number[] = [];
		let node: { children?: readonly unknown[] } = editor.instance.__test.getDocument();
		while (node.children?.length) {
			path.push(node.children.length - 1);
			node = node.children.at(-1) as typeof node;
		}
		const end = { path, offset: 'abc'.length };
		await placeRange(editor, { anchor: end, focus: end });

		await pasteGesture(editor, { 'text/plain': clip }, 'key');

		expect(editor.source(), mode).toBe(pasted);
		await destroyMountedEditors();
	}
});
