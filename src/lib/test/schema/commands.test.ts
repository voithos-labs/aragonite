import { describe, it, expect, vi } from 'vitest';
import {
	getCommand,
	GLOBAL_KEYMAP,
	resolveBinding,
	dispatchKeyCommand
} from '$lib/editor/schema/commands';
import {
	registerBlockKind,
	tryGetBlockKindDescriptor
} from '$lib/editor/schema/block-kind-descriptor';

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
			registerBlockKind('paragraph', {
				...real,
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
			registerBlockKind('paragraph', real);
		}
	});
});

describe('resolveBinding order', () => {
	it('per-kind binding shadows the global table, falls through otherwise', () => {
		const real = tryGetBlockKindDescriptor('paragraph')!;
		try {
			registerBlockKind('paragraph', {
				...real,
				keymap: [{ chord: 'Mod+Z', command: 'block.split' }]
			});
			expect(resolveBinding('Mod+Z', 'paragraph')?.command).toBe('block.split');
		} finally {
			registerBlockKind('paragraph', real);
		}
		// fencedCode declares no keymap → falls through to the global table
		expect(resolveBinding('Mod+Z', 'fencedCode')?.command).toBe('history.undo');
	});
});
