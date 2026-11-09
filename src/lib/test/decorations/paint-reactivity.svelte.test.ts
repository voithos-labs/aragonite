// @vitest-environment jsdom
// A block's paint is read through a derived that returns its cached arrays, so an overlay stays
// quiet only while Svelte skips a derived's dependents when it returns the same value again.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';

describe('a derived that returns the value it held', () => {
	it("reruns on its own input and leaves its dependents' effects alone", () => {
		const kept = ['mark'];
		let raw = $state.raw('one');
		let derivedRuns = 0;
		let effectRuns = 0;
		const stop = $effect.root(() => {
			const marks = $derived.by(() => {
				derivedRuns++;
				void raw;
				return kept;
			});
			$effect(() => {
				void marks;
				effectRuns++;
			});
		});
		flushSync();
		raw = 'two';
		flushSync();
		expect([derivedRuns, effectRuns]).toEqual([2, 1]);
		stop();
	});
});
