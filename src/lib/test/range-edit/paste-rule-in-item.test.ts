// @vitest-environment jsdom
// A block pasted on an item's own line stands in the item only where that line reads back as the
// item holding it; where it would not (`- ---` reads as a rule), the item gives way and the block
// takes its line, the list going on around it. Every route that lands blocks there agrees: the key
// paste, `insertMarkdown` at the caret, and `placement: 'below'` in an empty item.
// Miss-analysis: the empty-item rows pasted tables and headings, whose line reads back as the item
// holding them, and the rows that drained warnings in `afterEach` never read the dev check's fire.
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
import { parse } from '#lib/core/parser.js';
import { blocksIn, blocksOf, mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

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

type Route = 'key' | 'caret' | 'below';
const ROUTES: readonly Route[] = ['key', 'caret', 'below'];

/** The bytes a paste of `block` by `route` leaves at `‸` (a range at `⟦…⟧`), then once `Z` is typed;
 *  the tree reads back from the bytes, and no dev check fires on the way. */
async function landed(marked: string, mode: PresentationMode, block: string, route: Route) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const ranged = marked.includes('⟦');
	const [from, to] = ranged
		? [marked.indexOf('⟦'), marked.indexOf('⟧') - 1]
		: [marked.indexOf('‸'), marked.indexOf('‸')];
	const point = (at: number) => pointAtByte(measured(editor.instance.__test.getDocument()), at)!;
	expect(await placeRange(editor, { anchor: point(from), focus: point(to) })).toBe(true);
	if (route === 'key') await pasteGesture(editor, { 'text/plain': block }, 'key');
	else
		await editor.instance.insertMarkdown(
			block + '\n',
			route === 'below' ? { placement: 'below' } : undefined
		);
	await editor.settle();
	const left = editor.source();
	expect(blocksOf(parse(left).children)).toEqual(blocksIn(editor));
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return [left, typed];
}

const GIVES_WAY: [name: string, marked: string, block: string, left: string][] = [
	['an empty bullet', '- a\n- ‸\n- b\n', '---', '- a\n---\n- b\n'],
	['an empty star item, stars', '* a\n* ‸\n* b\n', '***', '* a\n***\n* b\n'],
	['an empty bullet, spaced dashes', '- a\n- ‸\n- b\n', '- - -', '- a\n- - -\n- b\n'],
	['an empty nested bullet', '- a\n  - x\n  - ‸\n- b\n', '---', '- a\n  - x\n  ---\n- b\n'],
	['the first empty bullet', '- ‸\n- b\n', '---', '---\n- b\n'],
	['the only empty bullet', '- ‸\n', '---', '---\n'],
	['an empty bullet in a quote', '> - a\n> - ‸\n> - b\n', '---', '> - a\n> ---\n> - b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, block, left] of GIVES_WAY)
		for (const route of ROUTES)
			it(`${mode}: ${block} by ${route} in ${name}: the item gives way`, async () => {
				expect((await landed(marked, mode, block, route))[0]).toBe(left);
			});

// A range over the item's whole text empties it on both sides, as an empty item is.
for (const mode of ['source', 'live'] as const)
	for (const route of ['key', 'caret'] as const)
		it(`${mode}: --- by ${route} over a bullet's whole text: the item gives way`, async () => {
			expect((await landed('- a\n- ⟦x⟧\n- b\n', mode, '---', route))[0]).toBe('- a\n---\n- b\n');
		});

const STANDS: [name: string, marked: string, block: string, left: string][] = [
	['an empty ordered item', '1. a\n2. ‸\n3. b\n', '---', '1. a\n2. ---\n3. b\n'],
	['an empty plus item', '+ a\n+ ‸\n+ b\n', '---', '+ a\n+ ---\n+ b\n'],
	['an empty bullet, spaced stars', '- a\n- ‸\n- b\n', '* * *', '- a\n- * * *\n- b\n'],
	[
		'an empty to-do, its text',
		'- [ ] a\n- [ ] ‸\n- [ ] b\n',
		'---',
		'- [ ] a\n- [ ] ---\n- [ ] b\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, block, left] of STANDS)
		for (const route of ROUTES)
			it(`${mode}: ${block} by ${route} in ${name}: the item holds it`, async () => {
				expect((await landed(marked, mode, block, route))[0]).toBe(left);
			});
