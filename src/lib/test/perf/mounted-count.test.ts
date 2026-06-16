import { describe, it, expect, beforeEach } from 'vitest';
import {
	enablePerfInstruments,
	resetPerfInstruments,
	perfSnapshot,
	incMountedBlocks,
	decMountedBlocks
} from '../../perf/instruments';

describe('mountedBlockCount gauge', () => {
	beforeEach(() => {
		enablePerfInstruments();
		resetPerfInstruments();
	});

	it('tracks the live mounted-block count up and down', () => {
		incMountedBlocks();
		incMountedBlocks();
		incMountedBlocks();
		expect(perfSnapshot().mountedBlockCount).toBe(3);
		decMountedBlocks();
		expect(perfSnapshot().mountedBlockCount).toBe(2);
	});

	it('resets to zero', () => {
		incMountedBlocks();
		resetPerfInstruments();
		expect(perfSnapshot().mountedBlockCount).toBe(0);
	});
});
