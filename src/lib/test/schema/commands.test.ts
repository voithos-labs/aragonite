import { describe, it, expect, vi } from 'vitest';
import {
	getCommand,
	GLOBAL_KEYMAP,
	resolveBinding,
	resolveKindBinding
} from '$lib/schema/commands';
import { dispatchKeyCommand } from '$lib/schema/block-commands';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

describe('global command registry', () => {
	it('registers undo/redo and runs them via the context', () => {
		const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
		getCommand('history.undo')!({ history });
		getCommand('history.redo')!({ history });
		expect(history.requestUndo).toHaveBeenCalledOnce();
		expect(history.requestRedo).toHaveBeenCalledOnce();
	});
	it('global keymap binds undo/redo chords', () => {
		expect(GLOBAL_KEYMAP.find((b) => b.chord === 'Mod+Z')?.command).toBe('history.undo');
		expect(GLOBAL_KEYMAP.find((b) => b.chord === 'Mod+Y')?.command).toBe('history.redo');
		expect(GLOBAL_KEYMAP.find((b) => b.chord === 'Mod+Shift+Z')?.command).toBe('history.redo');
	});
});

describe('dispatchKeyCommand', () => {
	const ctx = { history: { requestUndo: vi.fn(), requestRedo: vi.fn() } };
	it('routes a global chord to the global command (no runCommand call)', () => {
		const runCommand = vi.fn(() => true);
		expect(dispatchKeyCommand('Mod+Z', { kind: 'paragraph', runCommand }, ctx)).toBe(true);
		expect(runCommand).not.toHaveBeenCalled();
		expect(ctx.history.requestUndo).toHaveBeenCalled();
	});
	it('routes an unmatched chord to neither and returns false', () => {
		const runCommand = vi.fn(() => true);
		expect(dispatchKeyCommand('Mod+Q', { kind: 'paragraph', runCommand }, ctx)).toBe(false);
		expect(runCommand).not.toHaveBeenCalled();
	});
	it('routes a block-local chord to runCommand, forwarding the binding arg', () => {
		const real = tryGetBlockKindDescriptor('paragraph')!;
		const runCommand = vi.fn(() => true);
		try {
			augmentBuiltin('paragraph', {
				keymap: [
					{ chord: 'Mod+B', command: 'format.toggleStrong' },
					{ chord: 'Mod+3', command: 'heading.cycle', arg: 3 }
				]
			});
			expect(dispatchKeyCommand('Mod+B', { kind: 'paragraph', runCommand }, ctx)).toBe(true);
			expect(runCommand).toHaveBeenCalledWith('format.toggleStrong', undefined);
			expect(dispatchKeyCommand('Mod+3', { kind: 'paragraph', runCommand }, ctx)).toBe(true);
			expect(runCommand).toHaveBeenLastCalledWith('heading.cycle', 3);
		} finally {
			augmentBuiltin('paragraph', { keymap: real.keymap });
		}
	});
});

describe('resolveBinding order', () => {
	it('per-kind binding shadows the global table, falls through otherwise', () => {
		const real = tryGetBlockKindDescriptor('paragraph')!;
		try {
			augmentBuiltin('paragraph', {
				keymap: [{ chord: 'Mod+Z', command: 'block.split' }]
			});
			expect(resolveBinding('Mod+Z', 'paragraph')?.command).toBe('block.split');
		} finally {
			augmentBuiltin('paragraph', { keymap: real.keymap });
		}
		// fencedCode doesn't bind Mod+Z → falls through to the global table
		expect(resolveBinding('Mod+Z', 'fencedCode')?.command).toBe('history.undo');
	});
});

describe('resolveKindBinding (no global fallthrough)', () => {
	// Container bubble handlers use kind-only resolution so they never re-handle
	// global commands the focused leaf already owns — the double-undo regression.
	it('resolves a kind binding but never a global one', () => {
		expect(resolveKindBinding('Enter', 'paragraph')?.command).toBe('block.split');
		expect(resolveKindBinding('Tab', 'listItem')?.command).toBe('list.indent');
		expect(resolveKindBinding('Mod+Z', 'paragraph')).toBeNull();
		expect(resolveKindBinding('Mod+Z', 'listItem')).toBeNull();
	});
});

describe('fencedCode keymap', () => {
	// CodeBlock's transformative keydown branches each map to a code-specific
	// command; Backspace/Delete are fence-exit / pair-delete, not block merges,
	// so they get their own ids rather than reusing block.mergePrev/mergeNext.
	const FENCED_CODE_BINDINGS = [
		['Enter', 'code.newline'],
		['Tab', 'code.indent'],
		['Shift+Tab', 'code.dedent'],
		['Backspace', 'code.backspace'],
		['Delete', 'code.delete'],
		// Keyboard reorder parity with prose: the drag handle promises Alt+↑/↓.
		['Alt+ArrowUp', 'block.moveUp'],
		['Alt+ArrowDown', 'block.moveDown'],
		['Mod+B', 'format.toggleStrong'],
		['Mod+I', 'format.toggleEmphasis']
	] as const;

	it('resolves each transformative chord to its command', () => {
		for (const [chord, command] of FENCED_CODE_BINDINGS) {
			expect(resolveBinding(chord, 'fencedCode')?.command).toBe(command);
		}
	});
});

