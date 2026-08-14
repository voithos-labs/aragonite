import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import {
	dispatchKeyCommand,
	registerBlockCommand,
	runCommandById,
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

	// Miss-analysis: the memo had one test, and it drove one path — nothing asserted that the
	// diagnostic each path owes is its own, so a door no-op silently spent the chord path's.
	it('warns per dispatch path: a door no-op does not spend the chord path diagnostic', () => {
		const id = registerBlockCommand('paragraph', 'demo.bothPaths', () => true);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const runCommand = vi.fn(() => false);
		const target = { kind: 'paragraph' as const, runCommand };
		const ctx = {
			history: { requestUndo() {}, requestRedo() {} },
			isCrossBlockRange: () => false
		};

		expect(runCommandById(id, undefined, target, ctx)).toBe(false);
		expect(dispatchKeyCommand('Mod+Shift+K', target, ctx, overrides)).toBe(false);

		const messages = takeDevWarns().map((w) => w.message);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toContain('door');
		expect(messages[1]).toContain('chord');
	});
});
