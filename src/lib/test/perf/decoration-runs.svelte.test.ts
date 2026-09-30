// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '../../core/parser';
import { createDecorationEngine } from '../../decorations/decoration-state.svelte';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '../../perf/instruments';
import { generateFixture } from './fixtures/generate';

// The cost per edit scales with the number of decoration sources, not document size, so one
// block's change cascading into the rest would scale `decorationRuns` with the block count.

// A flat document of about 1MB, so a count that tracks blocks rather than edits is off by
// three orders of magnitude.
const bigDoc = parse(generateFixture('flat-prose', 1_000_000));
const EDITS = 20;

describe('decoration run ceilings', () => {
	beforeEach(() => {
		enablePerfInstruments();
		resetPerfInstruments();
	});
	afterEach(() => disablePerfInstruments());

	it('zero sources: a typing pass runs no provide', () => {
		const engine = createDecorationEngine({ getDoc: () => bigDoc });
		resetPerfInstruments();
		for (let i = 0; i < EDITS; i++) engine.notifyEdit();
		expect(perfSnapshot().decorationRuns).toBe(0);
	});

	it('one idle source: decorationRuns === edits, never a per-block cascade', () => {
		const engine = createDecorationEngine({ getDoc: () => bigDoc });
		engine.addSource({ name: 'idle', provide: () => [] });
		resetPerfInstruments(); // discard the registration run; count only the pass
		for (let i = 0; i < EDITS; i++) engine.notifyEdit();
		expect(perfSnapshot().decorationRuns).toBe(EDITS);
	});
});
