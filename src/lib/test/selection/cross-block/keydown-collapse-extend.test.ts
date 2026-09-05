// @vitest-environment jsdom
//
// The navigation arms, live in reading mode because nothing they do is an edit. Two things are
// invisible if only one direction is tested: WHICH endpoint an unshifted arrow collapses to
// (left/up to range start, right/down to end), and whether a shifted arrow grows or shrinks.
// Escape shares the collapse-to-start arm but is gated on carrying no modifiers.
import { describe, it, expect } from 'vitest';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

function envAcrossFirstTwo(presentationMode?: 'reading') {
	const env = makeKeydownEnv(SOURCE, presentationMode ? { presentationMode } : {});
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
	return env;
}

// Ctrl and Cmd fold to one Mod, and `reservedChords()` publishes the folded chord, so both arms
// owe both forms. Miss-analysis: the e2e cover presses `ControlOrMeta`, which is Meta only on
// darwin and no runner is darwin, so half the chord went untested (#69).
const DOC_EDGE_CHORDS = [
	['Ctrl', { ctrlKey: true, shiftKey: true }],
	['Cmd', { metaKey: true, shiftKey: true }]
] as const;

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

	// Contraction: pulling the focus back onto the anchor's own block leaves nothing spanning two
	// blocks, so the range must stop being cross-block rather than linger as a zero-width one.
	it('Shift+ArrowUp back onto the anchor block leaves cross-block mode', async () => {
		const env = envAcrossFirstTwo();

		expect(await env.keydown.handleKeyDown(press('ArrowUp', { shiftKey: true }))).toBe(true);

		expect(env.selection.isCrossBlock).toBe(false);
		expect(env.selection.focus).toBeNull();
	});

	for (const [mod, init] of DOC_EDGE_CHORDS) {
		it(`${mod}+Shift+End extends to the document end`, async () => {
			const env = envAcrossFirstTwo();

			expect(await env.keydown.handleKeyDown(press('End', init))).toBe(true);

			expect(env.selection.focus?.path).toEqual([2]);
		});

		it(`${mod}+Shift+Home extends backwards to the document start`, async () => {
			const env = makeKeydownEnv(SOURCE);
			env.selection.enterCrossBlock({ path: [2], offset: 1 }, { path: [1], offset: 2 });

			expect(await env.keydown.handleKeyDown(press('Home', init))).toBe(true);

			expect(env.selection.focus?.path).toEqual([0]);
			expect(env.selection.anchor?.path).toEqual([2]);
		});
	}
});

describe('cross-block keydown — doc-edge from a collapsed caret', () => {
	// The claim is what this arm can assert: entering cross-block reads the native caret, which
	// needs `document.activeElement === blockEl`, and the env's block elements are detached.
	for (const [mod, init] of DOC_EDGE_CHORDS) {
		for (const key of ['End', 'Home']) {
			it(`${mod}+Shift+${key} is claimed with no range yet open`, async () => {
				const env = makeKeydownEnv(SOURCE);

				expect(await env.keydown.handleKeyDown(press(key, init))).toBe(true);
			});
		}
	}
});
