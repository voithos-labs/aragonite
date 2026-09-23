// Miss-analysis: the join check after a write parsed with the global grammar, and every write test
// ran in it, so no test asked whether a switched-off syntax could come back through a merge.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations';
import { createRegistryView } from '$lib/schema/registry-view';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// A write reads its neighbours in the editor's grammar, so a paragraph that comes to sit over
// `---` in an editor without setext headings stays a paragraph over a divider.

const off = createRegistryView({ syntax: { setextHeading: false } }).grammar;

describe('a write beside a switched-off syntax', () => {
	it('a heading demoted over `---` stays a paragraph and a divider', () => {
		const doc = parse('# Plan\n---\n', { grammar: off });
		expect(doc.children.map((c) => c.kind)).toEqual(['heading', 'thematicBreak']);

		updateNodeContent(doc, 0, 'Plan\n', off);

		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'thematicBreak']);
		expect(serialize(doc)).toBe('Plan\n---\n');
		expect(describeConvergence(doc, off)).toBeNull();
	});

	it('the same write in the shipped grammar folds the two into a heading', () => {
		const doc = parse('# Plan\n---\n');
		updateNodeContent(doc, 0, 'Plan\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
		expect(describeConvergence(doc)).toBeNull();
	});
});
