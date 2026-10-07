import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { rebuildContainerRaw } from '$lib/schema/container-raw';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { fixtureGrammar } from '$lib/test/harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

// A demoted block stops interrupting the paragraph above it, so the write asks both edges of its
// window and reports where its text starts inside the survivor, which may be the predecessor.
// Miss-analysis: GH #21, the demotion's join was tested only below the write.

describe('a kind demotion settles the join above (GH #21)', () => {
	it('absorbs the predecessor the demoted block stopped interrupting', () => {
		const doc = parse('a\n# h\n');

		const settled = updateNodeContent(doc, 1, 'x# h\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('a\nx# h\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\nx# h\n']);
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 2,
			newCount: 1,
			idMap: { 0: 0 }
		});
		// The written text sits behind the predecessor's bytes and the join newline.
		expect(settled.textStart).toBe(2);
	});

	// Both joins at once: the write must report one window, not two merges the ids resync twice.
	it('folds three blocks into one when the demotion sat between two paragraphs', () => {
		const doc = parse('a\n# h\nb\n');

		const settled = updateNodeContent(doc, 1, 'x# h\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('a\nx# h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\nx# h\nb\n']);
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 1,
			idMap: { 0: 0 }
		});
		expect(settled.textStart).toBe(2);
	});

	// The other side of the same branch: the marker deleted rather than pushed off offset 0.
	it('absorbs when the marker is deleted instead', () => {
		const doc = parse('a\n# h\nb\n');

		const settled = updateNodeContent(doc, 1, ' h\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('a\n h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\n h\nb\n']);
		expect(settled.textStart).toBe(2);
	});

	// The container write takes marker-stripped body bytes, a different reading path than the
	// document's, so the upper edge needs its own pin there.
	it('absorbs inside a container body too', () => {
		const doc = parse('> a\n> # h\n> b\n');
		const quote = doc.children[0];

		const settled = updateNodeContent(
			{ children: quote.children!, owner: quote, lineEnding: '\n' },
			1,
			'x# h\n',
			defaultGrammarView,
			createSharingState()
		);
		rebuildContainerRaw(quote, fixtureGrammar);

		expect(serialize(doc)).toBe('> a\n> x# h\n> b\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(quote.children!.map((c) => c.raw)).toEqual(['a\nx# h\nb\n']);
		expect(settled.textStart).toBe(2);
	});

	// A multi-block write disturbs a join at each edge and between each pair of new blocks, and
	// the text offset is measured from the window's head either way.
	it('asks both edges of a multi-block write', () => {
		const doc = parse('a\n# h\nb\n');

		const settled = updateNodeContent(doc, 1, 'x\n\ny\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('a\nx\n\ny\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\nx\n', 'y\nb\n']);
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 2,
			idMap: { 0: 0 }
		});
		expect(settled.textStart).toBe(2);
	});

	// The blank branch's merge starts above the write, since blank lines don't stop the container
	// above, and it reports the offset the caret placement uses.
	it('reports the offset when emptying a block lets the container above swallow it', () => {
		const doc = parse('- item\n\ntext\n\n    code\n');

		const settled = updateNodeContent(doc, 1, '\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('- item\n\n\n    code\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.kind)).toEqual(['list']);
		expect(settled.change).toEqual({
			op: 'replace',
			at: 0,
			count: 3,
			newCount: 1,
			idMap: { 0: 0 }
		});
		// `- item\n` and the blank line the list keeps between them.
		expect(settled.textStart).toBe(8);
	});

	// The decline side: a blank line above still separates, so only the join below merges and the
	// written text keeps the window's head.
	it('leaves a separated predecessor standing', () => {
		const doc = parse('a\n\n# h\nb\n');

		const settled = updateNodeContent(doc, 1, 'x# h\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe('a\n\nx# h\nb\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', 'x# h\nb\n']);
		expect(settled.textStart).toBe(0);
	});
});
