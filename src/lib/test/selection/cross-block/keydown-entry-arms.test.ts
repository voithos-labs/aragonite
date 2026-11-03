// @vitest-environment jsdom
// The two branches that run while cross-block mode is not yet active, plus compositionstart.
// Ctrl+A escalates over two presses counted on `SelectionState`, so a press that forgot to count
// leaves it stuck at one block; compositionstart has no beforeinput to wait for, so an active range
// must be deleted synchronously or composed text lands on a stale one.
import { describe, it, expect } from 'vitest';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { takeDevWarns } from '../../support/warn-gate';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

describe('cross-block keydown: Ctrl+A priority order', () => {
	it('first press selects within the block, without entering cross-block mode', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.selectAllCount).toBe(1);
		expect(env.selection.ownsRange).toBe(false);
	});

	it('second press escalates to the whole document', async () => {
		const env = makeKeydownEnv(SOURCE);

		await env.keydown.handleKeyDown(press('a', { ctrlKey: true }));
		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.ownsRange).toBe(true);
		expect(env.selection.anchor?.path).toEqual([0]);
		expect(env.selection.focus?.path).toEqual([2]);
	});

	it('re-selects the whole document when pressed with a range already active', async () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true }))).toBe(true);

		expect(env.selection.focus?.path).toEqual([2]);
	});

	// Ctrl+Shift+A is a different chord and must not count as a second press.
	it('ignores the shifted chord', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('a', { ctrlKey: true, shiftKey: true }))).toBe(
			false
		);

		expect(env.selection.selectAllCount).toBe(0);
	});
});

describe('cross-block keydown: compositionstart', () => {
	it('deletes the active range synchronously and reports it handled', () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		expect(env.keydown.handleCompositionStart()).toBe(true);

		expect(env.source()).toBe('ata\n\ngamma\n');
		expect(env.selection.ownsRange).toBe(false);
	});

	it('declines with no range active, leaving the composition to the block', () => {
		const env = makeKeydownEnv(SOURCE);

		expect(env.keydown.handleCompositionStart()).toBe(false);

		expect(env.source()).toBe(SOURCE);
	});

	// Miss-analysis: only the arm's own reading-mode check was tested, never the delete's refusal.
	it('forced in reading mode, where nothing can compose, deletes nothing and warns', () => {
		const env = makeKeydownEnv(SOURCE, { presentationMode: 'reading' });
		env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		env.keydown.handleCompositionStart();

		expect(env.source()).toBe(SOURCE);
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});
