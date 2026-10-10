// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { asEditorX } from '#lib/caret/coordinate-spaces.js';
import { makeKeydownEnv, press } from './keydown-env';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';

// Every key the cross-block dispatcher consumes returns before handleSharedKeydown's sticky
// decision, and the collapse branches run no commit, so nothing downstream resets the column.

function envWithColumn() {
	const env = makeKeydownEnv('alpha beta gamma\n\ndelta\n');
	env.selection.enterCrossBlock({ path: [0], offset: 16 }, { path: [1], offset: 0 });
	env.caretMemory.captureColumn(asEditorX(600));
	return env;
}

describe('cross-block keydown: sticky column', () => {
	it('resets the column on a key it consumes to collapse the selection', async () => {
		const env = envWithColumn();

		expect(await env.keydown.handleKeyDown(press('ArrowLeft'))).toBe(true);

		expect(env.caretMemory.column()).toBeNull();
	});

	it('resets on Escape, which also collapses without a commit behind it', async () => {
		const env = envWithColumn();

		expect(await env.keydown.handleKeyDown(press('Escape'))).toBe(true);

		expect(env.caretMemory.column()).toBeNull();
	});

	it('preserves the column on a vertical arrow: the dispatcher has no caret to measure', async () => {
		const env = envWithColumn();

		await env.keydown.handleKeyDown(press('ArrowDown'));

		expect(env.caretMemory.column()).toBe(600);
	});

	it('preserves the column for a bare modifier the dispatcher does not consume', async () => {
		const env = makeKeydownEnv('alpha beta gamma\n\ndelta\n');
		env.caretMemory.captureColumn(asEditorX(600));

		expect(await env.keydown.handleKeyDown(press('Shift'))).toBe(false);

		expect(env.caretMemory.column()).toBe(600);
	});
});

// The dispatcher asks the paragraph's keymap what a chord does before classifying the key.
// Miss-analysis: both classifiers matched the Alt+ArrowUp literal, and no test rebound the chord.
describe('cross-block keydown: the reorder chord follows a rebinding', () => {
	const keybindings: KeybindingOverride[] = [
		{ chord: 'Alt+ArrowUp', command: null, kind: 'paragraph' },
		{ chord: 'Mod+ArrowUp', command: 'block.moveUp', kind: 'paragraph' }
	];

	function armed() {
		const env = makeKeydownEnv('alpha beta gamma\n\ndelta\n', { keybindings });
		env.caretMemory.captureColumn(asEditorX(600));
		env.caretMemory.pendingMarks.toggle('strong');
		return env;
	}

	it('the freed Alt+ArrowUp is an arrow: it reads as a key arrival and the marks drop', async () => {
		const env = armed();
		await env.keydown.handleKeyDown(press('ArrowUp', { altKey: true }));
		expect(env.caretMemory.arrivedByKey()).toBe(true);
		expect(env.caretMemory.pendingMarks.get()).toBeNull();
	});

	it('the rebound chord keeps the column, the record and the marks', async () => {
		const env = armed();
		await env.keydown.handleKeyDown(press('ArrowUp', { ctrlKey: true }));
		expect(env.caretMemory.column()).toBe(600);
		expect(env.caretMemory.side()).toBeNull();
		expect([...(env.caretMemory.pendingMarks.get() ?? [])]).toEqual(['strong']);
	});
});
