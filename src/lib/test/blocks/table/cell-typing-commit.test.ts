// @vitest-environment jsdom
// Every typed character in a cell goes through the cell's input write. A cell's raw is joined
// verbatim into its row, so an unescaped `|` in `cell.raw` reparses the row too wide and the parser
// silently drops the last column. Gestures that write their own bytes are in
// `cell-write-escape.test.ts`.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { metadataOf } from '#lib/core/nodes.js';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt } from './mount-table';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

/** Replace a cell's rendered text and fire the input the browser would. */
async function typeInto(rowIdx: number, colIdx: number, text: string): Promise<void> {
	const el = cellAt(mounted!, rowIdx, colIdx);
	el.focus();
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
	await mounted!.settle();
}

/** How many columns the committed document's table actually reparses to. */
function reparsedColumns(): number {
	const table = parse(mounted!.source()).children[0];
	return metadataOf(table, 'table').columnCount;
}

describe('a cell commits the bytes it was typed, escaped for its row', () => {
	it('escapes a typed pipe so the row keeps its column count', async () => {
		mounted = mountEditor({ source: GRID });

		await typeInto(1, 0, 'a|b');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| a\\|b | 2 |\n');
		expect(reparsedColumns()).toBe(2);
	});

	it('leaves text with no free pipe exactly as typed', async () => {
		// The escaping is not a blanket rewrite, so ordinary typing must arrive byte for byte.
		mounted = mountEditor({ source: GRID });

		await typeInto(1, 0, 'plain text');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| plain text | 2 |\n');
	});

	it('leaves an already-escaped pipe single-escaped', async () => {
		// The escape is idempotent over the whole raw; doubling it would render a
		// visible backslash and shift every caret past it.
		mounted = mountEditor({ source: GRID });

		await typeInto(1, 0, 'a\\|b');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| a\\|b | 2 |\n');
	});

	it('escapes every free pipe in one commit, not just the first', async () => {
		mounted = mountEditor({ source: GRID });

		await typeInto(1, 1, '|x|y|');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| 1 | \\|x\\|y\\| |\n');
		expect(reparsedColumns()).toBe(2);
	});

	it('commits a header cell through the same entry point', async () => {
		// The header row is the one whose cell count the delimiter must match, so a
		// leak there truncates the whole table rather than one row.
		mounted = mountEditor({ source: GRID });

		await typeInto(0, 0, 'H|dr');

		expect(mounted.source()).toBe('| H\\|dr | B |\n| --- | --- |\n| 1 | 2 |\n');
		expect(reparsedColumns()).toBe(2);
	});
});

describe('a composed (IME) cell edit commits once, through the same escape', () => {
	it('holds the commit until composition ends, then escapes the composed text', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 0);
		el.focus();

		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.textContent = 'x|y';
		el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
		await mounted.settle();
		// While a composition runs the document is untouched: the commit is suppressed.
		expect(mounted.source()).toBe(GRID);

		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		await mounted.settle();

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| x\\|y | 2 |\n');
	});
});
