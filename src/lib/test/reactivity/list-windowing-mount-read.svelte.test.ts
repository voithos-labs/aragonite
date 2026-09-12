// @vitest-environment jsdom
// Miss-analysis: every measure test registered a child whose height was already final and then
// flushed, so no test mounted a host whose content lands in a later effect of the same flush,
// which is what every BlockHost does; the empty-host read only showed as a scroll jerk in e2e.
import { describe, it, expect } from 'vitest';
import { flushSync, tick } from 'svelte';
import { fixedOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const ESTIMATE = 10;
const EMPTY_HOST = 50;
const RENDERED = 200;

describe('the batched measure pass reads a host after the flush that mounted it', () => {
	it('records the rendered height, not the empty host the mount flush holds', async () => {
		const children = [makePara('p0\n'), makePara('p1\n'), makePara('p2\n')];
		const { windowing, cleanup, port } = mountListWindowing({
			children,
			ids: ['b0', 'b1', 'b2'],
			oracle: fixedOracle(ESTIMATE),
			listHeight: 3 * ESTIMATE
		});

		let rendered = false;
		const applied: number[] = [];
		// A host registers in one effect and paints its content in a later one of the same
		// flush, as a BlockHost and its block component do.
		const unmount = $effect.root(() => {
			$effect(() => {
				return windowing.registerChild('b0', {
					readHeight: () => (rendered ? RENDERED : EMPTY_HOST),
					applyHeight: (h) => {
						applied.push(h);
						windowing.recordMeasuredChild(0, 'b0', h);
					}
				});
			});
			$effect(() => {
				rendered = true;
			});
		});
		flushSync();
		await tick();

		expect(applied).toEqual([RENDERED]);
		// The model is what the spacers read: block 1 now starts under the rendered height.
		await windowing.revealChild(1);
		expect(port.scrollTop()).toBe(RENDERED);

		unmount();
		cleanup();
	});
});
