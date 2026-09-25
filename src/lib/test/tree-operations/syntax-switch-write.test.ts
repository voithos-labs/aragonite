// Miss-analysis: the join check after a write parsed with the global grammar, and every write test
// ran in it, so no test asked whether a switched-off syntax could come back through a merge.
import { describe, it, expect } from 'vitest';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import {
	cascadeCleanupEmptyAncestors,
	mergeIntoPrevDeepLeaf,
	splitNode,
	updateNodeContent
} from '$lib/tree-operations';
import { deleteAtPath, replaceAtPath } from '$lib/tree-operations/path-mutate';
import { createSharingState } from '$lib/tree-operations/sharing';
import { createRegistryView } from '$lib/schema/registry-view';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';

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
		updateNodeContent(doc, 0, 'Plan\n', defaultGrammarView);
		expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
		expect(describeConvergence(doc)).toBeNull();
	});
});

// Miss-analysis: every split, join and range-delete test ran in the shipped grammar, so no
// test saw the fix-up after each of them read the joined bytes without the editor's grammar.
describe('a split, join or delete beside a switched-off syntax', () => {
	interface Route {
		name: string;
		source: string;
		run: (doc: Document) => void;
		kinds: string[];
	}

	const routes: Route[] = [
		{
			name: 'Enter between `a` and `bc` above `---`',
			source: 'abc\n---\n',
			run: (doc) => splitNode(doc, 0, 1, createSharingState(), fixtureReading({ grammar: off })),
			kinds: ['paragraph', 'paragraph', 'thematicBreak']
		},
		{
			name: 'Backspace joining a heading into the paragraph above `---`',
			source: 'a\n# h\n---\n',
			run: (doc) =>
				mergeIntoPrevDeepLeaf(doc, 1, createSharingState(), fixtureReading({ grammar: off })),
			kinds: ['paragraph', 'thematicBreak']
		},
		{
			name: 'a range delete taking the block between a paragraph and `---`',
			source: 'a\n# h\n---\n',
			run: (doc) => deleteAtPath(doc, [1], createSharingState(), off),
			kinds: ['paragraph', 'thematicBreak']
		},
		{
			name: 'a range delete replacing that block with nothing',
			source: 'a\n# h\n---\n',
			run: (doc) => replaceAtPath(doc, [1], [], createSharingState(), off),
			kinds: ['paragraph', 'thematicBreak']
		},
		{
			name: 'a range delete that empties the list between a paragraph and `---`',
			source: 'a\n- x\n---\n',
			run: (doc) => {
				doc.children[1].children![0].children = [];
				cascadeCleanupEmptyAncestors(doc, [1, 0, 0], [], createSharingState(), off);
			},
			kinds: ['paragraph', 'thematicBreak']
		}
	];

	for (const route of routes) {
		it(`${route.name} leaves what a reload reads`, () => {
			const doc = parse(route.source, { grammar: off });
			route.run(doc);
			expect(doc.children.map((c) => c.kind)).toEqual(route.kinds);
			expect(describeConvergence(doc, off)).toBeNull();
		});
	}
});

// The same key through the editor's own actions, so a route that dropped the editor's reading
// between the key and the tree operation fails here too.
describe('Enter beside a switched-off syntax, through the editor actions', () => {
	const reading = fixtureReading({ grammar: off });

	it('Enter between `a` and `bc` above `---` leaves a paragraph over a divider', async () => {
		const h = makeTopHarness(parse('abc\n---\n', { grammar: off }), { reading });
		await h.actions.splitBlock(0, 1);
		expect(h.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph', 'thematicBreak']);
		expect(describeConvergence(h.doc, off)).toBeNull();
	});
});
