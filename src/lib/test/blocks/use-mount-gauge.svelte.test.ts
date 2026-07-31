// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { useMountGauge } from '../../perf/use-mount-gauge.svelte';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	resetPerfInstruments,
	perfSnapshot
} from '../../perf/instruments';

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

	// The gauge is a net balance, so arm and disarm are decided ONCE per mount. Re-reading
	// `perfEnabled()` at teardown let a flip decrement a mount that was never counted.
	it('does not decrement a mount it never counted when perf arms mid-life', () => {
		disablePerfInstruments();
		const dispose = $effect.root(() => {
			useMountGauge();
		});
		flushSync();

		enablePerfInstruments();
		dispose();

		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});

	// The other direction (disarm mid-life) is held by the counters' own gate: with the instrument
	// off there is nothing to balance, and re-arming goes through resetPerfInstruments.
	it('never reads negative across an arm flip on many mounts', () => {
		disablePerfInstruments();
		const disposers = [0, 1, 2].map(() => $effect.root(() => useMountGauge()));
		flushSync();

		enablePerfInstruments();
		for (const dispose of disposers) dispose();

		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});
});
