import { describe, it, expect } from 'vitest';
import {
	normalizeKeybindingOverrides,
	lookupOverride,
	overrideDecision
} from '$lib/schema/keybinding-overrides';
import {
	resolveBinding,
	resolveKindBinding,
	isEditorGlobalChord,
	resolveGlobalBinding
} from '$lib/schema/commands';
import { mintCommandId } from '$lib/schema/command-id';
import { declarePluginKind } from '$lib/schema/plugin-kind';

describe('normalizeKeybindingOverrides', () => {
	it('compiles a global rebind', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Mod+B', command: 'history.undo' }]);
		expect(lookupOverride(map, 'global', 'Mod+B')).toMatchObject({ command: 'history.undo' });
	});

	it('compiles a kind-scoped binding under byKind', () => {
		const map = normalizeKeybindingOverrides([
			{ chord: 'Mod+1', command: 'heading.cycle', kind: 'heading', arg: 1 }
		]);
		expect(lookupOverride(map, 'global', 'Mod+1')).toBeUndefined();
		expect(lookupOverride(map, 'heading', 'Mod+1')).toMatchObject({
			command: 'heading.cycle',
			arg: 1
		});
	});

	it('carries a non-number arg through normalization (widened for minted commands)', () => {
		const command = mintCommandId('demo.setKind');
		const map = normalizeKeybindingOverrides([{ chord: 'Mod+Shift+K', command, arg: 'warning' }]);
		expect(lookupOverride(map, 'global', 'Mod+Shift+K')).toMatchObject({ command, arg: 'warning' });
	});

	it('scopes a minted command chord to a declared plugin kind (widened kind)', () => {
		const kind = declarePluginKind('kb-override-demo');
		const command = mintCommandId('demo.run');
		const map = normalizeKeybindingOverrides([{ chord: 'Mod+Shift+M', command, kind }]);
		expect(lookupOverride(map, 'global', 'Mod+Shift+M')).toBeUndefined();
		expect(lookupOverride(map, kind, 'Mod+Shift+M')).toMatchObject({ command });
		expect(map.byKind.get(kind)?.size).toBe(1);
	});

	it('compiles a disable to the "disabled" sentinel', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Mod+Z', command: null }]);
		expect(lookupOverride(map, 'global', 'Mod+Z')).toBe('disabled');
	});

	it('drops a chord with an unrecognized modifier (the Ctrl+B trap) — does NOT bind bare B', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Ctrl+B', command: 'format.toggleStrong' }]);
		expect(lookupOverride(map, 'global', 'B')).toBeUndefined();
		expect(map.global.size).toBe(0);
	});

	it('drops a Cmd-prefixed chord too', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Cmd+B', command: 'format.toggleStrong' }]);
		expect(map.global.size).toBe(0);
	});
});

describe('overrideDecision', () => {
	it('maps a binding to itself, disabled to null, missing to undefined', () => {
		const binding = { chord: 'Mod+B', command: 'format.toggleStrong' as const };
		expect(overrideDecision(binding)).toBe(binding);
		expect(overrideDecision('disabled')).toBeNull();
		expect(overrideDecision(undefined)).toBeUndefined();
	});
});

