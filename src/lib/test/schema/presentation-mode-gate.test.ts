import { describe, it, expect } from 'vitest';
import { isReadingMode, type PresentationMode } from '$lib/presentation-mode';
import { dispatchKeyCommand, dispatchKindCommand } from '$lib/schema/block-commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';

const modeGetter = (mode: PresentationMode) => () => mode;

describe('isReadingMode', () => {
	it('reads the mode through the getter; absent getter means not reading', () => {
		expect(isReadingMode(modeGetter('reading'))).toBe(true);
		expect(isReadingMode(modeGetter('source'))).toBe(false);
		expect(isReadingMode(modeGetter('preview-inline'))).toBe(false);
		// Live hides every marker but stays editable, so it must not trip the read-only gate.
		expect(isReadingMode(modeGetter('live'))).toBe(false);
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
		const reading = {
			history,
			getPresentationMode: modeGetter('reading'),
			isCrossBlockRange: () => false
		};
		expect(dispatchKeyCommand('Mod+Z', target(ran), reading)).toBe(false);
		expect(undos).toBe(0);

		const source = {
			history,
			getPresentationMode: modeGetter('source'),
			isCrossBlockRange: () => false
		};
		expect(dispatchKeyCommand('Mod+Z', target(ran), source)).toBe(true);
		expect(undos).toBe(1);
	});

	it('dispatchKindCommand gates when handed the reading getter, and stays open otherwise', () => {
		const overrides = normalizeKeybindingOverrides([
			{ kind: 'paragraph', chord: 'Mod+K', command: 'block.moveUp' }
		]);
		const ran: string[] = [];
		expect(
			dispatchKindCommand('Mod+K', target(ran), overrides, undefined, {
				getPresentationMode: modeGetter('reading')
			})
		).toBe(false);
		expect(ran).toEqual([]);
		expect(
			dispatchKindCommand('Mod+K', target(ran), overrides, undefined, {
				getPresentationMode: modeGetter('source')
			})
		).toBe(true);
		expect(ran).toEqual(['block.moveUp']);
	});
});
