// @vitest-environment jsdom
// Command-candidate keys (Enter, Mod+0-6) are owned by the block at the caret, so over a
// cross-block range they delete, then dispatch at the post-delete caret: dispatching first runs
// against stale indices, and deleting alone swallows the keystroke. Format toggles are not
// candidates; they take the cross-block toggle, which marks each block's own span.
import { describe, it, expect, vi } from 'vitest';
import { stubBlockComponent } from '../../harness/editor-actions';
import { makeKeydownEnv, press } from './keydown-env';
import { isCommandCandidateKey, isIndentKey } from '$lib/selection/cross-block/keydown';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

function envWithCommandTarget(runCommand = vi.fn(() => true), presentationMode?: 'reading') {
	const env = makeKeydownEnv(SOURCE, {
		revealTo: stubBlockComponent({ runCommand }),
		...(presentationMode ? { presentationMode } : {})
	});
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
	return { env, runCommand };
}

describe('cross-block keydown: command candidates', () => {
	it('deletes the range first, then dispatches the chord at the survivor', async () => {
		const { env, runCommand } = envWithCommandTarget();

		const event = press('Enter');
		expect(await env.keydown.handleKeyDown(event)).toBe(true);

		expect(event.defaultPrevented).toBe(true);
		expect(env.source()).toBe('ata\n\ngamma\n');
		expect(runCommand).toHaveBeenCalledWith('block.split', undefined);
	});

	it('dispatches at the reveal of the post-delete caret, not the pre-delete start', async () => {
		const { env } = envWithCommandTarget();

		await env.keydown.handleKeyDown(press('Enter'));

		expect(env.revealed.at(-1)).toEqual([0]);
	});

	it('resolves the chord against the survivor kind, not the anchor kind', async () => {
		const runCommand = vi.fn(() => true);
		const env = makeKeydownEnv('# head\n\npara\n', {
			revealTo: stubBlockComponent({ runCommand })
		});
		env.selection.enterCrossBlock({ path: [0], offset: 6 }, { path: [1], offset: 4 });

		await env.keydown.handleKeyDown(press('1', { ctrlKey: true }));

		expect(runCommand).toHaveBeenCalledWith('heading.cycle', 1);
	});

	// Reading mode: consumed (the range must not reach a per-block handler) but neither half
	// runs: no delete, no command.
	it('consumes but neither deletes nor dispatches in reading mode', async () => {
		const { env, runCommand } = envWithCommandTarget(
			vi.fn(() => true),
			'reading'
		);

		const event = press('Enter');
		expect(await env.keydown.handleKeyDown(event)).toBe(true);

		expect(event.defaultPrevented).toBe(true);
		expect(env.source()).toBe(SOURCE);
		expect(runCommand).not.toHaveBeenCalled();
	});

	// The contrapositive of `isCommandCandidateKey` at its only caller: a modified Enter is not
	// a candidate, so a check widened to every Enter would delete the range on Ctrl+Enter.
	for (const [name, init] of [
		['Ctrl+Enter', { ctrlKey: true }],
		['Alt+Enter', { altKey: true }]
	] as const) {
		it(`${name} is not a candidate and deletes nothing`, async () => {
			const { env, runCommand } = envWithCommandTarget();

			expect(await env.keydown.handleKeyDown(press('Enter', init))).toBe(false);

			expect(env.source()).toBe(SOURCE);
			expect(runCommand).not.toHaveBeenCalled();
		});
	}

	// Every format toggle is handled but not a candidate: deleting first and redispatching at the
	// collapsed caret would turn the document into `****`.
	for (const [chord, key, init, mark] of [
		['Mod+B', 'b', { ctrlKey: true }, '**'],
		['Mod+I', 'i', { ctrlKey: true }, '*'],
		['Mod+E', 'e', { ctrlKey: true }, '`'],
		['Mod+Shift+X', 'x', { ctrlKey: true, shiftKey: true }, '~~']
	] as const) {
		it(`${chord} is consumed, deletes nothing and marks each block's own span`, async () => {
			const { env, runCommand } = envWithCommandTarget();

			const event = press(key, init);
			expect(await env.keydown.handleKeyDown(event)).toBe(true);

			expect(event.defaultPrevented).toBe(true);
			// The anchor's tail and the focus block's head, each marked alone, with the block past
			// the range untouched, which is what a delete-then-redispatch branch could not leave.
			expect(env.source()).toBe(`a${mark}lpha${mark}

${mark}be${mark}ta

gamma
`);
			// The dispatcher routes ahead of the block's own handler, so the focused block is never asked.
			expect(runCommand).not.toHaveBeenCalled();
		});
	}

	// The whole-block cut reads Mod+X off the keydown with its own `!e.shiftKey` guard, so a
	// candidate branch that took the unshifted form would delete the range out from under it.
	it('Mod+X is not a candidate: the unshifted chord is the whole-block cut', async () => {
		const { env, runCommand } = envWithCommandTarget();

		expect(await env.keydown.handleKeyDown(press('x', { ctrlKey: true }))).toBe(false);

		expect(env.source()).toBe(SOURCE);
		expect(runCommand).not.toHaveBeenCalled();
	});

	it('Mod+Shift+B is not a candidate: the shifted chord belongs to the block', async () => {
		const { env, runCommand } = envWithCommandTarget();

		expect(await env.keydown.handleKeyDown(press('b', { ctrlKey: true, shiftKey: true }))).toBe(
			false
		);

		expect(env.source()).toBe(SOURCE);
		expect(runCommand).not.toHaveBeenCalled();
	});

	// Tab over a range indents what it holds; as a candidate it would remove the range first.
	it('Tab and Shift+Tab are indent keys, never candidates', () => {
		const { env } = envWithCommandTarget();
		for (const init of [{}, { shiftKey: true }]) {
			expect(isCommandCandidateKey(press('Tab', init))).toBe(false);
			expect(isIndentKey(press('Tab', init), env.ctx)).toBe(true);
		}
	});
});
