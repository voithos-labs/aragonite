// @vitest-environment jsdom
//
// Command-candidate keys (Enter, Tab, Mod+B/I, Mod+0-6) are owned by the block at the caret, so
// over a cross-block range they delete then dispatch. Dispatching first would run against stale
// indices; deleting without dispatching would swallow the keystroke. The reveal target is the
// authoritative post-delete caret, not the pre-delete start path — they differ for a table end.
import { describe, it, expect, vi } from 'vitest';
import { mockRef } from '../../harness/editor-actions';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

function envWithCommandTarget(runCommand = vi.fn(() => true), presentationMode?: 'reading') {
	const env = makeKeydownEnv(SOURCE, {
		revealTo: mockRef({ runCommand }),
		...(presentationMode ? { presentationMode } : {})
	});
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
	return { env, runCommand };
}

describe('cross-block keydown — command candidates', () => {
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

		await env.keydown.handleKeyDown(press('Tab'));

		expect(env.revealed.at(-1)).toEqual([0]);
	});

	it('resolves the chord against the survivor kind, not the anchor kind', async () => {
		const runCommand = vi.fn(() => true);
		const env = makeKeydownEnv('# head\n\npara\n', { revealTo: mockRef({ runCommand }) });
		env.selection.enterCrossBlock({ path: [0], offset: 6 }, { path: [1], offset: 4 });

		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));

		expect(runCommand).toHaveBeenCalledWith('format.toggleStrong', undefined);
	});

	// Reading mode: consumed (the range must not reach a per-block handler) but neither
	// half runs — no delete, no command.
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

	// The contrapositive of `isCommandCandidateKey` at its only caller: a modified Enter/Tab is NOT a
	// candidate, so a guard widened to every Enter would delete the range on Ctrl+Enter.
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

	// Every format toggle is owed the same route, and the two newest split on Shift: Mod+E rides
	// the unshifted arm, Mod+Shift+X an arm of its own.
	for (const [chord, key, init, command] of [
		['Mod+E', 'e', { ctrlKey: true }, 'format.toggleCode'],
		['Mod+Shift+X', 'x', { ctrlKey: true, shiftKey: true }, 'format.toggleStrikethrough']
	] as const) {
		it(`${chord} deletes the range then dispatches ${command}`, async () => {
			const { env, runCommand } = envWithCommandTarget();

			expect(await env.keydown.handleKeyDown(press(key, init))).toBe(true);

			expect(env.source()).toBe('ata\n\ngamma\n');
			expect(runCommand).toHaveBeenCalledWith(command, undefined);
		});
	}

	// The whole-block cut reads Mod+X off the keydown with its own `!e.shiftKey` guard, so a
	// candidate arm that took the unshifted form would delete the range out from under it.
	it('Mod+X is not a candidate — the unshifted chord is the whole-block cut', async () => {
		const { env, runCommand } = envWithCommandTarget();

		expect(await env.keydown.handleKeyDown(press('x', { ctrlKey: true }))).toBe(false);

		expect(env.source()).toBe(SOURCE);
		expect(runCommand).not.toHaveBeenCalled();
	});

	it('Mod+Shift+B is not a candidate — the shifted chord belongs to the block', async () => {
		const { env, runCommand } = envWithCommandTarget();

		expect(await env.keydown.handleKeyDown(press('b', { ctrlKey: true, shiftKey: true }))).toBe(
			false
		);

		expect(env.source()).toBe(SOURCE);
		expect(runCommand).not.toHaveBeenCalled();
	});
});
