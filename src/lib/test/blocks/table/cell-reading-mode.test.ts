// @vitest-environment jsdom
// Reading mode refuses every cell edit and keeps navigation. The structural chords are refused by
// the command dispatch's own reading-mode check; the row-appending end of Tab and Enter is a
// navigation plan, so the keydown switch carries its own check.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { EditorTestSurface } from '#lib/components/editor-root-test-surface.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { cellAt, installTableLayoutStubs, pressInCell } from './mount-table';

let restoreLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreLayout = installTableLayoutStubs();
	return () => restoreLayout();
});

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
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

// The menu never opens in reading mode; forced, its cut and paste reach the write, which refuses.
// Miss-analysis: the handler's own reading-mode check was the only thing tested, never the write's.
describe('the right-click menu clipboard in reading mode', () => {
	function readingCellRef(): BlockComponent {
		mountReading();
		return (mounted!.instance.__test as EditorTestSurface).getBlockComponent([0, 1, 0])!;
	}

	function readingWrites(): string[] {
		return takeDevWarns()
			.filter((w) => w.tag === READING_WRITE_TAG)
			.map((w) => w.tag);
	}

	it.each([
		['source', true],
		['reading', false]
	] as const)('in %s mode, the menu key opens the menu: %s', async (presentationMode, opens) => {
		mounted = mountEditor({ source: GRID, presentationMode });
		const cell = cellAt(mounted, 1, 0);
		cell.focus();

		const pressed = await pressKey(cell, { key: 'F10', shiftKey: true });

		expect(pressed.defaultPrevented).toBe(opens);
		expect(document.querySelector('[role="menu"]') !== null).toBe(opens);
	});

	it('forced to cut, writes nothing and warns', async () => {
		document.execCommand = vi.fn(() => true);

		await readingCellRef().applyMenuClipboard!('cut', { start: 0, end: 3 });
		await mounted!.settle();

		expect(mounted!.source()).toBe(GRID);
		expect(readingWrites()).toEqual([READING_WRITE_TAG]);
	});

	it('forced to paste, writes nothing and warns', async () => {
		// A clipboard that answers: with none installed the read throws and nothing is written anyway.
		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: async () => 'pasted' },
			configurable: true
		});

		await readingCellRef().applyMenuClipboard!('paste', { start: 0, end: 0 });
		await mounted!.settle();

		expect(mounted!.source()).toBe(GRID);
		expect(readingWrites()).toEqual([READING_WRITE_TAG]);
	});

	it('still allows copy, which mutates nothing', async () => {
		// The check is per action, not a blanket refusal, since a user must be able to copy out
		// of the table.
		const execCommand = vi.fn(() => true);
		document.execCommand = execCommand;

		await readingCellRef().applyMenuClipboard!('copy', { start: 0, end: 3 });

		expect(execCommand).toHaveBeenCalledWith('copy');
	});
});
