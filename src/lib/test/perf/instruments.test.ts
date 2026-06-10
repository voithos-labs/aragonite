import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../core/parser';
import type { PerfSnapshot } from '../../perf/instruments';
import {
	disablePerfInstruments,
	docByteLength,
	enablePerfInstruments,
	perfEnabled,
	perfSnapshot,
	recordInlineRefresh,
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
	parseCount: 0,
	parseMsTotal: 0,
	parseBlockCount: 0,
	inlineRefreshCount: 0,
	inlineRefreshNodeCount: 0,
	undoLiveBytes: 0,
	undoEntryCount: 0
};

function recordOneOfEach(): void {
	recordSnapshotClone(100);
	recordRebuildDepth(3);
	recordParse(1.5, 10);
	recordInlineRefresh(5);
	setUndoGauge(1000, 2);
}

describe('perf instruments', () => {
	beforeEach(() => {
		resetPerfInstruments();
		disablePerfInstruments();
	});
	afterEach(() => vi.unstubAllEnvs());

	it('enable is a no-op outside dev and Vitest', () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('VITEST', '');
		enablePerfInstruments();
		expect(perfEnabled()).toBe(false);
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
		recordInlineRefresh(7);
		setUndoGauge(1234, 3);
		const s = perfSnapshot();
		expect(s.snapshotCloneBytes).toBe(150);
		expect(s.snapshotCount).toBe(2);
		expect(s.rebuildDepths).toEqual({ 2: 2, 4: 1 });
		expect(s.parseCount).toBe(1);
		expect(s.parseBlockCount).toBe(10);
		expect(s.inlineRefreshCount).toBe(1);
		expect(s.inlineRefreshNodeCount).toBe(7);
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
});
