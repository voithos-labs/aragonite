// @vitest-environment jsdom
//
// The consumer's `keybindings` prop reaching a table chord. The table's structural chords are
// keymap bindings, so an override reaches them; as predicates inside the cell's keydown plan,
// which runs before the keymap, an override would be resolved and never consulted. Driven
// through a mounted Editor with real keystrokes, since the override sits between the two and a
// unit test of either half alone cannot see it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
import { installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';
import { cellAt, pressInCell } from './mount-table';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

// 3 rows × 2 columns; row 0 is the header.
const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

function mountWith(keybindings: KeybindingOverride[]): void {
	mounted = mountEditor({ source: GRID, keybindings });
}

describe('a keybindings override reaches a table structural chord', () => {
	it('disables the insert-row chord', async () => {
		mountWith([{ kind: 'tableCell', chord: 'Mod+Enter', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'Enter', ctrlKey: true });

		expect(mounted!.source()).toBe(GRID);
	});

	it('rebinds the insert-row chord to a fresh one', async () => {
		mountWith([
			{ kind: 'tableCell', chord: 'Mod+Enter', command: null },
			{ kind: 'tableCell', chord: 'Mod+Shift+J', command: 'table.insertRowBelow' }
		]);

		await pressInCell(mounted!, 1, 0, { key: 'J', ctrlKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(`| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n`);
	});

	// An unchanged source alone cannot tell "disabled" from "did something else": with the binding
	// gone the navigation plan moves a cell, which also writes nothing, so each case names the caret.
	it('disables the delete-row chord, leaving the caret in its own cell', async () => {
		mountWith([{ kind: 'tableCell', chord: 'Mod+Shift+Backspace', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'Backspace', ctrlKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(GRID);
		// Backspace at offset 0 with no binding is the plan's move to another cell; the caret is
		// at the start of the pressed cell here, so it moves to the previous one.
		expect(document.activeElement).toBe(cellAt(mounted!, 0, 1));
	});

	// A disable with no `kind` must reach the cell too: an override is what this editor wants,
	// so it means the same wherever the chord resolves.
	it('honors a global-scope disable of the row-reorder chord', async () => {
		mountWith([{ chord: 'Alt+ArrowDown', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'ArrowDown', altKey: true });

		expect(mounted!.source()).toBe(GRID);
		// An unbound modified arrow navigates rather than doing nothing (see
		// cell-keydown-plan.ts), so the row is intact and the caret moved down a row.
		expect(document.activeElement).toBe(cellAt(mounted!, 2, 0));
	});

	// The other way round: an override for a different kind must not free the cell's chord,
	// or scoping by kind would mean nothing.
	it('leaves the chord alone when the override scopes another kind', async () => {
		mountWith([{ kind: 'paragraph', chord: 'Mod+Enter', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'Enter', ctrlKey: true });

		expect(mounted!.source()).toBe(`| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n`);
	});
});
