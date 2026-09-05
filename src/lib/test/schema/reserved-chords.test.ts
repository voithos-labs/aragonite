// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';
import { collectReservedChords, chordIsClaimed } from '$lib/schema/reserved-chords';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import {
	__resetPluginGlobalKeymapForTests,
	__removePluginCommandsForTests
} from '$lib/schema/commands';
import { __resetMintedCommandIdsForTests } from '$lib/schema/command-id';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

registerBuiltInDescriptors();

beforeEach(() => {
	__resetPluginGlobalKeymapForTests();
	__removePluginCommandsForTests();
	__resetMintedCommandIdsForTests();
});

const chords = (searchBar = true) =>
	collectReservedChords({ searchBar, activation: everyInstalledPlugin });

function ke(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
	return new KeyboardEvent('keydown', init);
}

describe('collectReservedChords — sources', () => {
	it('unions the kind keymaps and the editor-global keymap', () => {
		const set = chords();
		// Prose keymap, table-cell keymap, and undo/redo.
		expect([...set]).toEqual(
			expect.arrayContaining(['Mod+B', 'Mod+1', 'Mod+Shift+A', 'Mod+Z', 'Mod+Shift+Z'])
		);
	});

	// A keymap-declared chord needs no manifest edit — the registry tier reports it. The two
	// newest toggles are the standing proof that the tier, not a hand-kept list, is the source.
	it('picks up a chord from the kind keymaps alone', () => {
		expect([...chords()]).toEqual(expect.arrayContaining(['Mod+Shift+X', 'Mod+E']));
	});

	it('includes chords claimed outside every keymap', () => {
		// Whole-block clipboard, document-edge extend, and the table context menu — none of
		// these resolve through a keymap, so only the manifest can report them.
		expect([...chords()]).toEqual(
			expect.arrayContaining(['Mod+C', 'Mod+X', 'Mod+Shift+Home', 'Mod+Shift+End', 'Shift+F10'])
		);
	});

	it('leaves bare keys out of contract', () => {
		const set = chords();
		for (const key of ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp']) {
			expect(set.has(key), `${key} is a bare key and must not be reported`).toBe(false);
		}
		// The modified forms of the same keys are in.
		expect(set.has('Shift+Enter')).toBe(true);
		expect(set.has('Alt+ArrowUp')).toBe(true);
	});

	it('follows the instance search-bar option', () => {
		expect(chords(true).has('Mod+F')).toBe(true);
		expect(chords(true).has('Mod+H')).toBe(true);
		expect(chords(false).has('Mod+F')).toBe(false);
		expect(chords(false).has('Mod+H')).toBe(false);
	});

	it('reflects a plugin global chord as it registers and unregisters', () => {
		expect(chords().has('Mod+Shift+7')).toBe(false);
		registerGlobalCommand('demo.reserved', () => true, { chord: 'Mod+Shift+7' });
		expect(chords().has('Mod+Shift+7')).toBe(true);
		__resetPluginGlobalKeymapForTests();
		expect(chords().has('Mod+Shift+7')).toBe(false);
	});
});

describe('collectReservedChords — per-instance overrides', () => {
	const withOverrides = (overrides: Parameters<typeof normalizeKeybindingOverrides>[0]) =>
		collectReservedChords({
			searchBar: true,
			activation: everyInstalledPlugin,
			keybindings: normalizeKeybindingOverrides(overrides)
		});

	it('adds a chord an override binds, at either scope', () => {
		expect(
			withOverrides([{ chord: 'Mod+Shift+9', command: 'history.undo' }]).has('Mod+Shift+9')
		).toBe(true);
		expect(
			withOverrides([{ chord: 'Mod+Shift+8', command: 'block.split', kind: 'paragraph' }]).has(
				'Mod+Shift+8'
			)
		).toBe(true);
	});

	it('drops a keymap chord the override disables globally', () => {
		expect(withOverrides([{ chord: 'Mod+B', command: null }]).has('Mod+B')).toBe(false);
	});

	// The released half of the disable split: the host may claim Mod+Z app-wide, and their
	// handler fires while focus is outside the editor. Inside it the press is still consumed —
	// the other half, pinned at `components/gap-caret-global-chord.svelte.test.ts`.
	it('drops a disabled GLOBAL chord even though the arms still consume it', () => {
		expect(withOverrides([{ chord: 'Mod+Z', command: null }]).has('Mod+Z')).toBe(false);
	});

	it('keeps a hardcoded chord a global disable cannot reach', () => {
		// Mod+C is read straight off the keydown, so unbinding it in the keymap changes nothing.
		expect(withOverrides([{ chord: 'Mod+C', command: null }]).has('Mod+C')).toBe(true);
	});

	it('leaves other instances alone — a kind-scoped disable is not a global one', () => {
		expect(withOverrides([{ chord: 'Mod+B', command: null, kind: 'paragraph' }]).has('Mod+B')).toBe(
			true
		);
	});
});

describe('chordIsClaimed — the editor normalization, not the caller', () => {
	const set = chords();

	it('folds Ctrl and Cmd to one answer', () => {
		expect(chordIsClaimed(ke({ key: 'b', ctrlKey: true }), set)).toBe(true);
		expect(chordIsClaimed(ke({ key: 'b', metaKey: true }), set)).toBe(true);
	});

	it('matches a CapsLock-uppercased letter', () => {
		expect(chordIsClaimed(ke({ key: 'B', ctrlKey: true }), set)).toBe(true);
	});

	it('reads modifiers in any order the platform reports them', () => {
		expect(chordIsClaimed(ke({ key: 'z', ctrlKey: true, shiftKey: true }), set)).toBe(true);
		expect(chordIsClaimed(ke({ key: 'ArrowUp', altKey: true }), set)).toBe(true);
	});

	it('declines an unclaimed chord, a bare key, and a lone modifier', () => {
		expect(chordIsClaimed(ke({ key: 'q', ctrlKey: true }), set)).toBe(false);
		expect(chordIsClaimed(ke({ key: 'b' }), set)).toBe(false);
		expect(chordIsClaimed(ke({ key: 'Enter' }), set)).toBe(false);
		expect(chordIsClaimed(ke({ key: 'Control', ctrlKey: true }), set)).toBe(false);
	});

	it('declines a modified variant of a claimed chord', () => {
		expect(chordIsClaimed(ke({ key: 'b', ctrlKey: true, altKey: true }), set)).toBe(false);
	});
});
