// @vitest-environment jsdom
// In a file with no final line break, a last line emptied, as a whole paragraph or under its block's
// other lines, is a blank last line, which keeps its break (`docs/design/syntax-tree.md` § The last
// line): the letter typed next lands on it, as in the same file closed by a line break, and a block
// emptied whole that is no paragraph adds no break.
// Miss-analysis: every emptied-last-block row ended its fixture in a line break, so the emptied block
// always kept an ending of its own, and no row emptied one on a line that had none.
// Miss-analysis: the open-file rows then emptied whole paragraphs only, never a line under a
// block's other lines, whose break the commit read as the file's own and took off.
// Miss-analysis: no row deleted a closed block's closing line or left the last line a space, so
// the step's test for an emptied line (the bytes end in a line ending) was never asked either.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	deleteBy,
	insertBy,
	pressHardwareKey,
	softBackspace
} from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { cellAt } from '#lib/test/blocks/table/mount-table.js';
import {
	clipboardGesture,
	mountCase,
	placeRange,
	runHistory,
	type Editor
} from '#lib/test/range-laws/gestures.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['live', 'source'];
const focused = () => document.activeElement as HTMLElement;
type Gesture = (editor: Editor) => Promise<unknown>;

/** The source after `gesture`, then after a letter, the tree converged with a reload after each
 *  unless `converges` is false (an emptied item holds an empty paragraph, which a reload doesn't). */
async function thenLetter(
	editor: Editor,
	gesture: Gesture,
	converges = true
): Promise<[string, string]> {
	const step = async (act: () => Promise<unknown>) => {
		await act();
		await editor.settle();
		if (converges)
			expect(
				describeConvergence(
					editor.instance.__test.getDocument(),
					editor.instance.__test.getGrammar()
				)
			).toBeNull();
		return editor.source();
	};
	return [
		await step(() => gesture(editor)),
		await step(() => insertBy('hardware key', focused(), 'x'))
	];
}

async function mountAt(
	source: string,
	mode: PresentationMode,
	path: number[],
	from: number,
	to = from
) {
	const editor = mountCase(source, mode);
	await editor.settle();
	if (from === to) placeCaret(surfaceAt(editor, path), from);
	else await placeRange(editor, { anchor: { path, offset: from }, focus: { path, offset: to } });
	await editor.settle();
	return editor;
}

const REMOVALS: [string, Gesture][] = [
	['Backspace', () => deleteBy(focused(), 'Backspace')],
	['Delete', () => deleteBy(focused(), 'Delete')],
	['a cut', (editor) => clipboardGesture(editor, 'cut', 'key')]
];

describe('the emptied last paragraph keeps its line', () => {
	// [name, source, selection, after the removal, after `x`]; each closed twin is the control.
	const ROWS: [string, string, [number[], number, number], string, string][] = [
		['under a blank line', 'zz\n\nab', [[1], 0, 2], 'zz\n\n\n', 'zz\n\nx\n'],
		['under a blank line, closed', 'zz\n\nab\n', [[1], 0, 2], 'zz\n\n\n', 'zz\n\nx\n'],
		['CRLF', 'zz\r\n\r\nab', [[1], 0, 2], 'zz\r\n\r\n\r\n', 'zz\r\n\r\nx\r\n'],
		['under a heading', '# zz\n\nab', [[1], 0, 2], '# zz\n\n\n', '# zz\n\nx\n'],
		['a quote’s last paragraph', '> zz\n>\n> ab', [[0, 1], 0, 2], '> zz\n>\n>\n', '> zz\n>\n> x\n'],
		['a quote’s, closed', '> zz\n>\n> ab\n', [[0, 1], 0, 2], '> zz\n>\n>\n', '> zz\n>\n> x\n'],
		[
			'an item’s last paragraph',
			'- zz\n\n  ab',
			[[0, 0, 1], 0, 2],
			'- zz\n\n  \n',
			'- zz\n\n  x\n'
		],
		['an item’s, closed', '- zz\n\n  ab\n', [[0, 0, 1], 0, 2], '- zz\n\n  \n', '- zz\n\n  x\n']
	];
	for (const [name, source, [path, from, to], emptied, typed] of ROWS)
		for (const mode of MODES)
			for (const [gesture, run] of REMOVALS)
				it(`${name}, ${gesture}, ${mode}`, async () => {
					const editor = await mountAt(source, mode, path, from, to);
					expect(await thenLetter(editor, run)).toEqual([emptied, typed]);
				});

	it.each(MODES)('Backspace over its last letter, %s', async (mode) => {
		const editor = await mountAt('zz\n\na', mode, [1], 1);
		expect(await thenLetter(editor, () => deleteBy(focused(), 'Backspace'))).toEqual([
			'zz\n\n\n',
			'zz\n\nx\n'
		]);
	});

	it.each(MODES)('an undo gives the text back, %s', async (mode) => {
		const editor = await mountAt('zz\n\nab', mode, [1], 0, 2);
		await deleteBy(focused(), 'Delete');
		await editor.settle();
		await runHistory(editor, 'undo');
		expect(editor.source()).toBe('zz\n\nab');
	});
});

