// @vitest-environment jsdom
// A cut remembers the caret the core named for it: a paste of the entry that cut wrote, at the
// caret the cut left, goes back there and gives the cut back; any other paste there goes where the
// caret is, as it would anywhere.
// Miss-analysis: the remembered caret was handed to every paste at the cut's landing, so text with
// no entry landed inside the next line's indent, and only the paste of the cut back was ever run.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
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
import {
	clipboardGesture,
	mountCase,
	pasteGesture,
	pastePlainGesture,
	placeOwnedRange,
	type Editor
} from '../range-laws/gestures';

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

/** A rule held whole in an item, above a line its removal leaves as prose: the core names the cut's
 *  caret inside that line's indent, and the editor holds the caret on its text. */
const SOURCE = 'intro\n\n- text\n  ***\n  ===\n\nlast\n';

async function cutRule(): Promise<{ editor: Editor; payload: Record<string, string> }> {
	const editor = mountCase(SOURCE, 'live');
	await editor.settle();
	const m = measured(editor.instance.__test.getDocument());
	const anchor = pointAtByte(m, SOURCE.indexOf('***'))!;
	const focus = pointAtByte(m, SOURCE.indexOf('==='))!;
	expect(await placeOwnedRange(editor, { anchor, focus })).toBe(true);
	const payload = await clipboardGesture(editor, 'cut', 'key');
	return { editor, payload };
}

it('the entry the cut wrote, pasted at its caret, gives the cut back', async () => {
	const { editor, payload } = await cutRule();
	await pasteGesture(editor, payload, 'key');
	expect(editor.source()).toBe(SOURCE);
});

it('text with no entry goes where the caret is, on the text the cut left', async () => {
	const { editor } = await cutRule();
	await pasteGesture(editor, { 'text/plain': 'x' }, 'key');
	expect(editor.source()).toBe('intro\n\n- text\n\n  x===\n\nlast\n');
});

it('the cut’s text pasted as plain text declines its entry, and its caret with it', async () => {
	const { editor, payload } = await cutRule();
	await pastePlainGesture(editor, payload['text/plain']);
	expect(editor.source()).toBe('intro\n\n- text\n\n  \\*\\*\\*===\n\nlast\n');
});

// Here the cut's caret is the one the editor holds, so the place is the entry's own and only the
// core's reading of a plain paste declines it.
it('the cut’s text pasted as plain text where its entry fits still declines it', async () => {
	const source = '**a**\n\n**b**\n';
	const editor = mountCase(source, 'live');
	await editor.settle();
	const m = measured(editor.instance.__test.getDocument());
	const range = { anchor: pointAtByte(m, 0)!, focus: pointAtByte(m, source.length - 1)! };
	expect(await placeOwnedRange(editor, range)).toBe(true);
	const payload = await clipboardGesture(editor, 'cut', 'key');
	await pastePlainGesture(editor, payload['text/plain']);
	expect(editor.source()).toBe('\\*\\*a\\*\\*\n\n\\*\\*b\\*\\*\n');
});

it('another entry of the editor’s own goes where the caret is', async () => {
	const { editor } = await cutRule();
	const landing = editor.instance.getSelection()!;
	const m = measured(editor.instance.__test.getDocument());
	const source = editor.source();
	const last = {
		anchor: pointAtByte(m, source.indexOf('last'))!,
		focus: pointAtByte(m, source.length - 1)!
	};
	expect(await placeOwnedRange(editor, last)).toBe(true);
	const copied = await clipboardGesture(editor, 'copy', 'key');
	await editor.instance.setSelection(landing);
	await editor.settle();
	await pasteGesture(editor, copied, 'key');
	expect(editor.source()).toBe('intro\n\n- text\n\n  last===\n\nlast\n');
});
