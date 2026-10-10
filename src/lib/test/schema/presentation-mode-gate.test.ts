import { describe, it, expect } from 'vitest';
import { isReadingMode, type PresentationMode } from '#lib/presentation-mode.js';
import { dispatchKeyCommand, dispatchKindCommand } from '#lib/schema/block-commands.js';
import { normalizeKeybindingOverrides } from '#lib/schema/keybinding-overrides.js';
import { commandContext, commandContextWith } from '../support/command-context';

const modeGetter = (mode: PresentationMode) => () => mode;

describe('isReadingMode', () => {
	it('reads the mode through the getter', () => {
		expect(isReadingMode(modeGetter('reading'))).toBe(true);
		expect(isReadingMode(modeGetter('source'))).toBe(false);
		expect(isReadingMode(modeGetter('preview-inline'))).toBe(false);
		// Live hides every marker but stays editable, so it must not trip the read-only check.
		expect(isReadingMode(modeGetter('live'))).toBe(false);
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
		const reading = commandContext({ history, getPresentationMode: modeGetter('reading') });
		expect(dispatchKeyCommand('Mod+Z', target(ran), reading)).toBe(false);
		expect(undos).toBe(0);

		const source = commandContext({ history, getPresentationMode: modeGetter('source') });
		expect(dispatchKeyCommand('Mod+Z', target(ran), source)).toBe(true);
		expect(undos).toBe(1);
	});

	it('dispatchKindCommand gates when handed the reading getter, and stays open otherwise', () => {
		const overrides = normalizeKeybindingOverrides([
			{ kind: 'paragraph', chord: 'Mod+K', command: 'block.moveUp' }
		]);
		const ran: string[] = [];
		const inMode = (mode: PresentationMode) =>
			commandContextWith(overrides, { getPresentationMode: modeGetter(mode) });
		expect(dispatchKindCommand('Mod+K', target(ran), inMode('reading'))).toBe(false);
		expect(ran).toEqual([]);
		expect(dispatchKindCommand('Mod+K', target(ran), inMode('source'))).toBe(true);
		expect(ran).toEqual(['block.moveUp']);
	});
});
