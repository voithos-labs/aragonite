// @vitest-environment jsdom
// A pending break that nothing is inserted into ends without a byte: a caret key, a press, an undo,
// the block's blur, a mode change and a document swap each leave the bytes and draw no line.
// Miss-analysis: GH #522, the break was a trailing backslash, so no test could abandon one; later,
// every row ended it with a key or a move away, so a forget that kept it passed them all.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import type { EditorTestSurface } from '#lib/components/editor-root-test-surface.js';

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
	it('ends the pending break, the closer kept', async () => {
		const { editor, el } = await openBreak('a **bold**\n');

		await pressKey(el, { key: 'ArrowLeft' });

		expect(breakAnchors(el)).toBe(0);
		expect(editor.source()).toBe('a **bold**\n');
	});
});

// The caret stays on the open line in both, so only the caret memory's forget can end the break.
describe.each(['source', 'live'] as const)('%s mode: a caret move that is no key', (mode) => {
	it('a press on the open line itself ends it', async () => {
		const { editor, el } = await openBreak('abc\n', mode);

		el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
		await editor.settle();

		expect(breakAnchors(el)).toBe(0);
		expect(editor.source()).toBe('abc\n');
	});

	it('an undo with nothing to undo ends it', async () => {
		const { editor, el } = await openBreak('abc\n', mode);

		await pressKey(el, { key: 'z', ctrlKey: true });

		expect(breakAnchors(el)).toBe(0);
		expect(editor.source()).toBe('abc\n');
	});
});

describe('a pending break does not outlive what it was opened in', () => {
	it('a switch to reading mode and back draws no line', async () => {
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

	// The key's route stops at the command dispatch; the block's own command reaches the write gate.
	it('reading mode opens none, by the key or by the block’s command', async () => {
		const { editor, el } = await openBreak('abc\n', 'reading');
		const surface = (editor as MountedEditor<EditorTestSurface>).instance.__test;
		placeCaret(el, 3);
		surface.getBlockComponent([0])?.runCommand?.('block.hardBreak');
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
		expect(editor.source()).toBe('abc\n');
		expect(breakAnchors(el)).toBe(0);
	});
});
