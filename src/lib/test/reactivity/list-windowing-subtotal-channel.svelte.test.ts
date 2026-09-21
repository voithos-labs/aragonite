// @vitest-environment jsdom
// Miss-analysis: both cases sit on the subtotal a child reports upward, which no unit suite
// drove: the self-height report was only ever watched through an e2e, where a redundant report
// is invisible, and where the id comes from corrects itself on the very next rebuild.
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

		// Three real child height writes and one unchanged box: a reporter with no check writes to
		// the parent's height table on every one, and reading and writing inside the observer's own
		// frame is what raises the ResizeObserver loop warning.
		for (const height of [50, 60, 70]) {
			windowing.recordMeasuredChild(0, 'b0', height);
			flushSync();
			await tick();
		}

		expect(reportSelfHeight).toHaveBeenCalledTimes(1);
		expect(reportSelfHeight).toHaveBeenCalledWith(640);
		cleanup();
	});

	it('addresses a subtotal by the id the height table is indexed by, not the live child list', () => {
		const oracleRef = countingOracle();
		const ids = ['b0', 'b1', 'b2'];
		const { windowing, cleanup } = mountScope({ ids, oracleRef });
		oracleRef.recordMeasured.mockClear();

		// A structural change lands before the rebuild effect flushes: the live id list has already
		// moved while the height table still holds the old ordering.
		ids.splice(0, ids.length, 'bNew', 'b0', 'b1', 'b2');
		windowing.setChildSubtotal(0, 999);

		expect(oracleRef.recordMeasured).toHaveBeenCalledWith('b0', 999);
		cleanup();
	});
});
