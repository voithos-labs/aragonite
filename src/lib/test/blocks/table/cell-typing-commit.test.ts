// @vitest-environment jsdom
//
// The cell's plain-typing commit funnel, end to end. A cell's raw is joined
// verbatim into its row, so a `|` that reaches `cell.raw` unescaped reparses the
// row wider than the delimiter's column count and the parser truncates — the last
// column's content is deleted, silently.
//
// `cell-write-escape.test.ts` drives the three gestures that compute their own
// bytes; the funnel every keystroke uses (`commitInput` — the one allowlisted
// caller in G4.20) had no test. Driven here through a mounted Editor and asserted
// on the document's bytes, so nothing between the keystroke and the file is
// stubbed: DOM readback, the cell's write door, the kind's escape at the sink,
// and the row and table rebuilds all have to agree.
//
// Typing is simulated the way the browser delivers it — the contenteditable's
// text is replaced, then `input` fires. That IS what the funnel receives; a
// per-character `keydown` cycle would prove nothing extra, since the cell reads
// the DOM rather than the event.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { metadataOf } from '$lib/core/nodes';
import { blockHostAt, installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

function cell(rowIdx: number, colIdx: number): HTMLElement {
	const table = blockHostAt(mounted!, [0]);
	const row = table.querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

/** Replace a cell's rendered text and fire the input the browser would. */
async function typeInto(rowIdx: number, colIdx: number, text: string): Promise<void> {
	const el = cell(rowIdx, colIdx);
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
		// Non-vacuity: the sink is not a blanket rewrite, so ordinary typing must
		// arrive byte-for-byte.
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

	it('commits a header cell through the same door', async () => {
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
		const el = cell(1, 0);
		el.focus();

		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.textContent = 'x|y';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await mounted.settle();
		// Mid-composition the document is untouched — the funnel is suppressed.
		expect(mounted.source()).toBe(GRID);

		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		await mounted.settle();

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| x\\|y | 2 |\n');
	});
});