describe('tableCell keymap — the table’s whole keyboard vocabulary', () => {
	// The cell is the surface that holds the caret, so every table chord binds on THIS
	// kind; an override scoped to `table` would resolve against a block that never
	// receives a keystroke. Behavior is pinned in blocks/table/cell-table-chords.test.ts —
	// this is the resolution the consumer guide's Tables family is checked against.
	const TABLE_CELL_BINDINGS = [
		['Mod+Enter', 'table.insertRowBelow'],
		['Mod+Shift+Enter', 'table.insertRowAbove'],
		['Alt+Shift+ArrowRight', 'table.insertColumnRight'],
		['Alt+Shift+ArrowLeft', 'table.insertColumnLeft'],
		['Mod+Shift+Backspace', 'table.deleteRow'],
		['Alt+Shift+Backspace', 'table.deleteColumn'],
		['Alt+ArrowUp', 'table.moveRowUp'],
		['Alt+ArrowDown', 'table.moveRowDown'],
		['Alt+ArrowLeft', 'table.moveColumnLeft'],
		['Alt+ArrowRight', 'table.moveColumnRight'],
		['Mod+Shift+A', 'table.cycleAlignment'],
		// Alt+Arrow is the row reorder here, so the whole-block move takes Mod+Alt.
		['Mod+Alt+ArrowUp', 'block.moveUp'],
		['Mod+Alt+ArrowDown', 'block.moveDown'],
		['Enter', 'cell.enter'],
		['Tab', 'cell.tab'],
		['Shift+Tab', 'cell.shiftTab']
	] as const;

	it('resolves each chord to its command', () => {
		for (const [chord, command] of TABLE_CELL_BINDINGS) {
			expect(resolveBinding(chord, 'tableCell')?.command, chord).toBe(command);
		}
	});

	it('leaves the bare arrows and Mod+A unbound — both depend on the caret’s position', () => {
		// Cell navigation and the three-stage select-all read where the caret sits inside
		// the cell, which a chord cannot express, so they stay with the keydown plan.
		for (const chord of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
			expect(resolveBinding(chord, 'tableCell'), chord).toBeNull();
		}
		expect(resolveBinding('Mod+A', 'tableCell')).toBeNull();
	});

	it('binds the whole-table move on the table’s CHILD kind, not the table', () => {
		// The table block never holds the caret; a chord resolved against it is dead.
		expect(resolveBinding('Mod+Alt+ArrowUp', 'table')).toBeNull();
	});
});

describe('thematicBreak keymap — keyboard reorder', () => {
	// The hr renders a drag handle whose tooltip promises Alt+↑/↓; those chords
	// must resolve to the block-move commands. Plain arrows stay unbound so the
	// component's own focus-navigation handles them.
	it('binds Alt+↑/↓ to block move and leaves plain arrows unbound', () => {
		expect(resolveBinding('Alt+ArrowUp', 'thematicBreak')?.command).toBe('block.moveUp');
		expect(resolveBinding('Alt+ArrowDown', 'thematicBreak')?.command).toBe('block.moveDown');
		expect(resolveBinding('ArrowUp', 'thematicBreak')).toBeNull();
		expect(resolveBinding('ArrowDown', 'thematicBreak')).toBeNull();
	});
});

describe('listItem keymap', () => {
	// Tab/Shift+Tab indent/unindent the item; ListItemBlock's bubble handler
	// dispatches these after the inner paragraph's block.insertTab declines.
	it('resolves Tab/Shift+Tab to indent/unindent', () => {
		expect(resolveBinding('Tab', 'listItem')?.command).toBe('list.indent');
		expect(resolveBinding('Shift+Tab', 'listItem')?.command).toBe('list.unindent');
	});
});

describe('tableCell keymap', () => {
	// Enter/Tab/Shift+Tab resolve to cell commands so the cross-block dispatch
	// can route a post-delete chord to a focused cell's runCommand.
	it('resolves Enter/Tab/Shift+Tab to cell commands', () => {
		expect(resolveBinding('Enter', 'tableCell')?.command).toBe('cell.enter');
		expect(resolveBinding('Tab', 'tableCell')?.command).toBe('cell.tab');
		expect(resolveBinding('Shift+Tab', 'tableCell')?.command).toBe('cell.shiftTab');
	});
});

describe('text-editable keymap breadth', () => {
	// The same transformative chords must resolve for prose AND the raw-editable
	// fallback kinds — TextEditableBlock renders both, and its keydown applied
	// these uniformly before the command-registry migration.
	const TEXT_EDITABLE_KINDS = [
		'paragraph',
		'heading',
		'setextHeading',
		'indentedCode',
		'htmlBlock',
		'linkReferenceDefinition',
		'unrecognized'
	] as const;

	it('covers prose AND raw-editable kinds', () => {
		for (const kind of TEXT_EDITABLE_KINDS) {
			expect(resolveBinding('Enter', kind)?.command).toBe('block.split');
			expect(resolveBinding('Backspace', kind)?.command).toBe('block.mergePrev');
		}
		expect(resolveBinding('Mod+3', 'paragraph')).toMatchObject({
			command: 'heading.cycle',
			arg: 3
		});
	});
});
