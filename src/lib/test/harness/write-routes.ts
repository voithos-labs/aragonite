// Every way the document's bytes get written, one row each, made on a mounted editor the way an
// author or a host makes it. The cost rows and the kept-starts rows both run this list, so a route
// added here is counted and checked in the same change.

import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
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
}

/** The block every route writes at, far enough down that blocks stand on both sides. */
const AT = 3;

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('\n');
const withList = (n: number) => paragraphs(n).replace(`line ${AT}\n`, '- item\n');

async function typeLetter(m: Mounted, path: number[]): Promise<void> {
	const el = surfaceAt(m, path);
	typeInto(el, el.textContent + 'x');
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
	{
		name: 'a letter in the last block of a document with no final line break',
		source: (n) => paragraphs(n).slice(0, -1),
		write: (m, n) => typeLetter(m, [n - 1]),
		asks: (n) => ({ path: [n - 1], offset: 0 }),
		announces: 'exact'
	},
	{
		name: 'Enter in a paragraph',
		source: paragraphs,
		write: async (m) => void (await pressKeyAt(m, [AT], 2, { key: 'Enter' })),
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'whole'
	},
	{
		name: 'Enter right after a typed letter',
		source: paragraphs,
		setUp: (m) => typeLetter(m, [AT]),
		write: async (m) => void (await pressKey(surfaceAt(m, [AT]), { key: 'Enter' })),
		asks: () => ({ path: [AT + 1], offset: 0 }),
		announces: 'whole'
	},
	{
		name: 'Backspace joining two paragraphs',
		source: paragraphs,
		write: async (m) => void (await pressKeyAt(m, [AT + 1], 0, { key: 'Backspace' })),
		asks: () => ({ path: [AT], offset: 0 }),
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
		announces: 'whole'
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
		announces: 'whole'
	},
	{
		name: 'a byte splice in two blocks far apart',
		source: paragraphs,
		async write(m, n) {
			const before = m.source();
			const after = before
				.replace(`line ${AT}\n`, `Xline ${AT}\n`)
				.replace(`line ${n - 2}\n`, `Xline ${n - 2}\n`);
			await m.instance.__test.spliceSource(
				after,
				{ at: after.indexOf(`Xline ${AT}`) + 1, holds: 'text' },
				{ kind: 'paste', detail: { count: 1 } }
			);
			await m.settle();
		},
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'whole'
	},
	{
		name: 'undo',
		source: paragraphs,
		setUp: (m) => typeLetter(m, [AT]),
		write: (m) => history(m, 'history.undo'),
		asks: () => ({ path: [AT], offset: 0 }),
		announces: 'whole'
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
		announces: 'whole'
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
