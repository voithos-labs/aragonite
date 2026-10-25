// @vitest-environment jsdom
// Only the read value runs the two steps again; what a step reads itself (the mode flip reads the
// selection) never reruns the pair.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { aroundRender } from '../around-render.svelte';

describe('aroundRender', () => {
	it('runs both steps again for a new value, never for state a step reads', () => {
		const runs: string[] = [];
		let value = $state.raw(0);
		let readByStep = $state.raw(0);
		const stop = $effect.root(() => {
			aroundRender(
				() => value,
				(v) => runs.push(`before ${v}/${readByStep}`),
				(v) => runs.push(`after ${v}/${readByStep}`)
			);
		});
		flushSync();
		readByStep = 1;
		flushSync();
		value = 1;
		flushSync();
		expect(runs).toEqual(['before 0/0', 'after 0/0', 'before 1/1', 'after 1/1']);
		stop();
	});
});
