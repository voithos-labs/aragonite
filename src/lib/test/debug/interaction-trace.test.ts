import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	enableInteractionTrace,
	disableInteractionTrace,
	isInteractionTraceEnabled,
	resetInteractionTrace,
	interactionTraceSnapshot,
	interactionTraceKeydownCount,
	traceRebuild,
	traceCompositionStart,
	traceKeydownVerdict,
	traceRevealFold
} from '$lib/debug/interaction-trace';

// The trace is module-global (its documented v1 limitation), so every case
// restores the shared switch + buffer around itself.
beforeEach(() => {
	resetInteractionTrace();
	enableInteractionTrace();
});
afterEach(() => {
	disableInteractionTrace();
	resetInteractionTrace();
});

describe('interaction-trace gating', () => {
	it('records nothing while disabled', () => {
		disableInteractionTrace();
		traceRebuild('raw', false);
		traceCompositionStart();
		expect(interactionTraceSnapshot()).toHaveLength(0);
	});

	it('records site/kind/detail while enabled', () => {
		traceRebuild('raw,islands', true);
		const [entry] = interactionTraceSnapshot();
		expect(entry.site).toBe('text-render');
		expect(entry.kind).toBe('rebuild');
		expect(entry.detail).toEqual({ changed: 'raw,islands', force: true });
		expect(typeof entry.t).toBe('number');
	});

	it('re-arms after a disable/enable cycle', () => {
		disableInteractionTrace();
		traceCompositionStart();
		enableInteractionTrace();
		traceCompositionStart();
		expect(interactionTraceSnapshot().map((e) => e.kind)).toEqual(['start']);
		expect(isInteractionTraceEnabled()).toBe(true);
	});
});

describe('interaction-trace ring buffer', () => {
	it('keeps entries in insertion order', () => {
		traceCompositionStart();
		traceRevealFold('commit');
		expect(interactionTraceSnapshot().map((e) => `${e.site}/${e.kind}`)).toEqual([
			'composition/start',
			'reveal/fold'
		]);
	});

	it('evicts the oldest entries past capacity (200)', () => {
		for (let i = 0; i < 205; i++) traceRebuild(String(i), false);
		const snap = interactionTraceSnapshot();
		expect(snap).toHaveLength(200);
		// First five (0–4) evicted; the tail begins at 5.
		expect(snap[0].detail?.changed).toBe('5');
		expect(snap[199].detail?.changed).toBe('204');
	});

	it('reset empties the buffer without disarming', () => {
		traceCompositionStart();
		resetInteractionTrace();
		expect(interactionTraceSnapshot()).toHaveLength(0);
		expect(isInteractionTraceEnabled()).toBe(true);
	});
});

// Miss-analysis: the absence oracles it backs read green either way, so nothing but this could
// catch a count that the ring buffer's eviction rolls back — the e2e helper would simply wait
// out its timeout and report the key as having reached no surface.
describe('interaction-trace keydown verdicts', () => {
	it('counts only while enabled', () => {
		disableInteractionTrace();
		traceKeydownVerdict('Tab', true);
		enableInteractionTrace();
		traceKeydownVerdict('Tab', true);
		expect(interactionTraceKeydownCount()).toBe(1);
	});

	it('keeps counting past the eviction that drops its own entries', () => {
		for (let i = 0; i < 205; i++) traceKeydownVerdict('a', false);
		expect(interactionTraceSnapshot()).toHaveLength(200);
		expect(interactionTraceKeydownCount()).toBe(205);
	});

	it('records the key and the verdict', () => {
		traceKeydownVerdict('Backspace', false);
		const [entry] = interactionTraceSnapshot();
		expect(entry.site).toBe('keydown');
		expect(entry.detail).toEqual({ key: 'Backspace', handled: false });
	});
});
