// @vitest-environment jsdom
// Miss-analysis: every suite that ran the container kit used the node environment, where Svelte
// compiles effects away, so none saw the kit's block-list state throw outside a component.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { getStateForNode } from '$lib/reactivity/state-registry';
import { mountBlockListState } from '$lib/testing/headless-block-list.svelte';

describe('the conformance kits’ block-list state under a DOM test environment', () => {
	it('builds and registers the production state with no component around it', () => {
		const list = parse('- a\n- b\n').children[0];

		const state = mountBlockListState(() => list);

		expect(getStateForNode(list)).toBe(state);
		expect(state.innerBlockIds).toHaveLength(2);
		expect(state.innerBlockRefs.every((ref) => ref !== undefined)).toBe(true);
	});
});
