// @vitest-environment jsdom
// A one-line clipboard that ends in a line ending holds a whole line, so it lands as a block, never
// as text after the caret's text: the block lands as any block does there, its ending opens the
// line Enter would, and a second ending is Enter on that line (nothing on an empty line, the list
// left from an empty item, an empty item above a rest set on its line in a list) or, at a
// paragraph's rest, a blank line of separation. Each row's bytes are spelled from those rules.
// Miss-analysis: the grid held these rows to the paste without its ending, which reads the line as
// text, so no row said what a one-line block with its ending leaves.
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

/** The bytes a paste leaves, then the bytes after a typed `Z`, which pins the caret. */
type Left = [pasted: string, typed: string];

/** `‸` marks the caret. `two` is what two endings leave, where it differs from one. */
interface Row {
	clip: string;
	one: Left;
	two?: Left;
}

const PLACES: [place: string, marked: string, rows: Row[]][] = [
	[
		'a paragraph’s end',
		'alpha‸\n\nAfter\n',
		// The block lands under a blank line; its ending is the empty line under it, the document's
		// own line ending after; a second ending on that empty line adds nothing.
		[
			{ clip: '# h', one: ['alpha\n\n# h\n\n\nAfter\n', 'alpha\n\n# h\n\nZ\n\nAfter\n'] },
			{ clip: '> q', one: ['alpha\n\n> q\n\n\nAfter\n', 'alpha\n\n> q\n\nZ\n\nAfter\n'] },
			{ clip: '- one', one: ['alpha\n\n- one\n\n\nAfter\n', 'alpha\n\n- one\n\nZ\n\nAfter\n'] },
			{ clip: '1. one', one: ['alpha\n\n1. one\n\n\nAfter\n', 'alpha\n\n1. one\n\nZ\n\nAfter\n'] },
			{ clip: '---', one: ['alpha\n\n---\n\n\nAfter\n', 'alpha\n\n---\n\nZ\n\nAfter\n'] }
		]
	],
	[
		'mid-text',
		'al‸pha\n\nAfter\n',
		// The ending splits off the rest a block would take, apart where it would read on, or opens an
		// empty line under a rule; a second is a blank line of separation, unless one stands there.
		[
			{
				clip: '# h',
				one: ['al\n\n# h\npha\n\nAfter\n', 'al\n\n# h\nZpha\n\nAfter\n'],
				two: ['al\n\n# h\n\npha\n\nAfter\n', 'al\n\n# h\n\nZpha\n\nAfter\n']
			},
			{ clip: '> q', one: ['al\n\n> q\n\npha\n\nAfter\n', 'al\n\n> q\n\nZpha\n\nAfter\n'] },
			{ clip: '- one', one: ['al\n\n- one\n\npha\n\nAfter\n', 'al\n\n- one\n\nZpha\n\nAfter\n'] },
			{
				clip: '1. one',
				one: ['al\n\n1. one\n\npha\n\nAfter\n', 'al\n\n1. one\n\nZpha\n\nAfter\n']
			},
			{ clip: '---', one: ['al\n\n---\n\npha\n\nAfter\n', 'al\n\n---\n\nZ\n\npha\n\nAfter\n'] }
		]
	],
	[
		'a paragraph’s text start',
		'‸alpha\n\nAfter\n',
		// At a line's start the block takes the line; the rest as mid-text.
		[
			{
				clip: '# h',
				one: ['# h\nalpha\n\nAfter\n', '# h\nZalpha\n\nAfter\n'],
				two: ['# h\n\nalpha\n\nAfter\n', '# h\n\nZalpha\n\nAfter\n']
			},
			{ clip: '> q', one: ['> q\n\nalpha\n\nAfter\n', '> q\n\nZalpha\n\nAfter\n'] },
			{ clip: '- one', one: ['- one\n\nalpha\n\nAfter\n', '- one\n\nZalpha\n\nAfter\n'] },
			{ clip: '1. one', one: ['1. one\n\nalpha\n\nAfter\n', '1. one\n\nZalpha\n\nAfter\n'] },
			{ clip: '---', one: ['---\n\nalpha\n\nAfter\n', '---\n\nZ\n\nalpha\n\nAfter\n'] }
		]
	],
	[
		'an item’s end',
		'- alpha‸\n- after\n',
		// A block lands in the item, a list of its type joins, one of the other type breaks the list;
		// the ending opens the next item, of the host's type, and a second ending leaves the list.
		[
			{
				clip: '# h',
				one: ['- alpha\n\n  # h\n- \n- after\n', '- alpha\n\n  # h\n- Z\n- after\n'],
				two: ['- alpha\n\n  # h\n\n\n- after\n', '- alpha\n\n  # h\n\nZ\n\n- after\n']
			},
			{
				clip: '> q',
				one: ['- alpha\n\n  > q\n- \n- after\n', '- alpha\n\n  > q\n- Z\n- after\n'],
				two: ['- alpha\n\n  > q\n\n\n- after\n', '- alpha\n\n  > q\n\nZ\n\n- after\n']
			},
			{
				clip: '- one',
				one: ['- alphaone\n- \n- after\n', '- alphaone\n- Z\n- after\n'],
				two: ['- alphaone\n\n\n- after\n', '- alphaone\n\nZ\n\n- after\n']
			},
			{
				clip: '1. one',
				one: ['- alpha\n1. one\n- \n- after\n', '- alpha\n1. one\n- Z\n- after\n'],
				two: ['- alpha\n1. one\n\n\n- after\n', '- alpha\n1. one\n\nZ\n\n- after\n']
			},
			{
				clip: '---',
				one: ['- alpha\n\n  ---\n- \n- after\n', '- alpha\n\n  ---\n- Z\n- after\n'],
				two: ['- alpha\n\n  ---\n\n\n- after\n', '- alpha\n\n  ---\n\nZ\n\n- after\n']
			}
		]
	],
	[
		'mid-item',
		'- al‸pha\n- after\n',
		// A rest goes to the next item (the second ending: an empty item above it), or gets an empty
		// item above it where it was an item already; under a rule it stays, an empty line between.
		[
			{
				clip: '# h',
				one: ['- al\n\n  # h\n- pha\n- after\n', '- al\n\n  # h\n- Zpha\n- after\n'],
				two: ['- al\n\n  # h\n- \n- pha\n- after\n', '- al\n\n  # h\n- \n- Zpha\n- after\n']
			},
			{
				clip: '> q',
				one: ['- al\n\n  > q\n- pha\n- after\n', '- al\n\n  > q\n- Zpha\n- after\n'],
				two: ['- al\n\n  > q\n- \n- pha\n- after\n', '- al\n\n  > q\n- \n- Zpha\n- after\n']
			},
			{
				clip: '- one',
				one: ['- alone\n- pha\n- after\n', '- alone\n- Zpha\n- after\n'],
				two: ['- alone\n- \n- pha\n- after\n', '- alone\n- \n- Zpha\n- after\n']
			},
			{
				clip: '1. one',
				one: ['- al\n1. one\n- \n- pha\n- after\n', '- al\n1. one\n- Z\n- pha\n- after\n'],
				two: ['- al\n1. one\n\n\n- pha\n- after\n', '- al\n1. one\n\nZ\n\n- pha\n- after\n']
			},
			{
				clip: '---',
				one: ['- al\n\n  ---\n\n  pha\n- after\n', '- al\n\n  ---\n\n  Z\n\n  pha\n- after\n']
			}
		]
	],
	[
		'an empty item',
		'- alpha\n- ‸\n- after\n',
		// A block the item's line reads back as holding stands in it, a list of the item's type joins;
		// a list of the other type and a rule take the item's place. The ending is the next item.
		[
			{
				clip: '# h',
				one: ['- alpha\n- # h\n- \n- after\n', '- alpha\n- # h\n- Z\n- after\n'],
				two: ['- alpha\n- # h\n\n\n- after\n', '- alpha\n- # h\n\nZ\n\n- after\n']
			},
			{
				clip: '> q',
				one: ['- alpha\n- > q\n- \n- after\n', '- alpha\n- > q\n- Z\n- after\n'],
				two: ['- alpha\n- > q\n\n\n- after\n', '- alpha\n- > q\n\nZ\n\n- after\n']
			},
			{
				clip: '- one',
				one: ['- alpha\n- one\n- \n- after\n', '- alpha\n- one\n- Z\n- after\n'],
				two: ['- alpha\n- one\n\n\n- after\n', '- alpha\n- one\n\nZ\n\n- after\n']
			},
			{
				clip: '1. one',
				one: ['- alpha\n1. one\n- \n- after\n', '- alpha\n1. one\n- Z\n- after\n'],
				two: ['- alpha\n1. one\n\n\n- after\n', '- alpha\n1. one\n\nZ\n\n- after\n']
			},
			{
				clip: '---',
				one: ['- alpha\n---\n- \n- after\n', '- alpha\n---\n- Z\n- after\n'],
				two: ['- alpha\n---\n\n\n- after\n', '- alpha\n---\n\nZ\n\n- after\n']
			}
		]
	]
];

/** What a paste of `clip` at `‸` leaves, then a typed letter; no dev check may fire on the way. */
async function pasted(marked: string, mode: PresentationMode, clip: string): Promise<Left> {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	const left = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return [left, typed];
}

for (const mode of ['source', 'live'] as const)
	for (const [place, marked, rows] of PLACES)
		for (const { clip, one, two } of rows) {
			it(`${mode}: ${clip} with its line ending at ${place} lands as a block`, async () => {
				expect(await pasted(marked, mode, clip + '\n')).toEqual(one);
			});
			it(`${mode}: ${clip} with two line endings at ${place}`, async () => {
				expect(await pasted(marked, mode, clip + '\n\n')).toEqual(two ?? one);
			});
		}
