// @vitest-environment jsdom
// Miss-analysis: every insertMarkdown test awaited the insert before tearing down, so a write still
// in flight when the editor unmounted, or when a swap replaced its document, was never made.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountWithCaret,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchImagePaste } from '#lib/test/harness/insertion-routes.js';
import type { InsertMarkdownOptions } from '#lib/editor-props.js';
import type { EditorSelection } from '#lib/selection/primitives.js';

installLayoutStubs();
afterEach(destroyMountedEditors);

describe.each<{ placement: InsertMarkdownOptions['placement'] }>([
	{ placement: 'caret' },
	{ placement: 'below' }
])('an insertMarkdown at $placement still in flight', ({ placement }) => {
	it('lands nowhere and reports nothing once the editor unmounts', async () => {
		const { editor } = mountWithCaret('hello\n', 2, 'source');
		await editor.settle();
		const inserted = editor.instance.insertMarkdown('**x**', { placement });
		const heard: string[] = [];
		const events = editor.instance.getEvents();
		events.on('edit', () => heard.push('edit'));
		events.on('error', (e) => heard.push(`error ${e.origin}`));
		await editor.destroy();

		expect(await inserted).toBe(false);
		await editor.settle();
		expect(heard).toEqual([]);
	});

	it('does not land in the document a source swap put in its place', async () => {
		const { editor } = mountWithCaret('hello\n', 2, 'source');
		await editor.settle();

		const inserted = editor.instance.insertMarkdown('**x**', { placement });
		editor.props.source = 'other\n';
		flushSync();
		// Where the user puts the caret in the new document is where a stray insert would go.
		placeCaret(surfaceAt(editor, [0]), 1);

		expect(await inserted).toBe(false);
		await editor.settle();
		expect(editor.source()).toBe('other\n');
	});
});

describe('an image import still running at the unmount', () => {
	const SOURCE = 'hello\n\nworld\n';
	const acrossBlocks: EditorSelection = {
		anchor: { path: [0], offset: 1 },
		focus: { path: [1], offset: 2 }
	};

	it.each([
		{ route: 'in a paragraph', range: null },
		{ route: 'over a range across blocks', range: acrossBlocks }
	])('lands and reports nothing $route when the host answers afterwards', async ({ range }) => {
		let answer: (markdown: string) => void = () => {};
		const { editor, el } = mountWithCaret(SOURCE, 2, 'source');
		editor.props.onPasteImage = () => new Promise((resolve) => (answer = resolve));
		flushSync();
		await editor.settle();
		if (range) await editor.instance.setSelection(range);
		dispatchImagePaste(range ? editor.target.querySelector<HTMLElement>('.editor')! : el);
		const heard: string[] = [];
		editor.instance.getEvents().on('error', (e) => heard.push(`error ${e.origin}`));
		editor.instance.getEvents().on('edit', () => heard.push('edit'));

		await editor.destroy();
		answer('![[shot.png]]');
		await editor.settle();

		expect(heard).toEqual([]);
		expect(editor.source()).toBe(SOURCE);
	});
});
