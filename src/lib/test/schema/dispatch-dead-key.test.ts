import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import {
	dispatchKeyCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { takeDevWarns } from '../support/warn-gate';

describe('leaf-path dispatch of an unresolved plugin command', () => {
	afterEach(() => {
		__resetBlockCommandsForTests();
		vi.restoreAllMocks();
	});

	it('dead-keys and dev-warns exactly once per id, never reaching runCommand', () => {
		// The leaf path resolves a minted command only against a supplied command context;
		// this target omits `getCommandContext`, so the command is unreachable.
		const id = registerBlockCommand('paragraph', 'demo.leafOnly', () => true);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const runCommand = vi.fn(() => false);
		const target = { kind: 'paragraph' as const, runCommand };
		const ctx = {
			history: { requestUndo() {}, requestRedo() {} },
			isCrossBlockRange: () => false
		};

		const first = dispatchKeyCommand('Mod+Shift+K', target, ctx, overrides);
		const second = dispatchKeyCommand('Mod+Shift+K', target, ctx, overrides);

		expect(first).toBe(false);
		expect(second).toBe(false);
		expect(runCommand).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});
});
