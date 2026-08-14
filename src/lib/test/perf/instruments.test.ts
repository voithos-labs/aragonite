import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../core/parser';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../../tree-operations/unshare';
import { createSharingState } from '../../tree-operations/sharing';
import type { PerfSnapshot } from '../../perf/instruments';
import {
	disablePerfInstruments,
	docByteLength,
	enablePerfInstruments,
	markKeystrokeSettle,
	markKeystrokeStart,
	perfSnapshot,
	recordBlockRender,
	recordDecorationRun,
	recordInlineCompute,
	recordIslandKeyScan,
	recordIslandRebuild,
	recordParse,
	recordRebuildDepth,
	recordSnapshotClone,
	resetPerfInstruments,
	setUndoGauge
} from '../../perf/instruments';

const EMPTY: PerfSnapshot = {
	snapshotCount: 0,
	snapshotCloneBytes: 0,
	rebuildDepths: {},
	containerKindReparses: 0,
	parseCount: 0,
	parseMsTotal: 0,
	parseBlockCount: 0,
	inlineComputeCount: 0,
	undoLiveBytes: 0,
	undoEntryCount: 0,
	blockRenderCount: 0,
	blockRenderMsTotal: 0,
	keystrokeInPageMs: [],
	blockRenderPaths: [],
	mountedBlockCount: 0,
	decorationRuns: 0,
	islandRebuilds: 0,
	islandKeyScans: 0
};

function recordOneOfEach(): void {
	recordSnapshotClone(100);
	recordRebuildDepth(3);
	recordParse(1.5, 10);
	recordInlineCompute();
	setUndoGauge(1000, 2);
	recordBlockRender(2);
	recordDecorationRun();
	recordIslandRebuild();
	recordIslandKeyScan();
	markKeystrokeStart();
	markKeystrokeSettle();
}

beforeEach(() => {
	resetPerfInstruments();
	disablePerfInstruments();
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.doUnmock('esm-env');
	vi.resetModules();
});

describe('perf instruments', () => {
	// `DEV` is a build-time constant, so the production arm of the switch is reachable
	// only by re-importing the module against a false one.
	it('enable is a no-op outside dev and Vitest', async () => {
		vi.resetModules();
		vi.doMock('esm-env', () => ({ DEV: false }));
		vi.stubEnv('VITEST', '');
		const production = await import('../../perf/instruments');
		production.enablePerfInstruments();
		expect(production.perfEnabled()).toBe(false);
	});

	it('records nothing while disabled', () => {
		recordOneOfEach();
		expect(perfSnapshot()).toEqual(EMPTY);
	});

	it('accumulates while enabled', () => {
		enablePerfInstruments();
		recordSnapshotClone(100);
		recordSnapshotClone(50);
		recordRebuildDepth(2);
		recordRebuildDepth(2);
		recordRebuildDepth(4);
		recordParse(1.5, 10);
		recordInlineCompute();
		recordInlineCompute();
		setUndoGauge(1234, 3);
		const s = perfSnapshot();
		expect(s.snapshotCloneBytes).toBe(150);
		expect(s.snapshotCount).toBe(2);
		expect(s.rebuildDepths).toEqual({ 2: 2, 4: 1 });
		expect(s.parseCount).toBe(1);
		expect(s.parseBlockCount).toBe(10);
		expect(s.inlineComputeCount).toBe(2);
		expect(s.undoLiveBytes).toBe(1234);
		expect(s.undoEntryCount).toBe(3);
	});

	it('snapshot is an independent copy', () => {
		enablePerfInstruments();
		recordRebuildDepth(2);
		const first = perfSnapshot();
		first.rebuildDepths[2] = 99;
		first.snapshotCount = 99;
		expect(perfSnapshot().rebuildDepths).toEqual({ 2: 1 });
		expect(perfSnapshot().snapshotCount).toBe(0);
	});

	it('reset zeroes everything after accumulation', () => {
		enablePerfInstruments();
		recordOneOfEach();
		resetPerfInstruments();
		expect(perfSnapshot()).toEqual(EMPTY);
	});

	it('docByteLength equals serialized length', () => {
		const src = '# h\n\n> quote\n\n- a\n- b\n';
		expect(docByteLength(parse(src))).toBe(src.length);
	});

	it('records block renders while enabled', () => {
		enablePerfInstruments();
		recordBlockRender(2.5);
		recordBlockRender(1.5);
		const s = perfSnapshot();
		expect(s.blockRenderCount).toBe(2);
		expect(s.blockRenderMsTotal).toBeCloseTo(4);
	});

	it('accumulates decoration and island counters while enabled', () => {
		enablePerfInstruments();
		recordDecorationRun();
		recordDecorationRun();
		recordIslandRebuild();
		recordIslandKeyScan();
		recordIslandKeyScan();
		recordIslandKeyScan();
		const s = perfSnapshot();
		expect(s.decorationRuns).toBe(2);
		expect(s.islandRebuilds).toBe(1);
		expect(s.islandKeyScans).toBe(3);
	});

	it('records the block path when one is supplied', () => {
		enablePerfInstruments();
		recordBlockRender(1, [0, 2]);
		recordBlockRender(1, [0, 2]);
		recordBlockRender(1); // no path → counted but not pathed
		const s = perfSnapshot();
		expect(s.blockRenderCount).toBe(3);
		expect(s.blockRenderPaths).toEqual(['0,2', '0,2']);
	});

	it('records one in-page keystroke sample per start/settle pair', () => {
		enablePerfInstruments();
		markKeystrokeStart();
		markKeystrokeSettle();
		markKeystrokeSettle(); // no pending start → ignored
		const s = perfSnapshot();
		expect(s.keystrokeInPageMs).toHaveLength(1);
		expect(s.keystrokeInPageMs[0]).toBeGreaterThanOrEqual(0);
	});

	it('keystroke samples array is an independent copy', () => {
		enablePerfInstruments();
		markKeystrokeStart();
		markKeystrokeSettle();
		const first = perfSnapshot();
		first.keystrokeInPageMs.push(999);
		expect(perfSnapshot().keystrokeInPageMs).toHaveLength(1);
	});
});

describe('perf seams', () => {
	it('parse() records duration and block count when enabled', () => {
		enablePerfInstruments();
		parse('# a\n\nb\n\nc\n');
		const snap = perfSnapshot();
		expect(snap.parseCount).toBe(1);
		expect(snap.parseBlockCount).toBe(3);
		expect(snap.parseMsTotal).toBeGreaterThanOrEqual(0);
	});

	it('rebuildUnsharedChain records one depth sample per chain rebuild', () => {
		const doc = parse('- a\n  - b\n');
		const sharing = createSharingState();
		// Nested paragraph's spine: list > listItem > list > listItem > paragraph.
		const chain = ensureUnsharedPath(doc, [0, 0, 1, 0, 0], sharing);
		enablePerfInstruments();
		rebuildUnsharedChain(doc, chain, sharing, null, undefined);
		expect(perfSnapshot().rebuildDepths).toEqual({ 5: 1 });
	});
});
