// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import { makeKeydownEnv, press } from './keydown-env';

// Every key the cross-block dispatcher consumes returns before handleSharedKeydown reaches its
// sticky decision, and the collapse arms run no commit — so nothing downstream resets either.
// Driven at the dispatcher because that is the entry path that swallows the key.

function envWithColumn() {
	const env = makeKeydownEnv('alpha beta gamma\n\ndelta\n');
	env.selection.enterCrossBlock({ path: [0], offset: 16 }, { path: [1], offset: 0 });
	env.stickyColumn.capture(asEditorX(600));
	return env;
}

describe('cross-block keydown — sticky column', () => {
	it('resets the column on a key it consumes to collapse the selection', async () => {
		const env = envWithColumn();

		expect(await env.keydown.handleKeyDown(press('ArrowLeft'))).toBe(true);

		expect(env.stickyColumn.get()).toBeNull();
	});

	it('resets on Escape, which also collapses without a commit behind it', async () => {
		const env = envWithColumn();

		expect(await env.keydown.handleKeyDown(press('Escape'))).toBe(true);

		expect(env.stickyColumn.get()).toBeNull();
	});

	it('preserves the column on a vertical arrow — the dispatcher has no caret to measure', async () => {
		const env = envWithColumn();

		await env.keydown.handleKeyDown(press('ArrowDown'));

		expect(env.stickyColumn.get()).toBe(600);
	});

	it('preserves the column for a bare modifier the dispatcher does not consume', async () => {
		const env = makeKeydownEnv('alpha beta gamma\n\ndelta\n');
		env.stickyColumn.capture(asEditorX(600));

		expect(await env.keydown.handleKeyDown(press('Shift'))).toBe(false);

		expect(env.stickyColumn.get()).toBe(600);
	});
});
