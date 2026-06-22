import { describe, it, expect } from 'vitest';
import {
	normalizeKeybindingOverrides,
	lookupOverride,
	overrideDecision
} from '$lib/editor/schema/keybinding-overrides';
import { resolveBinding, resolveKindBinding } from '$lib/editor/schema/commands';

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

	it('resolveKindBinding honors a kind override and disable, never the global tier', () => {
		const rebind = normalizeKeybindingOverrides([
			{ chord: 'Tab', command: 'history.undo', kind: 'listItem' }
		]);
		expect(resolveKindBinding('Tab', 'listItem', rebind)?.command).toBe('history.undo');

		const disable = normalizeKeybindingOverrides([
			{ chord: 'Tab', command: null, kind: 'listItem' }
		]);
		expect(resolveKindBinding('Tab', 'listItem', disable)).toBeNull();

		// A GLOBAL override is invisible to the container (kind-only) path.
		const globalOnly = normalizeKeybindingOverrides([{ chord: 'Tab', command: 'history.undo' }]);
		expect(resolveKindBinding('Tab', 'listItem', globalOnly)?.command).toBe('list.indent');
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
