import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { deleteNode, mergeWithNext, splitNode, updateNodeContent } from '../../tree-operations';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { settled } from '$lib/test/harness/settle-funnel';
import type { SettledContent } from '$lib/tree-operations/content-write';
import { defaultGrammarView } from '$lib/schema/block-openers';

// GH #61: a splice can leave neighbours whose adjacent bytes re-read as one block on reload
// (a list newly standing above indented code absorbs it, since no separator line can hold
// indentation apart). The neighbour merge joins the pair the way the reload will.
// Miss-analysis: the property branch excluded every document holding indented code, so the one
// adjacency no separator can fix was unreachable by construction.

describe('a splice absorbs a join the reload would fold (GH #61)', () => {
	it('a split creating a list above indented code absorbs it', () => {
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

	// Blank lines do not stop a continuation, so the absorbing block can stand above them.
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

	// A structured container's children do not reparse to themselves on their own: two items'
	// joined bytes read as a nested list, which is the parent's kind, not a sibling's.
	// Miss-analysis: the join pins only drove document-level children, so no window ever held
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
	// which no separator normalization can hold apart. The merge stops at the blockquote below, so
	// the tail code block keeps its own position.
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

	// GH #285: the swallowed block carries a run of blank lines, which the join must place where
	// the reload does; here they reach the item's content column, so the list takes them too.
	// Miss-analysis: every pin here drove a join whose bytes read as strictly fewer blocks, so no
	// window ever held a blank run that kept the count while the division moved.
	it('a mergeNext leaving a list above indented code takes its trailing blank run too', () => {
		const doc = parse('- a\n\nb\n\n    code\n \t \n\t\n\n```\n```\n');
		expect(doc.children.map((c) => c.kind)).toEqual([
			'list',
			'paragraph',
			'indentedCode',
			'fencedCode'
		]);

		const change = settled(
			doc,
			(body) => mergeWithNext(body, 0, undefined, undefined, defaultGrammarView).change
		);

		// Both blank lines reach the item's content column (a tab counts to the next four).
		expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual([
			['list', '', '- ab\n\n    code\n \t \n\t\n'],
			['fencedCode', '\n', '```\n```\n']
		]);
		expect(change).toEqual({ op: 'replace', at: 0, count: 3, newCount: 1, idMap: { 0: 0 } });
		expect(describeConvergence(doc)).toBeNull();
	});

	// The same join at the parent tail: the document's trailing blank line stays in `doc.suffix`.
	it('the same join at the tail keeps the trailing line in the suffix', () => {
		const doc = parse('- a\n\nb\n\n    code\n \t \n\t\n\n');
		expect(doc.suffix).toBe('\n');

		const change = settled(
			doc,
			(body) => mergeWithNext(body, 0, undefined, undefined, defaultGrammarView).change
		);

		expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual([
			['list', '', '- ab\n\n    code\n \t \n\t\n']
		]);
		expect(doc.suffix).toBe('\n');
		expect(change).toEqual({ op: 'replace', at: 0, count: 3, newCount: 1, idMap: { 0: 0 } });
		expect(describeConvergence(doc)).toBeNull();
	});

	// GH #285 with a paragraph for the head: the code's blank run stays a block of its own, so the
	// joined bytes keep the block count while the code moves up into the paragraph.
	it('a delete leaving a paragraph over indented code takes the code as its continuation', () => {
		const doc = parse('para\n# h\n    code\n    \n    \n\n```\n```\n');

		const change = settled(doc, (body) => deleteNode(body, 1));

		// The blank line above the fence goes with the delete: a known loss, GH #450.
		expect(serialize(doc)).toBe('para\n    code\n    \n    \n```\n```\n');
		expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual([
			['paragraph', '', 'para\n    code\n'],
			['paragraph', '    \n', '    \n'],
			['fencedCode', '', '```\n```\n']
		]);
		expect(change).toEqual({ op: 'replace', at: 0, count: 3, newCount: 2, idMap: { 0: 0 } });
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a delete between separated paragraphs stays a plain delete', () => {
		const doc = parse('a\n\nb\n\nc\n');

		const change = deleteNode(doc, 1);

		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', 'c\n']);
		expect(change).toEqual({ op: 'delete', at: 1, count: 1 });
		expect(describeConvergence(doc)).toBeNull();
	});

	// A list takes an indented separator line into its body, so the join keeps the block count
	// while the line moves into the item as a child.
	// Miss-analysis: the equal-count check measured the head's growth against the separator's
	// length, which is exactly what a container growing by that line shows; the shape property
	// drew such a line only once tabs counted as indentation.
	it('a delete bringing an indented separator under a list moves it into the item', () => {
		const doc = parse('- a\n  \n---\n  \n> q\n');

		settled(doc, (body) => deleteNode(body, 1));

		expect(serialize(doc)).toBe('- a\n  \n  \n> q\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});

// GH #255: the second half a split creates can be the first line of a two-line construct whose
// second line is the follower (a setext underline, a table delimiter row). The pair's own bytes
// parse to one block, so the reload merges it and the tree must too.
// Miss-analysis: every join pin merged a window whose head kept its kind, so the check admitting
// only a kind-preserving merge refused these promotions unasserted.

describe('a splice absorbs a join whose fold promotes the head (GH #255)', () => {
	it('a split above a setext underline leaves the pair as one heading', () => {
		const doc = parse('# [t](u)\n===\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['heading', 'paragraph']);

		// Inside the content: a cut at or before it moves the whole heading down instead.
		const result = splitNode(doc, 0, 4, undefined, undefined, undefined);

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['heading', '# [t\n'],
			['setextHeading', '](u)\n===\n']
		]);
		expect(result.secondHalfIndex).toBe(1);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a split above a table delimiter row leaves the pair as one table', () => {
		const doc = parse('# | a |\n| --- |\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['heading', 'paragraph']);

		splitNode(doc, 0, 4, undefined, undefined, undefined);

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['heading', '# | \n'],
			['table', 'a |\n| --- |\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The content write names the block whose bytes moved, so the merge is asked through the
	// head-line pre-parse first: it must fall through rather than decline the promotion.
	it('typing the underline into the tight block below a paragraph folds the pair', () => {
		const doc = parse('p\n# h\n');

		let written: SettledContent | undefined;
		const change = settled(doc, () => (written = updateNodeContent(doc, 1, '===\n')).change);

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([['setextHeading', 'p\n===\n']]);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
		// The typed underline sits behind the paragraph the promotion absorbed and its join newline.
		expect(written!.textStart).toBe(2);
		expect(describeConvergence(doc)).toBeNull();
	});
});
