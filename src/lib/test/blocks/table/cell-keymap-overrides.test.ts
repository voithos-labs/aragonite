// @vitest-environment jsdom
//
// The consumer `keybindings` prop reaching a table chord. Before the migration the table's
// structural chords were predicates in the cell's keydown plan, which ran before the keymap, so
// an override was resolved and then never consulted — the guide had to carve the whole Tables
// family out of its rebindability promise. Driven through a mounted Editor with real keystrokes:
// the override tier lives between the two, and a unit test of either half alone cannot see it.
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
	// gone the navigation plan hops a cell, which also writes nothing — so each arm names the caret.
	it('disables the delete-row chord, leaving the caret in its own cell', async () => {
		mountWith([{ kind: 'tableCell', chord: 'Mod+Shift+Backspace', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'Backspace', ctrlKey: true, shiftKey: true });

		expect(mounted!.source()).toBe(GRID);
		// Backspace at offset 0 with no binding is the plan's cell hop; the caret is at
		// the start of the pressed cell here, so the plan hops it to the previous one.
		expect(document.activeElement).toBe(cellAt(mounted!, 0, 1));
	});

	// A global-scope disable (no `kind`) must reach the cell too: the override tier is
	// per-instance intent, so it means the same at every scope the chord resolves in.
	it('honors a global-scope disable of the row-reorder chord', async () => {
		mountWith([{ chord: 'Alt+ArrowDown', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'ArrowDown', altKey: true });

		expect(mounted!.source()).toBe(GRID);
		// The unbound modified arrow navigates rather than no-op'ing (see
		// cell-keydown-plan.ts) — so the row is intact AND the caret moved down a row.
		expect(document.activeElement).toBe(cellAt(mounted!, 2, 0));
	});

	// Contrapositive: an override for a DIFFERENT kind must not free the cell's chord,
	// or "scoping by kind" would be decorative.
	it('leaves the chord alone when the override scopes another kind', async () => {
		mountWith([{ kind: 'paragraph', chord: 'Mod+Enter', command: null }]);

		await pressInCell(mounted!, 1, 0, { key: 'Enter', ctrlKey: true });

		expect(mounted!.source()).toBe(`| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n`);
	});
});
