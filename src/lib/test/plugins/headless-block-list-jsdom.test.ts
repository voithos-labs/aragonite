// @vitest-environment jsdom
// Miss-analysis: every container-kit suite ran in node, where Svelte compiles effects away.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { getStateForNode } from '#lib/block-lists/state-registry.js';
import { mountBlockListState } from '#lib/testing/headless-block-list.svelte.js';

describe('the conformance kits’ block-list state under a DOM test environment', () => {
	it('builds and registers the production state with no component around it', () => {
		const list = parse('- a\n- b\n').children[0];

		const state = mountBlockListState(() => list);

		expect(getStateForNode(list)).toBe(state);
		expect(state.innerBlockIds).toHaveLength(2);
		expect(state.innerBlockRefs.every((ref) => ref !== undefined)).toBe(true);
	});
});
