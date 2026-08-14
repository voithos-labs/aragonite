import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { deleteNode, splitNode } from '../../tree-operations';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #61: a splice can leave neighbours whose adjacent bytes re-read as ONE block on reload —
// a list newly standing above indented code absorbs it, since no separator line can hold
// indentation apart. The seam settle absorbs the pair the way the reload will.
// Miss-analysis: the property arm excluded every document holding indented code, so the one
// adjacency no separator can fix was unreachable by construction.

describe('a splice absorbs a seam the reload would fold (GH #61)', () => {
	it('a split minting a list above indented code absorbs it', () => {
		const source = '| H0 | H1 | H2 |\n| --- | --- |\n\n    code\n\n- | H0 |\n  | --- |\n';
		const doc = parse(source);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'indentedCode', 'list']);

		const result = splitNode(doc, 0, 21, undefined, undefined, undefined);

		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'list', 'list']);
		expect(doc.children[1].raw).toBe('- | --- |\n\n    code\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(result.change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 2, idMap: { 0: 0 } });
	});

	it('a delete leaving a list against indented code absorbs it', () => {
		const doc = parse('- > ---\n      code\n\n# t\n\n    code\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'heading', 'indentedCode']);

		const change = deleteNode(doc, 1);

		expect(doc.children).toHaveLength(1);
		expect(serialize(doc)).toBe('- > ---\n      code\n\n    code\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 3, newCount: 1, idMap: { 0: 0 } });
	});

	// A blank run is transparent to continuation, so the absorber can stand above it.
	it('a delete whose absorber sits across a blank run still folds the window', () => {
		const doc = parse('- > # [t](u)\n\n\n-     code\n  \n  foo@bar.com\n\n```\n```\n');
		expect(doc.children.map((c) => c.kind)).toEqual([
			'list',
			'paragraph',
			'list',
			'paragraph',
			'fencedCode'
		]);

		const change = deleteNode(doc, 2);

		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'fencedCode']);
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 4, newCount: 1, idMap: { 0: 0 } });
	});

	// The candidate edge crosses the run too: the pulled content sits on its far side.
	it('the absorbed content can sit across a blank run of its own', () => {
		const doc = parse('- ```\n  ```\n\n\n---\n\n\n    code\n\n[ref]: https://example.com\n');
		expect(doc.children).toHaveLength(6);

		const change = deleteNode(doc, 2);

		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'linkReferenceDefinition']);
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 5, newCount: 1, idMap: { 0: 0 } });
	});

	// A structured container's children do not standalone-reparse to themselves: two items'
	// joined bytes read as a nested LIST, which is the parent's kind, not a sibling's.
	// Miss-analysis: the seam pins only drove document-level children, so no window ever held
	// a structured container's children whose joined bytes parse to the parent's own kind.
	it('a list-scope delete never absorbs items into a nested list', () => {
		const doc = parse('1. First\n2. Second\n3. Third\n');
		const list = doc.children[0];
		const parent = { children: list.children!, ownerKind: list.kind, owner: list };

		const change = deleteNode(parent as never, 1);

		expect(list.children!.map((c) => c.kind)).toEqual(['listItem', 'listItem']);
		expect(list.children!.map((c) => c.raw)).toEqual(['1. First\n', '3. Third\n']);
		expect(change).toEqual({ op: 'delete', at: 1, count: 1 });
	});

	// GH #21's cross-linked family member, replayed off its fresh-seed shape: a setext heading
	// deleted from between a list and indented code lets the four-space indent continue the item,
	// which no separator normalization can hold apart. The fold stops at the blockquote below, so
	// the tail code block keeps its own slot.
	it('a delete letting a list swallow indented code stops the fold at the next block', () => {
		const doc = parse('# word\n- > # word\n\n[t](u)\n=\n\n    code\n\n> q\n\n    tail\n');
		expect(doc.children.map((c) => c.kind)).toEqual([
			'heading',
			'list',
			'setextHeading',
			'indentedCode',
			'blockquote',
			'indentedCode'
		]);

		const change = deleteNode(doc, 2);

		expect(doc.children.map((c) => c.kind)).toEqual([
			'heading',
			'list',
			'blockquote',
			'indentedCode'
		]);
		expect(doc.children[1].raw).toBe('- > # word\n\n    code\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 1, count: 3, newCount: 1, idMap: { 0: 0 } });
	});

	it('a delete between separated paragraphs stays a plain delete', () => {
		const doc = parse('a\n\nb\n\nc\n');

		const change = deleteNode(doc, 1);

		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', 'c\n']);
		expect(change).toEqual({ op: 'delete', at: 1, count: 1 });
		expect(describeConvergence(doc)).toBeNull();
	});
});
