// @vitest-environment jsdom
// Backspace at a block's start or Delete at its end that joins nothing lands as a range gesture's
// removal does, never on syntax: a name, a fence line, a heading's `#` in source mode, a table of
// contents (`docs/design/structural-edits.md` § Structural operations, `selection.md` § The gap
// caret). A caret the user puts on syntax still types there.
// Miss-analysis: the plain keys landed through each neighbour's own entry caret, which sits before
// a heading's `#` in source mode and at a name's end, and no row typed a letter after them.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { CURSOR_END, CURSOR_START } from '#lib/block-component.js';
import { blockFacts } from '#lib/schema/block-facts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { kitFixtures, mountCase, type Editor } from './gestures';
import { letterLanding } from './letter-landing';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

async function press(editor: Editor, key: string): Promise<void> {
	await pressHardwareKey(focused(), { key });
	await editor.settle();
}

/** The source after `key` at the caret placed at `offset` of the block at `path`, then a letter. */
async function typedAfter(
	source: string,
	mode: PresentationMode,
	at: { path: number[]; offset: number },
	keys: string[]
): Promise<{ editor: Editor; before: string; typed: string }> {
	await destroyMountedEditors();
	const editor = mountCase(source, mode);
	await editor.settle();
	placeCaret(surfaceAt(editor, at.path), at.offset);
	await editor.settle();
	for (const key of keys) await press(editor, key);
	const before = editor.source();
	await press(editor, 'x');
	return { editor, before, typed: editor.source() };
}

// ── The keys a ruling names ──────────────────────────────────────────────────

type Row = [
	name: string,
	source: string,
	at: { path: number[]; offset: number },
	keys: string[],
	typed: string
];

const BOTH_MODES: Row[] = [
	[
		'Backspace at a callout body’s start holds the gap under its opening line',
		':::tip\nin\n:::\n',
		{ path: [0, 1], offset: 0 },
		['Backspace'],
		':::tip\n\nx\n\nin\n:::\n'
	],
	[
		'Delete at a paragraph’s end before an untitled callout goes on to its text',
		'alpha\n\n:::tip\nin\n:::\n',
		{ path: [0], offset: 5 },
		['Delete'],
		'alpha\n\n:::tip\nxin\n:::\n'
	],
	[
		'Delete at a paragraph’s end before a heading lands past its `# `',
		'alpha\n\n# h\n',
		{ path: [0], offset: 5 },
		['Delete'],
		'alpha\n\n# xh\n'
	],
	[
		'Delete before a titled callout lands at its title',
		'alpha\n\n:::tip Title\nin\n:::\n',
		{ path: [0], offset: 5 },
		['Delete'],
		'alpha\n\n:::tip xTitle\nin\n:::\n'
	],
	[
		'Backspace below an empty untitled callout holds the gap inside it',
		':::tip\n:::\n\npara\n',
		{ path: [1], offset: 0 },
		['Backspace'],
		':::tip\n\nx\n:::\n\npara\n'
	],
	[
		'Delete before a table of contents holds the gap above it',
		'alpha\n\n[[toc]]\n',
		{ path: [0], offset: 5 },
		['Delete'],
		'alpha\n\nx\n\n[[toc]]\n'
	],
	[
		'Backspace after a table of contents holds the gap below it',
		'[[toc]]\n\nalpha\n',
		{ path: [1], offset: 0 },
		['Backspace'],
		'[[toc]]\n\nx\n\nalpha\n'
	],
	// Enter at a heading's text start moves the heading down, the caret with it, past its `# `.
	[
		'Enter at a heading’s text start',
		'# head\n\nafter\n',
		{ path: [0], offset: 2 },
		['Enter'],
		'\n# xhead\n\nafter\n'
	],
	[
		'Enter at an item heading’s text start',
		'- # head\n',
		{ path: [0, 0, 0], offset: 2 },
		['Enter'],
		'- \n- # xhead\n'
	],
	// Miss-analysis: Enter at a title row's end was only typed above a paragraph, so no row met a
	// body whose first block an entry caret puts on syntax.
	[
		'Enter at a titled callout’s row end lands past a heading’s `# `',
		':::tip Title\n# in\n:::\n',
		{ path: [0, 0], offset: CURSOR_END },
		['Enter'],
		':::tip Title\n# xin\n:::\n'
	],
	[
		'Enter at a titled note’s row end goes on into the tip under it',
		'::::note Title\n:::tip\nin\n:::\n::::\n',
		{ path: [0, 0], offset: CURSOR_END },
		['Enter'],
		'::::note Title\n:::tip\nxin\n:::\n::::\n'
	],
	[
		'Enter at a titled callout’s row end above a table of contents holds the gap under the row',
		':::tip Title\n[[toc]]\n:::\n',
		{ path: [0, 0], offset: CURSOR_END },
		['Enter'],
		':::tip Title\n\nx\n\n[[toc]]\n:::\n'
	],
	[
		'Enter at a titled callout’s row end above a paragraph lands at its start',
		':::tip Title\nin\n:::\n',
		{ path: [0, 0], offset: CURSOR_END },
		['Enter'],
		':::tip Title\nxin\n:::\n'
	],
	// From a container's last block the key reaches the block after the container.
	[
		'Delete at a quote’s last paragraph before an untitled callout',
		'> alpha\n\n:::tip\nin\n:::\n',
		{ path: [0, 0], offset: 5 },
		['Delete'],
		'> alpha\n\n:::tip\nxin\n:::\n'
	],
	[
		'Delete at an item’s last paragraph before a heading',
		'- alpha\n\n# h\n',
		{ path: [0, 0, 0], offset: 5 },
		['Delete'],
		'- alpha\n\n# xh\n'
	],
	// The core names no byte beside a quote whose one line is the document's open last line.
	[
		'Delete before a quote holding only an open last line enters the quote',
		'alpha\n\n>',
		{ path: [0], offset: 5 },
		['Delete'],
		'alpha\n\n> x'
	],
	// Miss-analysis: every container beside a key was open, so no gap fell where a closed one hides it.
	[
		'Backspace below a closed details ending in a table of contents lands on its summary',
		'<details>\n<summary>Sum</summary>\n\n[[toc]]\n\n</details>\n\nalpha\n',
		{ path: [1], offset: 0 },
		['Backspace'],
		'<details>\n<summary>Sumx</summary>\n\n[[toc]]\n\n</details>\n\nalpha\n'
	],
	// Controls: a caret the user puts on syntax types there, and a letter at a held name's end
	// starts the title.
	[
		'a caret placed at a row’s name end',
		':::tip\nin\n:::\n',
		{ path: [0, 0], offset: 6 },
		[],
		':::tip x\nin\n:::\n'
	],
	[
		'a caret placed at an unknown row’s name end',
		':::foo\nin\n:::\n',
		{ path: [0, 0], offset: 6 },
		[],
		':::foox\nin\n:::\n'
	],
	[
		'Backspace at a titled callout body’s start lands at its title’s end',
		':::tip Title\nin\n:::\n',
		{ path: [0, 1], offset: 0 },
		['Backspace'],
		':::tip Titlex\nin\n:::\n'
	]
];

