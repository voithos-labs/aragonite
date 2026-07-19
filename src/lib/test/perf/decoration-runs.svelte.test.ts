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

// Ceiling: the decoration engine's per-edit cost is O(sources), independent of
// document size. A per-block cascade — the regression this guards — would scale
// decorationRuns with the thousands of blocks in the fixture, not with the edit
// count. Render-key parity for an undecorated block (no island suffix, byte-
// identical key) is pinned separately in blocks/text/render-islands.test.ts.

// A ~1MB flat document: thousands of prose blocks, so a count that tracked blocks
// instead of edits would be off by three orders of magnitude. Parsed once.
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
