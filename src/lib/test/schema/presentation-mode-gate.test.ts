import { describe, it, expect } from 'vitest';
import {
	resolveEffectivePresentationMode,
	isReadingMode,
	type PresentationMode
} from '$lib/presentation-mode';
import { dispatchKeyCommand, dispatchKindCommand } from '$lib/schema/block-commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { EditorContext } from '$lib/schema/plugin-install';

const lookupFor = (mode: PresentationMode) => (_name: string) =>
	({ presentationMode: mode }) as EditorContext;

describe('resolveEffectivePresentationMode', () => {
	it('passes source and reading through; collapses the preview stubs to source', () => {
		expect(resolveEffectivePresentationMode('source')).toBe('source');
		expect(resolveEffectivePresentationMode('reading')).toBe('reading');
		expect(resolveEffectivePresentationMode('preview-block')).toBe('source');
		expect(resolveEffectivePresentationMode('preview-inline')).toBe('source');
	});
});

describe('isReadingMode', () => {
	it('reads the mode through the lookup; absent lookup means not reading', () => {
		expect(isReadingMode(lookupFor('reading'))).toBe(true);
		expect(isReadingMode(lookupFor('source'))).toBe(false);
		expect(isReadingMode(undefined)).toBe(false);
	});
});

describe('dispatch gates in reading mode', () => {
	const target = (ran: string[]) => ({
		kind: 'paragraph' as const,
		runCommand: (id: string) => {
			ran.push(id);
			return true;
		}
	});

	it('dispatchKeyCommand dead-keys the whole vocabulary, undo included', () => {
		const ran: string[] = [];
		let undos = 0;
		const history = { requestUndo: () => void undos++, requestRedo: () => {} };
		const reading = { history, pluginEditor: lookupFor('reading') };
		expect(dispatchKeyCommand('Mod+Z', target(ran), reading)).toBe(false);
		expect(undos).toBe(0);

		const source = { history, pluginEditor: lookupFor('source') };
		expect(dispatchKeyCommand('Mod+Z', target(ran), source)).toBe(true);
		expect(undos).toBe(1);
	});

	it('dispatchKindCommand gates when handed the lookup, and stays open without it', () => {
		const overrides = normalizeKeybindingOverrides([
			{ kind: 'paragraph', chord: 'Mod+K', command: 'block.moveUp' }
		]);
		const ran: string[] = [];
		expect(
			dispatchKindCommand('Mod+K', target(ran), overrides, undefined, lookupFor('reading'))
		).toBe(false);
		expect(ran).toEqual([]);
		expect(
			dispatchKindCommand('Mod+K', target(ran), overrides, undefined, lookupFor('source'))
		).toBe(true);
		expect(ran).toEqual(['block.moveUp']);
	});
});
