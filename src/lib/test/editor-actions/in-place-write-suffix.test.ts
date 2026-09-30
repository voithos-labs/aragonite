// The keystroke's in-place write reads the document with its trailing blank line, as the trial
// that chose the route does, so the two agree about the last blocks and the suffix stays put.
// Miss-analysis: no test typed in place at the document's tail.
import { describe, it, expect, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

describe('typing in place at the end of a document', () => {
	it.each([
		{
			shape: 'a blank last block filled',
			source: 'a\n\n\n',
			index: 1,
			text: 'x\n',
			result: 'a\n\nx\n'
		},
		{
			shape: 'a blank block just before the last one filled',
			source: 'a\n\n\n\nb\n\n',
			index: 2,
			text: 'x\n',
			result: 'a\n\n\nx\n\nb\n\n'
		},
		{
			shape: 'the last block, above the trailing blank line',
			source: 'a\n\n',
			index: 0,
			text: 'ab\n',
			result: 'ab\n\n'
		}
	])('$shape keeps the suffix and writes in place', async ({ source, index, text, result }) => {
		const h = makeTopHarness(source);
		const suffix = h.deps.doc.suffix;
		const commit = vi.spyOn(h.controller, 'commitStructural');

		await h.actions.updateBlockContent(index, text, 'authored', 0, 1);

		expect(serialize(h.deps.doc)).toBe(result);
		expect(h.deps.doc.suffix).toBe(suffix);
		expect(commit).not.toHaveBeenCalled();
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});
});
