// @vitest-environment jsdom
// Reading mode refuses every cell edit and keeps navigation. The structural chords are refused by
// the command dispatch's own reading-mode check; the row-appending end of Tab and Enter is a
// navigation plan, so the keydown switch carries its own check.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { cellAt, installTableLayoutStubs, pressInCell } from './mount-table';
import { mountCell, type MountedCell } from './mount-cell';

let restoreLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedEditor | null = null;
let bareCell: MountedCell | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	if (bareCell) await bareCell.dispose();
	mounted = null;
	bareCell = null;
	document.body.innerHTML = '';
});

const GRID = '| A | B |\n| --- | --- |\n| one | 2 |\n';

function mountReading(): void {
	mounted = mountEditor({ source: GRID, presentationMode: 'reading' });
}

describe('a reading-mode cell refuses every mutation', () => {
	it('renders as non-editable', () => {
		mountReading();

		expect(cellAt(mounted!, 1, 0).getAttribute('contenteditable')).toBe('false');
	});

	it('swallows the delete-row chord', async () => {
		mountReading();

		await pressInCell(mounted!, 1, 0, { key: 'Backspace', ctrlKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(GRID);
	});

	it('swallows the insert-column chord', async () => {
		mountReading();

		await pressInCell(mounted!, 1, 0, { key: 'ArrowRight', altKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(GRID);
	});

	it('swallows the row-append Tab at the last cell', async () => {
		mountReading();

		await pressInCell(mounted!, 1, 1, { key: 'Tab' });

		expect(mounted!.source()).toBe(GRID);
	});

	it('drops a paste on the floor', async () => {
		mountReading();
		const el = cellAt(mounted!, 1, 0);
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
		mountReading();

		await pressInCell(mounted!, 1, 0, { key: 'Tab' });

		expect(document.activeElement).toBe(cellAt(mounted!, 1, 1));
	});

	it('lets an arrow move down a row', async () => {
		mountReading();

		await pressInCell(mounted!, 0, 0, { key: 'ArrowDown' });

		expect(document.activeElement).toBe(cellAt(mounted!, 1, 0));
	});
});

describe('the right-click menu clipboard refuses to mutate in reading mode', () => {
	/** A cell on its own: inside `mountTable` a cell's `blockEdit` is the table's own actions, so
	 *  a stub would record nothing and every refusal below would pass without the check. */
	function readingCell(): MountedCell {
		bareCell = mountCell('one', { presentationMode: () => 'reading' });
		return bareCell;
	}

	it('declines cut, which would write through the cell’s entry point', async () => {
		document.execCommand = vi.fn(() => true);
		const door = readingCell();

		await door.ref().applyMenuClipboard!('cut', { start: 0, end: 3 });

		expect(door.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('declines paste', async () => {
		// A clipboard that would answer: with none installed the read throws and the handler
		// returns early whether or not the check is there.
		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: async () => 'pasted' },
			configurable: true
		});
		const door = readingCell();

		await door.ref().applyMenuClipboard!('paste', { start: 0, end: 0 });

		expect(door.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('still allows copy, which mutates nothing', async () => {
		// The check is per action, not a blanket refusal, since a user must be able to copy out
		// of the table.
		const execCommand = vi.fn(() => true);
		document.execCommand = execCommand;

		await readingCell().ref().applyMenuClipboard!('copy', { start: 0, end: 3 });

		expect(execCommand).toHaveBeenCalledWith('copy');
	});
});
