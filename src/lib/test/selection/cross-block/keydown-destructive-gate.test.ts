// @vitest-environment jsdom
//
// The destructive arm: Backspace/Delete over a cross-block range. It consumes the key
// unconditionally — the range must never fall through to a per-block handler that
// would delete one character against stale block indices — but it only MUTATES when
// the mode allows edits. Reading mode therefore has two obligations that pull in
// opposite directions, and a gate that got them backwards would look correct from
// either side alone.
//
// This is also the only reading-gate arm `keydown.ts` carries itself: G4.19's lint
// allowlists the file on the strength of these branches.
import { describe, it, expect } from 'vitest';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

function selectFirstTwo(env: ReturnType<typeof makeKeydownEnv>) {
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
}

describe('cross-block keydown — destructive arm', () => {
	for (const key of ['Backspace', 'Delete']) {
		it(`${key} deletes the range and leaves cross-block mode`, async () => {
			const env = makeKeydownEnv(SOURCE);
			selectFirstTwo(env);

			const event = press(key);
			expect(await env.keydown.handleKeyDown(event)).toBe(true);

			expect(event.defaultPrevented).toBe(true);
			expect(env.source()).toBe('ata\n\ngamma\n');
			expect(env.selection.isCrossBlock).toBe(false);
		});

		it(`${key} consumes the key but changes nothing in reading mode`, async () => {
			const env = makeKeydownEnv(SOURCE, { presentationMode: 'reading' });
			selectFirstTwo(env);

			const event = press(key);
			expect(await env.keydown.handleKeyDown(event)).toBe(true);

			expect(event.defaultPrevented).toBe(true);
			expect(env.source()).toBe(SOURCE);
			expect(env.selection.isCrossBlock).toBe(true);
		});
	}

	// Cut and copy are deliberately NOT consumed here: the synthetic clipboard event
	// has to reach the block's own handler, which writes synchronously through
	// `e.clipboardData`. Consuming them would silently break copy out of a selection.
	for (const key of ['c', 'x']) {
		it(`Ctrl+${key} passes through to the block clipboard handler`, async () => {
			const env = makeKeydownEnv(SOURCE);
			selectFirstTwo(env);

			const event = press(key, { ctrlKey: true });
			expect(await env.keydown.handleKeyDown(event)).toBe(false);

			expect(event.defaultPrevented).toBe(false);
			expect(env.source()).toBe(SOURCE);
		});
	}

	it('leaves Backspace alone when no cross-block range is active', async () => {
		const env = makeKeydownEnv(SOURCE);

		expect(await env.keydown.handleKeyDown(press('Backspace'))).toBe(false);

		expect(env.source()).toBe(SOURCE);
	});
});
