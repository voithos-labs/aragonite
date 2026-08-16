import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import {
	dispatchKeyCommand,
	registerBlockCommand,
	runCommandById,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { runGlobalChord, runGlobalChordOnKind } from '$lib/schema/commands';
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
			getPresentationMode: () => 'source' as const,
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
			getPresentationMode: () => 'source' as const,
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

// The surfaces with no focused block: the editor root's windowed-out caret, the gap caret's proxy,
// a block that IS its own focus target. Miss-analysis: the dead-key warn was added per BLOCK-LOCAL
// path, and this one resolves outside that tail entirely, so it was the one path where an
// unrunnable binding was a silent non-consume.
describe('global-scope dispatch of a binding no global command backs', () => {
	const ctx = {
		isReading: false,
		history: { requestUndo() {}, requestRedo() {} }
	};
	// A whole-block kind whose own keymap binds Alt+Arrow (reorder) and no history chord.
	const KIND = 'thematicBreak' as const;
	const REBOUND_TO_BLOCK_ID = normalizeKeybindingOverrides([
		{ chord: 'Mod+Z', command: 'format.toggleStrong' }
	]);

	it('warns once at a surface with no kind dispatch under it, and declines the press', () => {
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+J', command: 'format.toggleStrong' }
		]);

		expect(runGlobalChord('Mod+J', overrides, ctx)).toBe(false);
		expect(runGlobalChord('Mod+J', overrides, ctx)).toBe(false);

		const messages = takeDevWarns().map((w) => w.message);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain('global-chord');
		expect(messages[0]).toContain('format.toggleStrong');
	});

	// Consumed on top of dead, and the shape that reaches a whole-block surface too: the built-in
	// table claims the chord so it may not fall through, and the override left it unrunnable.
	it.each([
		['no kind tier', () => runGlobalChord('Mod+Z', REBOUND_TO_BLOCK_ID, ctx)],
		['a kind tier below', () => runGlobalChordOnKind('Mod+Z', KIND, REBOUND_TO_BLOCK_ID, ctx)]
	])('warns and still consumes with %s', (_name, press) => {
		expect(press()).toBe(true);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});

	// The handoff, not a dead key: the kind's own keymap answers this one, one tier on.
	it('stays silent when a kind keymap chord declines into the kind dispatch', () => {
		expect(runGlobalChordOnKind('Alt+ArrowUp', KIND, undefined, ctx)).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	it('stays silent where nothing resolved at all', () => {
		expect(runGlobalChord('Mod+J', undefined, ctx)).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});
});
