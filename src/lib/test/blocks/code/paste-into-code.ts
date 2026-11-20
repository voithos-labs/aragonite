// A paste into a mounted fenced code block holding `display`, its fence lines shown so every raw
// offset takes a caret: the bytes and the caret the editor leaves.

import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { placeCaret, selectRange, surfaceAt } from '../../harness/mount-editor.svelte';
import { mountCase, pasteGesture } from '../../range-laws/gestures';
import { caretOf } from '../../range-laws/through-splice';

export async function pasteIntoCode(input: {
	display: string;
	selection: { start: number; end: number };
	pasted: string;
}): Promise<{ text: string; cursor: number | undefined }> {
	const { display, selection, pasted } = input;
	const editor = mountCase(`${display}\n`, 'source');
	await editor.settle();
	const el = surfaceAt(editor, [0]);
	if (selection.start === selection.end) placeCaret(el, selection.start);
	else selectRange(el, selection.start, selection.end);
	await editor.settle();
	await pasteGesture(editor, { 'text/plain': pasted }, 'key');
	const text = trimTrailingLineEnding(editor.source());
	const cursor = caretOf(editor)?.at;
	await editor.destroy();
	return { text, cursor };
}
