// @vitest-environment jsdom
// Where a paste dropped on a cell ends up: through the cell's paste handler, the dispatcher and
// the handling registered for `tableCell`. Either failure breaks the table silently: the generic
// inline handling taking the paste, or a pasted newline reaching `cell.raw`.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { metadataOf } from '#lib/core/nodes.js';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt } from './mount-table';
import { pressKey } from '#lib/test/harness/settle.js';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const GRID = '| A | B |\n| --- | --- |\n| one | 2 |\n';

/** jsdom builds no ClipboardEvent, so the payload travels on a real dispatched event. */
async function pasteInto(el: HTMLElement, text: string): Promise<void> {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types: ['text/plain'],
			getData: (type: string) => (type === 'text/plain' ? text : ''),
			setData: () => {}
		}
	});
	el.dispatchEvent(event);
	await mounted!.settle();
}

/** Select `[start, end)` of the cell's rendered text, the way a drag would. */
function selectInCell(el: HTMLElement, start: number, end: number): void {
	el.focus();
	const textNode = el.firstChild;
	if (!textNode) throw new Error('cell has no rendered text to select');
	const range = document.createRange();
	range.setStart(textNode, start);
	range.setEnd(textNode, end);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** Collapsed caret past the cell's last character. */
function caretAtCellEnd(el: HTMLElement): void {
	const length = el.firstChild?.textContent?.length ?? 0;
	selectInCell(el, length, length);
}

function reparsedColumns(): number {
	return metadataOf(parse(mounted!.source()).children[0], 'table').columnCount;
}

describe('a paste into a cell lands on the cell’s own paste surface', () => {
	it('escapes a pasted pipe, so the row keeps its column count', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 0);
		caretAtCellEnd(el);

		await pasteInto(el, 'a|b|c');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| onea\\|b\\|c | 2 |\n');
		expect(reparsedColumns()).toBe(2);
	});

	it('collapses a multi-line paste to one line', async () => {
		// A raw newline in `cell.raw` splits the row's bytes in two, so the lines are
		// joined with spaces rather than let through.
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 0);
		selectInCell(el, 0, 3);

		await pasteInto(el, 'first\nsecond\nthird');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| first second third | 2 |\n');
	});

	it('trims the pasted run rather than padding the cell', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 1);
		selectInCell(el, 0, 1);

		await pasteInto(el, '  spaced  \n');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| one | spaced |\n');
	});

	it('replaces the cell’s selected range instead of inserting beside it', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 0);
		selectInCell(el, 0, 3);

		await pasteInto(el, 'two');

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| two | 2 |\n');
	});

	// Miss-analysis: the grid parser was unit-tested alone and the fill by e2e, so nothing below a
	// browser showed that a cell sends a pasted grid to the table instead of into its own text.
	it.each([
		['tab-separated rows', 'p\tq\ns\tt\n'],
		['a GFM table', '| p | q |\n| --- | --- |\n| s | t |\n']
	])('fills %s from the caret’s cell and grows the table, in one undo', async (_name, clip) => {
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 1);
		caretAtCellEnd(el);

		await pasteInto(el, clip);

		expect(mounted.source()).toBe(
			'| A | B |  |\n| --- | --- | --- |\n| one | p | q |\n|  | s | t |\n'
		);

		await pressKey(cellAt(mounted!, 1, 1), { key: 'z', ctrlKey: true });
		expect(mounted.source()).toBe(GRID);
	});

	it('ignores an empty clipboard rather than committing a no-op edit', async () => {
		mounted = mountEditor({ source: GRID });
		const el = cellAt(mounted!, 1, 0);
		el.focus();

		await pasteInto(el, '');

		expect(mounted.source()).toBe(GRID);
	});
});

// Miss-analysis: what a cell makes of a clipboard was held through the dispatcher the range-edit
// core replaced, over a stubbed write, so no row read the cell's own answer or the op it names.
describe('what a cell makes of a clipboard, and the op an `edit` listener hears', () => {
	async function pasted(clip: string): Promise<{ source: string; ops: unknown[] }> {
		mounted = mountEditor({ source: GRID });
		const ops: unknown[] = [];
		mounted.instance.getEvents().on('edit', (event) => ops.push([event.op, event.detail]));
		const el = cellAt(mounted!, 1, 0);
		caretAtCellEnd(el);
		await pasteInto(el, clip);
		return { source: mounted.source(), ops };
	}

	it('keeps text a copy wrapped in blank lines on the cell’s line, a paste of no blocks', async () => {
		const { source, ops } = await pasted('  \nhello\nworld\n  ');
		expect(parse(source).children.map((block) => block.kind)).toEqual(['table']);
		expect(source).toContain('hello world |');
		expect(ops).toEqual([['paste', { count: 0 }]]);
	});

	it.each([
		['two paragraphs', 'a\n\nb\n', 2],
		['one block that is no paragraph, wrapped in blank lines', '  \n# Hello\n  ', 1]
	])('slices the table for %s, a paste of that many blocks', async (_name, clip, count) => {
		const { source, ops } = await pasted(clip);
		expect(parse(source).children.map((block) => block.kind)).not.toEqual(['table']);
		expect(ops).toEqual([['paste', { count }]]);
	});

	it('fills cells from a grid as `tablePasteGrid`', async () => {
		const { ops } = await pasted('p\tq');
		expect(ops).toEqual([['tablePasteGrid', { rowIdx: 1, colIdx: 0, rows: 1, cols: 2 }]]);
	});
});
