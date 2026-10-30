// @vitest-environment jsdom
// Block math's live preview beside a shown source follows every change to it: a native input, an
// IME commit whatever order its events arrive in, and the document's undo filling it.
// Miss-analysis: Chromium ends a commit on a composing input, and no row composed in a shown math source.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installEditorDomStubsForTests } from '#lib/testing.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import type { MathRenderer } from '#lib/plugins/latex/math-renderer.js';
import {
	destroyMountedEditors,
	mountEditor,
	placeCaret,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

// Draws the formula as its own text, so the preview reads back what it was asked to draw.
const renderer: MathRenderer = (source) => ({
	dom: Object.assign(document.createElement('span'), { textContent: source })
});
const preview = (editor: MountedEditor) =>
	editor.target.querySelector<HTMLElement>('.math-block-render')?.textContent;

async function openSource(): Promise<{ editor: MountedEditor; el: HTMLElement }> {
	const editor = mountEditor({ source: '$$\nx\n$$\n', plugins: [latexPlugin({ renderer })] });
	await editor.settle();
	return reveal(editor);
}

async function reveal(editor: MountedEditor): Promise<{ editor: MountedEditor; el: HTMLElement }> {
	const render = editor.target.querySelector<HTMLElement>('.math-block-render')!;
	const at = { bubbles: true, cancelable: true };
	render.dispatchEvent(new PointerEvent('pointerdown', at));
	render.dispatchEvent(new MouseEvent('click', at));
	await editor.settle();
	return { editor, el: editor.target.querySelector<HTMLElement>('.math-block-source')! };
}

/** The body as an IME or a drop leaves it in the element, caret after it. */
function edit(el: HTMLElement, body: string): void {
	el.textContent = `$$\n${body}\n$$`;
	placeCaret(el, `$$\n${body}`.length);
}

const composition = (type: string) => new CompositionEvent(type, { bubbles: true });
const input = (inputType: string, isComposing = false) =>
	new InputEvent('input', { bubbles: true, inputType, isComposing });

beforeEach(() => {
	installEditorDomStubsForTests();
});
afterEach(async () => {
	await destroyMountedEditors();
});

describe('block math’s preview while its source is shown', () => {
	it('draws the committed formula after an IME commit that ends on a composing input', async () => {
		const { editor, el } = await openSource();
		el.dispatchEvent(composition('compositionstart'));
		edit(el, 'xy');
		el.dispatchEvent(input('insertCompositionText', true));
		el.dispatchEvent(composition('compositionend'));
		await editor.settle();

		expect(preview(editor)).toBe('xy');
	});

	it('draws the edited formula after a native input', async () => {
		const { editor, el } = await openSource();
		edit(el, 'xz');
		el.dispatchEvent(input('insertFromDrop'));
		await editor.settle();

		expect(preview(editor)).toBe('xz');
	});

	// Miss-analysis: every row edited inside the source, and none let the document's undo refill it.
	// The edit the source still held lands as a step of its own first, which the undo takes back.
	it('draws the restored formula when the document’s undo fills the shown source', async () => {
		const { editor, el } = await openSource();
		edit(el, 'xy');
		el.dispatchEvent(input('insertFromDrop'));
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();
		const { el: reopened } = await reveal(editor);
		edit(reopened, 'xyz');
		reopened.dispatchEvent(input('insertFromDrop'));
		await pressKey(reopened, { key: 'z', ctrlKey: true });

		expect(reopened.textContent).toBe('$$\nxy\n$$');
		expect(preview(editor)).toBe('xy');
	});
});
