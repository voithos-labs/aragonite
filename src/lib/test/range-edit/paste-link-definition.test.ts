// @vitest-environment jsdom
// A link definition is no host for blocks: a clipboard of lines pasted anywhere in one (its label,
// its destination, its title) lands as blocks of their own under it, set apart, and its last line
// ending opens the line under them, which the next letter takes as a paragraph of its own. One line
// with no line ending still goes in as its bytes.
// Miss-analysis: the literal-host rows were code blocks and HTML, whose lines take pasted lines, so
// no row asked what a block whose lines are no body does with them.
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

/** The bytes a key paste of `clip` at `‸` leaves, then once `Z` is typed; the tree reads back from
 *  the bytes, and no dev check fires on the way. */
async function landed(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = marked.indexOf('‸');
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), at)!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
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

const CLIPS = {
	list: '- one\n- two\n',
	fence: '```\ncode\n```\n',
	paragraphs: 'one\n\ntwo',
	heading: '# head\n'
};

/** What each clipboard leaves under the definition, then with `Z` typed; `·` stands for the bytes
 *  around the pasted blocks, `before` above them and `after` below. */
const UNDER: Record<keyof typeof CLIPS, [left: string, typed: string]> = {
	list: ['- one\n- two\n', '- one\n- two\n\nZ\n'],
	fence: ['```\ncode\n```\n', '```\ncode\n```\n\nZ\n'],
	paragraphs: ['one\n\ntwo', 'one\n\ntwoZ'],
	heading: ['# head\n', '# head\n\nZ\n']
};

const TOP: [place: string, marked: string, before: string, after: string][] = [
	['the label', '[r‸ef]: /url\n\nAfter [ref]\n', '[ref]: /url\n\n', '\nAfter [ref]\n'],
	['the destination', '[ref]: /u‸rl\n\nAfter [ref]\n', '[ref]: /url\n\n', '\nAfter [ref]\n'],
	['a title', '[ref]: /url "ti‸tle"\n\nAfter [ref]\n', '[ref]: /url "title"\n\n', '\nAfter [ref]\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [place, marked, before, after] of TOP)
		for (const [name, clip] of Object.entries(CLIPS) as [keyof typeof CLIPS, string][])
			it(`${mode}: ${name} pasted in ${place} lands under the definition`, async () => {
				const [left, typed] = UNDER[name];
				// Two paragraphs end on text, so the next line keeps its blank line apart.
				const tail = name === 'paragraphs' ? '\n' + after : after;
				expect(await landed(marked, mode, clip)).toEqual([
					before + left + tail,
					before + typed + tail
				]);
			});

// A definition in a container keeps the blocks in it, under the definition; in an item the last
// line ending opens the next item, as it does anywhere in a list.
const NESTED: [
	place: string,
	marked: string,
	clip: keyof typeof CLIPS,
	left: string,
	typed: string
][] = [
	[
		'a quote',
		'> [ref]: /u‸rl\n>\n> After [ref]\n',
		'list',
		'> [ref]: /url\n>\n> - one\n> - two\n>\n> After [ref]\n',
		'> [ref]: /url\n>\n> - one\n> - two\n>\n> Z\n>\n> After [ref]\n'
	],
	[
		'a quote',
		'> [ref]: /u‸rl\n>\n> After [ref]\n',
		'heading',
		'> [ref]: /url\n>\n> # head\n>\n> After [ref]\n',
		'> [ref]: /url\n>\n> # head\n>\n> Z\n>\n> After [ref]\n'
	],
	[
		'an item',
		'- [ref]: /u‸rl\n- after\n',
		'heading',
		'- [ref]: /url\n\n  # head\n- \n- after\n',
		'- [ref]: /url\n\n  # head\n- Z\n- after\n'
	],
	[
		'an item',
		'- [ref]: /u‸rl\n- after\n',
		'list',
		'- [ref]: /url\n\n  - one\n  - two\n  - \n- after\n',
		'- [ref]: /url\n\n  - one\n  - two\n  - Z\n- after\n'
	],
	[
		'an item',
		'- [ref]: /u‸rl\n- after\n',
		'fence',
		'- [ref]: /url\n\n  ```\n  code\n  ```\n- \n- after\n',
		'- [ref]: /url\n\n  ```\n  code\n  ```\n- Z\n- after\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [place, marked, clip, left, typed] of NESTED)
		it(`${mode}: ${clip} pasted in a definition in ${place} lands under it there`, async () => {
			expect(await landed(marked, mode, CLIPS[clip])).toEqual([left, typed]);
		});

// The definition's title has started on the next line and not closed: the blocks under the
// definition stay apart from the lines that wait for it.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: a heading pasted at a definition whose title waits lands apart from both`, async () => {
		const marked = "[a]: /u‸\n    'code\n# h\ntext\nend'\n";
		const [left] = await landed(marked, mode, CLIPS.heading);
		expect(left).toBe("[a]: /u\n\n# head\n\n    'code\n# h\ntext\nend'\n");
	});

// One line with no line ending goes in as its bytes, whatever it reads as.
for (const mode of ['source', 'live'] as const)
	it(`${mode}: one line pasted in a destination goes in as its bytes`, async () => {
		const [left] = await landed('[ref]: /u‸rl\n\nAfter [ref]\n', mode, '# x');
		expect(left).toBe('[ref]: /u# xrl\n\nAfter [ref]\n');
	});
