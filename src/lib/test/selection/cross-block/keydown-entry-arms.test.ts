// @vitest-environment jsdom
//
// The two arms that run while cross-block mode is NOT yet active, plus the
// compositionstart half the same factory returns.
//
// Ctrl+A is a two-press ladder: the first press selects the focused block's content
// (natively, so the caret stays inside one block), the second escalates to the whole
// document. The count lives on SelectionState and the escalation is keyed off it, so
// a press that forgot to increment would leave Ctrl+A stuck at one block.
//
// compositionstart is the IME's first signal and there is no beforeinput to gate on:
// an active range has to be deleted SYNCHRONOUSLY or the composed text lands on top
// of a stale selection.
import { describe, it, expect } from 'vitest';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

describe('cross-block keydown — Ctrl+A ladder', () => {
	it('first press selects within the block, without entering cross-block mode', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.selectAllCount).toBe(1);
		expect(env.selection.isCrossBlock).toBe(false);
	});

	it('second press escalates to the whole document', async () => {
		const env = makeKeydownEnv(SOURCE);

		await env.keydown.handleKeyDown(press('a', { ctrlKey: true }));
		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.isCrossBlock).toBe(true);
		expect(env.selection.anchor?.path).toEqual([0]);
		expect(env.selection.focus?.path).toEqual([2]);
	});

	it('re-selects the whole document when pressed with a range already active', async () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.focus?.path).toEqual([2]);
	});

	// Ctrl+Shift+A is a different chord and must not ladder.
	it('ignores the shifted chord', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true, shiftKey: true }))).toBe(
			false
		);

		expect(env.selection.selectAllCount).toBe(0);
	});
});

describe('cross-block keydown — compositionstart', () => {
	it('deletes the active range synchronously and reports it handled', () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(env.keydown.handleCompositionStart()).toBe(true);

		expect(env.source()).toBe('ata\n\ngamma\n');
		expect(env.selection.isCrossBlock).toBe(false);
	});

	it('declines with no range active, leaving the composition to the block', () => {
		const env = makeKeydownEnv(SOURCE);

		expect(env.keydown.handleCompositionStart()).toBe(false);

		expect(env.source()).toBe(SOURCE);
	});

	it('declines in reading mode, deleting nothing', () => {
		const env = makeKeydownEnv(SOURCE, { presentationMode: 'reading' });
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(env.keydown.handleCompositionStart()).toBe(false);

		expect(env.source()).toBe(SOURCE);
		expect(env.selection.isCrossBlock).toBe(true);
	});

	// The sticky column is reset unconditionally, before the range check: a
	// composition is a horizontal edit, so a column captured by an earlier vertical
	// arrow must not survive it.
	it('resets the sticky column even when it declines', () => {
		const env = makeKeydownEnv(SOURCE);
		env.stickyColumn.capture(asEditorX(600));

		env.keydown.handleCompositionStart();

		expect(env.stickyColumn.get()).toBeNull();
	});
});
