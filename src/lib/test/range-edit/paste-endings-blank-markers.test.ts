// @vitest-environment jsdom
// Line endings pasted at the text start of a block in a container leave each line they blank with
// its markers and no trailing space, the caret's own line too: what that many Enters leave, a
// quote two deep and a quote opening an item's first line included.
// Miss-analysis: the blank-marker rows pasted one ending, which takes another path than two or more,
// so no row read the caret's own line once a blank line came with it.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
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
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
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

/** `clip` pasted at `‸` (none for an empty one), then `enters` presses of Enter and `Z`: the bytes. */
async function typedAfter(marked: string, mode: PresentationMode, clip: string, enters = 0) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	if (clip !== '') await pasteGesture(editor, { 'text/plain': clip }, 'key');
	for (const key of [...Array(enters).fill('Enter'), 'Z']) {
		await pressHardwareKey(document.activeElement as HTMLElement, { key });
		await editor.settle();
	}
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	return editor.source();
}

const HOSTS = ['> ‸alpha\n\nAfter\n', '> > ‸alpha\n', '- > ‸alpha\n- after\n'];

for (const marked of HOSTS)
	for (const mode of ['source', 'live'] as PresentationMode[])
		for (const count of [1, 2, 3])
			it(`${count} ending(s) at ${JSON.stringify(marked)}, ${mode}`, async () => {
				expect(await typedAfter(marked, mode, '\n'.repeat(count))).toBe(
					await typedAfter(marked, mode, '', count)
				);
			});

it('three endings at a quote’s text start, spelled', async () => {
	expect(await typedAfter('> ‸alpha\n\nAfter\n', 'source', '\n\n\n')).toBe(
		'>\n>\n>\n> Zalpha\n\nAfter\n'
	);
});
