// @vitest-environment jsdom
// The caret memory forgets during a block's teardown, inside Svelte's own update, where a write to
// reactive state throws even when it writes the value already there.
// Miss-analysis: the records' end moved into one place and lost its "only when open" check, and
// no unit row forgot the memory from inside a reactive read; only an e2e unmount saw the throw.
import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { createCaretMemory } from '#lib/caret/caret-memory.js';

describe('forgetting with nothing pending', () => {
	it('writes no reactive state, so a forget inside a derived read is safe', () => {
		const memory = createCaretMemory();
		let read = 0;
		const stop = $effect.root(() => {
			const forgotten = $derived.by(() => {
				memory.forget();
				memory.pendingBreak.forBlock({}).end();
				return 1;
			});
			$effect(() => {
				read = forgotten;
			});
		});
		expect(() => flushSync()).not.toThrow();
		expect(read).toBe(1);
		stop();
	});
});
