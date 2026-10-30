// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { registerBuiltInDescriptors } from '#lib/schema/built-in-descriptors.js';
import { collectReservedChords } from '#lib/schema/reserved-chords.js';
import { normalizeKeybindingOverrides } from '#lib/schema/keybinding-overrides.js';
import { registerGlobalCommand } from '#lib/schema/global-commands.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { __resetSchemaRegistriesForTests } from '#lib/schema/registry-reset.js';

registerBuiltInDescriptors();

const chords = (searchBar = true) =>
	collectReservedChords({ searchBar, activation: everyInstalledPlugin });

describe('collectReservedChords: sources', () => {
	it('unions the kind keymaps and the editor-global keymap', () => {
		const set = chords();
		// One chord each from the prose keymap, the table-cell keymap, and undo/redo.
		expect([...set]).toEqual(
			expect.arrayContaining(['Mod+B', 'Mod+1', 'Mod+Shift+A', 'Mod+Z', 'Mod+Shift+Z'])
		);
	});

	// A chord declared in a keymap needs no edit to the hardcoded list: the registry reports it.
	it('picks up a chord from the kind keymaps alone', () => {
		expect([...chords()]).toEqual(expect.arrayContaining(['Mod+Shift+X', 'Mod+E']));
	});

	it('includes chords claimed outside every keymap', () => {
		// Whole-block clipboard, document-edge extend and the table context menu: none of these
		// resolve through a keymap, so only the hardcoded list can report them.
		expect([...chords()]).toEqual(
			expect.arrayContaining(['Mod+C', 'Mod+X', 'Mod+Shift+Home', 'Mod+Shift+End', 'Shift+F10'])
		);
	});

	it('leaves bare keys out of contract', () => {
		const set = chords();
		for (const key of ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp']) {
			expect(set.has(key), `${key} is a bare key and must not be reported`).toBe(false);
		}
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
		__resetSchemaRegistriesForTests();
		expect(chords().has('Mod+Shift+7')).toBe(false);
	});
});

describe('collectReservedChords: per-instance overrides', () => {
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

	// Disabling Mod+Z releases it to the host while focus is outside the editor; inside the editor
	// the keypress is still swallowed.
	it('drops a disabled global chord even though the branches still consume it', () => {
		expect(withOverrides([{ chord: 'Mod+Z', command: null }]).has('Mod+Z')).toBe(false);
	});

	it('keeps a hardcoded chord a global disable cannot reach', () => {
		// Mod+C is read straight off the keydown, so unbinding it in the keymap changes nothing.
		expect(withOverrides([{ chord: 'Mod+C', command: null }]).has('Mod+C')).toBe(true);
	});

	it('leaves other instances alone: a kind-scoped disable is not a global one', () => {
		expect(withOverrides([{ chord: 'Mod+B', command: null, kind: 'paragraph' }]).has('Mod+B')).toBe(
			true
		);
	});
});

// Cmd+Arrow is macOS's Home and End, which the edge sites take; the chord form folds Ctrl+Arrow, the
// word motion of Windows and Linux, into the same `Mod+Arrow`.
describe('the Cmd+Arrow edge chords', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('are listed only where Cmd is the command key', () => {
		expect(chords().has('Mod+ArrowLeft')).toBe(false);
		vi.stubGlobal('navigator', { platform: 'MacIntel' });
		expect(chords().has('Mod+ArrowLeft')).toBe(true);
	});
});
