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
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	INSERTION_ROUTES,
	TEXT_HOSTS,
	dispatchBeforeInput,
	insertBy,
	type InsertionRoute
} from '#lib/test/harness/insertion-routes.js';
import { COLON_LINES, definePlugin, registerDirective, type CstNode } from '#lib/plugin.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// A space at a new bold's hidden closer, on every route, is the first table in `held-space.test.ts`.
describe.each(INSERTION_ROUTES)('typed by %s', (route) => {
	// The typed closer leaves the outside record, which every route has to read.
	it('text after a typed closer lands outside the bold', async () => {
		const { editor, el } = mountWithCaret('a **bold** b\n', 8);
		await insertBy('hardware key', el, '**');

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

// A `notes` box beside the admonitions' `note`, so one name the editor holds starts another.
const notesBox = definePlugin({
	name: 'spec-notes-box',
	setup() {
		const kind = testLeaf('spec-notes-box', {
			mergeRole: 'container',
			container: { lines: COLON_LINES }
		});
		registerDirective('container', 'notes', {
			kind,
			fromDirective: (parsed) =>
				({
					kind,
					leadingTrivia: parsed.leadingTrivia,
					raw: parsed.raw,
					innerPrefix: parsed.body?.prefix ?? '',
					children: parsed.body?.children ?? [],
					innerSuffix: parsed.body?.suffix ?? ''
				}) as CstNode
		});
	}
});

// A paste the browser inserts with no paste event reads back as typed text, so it types.
const PASTES: readonly InsertionRoute[] = ['paste'];

/** [what is put in, the row it lands on, the row a typing route writes, the row a paste writes] */
const NAME_END: [string, string, string, string, string][] = [
	['a letter at a name the editor holds', ':::tip', 'x', ':::tip x', ':::tip x'],
	// The exceptions, each by the rule that makes it.
	['a letter at a name the editor does not hold', ':::foo', 'x', ':::foox', ':::foo x'],
	['a character no name holds', ':::tip', '!', ':::tip!', ':::tip !'],
	['a letter that continues to another held name', ':::note', 's', ':::notes', ':::note s']
];

// Text lengthening a held `:::name` at an untitled row's end starts the title on every route.
// Miss-analysis: routes were compared at prose's edges only, never at a name's end, where they part.
describe.each(INSERTION_ROUTES)('text at an untitled row’s name end, by %s', (route) => {
	for (const [name, row, text, typed, pasted] of NAME_END)
		it(name, async () => {
			const source = `${row}\nin\n:::\n`;
			const editor = mountEditor({ source, plugins: [...SYNTAX_PLUGINS, notesBox] });
			await editor.settle();
			placeCaret(surfaceAt(editor, [0, 0]), row.length);
			await editor.settle();

			await insertBy(route, document.activeElement as HTMLElement, text);
			await editor.settle();

			const line = PASTES.includes(route) ? pasted : typed;
			expect(editor.source()).toBe(`${line}\nin\n:::\n`);
		});
});
