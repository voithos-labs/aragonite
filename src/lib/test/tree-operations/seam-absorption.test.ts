import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { deleteNode, mergeWithNext, splitNode, updateNodeContent } from '../../tree-operations';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { settled } from '$lib/test/harness/settle-funnel';
import type { SettledContent } from '$lib/tree-operations/content-write';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { fixtureReading } from '../harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

// A splice can leave neighbours whose adjacent bytes reread as one block (a list newly above
// indented code absorbs it), so the neighbour merge joins the pair the way the reload will.
// Miss-analysis: GH #61, the shape property excluded every document holding indented code.

describe('a splice absorbs a join the reload would fold (GH #61)', () => {
	it('a split creating a list above indented code absorbs it', () => {
		const source = '| H0 | H1 | H2 |\n| --- | --- |\n\n    code\n\n- | H0 |\n  | --- |\n';
		const doc = parse(source);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'indentedCode', 'list']);

		const result = splitNode(doc, 0, 21, createSharingState(), fixtureReading());

		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'list', 'list']);
		expect(doc.children[1].raw).toBe('- | --- |\n\n    code\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(result.change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 2, idMap: { 0: 0 } });
	});

	it('a delete leaving a list against indented code absorbs it', () => {
		const doc = parse('- > ---\n      code\n\n# t\n\n    code\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'heading', 'indentedCode']);

		const change = deleteNode(doc, 1, defaultGrammarView, createSharingState());

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

		const change = deleteNode(doc, 2, defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'fencedCode']);
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 4, newCount: 1, idMap: { 0: 0 } });
	});

	// The candidate edge crosses the run too: the pulled content sits on its far side.
	it('the absorbed content can sit across a blank run of its own', () => {
		const doc = parse('- ```\n  ```\n\n\n---\n\n\n    code\n\n[ref]: https://example.com\n');
		expect(doc.children).toHaveLength(6);

		const change = deleteNode(doc, 2, defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'linkReferenceDefinition']);
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 5, newCount: 1, idMap: { 0: 0 } });
	});

	// Two items' joined bytes read as a nested list, the parent's kind, not a sibling's.
	// Miss-analysis: the join tests drove only document-level children, never a container's.
	it('a list-scope delete never absorbs items into a nested list', () => {
		const doc = parse('1. First\n2. Second\n3. Third\n');
		const list = doc.children[0];
		const parent = { children: list.children!, owner: list };

		const change = deleteNode(parent as never, 1, defaultGrammarView, createSharingState());

		expect(list.children!.map((c) => c.kind)).toEqual(['listItem', 'listItem']);
		expect(list.children!.map((c) => c.raw)).toEqual(['1. First\n', '3. Third\n']);
		expect(change).toEqual({ op: 'delete', at: 1, count: 1 });
	});

	// A setext heading deleted from between a list and indented code lets the item take the code;
	// the merge stops at the blockquote below, so the tail code block keeps its own position.
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

		const change = deleteNode(doc, 2, defaultGrammarView, createSharingState());

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

	// The swallowed block's blank lines reach the item's content column, so the list takes them too.
	// Miss-analysis: GH #285, every join here read as fewer blocks; none moved a blank run's split.
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
			(body) => mergeWithNext(body, 0, fixtureReading(), createSharingState()).change
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
			(body) => mergeWithNext(body, 0, fixtureReading(), createSharingState()).change
		);

		expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual([
			['list', '', '- ab\n\n    code\n \t \n\t\n']
		]);
		expect(doc.suffix).toBe('\n');
		expect(change).toEqual({ op: 'replace', at: 0, count: 3, newCount: 1, idMap: { 0: 0 } });
		expect(describeConvergence(doc)).toBeNull();
	});

	// The code joins the paragraph and its blank lines come back as a run, which the next line joins.
	// Miss-analysis: GH #450, no case gave the code more blank lines than the join had blocks for.
	it.each([
		[
			'two whitespace lines (#450)',
			'para\n# h\n    code\n    \n    \n\n```\n```\n',
			[
				['paragraph', '', 'para\n    code\n'],
				['paragraph', '    \n', '    \n'],
				['paragraph', '', '\n'],
				['fencedCode', '', '```\n```\n']
			]
		],
		[
			'three whitespace lines (#451)',
			'para\n***\n    code\n    \n    \n    \n\n```\n```\n',
			[
				['paragraph', '', 'para\n    code\n'],
				['paragraph', '    \n', '    \n'],
				['paragraph', '', '    \n'],
				['paragraph', '', '\n'],
				['fencedCode', '', '```\n```\n']
			]
		]
	])(
		'a delete leaving a paragraph over indented code takes the code as its continuation: %s',
		(_label, source, layout) => {
			const doc = parse(source);

			settled(doc, (body) => deleteNode(body, 1, defaultGrammarView, createSharingState()));

			expect(serialize(doc)).toBe(source.replace(/^para\n[^\n]*\n/, 'para\n'));
			expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual(layout);
			expect(describeConvergence(doc)).toBeNull();
		}
	);

	it('a delete between separated paragraphs stays a plain delete', () => {
		const doc = parse('a\n\nb\n\nc\n');

		const change = deleteNode(doc, 1, defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', 'c\n']);
		expect(change).toEqual({ op: 'delete', at: 1, count: 1 });
		expect(describeConvergence(doc)).toBeNull();
	});

	// A list takes an indented separator line into its body, so the line moves into the item.
	// Miss-analysis: the equal-count check read a container growing by that line as unchanged.
	it('a delete bringing an indented separator under a list moves it into the item', () => {
		const doc = parse('- a\n  \n---\n  \n> q\n');

		settled(doc, (body) => deleteNode(body, 1, defaultGrammarView, createSharingState()));

		expect(serialize(doc)).toBe('- a\n  \n  \n> q\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});

// A split's second half can open a two-line construct with the follower, which the tree merges.
// Miss-analysis: GH #255, every join test kept the head's kind, so promotions went untested.

describe('a splice absorbs a join whose fold promotes the head (GH #255)', () => {
	it('a split above a setext underline leaves the pair as one heading', () => {
		const doc = parse('# [t](u)\n===\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['heading', 'paragraph']);

		// Inside the content: a cut at or before it moves the whole heading down instead.
		const result = splitNode(doc, 0, 4, createSharingState(), fixtureReading());

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

		splitNode(doc, 0, 4, createSharingState(), fixtureReading());

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
		const change = settled(
			doc,
			() =>
				(written = updateNodeContent(doc, 1, '===\n', defaultGrammarView, createSharingState()))
					.change
		);

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([['setextHeading', 'p\n===\n']]);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
		// The typed underline sits behind the paragraph the promotion absorbed and its join newline.
		expect(written!.textStart).toBe(2);
		expect(describeConvergence(doc)).toBeNull();
	});
});
