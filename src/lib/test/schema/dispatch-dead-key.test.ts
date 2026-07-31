import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __resetCommandWarningsForTests } from '$lib/schema/commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import {
	dispatchKeyCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';

// devWarn is silent under test by default — force dev/non-test so the dead-key
// warn fires (pattern: src/lib/test/dev-warn.test.ts).
describe('leaf-path dispatch of an unresolved plugin command', () => {
	beforeEach(() => configureEditorEnv({ isDev: true, isTest: false }));
	afterEach(() => {
		resetEditorEnv();
		__resetCommandWarningsForTests();
		__resetBlockCommandsForTests();
		vi.restoreAllMocks();
	});

	it('dead-keys and dev-warns exactly once per id, never reaching runCommand', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// The leaf path resolves a minted command only against a supplied command context;
		// this target omits `getCommandContext`, so the command is unreachable.
		const id = registerBlockCommand('paragraph', 'demo.leafOnly', () => true);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const runCommand = vi.fn(() => false);
		const target = { kind: 'paragraph' as const, runCommand };
		const ctx = { history: { requestUndo() {}, requestRedo() {} } };

		const first = dispatchKeyCommand('Mod+Shift+K', target, ctx, overrides);
		const second = dispatchKeyCommand('Mod+Shift+K', target, ctx, overrides);

		expect(first).toBe(false);
		expect(second).toBe(false);
		expect(runCommand).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
