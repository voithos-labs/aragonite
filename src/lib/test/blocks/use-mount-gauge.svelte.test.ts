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

	// The gauge's counting has its own tests; what only the wrapper can break is its cleanup.
	it('counts the component into the gauge on mount and back out on teardown', () => {
		const dispose = $effect.root(() => {
			useMountGauge();
		});
		flushSync();
		expect(perfSnapshot().mountedBlockCount).toBe(1);

		dispose();
		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});

	// The gauge is a running balance, so whether a mount counts is decided once, at mount, and
	// teardown does not read `perfEnabled()` again.
	it('does not decrement a mount it never counted when perf branches mid-life', () => {
		disablePerfInstruments();
		const dispose = $effect.root(() => {
			useMountGauge();
		});
		flushSync();

		enablePerfInstruments();
		dispose();

		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});

	// Disabling perf mid-life needs no test here: a disabled gauge counts nothing, and enabling it
	// again goes through `resetPerfInstruments`.
	it('never reads negative across a branch flip on many mounts', () => {
		disablePerfInstruments();
		const disposers = [0, 1, 2].map(() => $effect.root(() => useMountGauge()));
		flushSync();

		enablePerfInstruments();
		for (const dispose of disposers) dispose();

		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});
});
