// @vitest-environment jsdom
//
// The navigation arms, which stay live in reading mode because nothing they do is an
// edit. Two things are easy to get wrong and invisible if only one direction is
// tested: WHICH endpoint an unshifted arrow collapses to (left/up go to the range
// start, right/down to its end — reversing them teleports the caret across the whole
// selection), and whether a shifted arrow grows or shrinks the range.
//
// Escape shares the collapse-to-start arm but is gated on carrying no modifiers, so a
// modified Escape has to fall through rather than silently collapse.
import { describe, it, expect } from 'vitest';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

function envAcrossFirstTwo(presentationMode?: 'reading') {
	const env = makeKeydownEnv(SOURCE, presentationMode ? { presentationMode } : {});
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
	return env;
}

describe('cross-block keydown — collapse', () => {
	for (const key of ['ArrowLeft', 'ArrowUp']) {
		it(`${key} collapses to the range start`, async () => {
			const env = envAcrossFirstTwo();

			expect(await env.keydown.handleKeyDown(press(key))).toBe(true);

			expect(env.selection.isCrossBlock).toBe(false);
			expect(env.revealed.at(-1)).toEqual([0]);
		});
	}

	for (const key of ['ArrowRight', 'ArrowDown']) {
		it(`${key} collapses to the range end`, async () => {
			const env = envAcrossFirstTwo();

			expect(await env.keydown.handleKeyDown(press(key))).toBe(true);

			expect(env.selection.isCrossBlock).toBe(false);
			expect(env.revealed.at(-1)).toEqual([1]);
		});
	}

	it('Escape collapses to the range start', async () => {
		const env = envAcrossFirstTwo();

		expect(await env.keydown.handleKeyDown(press('Escape'))).toBe(true);

		expect(env.selection.isCrossBlock).toBe(false);
		expect(env.revealed.at(-1)).toEqual([0]);
	});

	// The Escape arm is explicitly modifier-free. A modified Escape belongs to
	// whatever else claims it, and collapsing on it would steal the chord.
	for (const [name, init] of [
		['Shift+Escape', { shiftKey: true }],
		['Ctrl+Escape', { ctrlKey: true }],
		['Alt+Escape', { altKey: true }]
	] as const) {
		it(`${name} falls through with the selection intact`, async () => {
			const env = envAcrossFirstTwo();

			expect(await env.keydown.handleKeyDown(press('Escape', init))).toBe(false);

			expect(env.selection.isCrossBlock).toBe(true);
		});
	}

	// Navigation is not an edit, so it stays live where the destructive arm gates.
	it('still collapses in reading mode', async () => {
		const env = envAcrossFirstTwo('reading');

		expect(await env.keydown.handleKeyDown(press('ArrowLeft'))).toBe(true);

		expect(env.selection.isCrossBlock).toBe(false);
	});
});

describe('cross-block keydown — extend', () => {
	it('Shift+ArrowDown grows the range to the next block', async () => {
		const env = envAcrossFirstTwo();

		expect(await env.keydown.handleKeyDown(press('ArrowDown', { shiftKey: true }))).toBe(true);

		expect(env.selection.focus?.path).toEqual([2]);
		expect(env.selection.anchor?.path).toEqual([0]);
	});

	// Contraction: pulling the focus back onto the anchor's own block leaves nothing
	// spanning two blocks, so the range stops being cross-block rather than lingering
	// as a zero-width one that the next keystroke would still route through here.
	it('Shift+ArrowUp back onto the anchor block leaves cross-block mode', async () => {
		const env = envAcrossFirstTwo();

		expect(await env.keydown.handleKeyDown(press('ArrowUp', { shiftKey: true }))).toBe(true);

		expect(env.selection.isCrossBlock).toBe(false);
		expect(env.selection.focus).toBeNull();
	});

	it('Ctrl+Shift+End extends to the document end', async () => {
		const env = envAcrossFirstTwo();

		expect(await env.keydown.handleKeyDown(press('End', { ctrlKey: true, shiftKey: true }))).toBe(
			true
		);

		expect(env.selection.focus?.path).toEqual([2]);
	});

	it('Ctrl+Shift+Home extends backwards to the document start', async () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock({ path: [2], offset: 1 }, { path: [1], offset: 2 });

		expect(await env.keydown.handleKeyDown(press('Home', { ctrlKey: true, shiftKey: true }))).toBe(
			true
		);

		expect(env.selection.focus?.path).toEqual([0]);
		expect(env.selection.anchor?.path).toEqual([2]);
	});
});
