// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { useMountGauge } from '../../perf/use-mount-gauge.svelte';
import { enablePerfInstruments, resetPerfInstruments, perfSnapshot } from '../../perf/instruments';

describe('useMountGauge', () => {
	beforeEach(() => {
		enablePerfInstruments();
		resetPerfInstruments();
	});

	// The gauge's inc/dec are unit-tested directly elsewhere; what only the wrapper
	// can regress is dropping the cleanup, so this pins mount-up / teardown-down.
	it('counts the component into the gauge on mount and back out on teardown', () => {
		const dispose = $effect.root(() => {
			useMountGauge();
		});
		flushSync();
		expect(perfSnapshot().mountedBlockCount).toBe(1);

		dispose();
		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});
});
