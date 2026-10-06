// @vitest-environment jsdom
// A pending break that nothing is inserted into ends without a byte: a caret key, the block's blur,
// a mode change and a document swap each leave the block's bytes as they were and its line unpainted.
// Miss-analysis: GH #522, the break was a trailing backslash, so no test could abandon one.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const breakAnchors = (el: HTMLElement) =>
	el.querySelectorAll('br[data-caret-anchor="break"]').length;

async function openBreak(
	source: string,
	mode: 'source' | 'live' | 'reading' = 'live'
): Promise<{ editor: MountedEditor; el: HTMLElement }> {
	const editor = mountEditor({ source, presentationMode: mode });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, source.indexOf('\n'));
	await pressKey(el, { key: 'Enter', shiftKey: true });
	return { editor, el };
}

describe.each(['source', 'live'] as const)('%s mode: a pending break ends unwritten', (mode) => {
	it('when the caret leaves for another block', async () => {
		const { editor, el } = await openBreak('abc\n\nnext\n', mode);
		expect(breakAnchors(el)).toBe(2);

		surfaceAt(editor, [1]).focus();
		await editor.settle();

		expect(editor.source()).toBe('abc\n\nnext\n');
		expect(breakAnchors(el)).toBe(0);
	});

	it.each(['Backspace', 'ArrowLeft'])(
		'on %s, which puts the caret back at the text’s end',
		async (key) => {
			const { editor, el } = await openBreak('abc\n', mode);

			await pressKey(el, { key });

			expect(editor.source()).toBe('abc\n');
			expect(breakAnchors(el)).toBe(0);
			expect(window.getSelection()?.focusNode?.textContent).toBe('abc');
		}
	);
});

describe('live mode: ArrowLeft beside a hidden closer', () => {
	// The edge step also takes a plain ArrowLeft at a hidden closer, and must not get it first.
	it('ends the pending break rather than stepping into the construct', async () => {
		const { editor, el } = await openBreak('a **bold**\n');

		await pressKey(el, { key: 'ArrowLeft' });

		expect(breakAnchors(el)).toBe(0);
		expect(editor.source()).toBe('a **bold**\n');
	});
});

describe('a pending break does not outlive what it was opened in', () => {
	it('a switch to reading mode and back ends it', async () => {
		const { editor } = await openBreak('abc\n');

		editor.props.presentationMode = 'reading';
		await editor.settle();
		expect(breakAnchors(surfaceAt(editor, [0]))).toBe(0);
		editor.props.presentationMode = 'live';
		await editor.settle();

		expect(editor.source()).toBe('abc\n');
		expect(breakAnchors(surfaceAt(editor, [0]))).toBe(0);
	});

	it('a document swap ends it, so the next insertion writes no break', async () => {
		const { editor } = await openBreak('abc\n');

		editor.props.source = 'xyz\n';
		await editor.settle();
		const el = surfaceAt(editor, [0]);
		el.textContent = 'xyzq';
		placeCaret(el, 4);
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await editor.settle();

		expect(editor.source()).toBe('xyzq\n');
	});

	it('reading mode opens none', async () => {
		const { editor, el } = await openBreak('abc\n', 'reading');

		expect(editor.source()).toBe('abc\n');
		expect(breakAnchors(el)).toBe(0);
	});
});
