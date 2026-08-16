// @vitest-environment jsdom
// Miss-analysis: both arms sit on the upward subtotal channel, which no unit suite drove —
// the self-height report was only ever observed through an e2e where a redundant report is
// invisible, and the id sourcing self-corrects on the very next rebuild.
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createListWindowing, type ListWindowing } from '../../reactivity/list-windowing.svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { CstNode } from '../../core/nodes';
import { stubListEl, stubScrollport } from '../harness/stub-scrollport';

const makePara = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

function countingOracle(): { oracle: HeightOracle; recordMeasured: ReturnType<typeof vi.fn> } {
	const recordMeasured = vi.fn();
	return {
		recordMeasured,
		oracle: {
			estimate: () => 100,
			measured: () => undefined,
			recordMeasured,
			height: () => 100,
			invalidateWidth: () => {},
			clear: () => {}
		}
	};
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

function mountScope(opts: ScopeOpts): { windowing: ListWindowing; cleanup: () => void } {
	const children = opts.ids.map((_, i) => makePara(`p${i}\n`));
	const port = stubScrollport({ viewportHeight: 500 });
	let windowing!: ListWindowing;
	const cleanup = $effect.root(() => {
		windowing = createListWindowing({
			oracle: opts.oracleRef.oracle,
			getChildren: () => children,
			getChildIds: () => opts.ids,
			getListEl: () => stubListEl(port, 2000),
			getPort: () => port,
			getOwnEl: opts.getOwnEl,
			reportSelfHeight: opts.reportSelfHeight,
			correctsScroll: () => true,
			getFocusPath: () => null,
			getWidthVersion: () => 0,
			getViewportHeightVersion: () => 0,
			getParentPath: () => [0],
			overscan: 2,
			pinExtensionCap: 100,
			activateAbovePx: 1000,
			deactivateBelowPx: 800
		});
	});
	flushSync();
	return { windowing, cleanup };
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
