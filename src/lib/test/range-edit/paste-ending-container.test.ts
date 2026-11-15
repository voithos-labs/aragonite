// @vitest-environment jsdom
// A clipboard's last line ending opens its line inside the container what was pasted ended in,
// behind that container's markers, as Enter there does: at a container's last paragraph too, and
// where a pasted quote joined the caret's quote. A second ending on that empty line is Enter's
// second, which leaves the container where Enter leaves it.
// Miss-analysis: the ending rows put the caret in a top-level block or a list item, and the one
// quote host had a line under the paragraph, so no row asked where the line lands at a container's end.
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
	const ranged = marked.includes('⟦');
	const [from, to] = ranged
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

// Each host's paragraph is its container's last, where the line under it is outside the container.
const LAST: [name: string, marked: string][] = [
	['a quote', '> alpha‸\n\nAfter\n'],
	['an alert', '> [!NOTE]\n> alpha‸\n\nAfter\n'],
	['a callout', ':::note\nalpha‸\n:::\n\nAfter\n'],
	['a footnote', 'a[^1]\n\n[^1]: alpha‸\n\nAfter\n'],
	['a quote in an item', '- > alpha‸\n- after\n'],
	['a quote two deep', '> > alpha‸\n\nAfter\n'],
	['a CRLF quote', '> alpha‸\r\n\r\nAfter\r\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of LAST) {
		it(`${mode}: ${name}’s last paragraph, a line ending opens Enter’s line in it`, async () => {
			expect(await pasted(marked, mode, 'one\n')).toEqual(await pasted(marked, mode, 'one', 1));
		});
		it(`${mode}: ${name}’s last paragraph, two line endings are two Enters`, async () => {
			expect(await pasted(marked, mode, 'one\n\n')).toEqual(await pasted(marked, mode, 'one', 2));
		});
	}

// A list's ending opens a line of the caret's block (ruling 53): an empty paragraph in the container,
// where Enter after the list's last item and Enter again leave it.
for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of LAST.filter(([name]) => !name.includes('item')))
		it(`${mode}: ${name}’s last paragraph, a list’s line ending opens a line in it`, async () => {
			const list = '- one\n- two';
			expect(await pasted(marked, mode, list + '\n')).toEqual(await pasted(marked, mode, list, 2));
		});

// A pasted quote that joins the caret's quote ends inside it, so its ending's line is the quote's,
// as text's is at the same place.
const JOINED: [name: string, marked: string, quote: string][] = [
	['the end, a line under it', '> alpha‸\n>\n> after\n', '> one'],
	['the end of its last paragraph', '> alpha‸\n\nAfter\n', '> one'],
	['mid-text', '> al‸pha\n>\n> after\n', '> one'],
	['the text start', '> ‸alpha\n>\n> after\n', '> one'],
	['the whole text', '> ⟦alpha⟧\n>\n> after\n', '> one'],
	['two lines', '> alpha‸\n>\n> after\n', '> one\n> two'],
	['two deep', '> > alpha‸\n> >\n> > after\n', '> one'],
	['in an item', '- > alpha‸\n- after\n', '> one'],
	['a CRLF quote', '> alpha‸\r\n>\r\n> after\r\n', '> one']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, quote] of JOINED) {
		const text = quote.replace(/^> /gm, '');
		for (const endings of ['\n', '\n\n'])
			it(`${mode}: a quote joined at ${name}, ${endings.length} ending(s) land as text’s`, async () => {
				expect(await pasted(marked, mode, quote + endings)).toEqual(
					await pasted(marked, mode, text + endings)
				);
			});
	}

// A callout taken in ends on its closing line, which takes no caret: the ending lands in the body.
// Miss-analysis: every container joined in a row was a quote, which has no closing line to end on.
const TAKEN_IN: [name: string, marked: string][] = [
	['a callout’s body end', ':::note\nalpha‸\n:::\n\nAfter\n'],
	['the last callout’s body end', ':::note\nalpha‸\n:::\n'],
	['a callout in an item', '- :::note\n  alpha‸\n  :::\n- after\n'],
	['a callout in a quote', '> :::note\n> alpha‸\n> :::\n>\n> After\n'],
	['a CRLF callout', ':::note\r\nalpha‸\r\n:::\r\n\r\nAfter\r\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of TAKEN_IN)
		for (const endings of ['\n', '\n\n'])
			it(`${mode}: a callout taken in at ${name}, ${endings.length} ending(s) land as text’s`, async () => {
				expect(await pasted(marked, mode, ':::note\nb\n:::' + endings)).toEqual(
					await pasted(marked, mode, 'b' + endings)
				);
			});

it('a callout taken in by a callout an item holds leaves no blank line among the items', async () => {
	const { typed } = await pasted(
		'- :::note\n  alpha‸\n  :::\n- after\n',
		'live',
		':::note\nb\n:::\n'
	);
	expect(typed).toMatch(/ {2}:::\n- after\n$/);
});

// Miss-analysis: the taken-in rows ended on a paragraph, so none asked where the ending goes after
// a body that ends on a fence, whose last caret place is its code.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: a quote taken in that ends on a fence keeps its ending out of the code`, async () => {
		const fence = '> ```\n> code\n> ```\n';
		const { typed } = await pasted('> alpha‸\n\nAfter\n', mode, `> q\n${fence}`);
		expect(typed).toContain(`> alphaq\n${fence}`);
	});

// A trailing line of spaces is an ending: the quote joins, then a line break and a blank line.
// Miss-analysis: every joined row's quote ended the clipboard, so no row put a line after it.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: a quote with a line of spaces after it joins, its endings mid-text`, async () => {
		const { after, typed } = await pasted('> al‸pha\n> after\n', mode, '> q\n  \n');
		expect([after.source, typed]).toEqual([
			'> alq\n>\n> pha\n> after\n',
			'> alq\n>\n> Zpha\n> after\n'
		]);
	});

// At the top level no container is left, and the line ending that was there follows (§ 5.6).
// Miss-analysis: the laws accept a blank line more anywhere, so only spelled rows hold this edge.
const TOP: [name: string, marked: string, left: string, typed: string][] = [
	['the last paragraph', 'alpha‸\n', 'alphaone\n\n', 'alphaone\n\nZ\n'],
	['a paragraph over a list', 'abc‸\n- c\n', 'abcone\n\n- c\n', 'abcone\n\nZ\n\n- c\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, left, typed] of TOP)
		it(`${mode}: ${name}, a line ending keeps § 5.6’s bytes`, async () => {
			const got = await pasted(marked, mode, 'one\n');
			expect([got.after.source, got.typed]).toEqual([left, typed]);
		});

it('the ruled row: a quote joined at a quote’s end opens the quote’s empty line', async () => {
	const { after, typed } = await pasted('> alpha‸\n>\n> after\n', 'source', '> one\n');
	expect([after.source, typed]).toEqual([
		'> alphaone\n>\n>\n> after\n',
		'> alphaone\n>\n> Z\n>\n> after\n'
	]);
});
