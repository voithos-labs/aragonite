// @vitest-environment jsdom
// A clipboard's last line ending pasted at the end of a file with no final line break lands as
// Enter there does: the line it opens is the file's blank last line, which keeps its break, with
// the caret on it; a second ending is Enter's second, nothing where that only stacks a line.
// Miss-analysis: every ending row's document ended in a line break, so no row asked what the
// ending leaves where the last line had none, and the last-line check fired on the paste alone.
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

/** What a paste of `clip` leaves at `‸` (a range at `⟦…⟧`), then `enters` presses of Enter, then a
 *  typed letter; no dev check may fire on the way. */
async function pasted(marked: string, mode: PresentationMode, clip: string, enters = 0) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const [from, to] = marked.includes('⟦')
		? [marked.indexOf('⟦'), marked.indexOf('⟧') - 1]
		: [marked.indexOf('‸'), marked.indexOf('‸')];
	const point = (at: number) => pointAtByte(measured(editor.instance.__test.getDocument()), at)!;
	expect(await placeRange(editor, { anchor: point(from), focus: point(to) })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	const key = async (key: string) => {
		await pressHardwareKey(document.activeElement as HTMLElement, { key });
		await editor.settle();
	};
	for (let i = 0; i < enters; i++) await key('Enter');
	const after = {
		source: editor.source(),
		caret: JSON.stringify(editor.instance.getSelection()?.focus)
	};
	await key('Z');
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return { after, typed };
}

type Host = 'top' | 'item' | 'quote' | 'code';

/** Each host's last line has no line ending. */
const OPEN: [name: string, marked: string, host: Host][] = [
	['a paragraph', 'abc‸', 'top'],
	['a paragraph under another', 'one\n\nabc‸', 'top'],
	['a heading', '# abc‸', 'top'],
	['a range over the last text', 'one\n\na⟦bc⟧', 'top'],
	['a list item', '- abc‸', 'item'],
	['a quote', '> abc‸', 'quote'],
	['a fence’s body', '```\nabc‸\n```', 'code'],
	['a CRLF paragraph', 'one\r\n\r\nabc‸', 'top'],
	['a CRLF list item', '- one\r\n- abc‸', 'item']
];

const CLIPS = ['x', '- q\n- r', 'one\n\ntwo'];

/** The Enters a paste's `endings` are: out of a pasted list two (the caret's block's line), in an
 *  item one; none more where Enter only stacks a line; code takes a second as written, not Enter. */
function entersFor(host: Host, clip: string, endings: number): number | null {
	if (host === 'code') return endings === 1 ? 1 : null;
	const first = clip.startsWith('- ') && (host === 'top' || host === 'quote') ? 2 : 1;
	return first + (endings === 2 && host !== 'top' ? 1 : 0);
}

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, host] of OPEN)
		for (const clip of CLIPS)
			for (const endings of [1, 2]) {
				const enters = entersFor(host, clip, endings);
				if (enters === null) continue;
				it(`${mode}: ${JSON.stringify(clip)} and ${endings} line ending(s) at ${name}’s open end are Enter`, async () => {
					expect(await pasted(marked, mode, clip + '\n'.repeat(endings))).toEqual(
						await pasted(marked, mode, clip, enters)
					);
				});
			}

// No Enter follows a pasted fence, which takes no text: its ending opens the empty line under it
// as a last paragraph's does.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: a fence and its line ending at a paragraph’s open end leave an empty line`, async () => {
		const { after, typed } = await pasted('abc‸', mode, '```\nq\n```\n');
		expect([after.source, typed]).toEqual([
			'abc\n\n```\nq\n```\n\n\n',
			'abc\n\n```\nq\n```\n\nZ\n'
		]);
	});
