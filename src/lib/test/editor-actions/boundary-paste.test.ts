// @vitest-environment jsdom
// Miss-analysis: the gap caret's and the whole-block host's input policy declined a paste by
// design, and no row pasted at either, so Ctrl+V there did nothing at all.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { installClipboardEvents } from '#lib/test/harness/clipboard-events.js';
import { pressKey, settleEditor } from '#lib/test/harness/settle.js';
import type { BlockComponent } from '#lib/block-component.js';

beforeAll(() => {
	installLayoutStubs();
	installClipboardEvents();
});
afterEach(destroyMountedEditors);

type Lookup = { getBlockComponent(path: number[]): BlockComponent | null };

async function paste(text: string): Promise<void> {
	const clipboardData = new DataTransfer();
	clipboardData.setData('text/plain', text);
	const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
	document.activeElement!.dispatchEvent(event);
	await settleEditor();
	await settleEditor();
}

async function atGapAboveCode(source: string): Promise<MountedEditor<Lookup>> {
	const editor = mountEditor<Lookup>({ source });
	await editor.settle();
	const code = surfaceAt(editor, [0]);
	placeCaret(code, 0);
	await pressKey(code, { key: 'ArrowLeft' });
	return editor;
}

async function onRuleFocusedWhole(source: string): Promise<MountedEditor<Lookup>> {
	const editor = mountEditor<Lookup>({ source });
	await editor.settle();
	editor.instance.__test.getBlockComponent([1])!.focus?.(0);
	await editor.settle();
	return editor;
}

describe('a paste at the gap caret', () => {
	it('inserts the clipboard’s blocks at the gap, as one undo entry', async () => {
		const editor = await atGapAboveCode('```\ncode\n```\n\npara\n');
		await paste('# Title\n\nbody');
		expect(editor.source()).toBe('# Title\n\nbody\n\n```\ncode\n```\n\npara\n');
		await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe('```\ncode\n```\n\npara\n');
	});

	it('keeps a CRLF document’s line ending', async () => {
		const editor = await atGapAboveCode('```\r\ncode\r\n```\r\n\r\npara\r\n');
		await paste('one\ntwo');
		expect(editor.source()).toBe('one\r\ntwo\r\n\r\n```\r\ncode\r\n```\r\n\r\npara\r\n');
	});
});

describe('a paste on a block focused whole', () => {
	it('inserts the clipboard’s blocks after the block, as one undo entry', async () => {
		const editor = await onRuleFocusedWhole('a\n\n---\n\nb\n');
		await paste('PASTED');
		expect(editor.source()).toBe('a\n\n---\n\nPASTED\n\nb\n');
		await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe('a\n\n---\n\nb\n');
	});

	it('keeps a CRLF document’s line ending', async () => {
		const editor = await onRuleFocusedWhole('a\r\n\r\n---\r\n\r\nb\r\n');
		await paste('one\ntwo');
		expect(editor.source()).toBe('a\r\n\r\n---\r\n\r\none\r\ntwo\r\n\r\nb\r\n');
	});
});

// Miss-analysis: every boundary-paste row mounted an editable document, so none saw the reading-mode
// check that the paste route skipped.
describe('a paste on a block focused whole in reading mode', () => {
	it('writes nothing', async () => {
		const source = 'a\n\n---\n\nb\n';
		const editor = mountEditor<Lookup>({ source, presentationMode: 'reading' });
		await editor.settle();
		editor.instance.__test.getBlockComponent([1])!.focus?.(0);
		await editor.settle();
		await paste('PASTED');
		expect(editor.source()).toBe(source);
	});
});

describe('claimsChord at a gap and on a block focused whole', () => {
	it('takes the paste chord at both', async () => {
		const press = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true });
		const gap = await atGapAboveCode('```\ncode\n```\n\npara\n');
		expect(gap.instance.claimsChord(press)).toBe(true);
		await gap.destroy();
		const rule = await onRuleFocusedWhole('a\n\n---\n\nb\n');
		expect(rule.instance.claimsChord(press)).toBe(true);
	});
});
