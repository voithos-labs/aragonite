import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import {
	dispatchKeyCommand,
	registerBlockCommand,
	runCommandById
} from '$lib/schema/block-commands';
import { runGlobalChord, runGlobalChordOnKind } from '$lib/schema/commands';
import { takeDevWarns } from '../support/warn-gate';
import { commandContext, commandContextWith } from '../support/command-context';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

describe('leaf-path dispatch of an unresolved plugin command', () => {
	afterEach(() => {
		__resetSchemaRegistriesForTests();
		vi.restoreAllMocks();
	});

	it('dead-keys and dev-warns exactly once per id, never reaching runCommand', () => {
		// The leaf path resolves a plugin command only against a supplied command context; this
		// target omits `getCommandContext`, so the command cannot be reached.
		const id = registerBlockCommand('paragraph', 'demo.leafOnly', () => true);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const runCommand = vi.fn(() => false);
		const target = { kind: 'paragraph' as const, runCommand };
		const ctx = commandContextWith(overrides);
		const first = dispatchKeyCommand('Mod+Shift+K', target, ctx);
		const second = dispatchKeyCommand('Mod+Shift+K', target, ctx);

		expect(first).toBe(false);
		expect(second).toBe(false);
		expect(runCommand).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});

	// Miss-analysis: the one test drove one path, so a direct call could use up the chord's warning.
	it('warns per dispatch path: an entry point no-op does not spend the chord path diagnostic', () => {
		const id = registerBlockCommand('paragraph', 'demo.bothPaths', () => true);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const runCommand = vi.fn(() => false);
		const target = { kind: 'paragraph' as const, runCommand };
		const ctx = commandContextWith(overrides);
		expect(runCommandById(id, undefined, target, ctx)).toBe(false);
		expect(dispatchKeyCommand('Mod+Shift+K', target, ctx)).toBe(false);

		const messages = takeDevWarns().map((w) => w.message);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toContain('door');
		expect(messages[1]).toContain('chord');
	});
});

// No focused block: the root caret on an unmounted block, the gap caret, a self-focused block.
// Miss-analysis: the key-does-nothing warning was tested on block-local paths only, never this one.
describe('global-scope dispatch of a binding no global command backs', () => {
	// A whole-block kind whose own keymap binds Alt+Arrow (reorder) and no history chord.
	const KIND = 'thematicBreak' as const;
	const REBOUND_TO_BLOCK_ID = normalizeKeybindingOverrides([
		{ chord: 'Mod+Z', command: 'format.toggleStrong' }
	]);

	it('warns once at a surface with no kind dispatch under it, and declines the press', () => {
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+J', command: 'format.toggleStrong' }
		]);

		expect(runGlobalChord('Mod+J', commandContextWith(overrides))).toBe(false);
		expect(runGlobalChord('Mod+J', commandContextWith(overrides))).toBe(false);

		const messages = takeDevWarns().map((w) => w.message);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain('global-chord');
		expect(messages[0]).toContain('format.toggleStrong');
	});

	// The built-in global keymap takes Mod+Z, so the press is swallowed even though the override left
	// it unrunnable, with or without a whole-block kind below.
	it.each([
		['no kind tier', () => runGlobalChord('Mod+Z', commandContextWith(REBOUND_TO_BLOCK_ID))],
		[
			'a kind tier below',
			() => runGlobalChordOnKind('Mod+Z', KIND, commandContextWith(REBOUND_TO_BLOCK_ID))
		]
	])('warns and still consumes with %s', (_name, press) => {
		expect(press()).toBe(true);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});

	// A handoff, not a key that does nothing: the kind's own keymap answers this one, one level on.
	it('stays silent when a kind keymap chord declines into the kind dispatch', () => {
		expect(runGlobalChordOnKind('Alt+ArrowUp', KIND, commandContext())).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	it('stays silent where nothing resolved at all', () => {
		expect(runGlobalChord('Mod+J', commandContext())).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});
});