// Each row and its twin with a final line break leave the same bytes.
describe('a last line emptied under its block’s other lines keeps its line', () => {
	const ROWS: [string, string, [number[], number, number], string, string][] = [
		['a paragraph', 'above\npq', [[0], 6, 8], 'above\n\n', 'above\nx\n'],
		[
			'an item',
			'- one\n- two\n  pq',
			[[0, 1, 0], 4, 6],
			'- one\n- two\n  \n',
			'- one\n- two\n  x\n'
		],
		['an unclosed code block', 'zz\n\n```\npq', [[1], 4, 6], 'zz\n\n```\n\n', 'zz\n\n```\nx\n'],
		['a quote', '> above\n> pq', [[0, 0], 6, 8], '> above\n>\n', '> above\n> x\n'],
		[
			'an alert',
			'> [!NOTE]\n> a\n> pq',
			[[0, 0], 2, 4],
			'> [!NOTE]\n> a\n>\n',
			'> [!NOTE]\n> a\n> x\n'
		],
		['a footnote', '[^1]: a\n    pq', [[0, 0], 2, 4], '[^1]: a\n    \n', '[^1]: a\n    x\n']
	];
	const GESTURES: [string, Gesture][] = [
		...REMOVALS,
		['a soft delete', () => softBackspace(focused())]
	];
	for (const [name, open, [path, from, to], emptied, typed] of ROWS)
		for (const source of [open, `${open}\n`])
			for (const mode of MODES)
				for (const [gesture, run] of GESTURES)
					it(`${name}${source === open ? '' : ', closed'}, ${gesture}, ${mode}`, async () => {
						const editor = await mountAt(source, mode, path, from, to);
						expect(await thenLetter(editor, run)).toEqual([emptied, typed]);
					});

	for (const source of ['zz\n\n```\npq', 'zz\n\n```\npq\n'])
		it.each(MODES)(
			`Enter at the end of ${JSON.stringify(source)} opens a line, %s`,
			async (mode) => {
				const editor = await mountAt(source, mode, [1], 6);
				const enter = () => pressHardwareKey(focused(), { key: 'Enter' });
				expect(await thenLetter(editor, enter)).toEqual([
					'zz\n\n```\npq\n\n',
					'zz\n\n```\npq\nx\n'
				]);
			}
		);

	// A composition takes the range away first, then commits where the emptied line stands.
	it('a composition over an unclosed code body’s last line, live', async () => {
		const editor = await mountAt('zz\n\n```\npq', 'live', [1], 4, 6);
		const compose = () => insertBy('composition', focused(), 'y');
		expect(await thenLetter(editor, compose)).toEqual(['zz\n\n```\ny\n', 'zz\n\n```\nyx\n']);
	});
});

// The step ends only a line the write left blank, never a line the block wrote back itself.
describe('a last line the write did not leave empty gets no second break', () => {
	it('a closed code block’s closing line deleted comes back once, and the letter lands above it', async () => {
		const editor = await mountAt('zz\n\n~~~\npq\n~~~', 'source', [1], 7, 10);
		expect(await thenLetter(editor, () => deleteBy(focused(), 'Delete'))).toEqual([
			'zz\n\n~~~\npq\n~~~',
			'zz\n\n~~~\npq\nx\n~~~'
		]);
	});

	it.each(MODES)('a last line left one space keeps its line, %s', async (mode) => {
		const editor = await mountAt('above\npq', mode, [0], 6, 8);
		const space = () => insertBy('hardware key', focused(), ' ');
		expect(await thenLetter(editor, space)).toEqual(['above\n \n', 'above\n x\n']);
	});
});

// A line break over the selection leaves what it leaves in the same file closed by a line break.
describe('a line break over the last paragraph’s whole text matches the closed file', () => {
	const BREAKS: [string, Gesture][] = [
		['Enter', () => pressHardwareKey(focused(), { key: 'Enter' })],
		['Shift+Enter', () => pressHardwareKey(focused(), { key: 'Enter', shiftKey: true })]
	];
	for (const mode of MODES)
		for (const [name, run] of BREAKS)
			it(`${name}, ${mode}`, async () => {
				const closed = await thenLetter(await mountAt('zz\n\nab\n', mode, [1], 0, 2), run);
				await destroyMountedEditors();
				expect(await thenLetter(await mountAt('zz\n\nab', mode, [1], 0, 2), run)).toEqual(closed);
			});
});

// The break is a blank paragraph's: an emptied block of any other kind keeps the file open.
describe('an emptied last block that is no paragraph adds no line break', () => {
	const ROWS: [string, string, PresentationMode, [number[], number, number], string, string][] = [
		['a heading', 'zz\n\n# ab', 'source', [[1], 2, 4], 'zz\n\n# ', 'zz\n\n# x'],
		['an item’s first line', 'zz\n\n- ab', 'live', [[1, 0, 0], 0, 2], 'zz\n\n- ', 'zz\n\n- x'],
		[
			'a code body',
			'zz\n\n```\nab\n```',
			'source',
			[[1], 4, 6],
			'zz\n\n```\n\n```',
			'zz\n\n```\nx\n```'
		]
	];
	for (const [name, source, mode, [path, from, to], emptied, typed] of ROWS)
		it(`${name}, ${mode}`, async () => {
			const editor = await mountAt(source, mode, path, from, to);
			const converges = !name.startsWith('an item');
			expect(await thenLetter(editor, () => deleteBy(focused(), 'Delete'), converges)).toEqual([
				emptied,
				typed
			]);
		});

	it.each(MODES)('a table’s last cell, %s', async (mode) => {
		const editor = mountCase('zz\n\n| a | b |\n| - | - |\n| c | d |', mode);
		await editor.settle();
		const cell = cellAt(editor, 1, 1, [1]);
		placeCaret(cell.querySelector<HTMLElement>('[contenteditable]') ?? cell, 1);
		await editor.settle();
		expect(await thenLetter(editor, () => deleteBy(focused(), 'Backspace'))).toEqual([
			'zz\n\n| a | b |\n| - | - |\n| c |  |',
			'zz\n\n| a | b |\n| - | - |\n| c | x |'
		]);
	});
});
