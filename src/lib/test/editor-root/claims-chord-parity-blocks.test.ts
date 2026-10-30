// @vitest-environment jsdom
// Miss-analysis: `claimsChord` was a second computation (every kind's keymap at once) that no test
// held against what the keydown handlers do where the caret is, so a table chord was claimed in prose.
import { beforeAll, describe, it } from 'vitest';
import { registerBuiltInDescriptors } from '#lib/schema/built-in-descriptors.js';
import {
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt } from '../blocks/table/mount-table';
import { expectParity, keysToProbe, type ClaimContext } from './claims-parity';

beforeAll(installLayoutStubs);
registerBuiltInDescriptors();

// A caret mid-text everywhere: at an edge the arrow and delete keys leave the block instead.
const DOC = [
	'para text here',
	'# heading text',
	'> - item one text\n>   - [ ] nested item text',
	'| A | B | C |\n| --- | --- | --- |\n| 1 | middle | 3 |\n| 4 | 5 | 6 |',
	'```\ncode text here\n```',
	'---',
	'last para here'
].join('\n\n');

const caretAt =
	(path: number[], offset: number): ClaimContext['enter'] =>
	async (editor) => {
		const el = surfaceAt(editor, path);
		placeCaret(el, offset);
		return el;
	};

const CONTEXTS: ClaimContext[] = [
	{ name: 'paragraph', source: DOC, enter: caretAt([0], 5) },
	{ name: 'paragraph, caret at its start', source: DOC, enter: caretAt([6], 0) },
	{ name: 'heading', source: DOC, enter: caretAt([1], 6) },
	{ name: 'nested list item in a quote', source: DOC, enter: caretAt([2, 0, 0, 1, 0, 0], 8) },
	{
		name: 'table cell',
		source: DOC,
		enter: async (editor) => {
			const cell = cellAt(editor, 1, 1, [3]);
			placeCaret(cell, 3);
			return cell;
		}
	},
	{ name: 'code block', source: DOC, enter: caretAt([4], 6) },
	{
		name: 'thematic break focused whole',
		source: DOC,
		enter: async (editor) => {
			editor.instance.__test.getBlockComponent([5])!.focus?.(0);
			await editor.settle();
			return document.activeElement as HTMLElement;
		}
	},
	{
		name: 'paragraph, tableCell-scoped override',
		source: DOC,
		keybindings: [{ kind: 'tableCell', chord: 'Mod+Shift+J', command: 'table.insertRowBelow' }],
		enter: caretAt([0], 5)
	},
	{
		name: 'paragraph, global disable',
		source: DOC,
		keybindings: [
			{ chord: 'Mod+B', command: null },
			{ chord: 'Mod+Z', command: null }
		],
		enter: caretAt([0], 5)
	}
];

describe.each(CONTEXTS)('claimsChord agrees with the keydown: $name', (context) => {
	it.each(keysToProbe())('%s', (chord) => expectParity(context, chord));
});
