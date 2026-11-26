// @vitest-environment jsdom
// A line ending pasted at a line's end inside a block of several lines is Enter there (ruling 87):
// it splits the block above the line under it and the caret goes to that line, never swallowed by
// the block's own line break. In a quote the quote's Enter, in an item the item's; at a run's close
// in live mode the run closes before the break. Each row equals the paste without its endings and
// then that many Enters: bytes, caret, the letter typed after, and no dev check on the way.
// Miss-analysis: every ending row put the caret mid-line or at the block's last line, so none had
// a line of the block under the caret, where the block's own break stood for the pasted one.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted at `‸`, then `enters` presses of Enter, then a typed letter. */
async function pasted(marked: string, mode: PresentationMode, clip: string, enters = 0) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	const key = async (k: string) => {
		await pressHardwareKey(document.activeElement as HTMLElement, { key: k });
		await editor.settle();
	};
	if (clip !== '') await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	for (let i = 0; i < enters; i++) await key('Enter');
	const after = {
		source: editor.source(),
		caret: JSON.stringify(editor.instance.getSelection()?.focus)
	};
	expect(
		describeConvergence(editor.instance.__test.getDocument(), editor.instance.__test.getGrammar())
	).toBeNull();
	await key('Z');
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return { after, typed };
}

const HOSTS: [string, string][] = [
	['a paragraph', 'one‸\ntwo\n'],
	['a paragraph of three lines', 'one‸\ntwo\nthree\n'],
	['a paragraph the file ends on with no break', 'one‸\ntwo'],
	['a CRLF paragraph', 'one‸\r\ntwo\r\n'],
	['a quote', '> one‸\n> two\n'],
	['a quote in a quote', '> > one‸\n> > two\n'],
	['a quote in an item', '- > one‸\n  > two\n'],
	['a callout', ':::note\none‸\ntwo\n:::\n'],
	['an item', '- one‸\n  two\n- b\n'],
	['an item’s lazy line', '- one‸\ntwo\n- b\n'],
	['an ordered item', '1. one‸\n   two\n2. b\n'],
	['a to-do', '- [ ] one‸\n  two\n'],
	['a nested item', '- a\n  - one‸\n    two\n'],
	['an item in a quote', '> - one‸\n>   two\n']
];

// [the clipboard, the same without its endings, how many Enters]
const CLIPS: [string, string, number][] = [
	['o\n', 'o', 1],
	['\n', '', 1],
	['o\n\n', 'o', 2],
	['x\ny\n', 'x\ny', 1]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of HOSTS)
		for (const [clip, bare, enters] of CLIPS)
			it(`${mode}: ${JSON.stringify(clip)} at a line's end in ${name} is Enter there`, async () => {
				expect(await pasted(marked, mode, clip)).toEqual(await pasted(marked, mode, bare, enters));
			});

// Live mode hides the closer, so the run closes before the break; in source mode the closer is
// text after the caret on its line, so the ending is a line break there (ruling 79).
for (const [run, clip] of [
	['*', 'o\n'],
	['*', '\n'],
	['**', 'o\n'],
	['**', '\n']
])
	it(`live: ${JSON.stringify(clip)} at a ${run} run's close over a line of the text`, async () => {
		const marked = `${run}one‸${run}\ntwo\n`;
		const word = clip === '\n' ? 'one' : 'oneo';
		const { typed } = await pasted(marked, 'live', clip);
		expect(typed).toBe(`${run}${word}${run}\n\nZtwo\n`);
		expect(await pasted(marked, 'live', clip)).toEqual(
			await pasted(marked, 'live', clip.slice(0, -1), 1)
		);
	});

it('source: an ending before a run’s visible closer is a line break there', async () => {
	const { after } = await pasted('*one‸*\ntwo\n', 'source', 'o\n');
	expect(after.source).toBe('*oneo\n*\ntwo\n');
});

it('the ruled rows: a paragraph, a quote and an item', async () => {
	expect((await pasted('one‸\ntwo\n', 'source', 'o\n')).typed).toBe('oneo\n\nZtwo\n');
	expect((await pasted('> one‸\n> two\n', 'source', 'o\n')).typed).toBe('> oneo\n>\n> Ztwo\n');
	expect((await pasted('- one‸\n  two\n- b\n', 'source', 'o\n')).typed).toBe(
		'- oneo\n- Ztwo\n- b\n'
	);
});
