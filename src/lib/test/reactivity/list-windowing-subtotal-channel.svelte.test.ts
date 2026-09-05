// @vitest-environment jsdom
// Miss-analysis: both arms sit on the upward subtotal channel, which no unit suite drove —
// the self-height report was only ever observed through an e2e where a redundant report is
// invisible, and the id sourcing self-corrects on the very next rebuild.
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
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
		// A nested scope: the subtotal channel only exists below the top level.
		getParentPath: () => [0]
	});
}

describe('list-windowing subtotal channel', () => {
	it('reports its own box height only when the box actually moves (#189)', () => {
		const oracleRef = countingOracle();
		const reportSelfHeight = vi.fn();
		const { windowing, cleanup } = mountScope({
			ids: ['b0', 'b1', 'b2'],
			oracleRef,
			getOwnEl: () => stubOwnEl(640),
			reportSelfHeight
		});

		// Three genuine child height writes, one unchanged box: an ungated reporter re-enters
		// the parent's model on every one, and the read-write cycle inside the observer's own
		// delivery frame is what raises the ResizeObserver loop warning.
		for (const height of [50, 60, 70]) {
			windowing.recordMeasuredChild(0, 'b0', height);
			flushSync();
		}

		expect(reportSelfHeight).toHaveBeenCalledTimes(1);
		expect(reportSelfHeight).toHaveBeenCalledWith(640);
		cleanup();
	});

	it('addresses a subtotal by the id the MODEL is indexed by, not the live child list', () => {
		const oracleRef = countingOracle();
		const ids = ['b0', 'b1', 'b2'];
		const { windowing, cleanup } = mountScope({ ids, oracleRef });
		oracleRef.recordMeasured.mockClear();

		// A structural change lands before the rebuild effect flushes: the live id list has
		// already moved while the model still carries the old ordering.
		ids.splice(0, ids.length, 'bNew', 'b0', 'b1', 'b2');
		windowing.setChildSubtotal(0, 999);

		expect(oracleRef.recordMeasured).toHaveBeenCalledWith('b0', 999);
		cleanup();
	});
});
