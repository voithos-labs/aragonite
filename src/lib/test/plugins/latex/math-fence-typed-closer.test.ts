// A body line typed into a ```math source that reads as its closer grows the fence, as it does in
// a code block, rather than splitting the block in two (GH #593).
// Miss-analysis: the fence rule's tests wrote from outside the block (find/replace, a range
// delete), and the leaf's typing commit never reached the rule at all.
import { describe, it, expect, beforeEach } from 'vitest';
import { serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathFence, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { makeTopHarness } from '$lib/test/harness/editor-actions';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathFence();
});

describe('typing a closer-shaped line into a math fence', () => {
	it('grows both fence runs and keeps one block', async () => {
		const h = makeTopHarness('```math\nx\n```\n\npara\n');
		expect(h.deps.doc.children[0].kind).toBe(MATH_FENCE);

		await h.actions.updateBlockContent(0, '```math\nx\n```\ny\n```\n', 'authored', 10, 14);

		expect(h.deps.doc.children.map((c) => c.kind)).toEqual([MATH_FENCE, 'paragraph']);
		expect(serialize(h.deps.doc)).toBe('````math\nx\n```\ny\n````\n\npara\n');
	});
});