const SOURCE_ONLY: Row[] = [
	// Controls: where the user put the caret, before or inside the marker.
	[
		'a caret placed before a heading’s `#`',
		'alpha\n\n# h\n',
		{ path: [1], offset: 0 },
		[],
		'alpha\n\nx# h\n'
	],
	[
		'Enter before a heading’s `#`',
		'# head\n\nafter\n',
		{ path: [0], offset: 0 },
		['Enter'],
		'\nx# head\n\nafter\n'
	],
	[
		'Enter inside a heading’s marker',
		'# head\n\nafter\n',
		{ path: [0], offset: 1 },
		['Enter'],
		'\nx# head\n\nafter\n'
	],
	[
		'ArrowRight from a paragraph’s end into a heading',
		'alpha\n\n# h\n',
		{ path: [0], offset: 5 },
		['ArrowRight'],
		'alpha\n\nx# h\n'
	]
];

describe('a plain key that joins nothing lands off syntax', () => {
	for (const mode of ['source', 'live'] as const)
		for (const [name, source, at, keys, typed] of [
			...BOTH_MODES,
			...(mode === 'source' ? SOURCE_ONLY : [])
		])
			it(`${mode}: ${name}`, async () => {
				expect((await typedAfter(source, mode, at, keys)).typed).toBe(typed);
			});
});

// ── Every kit kind ───────────────────────────────────────────────────────────

/** Booked, not ruled: a letter at these kinds' edge renames or re-kinds them wherever a caret
 *  enters (a definition, a `::name`, an indent, an HTML tag). A setext heading merges instead. */
const BOOKED = {
	Backspace: new Set(['linkReferenceDefinition', 'directiveLeaf']),
	Delete: new Set(['indentedCode', 'htmlBlock', 'linkReferenceDefinition'])
};

describe('Backspace after every kit kind and Delete before it land off its syntax', () => {
	for (const mode of ['source', 'live'] as const)
		for (const key of ['Backspace', 'Delete'] as const)
			it(`${mode}, ${key}`, async () => {
				const out: string[] = [];
				const back = key === 'Backspace';
				for (const [kind, fixture] of await kitFixtures()) {
					const block = fixture.replace(/\r?\n$/, '');
					const source = back ? `${block}\n\nbelow\n` : `above\n\n${block}\n`;
					const own = mountCase(source, mode);
					await own.settle();
					if (own.instance.__test.getDocument().children.length !== 2) continue;
					// The kind's own entry on the key's side, where a booked kind's landing stays.
					own.instance.__test
						.getBlockComponent(back ? [0] : [1])!
						.focus(back ? CURSOR_END : CURSOR_START);
					await own.settle();
					await press(own, 'x');
					const entered = own.source();
					// Unruled: a `::name`'s text starts at the name's end, so the core's text start renames it.
					if (!back && kind === 'directiveLeaf') continue;
					const at = back ? { path: [1], offset: 0 } : { path: [0], offset: 5 };
					const { editor, before, typed } = await typedAfter(source, mode, at, [key]);
					if (BOOKED[key].has(kind)) {
						if (typed !== entered) out.push(`${kind}: ${JSON.stringify(typed)}, not its own entry`);
						continue;
					}
					const letter = letterLanding(editor, before, typed, 'x');
					// jsdom types nothing into a picture of its source; anywhere else the letter was lost.
					const picture = blockFacts(kind).textPosition === 'while-source-shows';
					if (letter ? !letter.offSyntax : !picture) out.push(`${kind}: ${JSON.stringify(typed)}`);
				}
				expect(out).toEqual([]);
			});
});
