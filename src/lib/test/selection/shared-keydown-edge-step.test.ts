// @vitest-environment jsdom
// A table cell asks for the edge step ahead of its navigation plan and again in the shared
// prelude, so the step answers once per keydown rather than walking the block twice.
// Miss-analysis: the cell's second ask had no test, so the double walk was invisible.
import { describe, it, expect } from 'vitest';
import { handleEdgeStep } from '$lib/selection/shared-keydown';
import type { SelectionState } from '$lib/selection/selection-state.svelte';

function asking(answer: boolean) {
	const ctx = {
		selection: { isCrossBlock: false } as SelectionState,
		asks: 0,
		stepEdge: () => {
			ctx.asks++;
			return answer;
		}
	};
	return ctx;
}

describe('handleEdgeStep', () => {
	it.each([true, false])('asks the edge step once per keydown (answer %s)', (answer) => {
		const ctx = asking(answer);
		const e = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
		expect(handleEdgeStep(e, ctx)).toBe(answer);
		expect(handleEdgeStep(e, ctx)).toBe(answer);
		expect(ctx.asks).toBe(1);
		expect(e.defaultPrevented).toBe(answer);
	});

	it('leaves a cross-block range to its own handler', () => {
		const ctx = { ...asking(true), selection: { isCrossBlock: true } as SelectionState };
		expect(handleEdgeStep(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx)).toBe(false);
	});
});
