// @vitest-environment jsdom
// Miss-analysis: only an e2e drove the subtotal a child reports up, where extra reports hide.
import { describe, it, expect, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import { fixedOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

function countingOracle(): { oracle: HeightOracle; recordMeasured: ReturnType<typeof vi.fn> } {
	const recordMeasured = vi.fn();
	return { recordMeasured, oracle: { ...fixedOracle(100), recordMeasured } };
}

function stubOwnEl(height: number): HTMLElement {
	return { getBoundingClientRect: () => ({ height }) } as unknown as HTMLElement;
}

interface ScopeOpts {
	ids: string[];
	oracleRef: ReturnType<typeof countingOracle>;
	getOwnEl?: () => HTMLElement | null;
	reportSelfHeight?: (height: number) => void;
}

function mountScope(opts: ScopeOpts) {
	return mountListWindowing({
		children: opts.ids.map((_, i) => makePara(`p${i}\n`)),
		ids: opts.ids,
		oracle: opts.oracleRef.oracle,
		listHeight: 2000,
		getOwnEl: opts.getOwnEl,
		reportSelfHeight: opts.reportSelfHeight,
		// A nested list: the subtotal report only exists below the top level.
		getParentPath: () => [0]
	});
}

describe('list-windowing subtotal channel', () => {
	it('reports its own box height only when the box actually moves (#189)', async () => {
		const oracleRef = countingOracle();
		const reportSelfHeight = vi.fn();
		const { windowing, cleanup } = mountScope({
			ids: ['b0', 'b1', 'b2'],
			oracleRef,
			getOwnEl: () => stubOwnEl(640),
			reportSelfHeight
		});

		// An unchecked reporter would write the parent's table on every change, and writing inside
		// the observer's own frame raises the ResizeObserver loop warning.
		let current = 0;
		windowing.registerChild('b0', { index: 0, readHeight: () => current });
		for (const height of [50, 60, 70]) {
			current = height;
			windowing.measureChildNow('b0');
			flushSync();
			await tick();
		}

		expect(reportSelfHeight).toHaveBeenCalledTimes(1);
		expect(reportSelfHeight).toHaveBeenCalledWith(640);
		cleanup();
	});
});