describe('override-aware resolution (commands.ts)', () => {
	it('a kind override shadows the built-in kind keymap', () => {
		const map = normalizeKeybindingOverrides([
			{ chord: 'Enter', command: 'history.undo', kind: 'paragraph' }
		]);
		expect(resolveBinding('Enter', 'paragraph', map)?.command).toBe('history.undo');
		// without overrides, Enter on paragraph is the built-in split
		expect(resolveBinding('Enter', 'paragraph')?.command).toBe('block.split');
	});

	it('a global override shadows a built-in KIND binding (source dominates specificity)', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Enter', command: 'history.undo' }]);
		expect(resolveBinding('Enter', 'paragraph', map)?.command).toBe('history.undo');
	});

	it('a global disable suppresses a chord everywhere and does NOT consult the built-in', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Mod+Z', command: null }]);
		expect(resolveBinding('Mod+Z', 'paragraph', map)).toBeNull();
	});

	it('resolveKindBinding honors a kind override and disable', () => {
		const rebind = normalizeKeybindingOverrides([
			{ chord: 'Tab', command: 'history.undo', kind: 'listItem' }
		]);
		expect(resolveKindBinding('Tab', 'listItem', rebind)?.command).toBe('history.undo');

		const disable = normalizeKeybindingOverrides([
			{ chord: 'Tab', command: null, kind: 'listItem' }
		]);
		expect(resolveKindBinding('Tab', 'listItem', disable)).toBeNull();
	});

	// The bubble must see a global OVERRIDE (a disable that is invisible here still runs
	// list.indent) but never the built-in global table, or a bubbled undo double-fires.
	it('resolveKindBinding honors a GLOBAL override at the bubble, not the built-in global table', () => {
		const disable = normalizeKeybindingOverrides([{ chord: 'Tab', command: null }]);
		expect(resolveKindBinding('Tab', 'listItem', disable)).toBeNull();

		// A global BIND shadows the built-in kind binding too (uniform intent).
		const rebind = normalizeKeybindingOverrides([{ chord: 'Tab', command: 'history.undo' }]);
		expect(resolveKindBinding('Tab', 'listItem', rebind)?.command).toBe('history.undo');

		// The built-in global table itself still never fires at the bubble: Mod+Z
		// carries no kind or global OVERRIDE, so it stays unbound (no double-undo).
		expect(resolveKindBinding('Mod+Z', 'listItem')).toBeNull();
	});

	it('adds a brand-new chord for a built-in command', () => {
		const map = normalizeKeybindingOverrides([{ chord: 'Mod+Alt+S', command: 'history.undo' }]);
		expect(resolveBinding('Mod+Alt+S', 'paragraph', map)?.command).toBe('history.undo');
	});

	it('no overrides leaves built-in resolution unchanged', () => {
		expect(resolveBinding('Mod+Z', 'paragraph')?.command).toBe('history.undo');
		expect(resolveKindBinding('Enter', 'paragraph')?.command).toBe('block.split');
	});
});

describe('isEditorGlobalChord', () => {
	it('matches the exact default history chords only', () => {
		expect(isEditorGlobalChord('Mod+Z')).toBe(true);
		expect(isEditorGlobalChord('Mod+Y')).toBe(true);
		expect(isEditorGlobalChord('Mod+Shift+Z')).toBe(true);
	});

	it('does NOT match a modified variant — the Ctrl+Alt+Y interception bug guard', () => {
		expect(isEditorGlobalChord('Mod+Alt+Y')).toBe(false);
		expect(isEditorGlobalChord('Mod+Alt+Z')).toBe(false);
		expect(isEditorGlobalChord('Mod+B')).toBe(false);
	});
});

describe('resolveGlobalBinding', () => {
	it('returns the default global binding when no override', () => {
		expect(resolveGlobalBinding('Mod+Z')?.command).toBe('history.undo');
		expect(resolveGlobalBinding('Mod+Y')?.command).toBe('history.redo');
	});

	it('honors a global rebind and disable', () => {
		const rebind = normalizeKeybindingOverrides([{ chord: 'Mod+Z', command: 'history.redo' }]);
		expect(resolveGlobalBinding('Mod+Z', rebind)?.command).toBe('history.redo');
		const disable = normalizeKeybindingOverrides([{ chord: 'Mod+Z', command: null }]);
		expect(resolveGlobalBinding('Mod+Z', disable)).toBeNull();
	});

	it('ignores a kind-scoped override (global scope only)', () => {
		const kindScoped = normalizeKeybindingOverrides([
			{ chord: 'Mod+Z', command: 'history.redo', kind: 'paragraph' }
		]);
		expect(resolveGlobalBinding('Mod+Z', kindScoped)?.command).toBe('history.undo');
	});
});
