// A body line typed into a ```math source that reads as its closer grows the fence, as it does in
// a code block, rather than splitting the block in two.
// Miss-analysis: the fence rule's tests wrote from outside the block, never by typing (GH #593).
import { describe, it, expect, beforeEach } from 'vitest';
import { serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	registerMathBlock,
	registerMathFence,
	MATH_BLOCK,
	MATH_FENCE
} from '$lib/plugins/latex/latex-kind';
import { makeContainerHarness, makeTopHarness } from '$lib/test/harness/editor-actions';

beforeEach(() => {
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

	// The quote's keystroke takes the write path a container shares with the top level.
	it('does the same inside a quote', async () => {
		const h = makeContainerHarness('> ```math\n> x\n> ```\n>\n> para\n', [0]);
		expect(h.getNode().children![0].kind).toBe(MATH_FENCE);

		await h.bundle.blockEdit.updateBlockContent(0, '```math\nx\n```\ny\n```\n', 'authored', 10, 14);

		expect(h.getNode().children!.map((c) => c.kind)).toEqual([MATH_FENCE, 'paragraph']);
		expect(serialize(h.deps.doc)).toBe('> ````math\n> x\n> ```\n> y\n> ````\n>\n> para\n');
	});
});

// A `$$` block is closed by parse, so its rule puts back a closer the source edit dropped.
describe('a $$ source committed without its closer', () => {
	it('gets the closer back', async () => {
		resetPluginPlatformForTests();
		registerMathBlock();
		const h = makeTopHarness('$$\nx\n$$\n');
		expect(h.deps.doc.children[0].kind).toBe(MATH_BLOCK);

		await h.actions.updateBlockContent(0, '$$\nx\n', 'authored', 5, 5);

		expect(serialize(h.deps.doc)).toBe('$$\nx\n$$\n');
		expect(h.deps.doc.children[0].kind).toBe(MATH_BLOCK);
	});
});
