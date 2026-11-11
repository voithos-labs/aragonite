// Every way the document's bytes get written, one row each, made on a mounted editor the way an
// author or a host makes it. The cost rows and the kept-starts rows both run this list, so a route
// added here is counted and checked in the same change.

import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { dispatchPaste, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { dispatchClipboardEvent, StubDataTransfer } from '#lib/test/harness/clipboard-events.js';
import {
	placeCaret,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

export type Mounted = MountedEditor<EditorTestSurface>;

export interface WriteRoute {
	name: string;
	/** A document of `n` top-level blocks. */
	source(n: number): string;
	/** Writes that come first and aren't the route's own. */
	setUp?(m: Mounted, n: number): Promise<void>;
	write(m: Mounted, n: number): Promise<void>;
	/** A text position by the write, whose byte a listener asks for after it. */
	asks(n: number): { path: number[]; offset: number };
	/** `whole`: the write names no blocks, so the next position read measures every one. */
	announces: 'exact' | 'whole';
	/** The write, or the range it starts from, asks positions itself: a reader with no listener. */
	readsItself?: true;
	/** The range edit lays out its answer, a parse of the whole document, to find its caret
	 *  (`range-edit/edit-range.ts :: answerOf`), so it measures every block of that parse. */
	laysOutItsAnswer?: true;
}

/** The block every route writes at, far enough down that blocks stand on both sides. */
const AT = 3;

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('\n');
const withList = (n: number) => paragraphs(n).replace(`line ${AT}\n`, '- item\n');
const withBlock = (block: string) => (n: number) => paragraphs(n).replace(`line ${AT}\n`, block);
const QUOTED = [AT, 0];
const NESTED = [AT, 0, 1, 0, 0];

async function typeLetter(m: Mounted, path: number[]): Promise<void> {
	const el = surfaceAt(m, path);
	typeInto(el, el.textContent + 'x');
	await m.settle();
}

/** A range the editor holds, from inside the text at `from` to inside the text at `to`. */
async function holdRange(m: Mounted, from: number[], to: number[]): Promise<void> {
	await m.instance.setSelection({
		anchor: { path: from, offset: 2 },
		focus: { path: to, offset: 2 }
	});
	await m.settle();
}

async function history(m: Mounted, command: 'history.undo' | 'history.redo'): Promise<void> {
	m.instance.runCommand(command);
	await m.settle();
}

export const WRITE_ROUTES: WriteRoute[] = [
	{
		name: 'a letter in a top-level paragraph',
		source: paragraphs,
		write: (m) => typeLetter(m, [AT]),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'a letter in a list item',
		source: withList,
		write: (m) => typeLetter(m, [AT, 0, 0]),
		asks: () => ({ path: [AT, 0, 0], offset: 0 }),
		announces: 'exact'
	},
	// The second letter of a burst writes in place, its containers the same nodes with new bytes.
	{
		name: 'a second letter in a quoted paragraph, every line ending CRLF',
		source: (n) => withBlock('> alpha\n> beta\n')(n).replace(/\n/g, '\r\n'),
		setUp: (m) => typeLetter(m, QUOTED),
		write: (m) => typeLetter(m, QUOTED),
		asks: () => ({ path: QUOTED, offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'a second letter in an item nested under a tab',
		source: withBlock('- a\n\t- bc\n\n    d\n'),
		setUp: (m) => typeLetter(m, NESTED),
		write: (m) => typeLetter(m, NESTED),
		asks: () => ({ path: NESTED, offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'a letter in the last block of a document with no final line break',
		source: (n) => paragraphs(n).slice(0, -1),
		write: (m, n) => typeLetter(m, [n - 1]),
		asks: (n) => ({ path: [n - 1], offset: 0 }),
		announces: 'exact'
	},
	// The fix-up splices the document's list to give the filled paragraph its blank line back.
	{
		name: 'a letter into the empty paragraph an Enter left',
		source: paragraphs,
		setUp: async (m) => void (await pressKeyAt(m, [AT], 6, { key: 'Enter' })),
		write: (m) => typeLetter(m, [AT + 1]),
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'whole'
	},
	// The list reads its bytes again and the item's second paragraph becomes a top-level block.
	{
		name: 'a space typed in a list item whose second paragraph then leaves the list',
		source: withBlock('- ab\n\n  b\n'),
		async write(m) {
			const el = surfaceAt(m, [AT, 0, 0]);
			typeInto(el, ' ' + el.textContent);
			await m.settle();
		},
		asks: () => ({ path: [AT - 1], offset: 0 }),
		announces: 'whole'
	},
	{
		name: 'Enter in a paragraph',
		source: paragraphs,
		write: async (m) => void (await pressKeyAt(m, [AT], 2, { key: 'Enter' })),
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'Enter right after a typed letter',
		source: paragraphs,
		setUp: (m) => typeLetter(m, [AT]),
		write: async (m) => void (await pressKey(surfaceAt(m, [AT]), { key: 'Enter' })),
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'Enter in a list item, a commit over the list alone',
		source: withBlock('- item\n- two\n'),
		write: async (m) => void (await pressKeyAt(m, [AT, 0, 0], 2, { key: 'Enter' })),
		asks: () => ({ path: [AT, 0, 0], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'Backspace joining two paragraphs',
		source: paragraphs,
		write: async (m) => void (await pressKeyAt(m, [AT + 1], 0, { key: 'Backspace' })),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'Backspace taking back an Enter of the same undo entry',
		source: paragraphs,
		setUp: async (m) => void (await pressKeyAt(m, [AT], 6, { key: 'Enter' })),
		write: async (m) => void (await pressKey(surfaceAt(m, [AT + 1]), { key: 'Backspace' })),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'a format toggle over a range across blocks',
		source: paragraphs,
		setUp: (m) => holdRange(m, [AT], [AT + 2]),
		async write(m) {
			m.instance.runCommand('format.toggleStrong');
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true
	},
	// The toggle writes the document's list and the list's own, two scopes in one commit.
	{
		name: 'a format toggle over a range from a paragraph into a list item',
		source: withList,
		setUp: (m) => holdRange(m, [AT - 1], [AT, 0, 0]),
		async write(m) {
			m.instance.runCommand('format.toggleStrong');
			await m.settle();
		},
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'whole',
		readsItself: true
	},
	// The quote's heading becomes a paragraph, so the quote runs on into the line under it and the
	// two top-level blocks become one.
	{
		name: 'a heading in a quote typed into a paragraph, the quote taking in the block below',
		source: (n) => withBlock('> a\n> # h\n')(n).replace('# h\n\n', '# h\n'),
		async write(m) {
			typeInto(surfaceAt(m, [AT, 1]), 'h');
			await m.settle();
		},
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'whole'
	},
	{
		name: 'a paragraph typed into a heading',
		source: paragraphs,
		async write(m) {
			const el = surfaceAt(m, [AT]);
			typeInto(el, '# ' + el.textContent);
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 2 }),
		announces: 'exact'
	},
	{
		name: 'a heading typed right after a letter, in the letter’s undo entry',
		source: paragraphs,
		setUp: (m) => typeLetter(m, [AT]),
		async write(m) {
			const el = surfaceAt(m, [AT]);
			typeInto(el, '# ' + el.textContent);
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 2 }),
		announces: 'exact'
	},
	{
		name: 'a byte splice inside one block',
		source: paragraphs,
		async write(m) {
			const before = m.source();
			const at = before.indexOf(`line ${AT}`);
			await m.instance.__test.spliceSource(
				before.slice(0, at) + 'X' + before.slice(at),
				{ at: at + 1, holds: 'text' },
				{ kind: 'paste', detail: { count: 1 } }
			);
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true
	},
	// The draft maps its ranges through `change-record.ts :: partLengths`, a sum of every block that
	// no counter sees yet.
	{
		name: 'a draft writing in two blocks far apart',
		source: paragraphs,
		async write(m, n) {
			const before = m.source();
			const draft = m.instance.edit();
			for (const i of [AT, n - 2]) {
				const at = before.indexOf(`line ${i}\n`);
				draft.replace({ from: at, to: at }, 'X');
			}
			await draft.commit();
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true
	},
	{
		name: 'Backspace over a range the editor holds across blocks',
		source: paragraphs,
		setUp: (m) => holdRange(m, [AT], [AT + 2]),
		write: async (m) => void (await pressKey(surfaceAt(m, [AT]), { key: 'Backspace' })),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true,
		laysOutItsAnswer: true
	},
	{
		name: 'a letter typed over a range the editor holds across blocks',
		source: paragraphs,
		setUp: (m) => holdRange(m, [AT], [AT + 2]),
		async write(m) {
			await pressHardwareKey(surfaceAt(m, [AT]), { key: 'x' });
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true,
		laysOutItsAnswer: true
	},
	// Two writes in one undo entry: the removal's splice, then the paste's commit, whose undo
	// snapshot is the document from before both.
	{
		name: 'a paste over a range the editor holds across blocks',
		source: paragraphs,
		setUp: (m) => holdRange(m, [AT], [AT + 2]),
		async write(m) {
			dispatchPaste(surfaceAt(m, [AT]), 'pasted');
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true,
		laysOutItsAnswer: true
	},
	{
		name: 'a cut of a range the editor holds across blocks',
		source: paragraphs,
		setUp: (m) => holdRange(m, [AT], [AT + 2]),
		async write(m) {
			dispatchClipboardEvent(surfaceAt(m, [AT]), 'cut', new StubDataTransfer());
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true,
		laysOutItsAnswer: true
	},
	{
		name: 'Backspace at the top of an empty fence, which removes the block whole',
		source: withBlock('```\n```\n'),
		async write(m) {
			const el = surfaceAt(m, [AT]);
			placeCaret(el, 0);
			await pressKey(el, { key: 'Backspace' });
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact',
		readsItself: true,
		laysOutItsAnswer: true
	},
	{
		name: 'undo',
		source: paragraphs,
		setUp: (m) => typeLetter(m, [AT]),
		write: (m) => history(m, 'history.undo'),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'undo of an Enter, which takes a block out',
		source: paragraphs,
		setUp: async (m) => void (await pressKeyAt(m, [AT], 2, { key: 'Enter' })),
		write: (m) => history(m, 'history.undo'),
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'redo',
		source: paragraphs,
		async setUp(m) {
			await typeLetter(m, [AT]);
			await history(m, 'history.undo');
		},
		write: (m) => history(m, 'history.redo'),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'the source prop swapped for another document',
		source: paragraphs,
		async write(m, n) {
			m.props.source = paragraphs(n).replace(`line ${AT}\n`, `swapped ${AT}\n`);
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'whole'
	}
];
