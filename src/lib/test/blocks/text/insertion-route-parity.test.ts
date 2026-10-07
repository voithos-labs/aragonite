// @vitest-environment jsdom
// Text reaching a prose block's caret lands on the same side of a hidden edge whichever route
// brought it: a hardware key, a soft keyboard, an autocorrect replacement, an IME commit, a paste.
// Miss-analysis: the side was decided on the hardware keydown only, and every edge row pressed a
// hardware key, so no row drove a soft keyboard, a replacement or a paste at a hidden edge.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	mountWithCaret,
	placeCaret
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import {
	INSERTION_ROUTES,
	TEXT_HOSTS,
	dispatchBeforeInput,
	insertBy
} from '$lib/test/harness/insertion-routes';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// A space at a new bold's hidden closer, on every route, is the first table in `held-space.test.ts`.
describe.each(INSERTION_ROUTES)('typed by %s', (route) => {
	it('text after an arrow stepped out of a bold lands outside it', async () => {
		const { editor, el } = mountWithCaret('a **bold** b\n', 8);
		await pressKey(el, { key: 'ArrowRight' });

		await insertBy(route, el, 'X');

		expect(editor.source()).toBe('a **bold**X b\n');
	});

	it('source mode writes the space where the caret shows it, inside the visible closer', async () => {
		const { editor, el } = mountWithCaret('a **two**\n', 7, 'source');

		await insertBy(route, el, ' ');

		expect(editor.source()).toBe('a **two **\n');
	});
});

// Chromium aims a key typed past a hidden closer back at its start. Miss-analysis: the keydown
// wrote every delimiter there, so no row met a `beforeinput` target the caret disagreed with.
describe.each(TEXT_HOSTS)(
	'a delimiter aimed across a hidden run from the caret, in $name',
	(host) => {
		it('pairs at the caret', async () => {
			const editor = mountEditor({ source: host.source('x **b** y'), presentationMode: 'live' });
			const el = host.el(editor);
			placeCaret(el, 5);
			const target = window.getSelection()!.getRangeAt(0).cloneRange();
			placeCaret(el, 7);

			dispatchBeforeInput(el, 'insertText', { data: '`', target });
			await editor.settle();

			expect(editor.source()).toMatch(/``/);
		});
	}
);
