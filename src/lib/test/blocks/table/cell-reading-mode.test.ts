// @vitest-environment jsdom
//
// Reading mode makes a cell inert without making it dead: navigation still
// works, so a reader can walk the grid, and every mutation is refused. The cell
// carries that split ITSELF, in the default arm of its keydown switch — the
// keymap gate `reading-gate-parity` scans for cannot see it, because the cell's
// structural chords never reach the command seam.
//
// One test per side of the split, because it is exactly the shape that rots:
// a refusal added without its navigation twin makes reading mode a dead end,
// and a gate dropped makes it editable.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { blockHostAt, installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';
import { installTableLayoutStubs, mountTable, type MountedTable } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedEditor | null = null;
let table: MountedTable | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	if (table) await table.dispose();
	mounted = null;
	table = null;
	document.body.innerHTML = '';
});

const GRID = '| A | B |\n| --- | --- |\n| one | 2 |\n';

function cell(rowIdx: number, colIdx: number): HTMLElement {
	const host = blockHostAt(mounted!, [0]);
	const row = host.querySelector(`[data-table-row-idx="${rowIdx}"]`);
	const found = row?.querySelectorAll(':scope > .table-cell')[colIdx] as HTMLElement | undefined;
	if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
	return found;
}

async function pressInCell(rowIdx: number, colIdx: number, init: KeyboardEventInit): Promise<void> {
	const el = cell(rowIdx, colIdx);
	el.focus();
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	await mounted!.settle();
}

function mountReading(): void {
	mounted = mountEditor({ source: GRID, presentationMode: 'reading' });
}

describe('a reading-mode cell refuses every mutation', () => {
	it('renders as non-editable', () => {
		mountReading();

		expect(cell(1, 0).getAttribute('contenteditable')).toBe('false');
	});

	it('swallows the delete-row chord', async () => {
		mountReading();

		await pressInCell(1, 0, { key: 'Backspace', ctrlKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(GRID);
	});

	it('swallows the insert-column chord', async () => {
		mountReading();

		await pressInCell(1, 0, { key: 'ArrowRight', altKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(GRID);
	});

	it('swallows the row-append Tab at the last cell', async () => {
		mountReading();

		await pressInCell(1, 1, { key: 'Tab' });

		expect(mounted!.source()).toBe(GRID);
	});

	it('drops a paste on the floor', async () => {
		mountReading();
		const el = cell(1, 0);
		el.focus();
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', {
			value: { getData: () => 'pasted', setData: () => {} }
		});
		el.dispatchEvent(event);
		await mounted!.settle();

		expect(mounted!.source()).toBe(GRID);
	});
});

describe('a reading-mode cell still navigates', () => {
	it('lets Tab move to the next cell', async () => {
		// The other side of the same switch arm: reading mode keeps 'focus-cell'
		// and 'exit', so the grid stays walkable.
		mountReading();

		await pressInCell(1, 0, { key: 'Tab' });

		expect(document.activeElement).toBe(cell(1, 1));
	});

	it('lets an arrow move down a row', async () => {
		mountReading();

		await pressInCell(0, 0, { key: 'ArrowDown' });

		expect(document.activeElement).toBe(cell(1, 0));
	});
});

describe('the right-click menu clipboard refuses to mutate in reading mode', () => {
	/** The cell's published component, the object TableBlock's menu calls into. */
	function cellRef(rowIdx: number, colIdx: number, blockEdit: BlockEditActions) {
		table = mountTable(GRID, { blockEdit, policies: { presentationMode: () => 'reading' } });
		return table.block.getBlockComponentByPath!([rowIdx, colIdx])!;
	}

	it('declines cut, which would write through the cell’s door', async () => {
		const blockEdit = makeStubBlockEdit();
		document.execCommand = vi.fn(() => true);

		await cellRef(1, 0, blockEdit).applyMenuClipboard!('cut', { start: 0, end: 3 });

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('declines paste', async () => {
		const blockEdit = makeStubBlockEdit();

		await cellRef(1, 0, blockEdit).applyMenuClipboard!('paste', { start: 0, end: 0 });

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('still allows copy, which mutates nothing', async () => {
		// Contrapositive: the gate is action-shaped, not a blanket refusal — a
		// reader must be able to copy out of the table.
		const blockEdit = makeStubBlockEdit();
		const execCommand = vi.fn(() => true);
		document.execCommand = execCommand;

		await cellRef(1, 0, blockEdit).applyMenuClipboard!('copy', { start: 0, end: 3 });

		expect(execCommand).toHaveBeenCalledWith('copy');
	});
});
