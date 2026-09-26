// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import { makeKeydownEnv, press } from './keydown-env';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';

// Every key the cross-block dispatcher consumes returns before handleSharedKeydown reaches its
// sticky decision, and the collapse branches run no commit, so nothing downstream resets either.
// Driven at the dispatcher because that is the entry path that swallows the key.

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

// The dispatcher asks the paragraph's keymap what a chord does before it classifies the key, so
// a rebound reorder is read as the move and the freed chord as an arrow.
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

	it('the freed Alt+ArrowUp is an arrow: the side is set and the marks drop', async () => {
		const env = armed();
		await env.keydown.handleKeyDown(press('ArrowUp', { altKey: true }));
		expect(env.caretMemory.side()).toBe('far');
		expect(env.caretMemory.pendingMarks.get()).toBeNull();
	});

	it('the rebound chord keeps the column, the side and the marks', async () => {
		const env = armed();
		await env.keydown.handleKeyDown(press('ArrowUp', { ctrlKey: true }));
		expect(env.caretMemory.column()).toBe(600);
		expect(env.caretMemory.side()).toBeNull();
		expect([...(env.caretMemory.pendingMarks.get() ?? [])]).toEqual(['strong']);
	});
});
