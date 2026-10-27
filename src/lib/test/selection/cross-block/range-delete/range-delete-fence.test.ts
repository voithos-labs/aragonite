import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { cellPoint, type SelectionPoint } from '#lib/selection/primitives.js';
import { registerCalloutForTests } from '../../chrome-plugins';
import { expectParseConverged } from '../../../harness/parse-converged';
import { deleteRange } from '../../../harness/range-delete';

// A range delete that takes a fenced code block's opener, its closer, or a line break in its body
// leaves bytes that read back as the same blocks.

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const kindsOf = (doc: ReturnType<typeof parse>) => doc.children.map((c) => c.kind);

/** Rows whose whole check is the bytes the delete leaves and a reparse that agrees with them. */
function expectDeleted(source: string, start: SelectionPoint, end: SelectionPoint, left: string) {
	const doc = parse(source);
	deleteRange(doc, start, end);
	expect(serialize(doc)).toBe(left);
	expectParseConverged(doc);
}

// Miss-analysis: joins were tested on text only, and the fence rule only at the component's write.
describe('range delete inside a fenced code block', () => {
	it.each([
		// The deleted line break forms "```" on one line, so the fence grows past it.
		[
			'grows the fence when the join creates a closer line',
			'```js\n``\n`\nbody\n```\n\n# Heading\n',
			'````js\n```\nbody\n````\n\n# Heading\n'
		],
		[
			'leaves a join that creates no closer alone',
			'```js\nab\ncd\n```\n\n# Heading\n',
			'```js\nabcd\n```\n\n# Heading\n'
		]
	])('%s', (_, source, left) => expectDeleted(source, at([0], 8), at([0], 9), left));

	// The rule is the block's own, not the document's: the same join inside a paragraph is
	// ordinary text, and escalating anything there would rewrite the user's bytes.
	it('leaves the same join inside a paragraph alone', () => {
		const doc = parse('``\n`\n\n# Heading\n');

		deleteRange(doc, at([0], 2), at([0], 3));

		expect(serialize(doc)).toBe('```\n\n# Heading\n');
	});
});

// Miss-analysis: GH #58; the fence pins only drove ranges that start in a code body.
// Miss-analysis (GH #768): these rows pinned the closer's drop, a line the range never covered.
describe('range delete that consumes a fenced code opener', () => {
	const FENCE = 'para\n\n```js\nbody\n```\n\ntail\n';

	it('keeps the closer the cross-block merge stranded, which opens a fence over the rest', () => {
		const doc = parse(FENCE);

		const { caret } = deleteRange(doc, at([0], 2), at([1], 8));

		expect(serialize(doc)).toBe('pady\n```\n\ntail\n');
		expect(kindsOf(doc)).toEqual(['paragraph', 'fencedCode']);
		expect(caret(doc)).toEqual({ path: [0], offset: 2 });
		expectParseConverged(doc);
	});

	it.each([
		// A tilde line in the surviving body is text the run never terminated, not a live opener.
		[
			'past a foreign-marker open line in the surviving body',
			'para\n\n```js\n~~~\nbody\n```\n\ntail\n',
			at([1], 6),
			'pa~~~\nbody\n```\n\ntail\n'
		],
		// Loaded markdown can close with a longer run than the opener the range took.
		[
			'a stranded closer longer than the deleted opener’s run',
			'para\n\n~~~js\nbody\n~~~~~\n\ntail\n',
			at([1], 8),
			'pady\n~~~~~\n\ntail\n'
		],
		[
			'on the block’s own line ending (G4.20)',
			'para\r\n\r\n```js\r\nbody\r\n```\r\n\r\ntail\r\n',
			at([1], 9),
			'pady\r\n```\r\n\r\ntail\r\n'
		],
		[
			'when the code block sits inside a blockquote',
			'para\n\n> ```js\n> body\n> ```\n\ntail\n',
			at([1, 0], 8),
			'pady\n```\n\ntail\n'
		],
		// Taking both fence lines leaves no run to strand and no metadata to restore from.
		['nothing when the range took both fence lines', FENCE, at([1], 14), 'pa\n\ntail\n']
	])('keeps %s', (_, source, end, left) => expectDeleted(source, at([0], 2), end, left));

	// The same-block branch writes raw in place with no reparse, so the node keeps a stale kind as
	// any kind would; the bytes have to read back as the blocks the tree holds.
	it('keeps it on a range confined to the code block', () => {
		expectDeleted('```js\nbody\n```\n\ntail\n', at([0], 0), at([0], 8), 'dy\n```\n\ntail\n');
	});

	it('keeps it when the range starts in a table', () => {
		const doc = parse('| a | b |\n| --- | --- |\n| c | d |\n\n```js\nbody\n```\n\ntail\n');

		deleteRange(doc, cellPoint([0], 0), at([1], 8));

		expect(serialize(doc)).toBe('dy\n```\n\ntail\n');
		expectParseConverged(doc);
	});

	describe('through the chrome wall', () => {
		beforeEach(registerCalloutForTests);

		const CALLOUT = ':::callout Title\nInside\n:::\n\n```js\nbody\n```\n\ntail\n';

		it('keeps it on the end truncation, which takes the opener and not the closer', () => {
			expectDeleted(CALLOUT, at([0, 0], 2), at([1], 8), ':::callout Ti\n:::\n\ndy\n```\n\ntail\n');
		});

		// The whole surviving tail is the closer line, which reads as a bare opener and gets its
		// closer back, so the wall's kept position holds an empty code block.
		it('closes a tail that is exactly the closer line again', () => {
			const doc = parse(CALLOUT);

			deleteRange(doc, at([0, 0], 2), at([1], 11));

			expect(serialize(doc)).toBe(':::callout Ti\n:::\n\n```\n```\n\ntail\n');
			expect(kindsOf(doc)).toEqual(['callout', 'fencedCode', 'paragraph']);
			expectParseConverged(doc);
		});
	});
});

// Miss-analysis: GH #55; the fence pins joined inside one block and never truncated past a closer.
describe('range delete that consumes a fenced code closer', () => {
	it.each([
		[
			'the closer the same-block range swallowed',
			'```js\nbody\n```\n\npara\n',
			at([0], 8),
			at([0], 14),
			'```js\nbo\n```\n\npara\n'
		],
		[
			'at the block’s own run length without regrowing it',
			'````js\n```\nbody\n````\n\npara\n',
			at([0], 13),
			at([0], 20),
			'````js\n```\nbo\n````\n\npara\n'
		],
		[
			'the closer on the block’s own line ending (G4.20)',
			'```js\r\nbody\r\n```\r\n\r\npara\r\n',
			at([0], 9),
			at([0], 16),
			'```js\r\nbo\r\n```\r\n\r\npara\r\n'
		],
		// The parser keeps a missing final newline, so the reattached ending is the document's CRLF.
		[
			'CRLF when the document’s last block has no trailing newline',
			'```js\r\nbody\r\n```\r\n\r\npara',
			at([0], 9),
			at([1], 4),
			'```js\r\nbo\r\n```\r\n'
		]
	])('restores %s', (_, source, start, end, left) => expectDeleted(source, start, end, left));

	it('restores it when a cross-block range pulls the next block into the body', () => {
		const doc = parse('```js\nbody\n```\n\npara\n\ntail\n');

		const { caret } = deleteRange(doc, at([0], 8), at([1], 2));

		expect(serialize(doc)).toBe('```js\nbora\n```\n\ntail\n');
		expect(kindsOf(doc)).toEqual(['fencedCode', 'paragraph']);
		// The restored closer lands past the join, so the caret keeps the truncation's offset.
		expect(caret(doc)).toEqual({ path: [0], offset: 8 });
		expectParseConverged(doc);
	});

	it('restores it when the range ends inside a table', () => {
		const doc = parse('```js\nbody\n```\n\n| a | b |\n| --- | --- |\n| c | d |\n\ntail\n');

		deleteRange(doc, at([0], 8), cellPoint([1], 1));

		expect(kindsOf(doc)).toEqual(['fencedCode', 'table', 'paragraph']);
		expectParseConverged(doc);
	});

	describe('through the chrome wall', () => {
		beforeEach(registerCalloutForTests);

		it('restores the closer of a code block truncated outside the wall', () => {
			const doc = parse('```js\nbody\n```\n\n:::callout Title\nBody1\n:::\n\nBelow\n');

			deleteRange(doc, at([0], 8), at([1, 0], 3));

			expect(kindsOf(doc)).toEqual(['fencedCode', 'callout', 'paragraph']);
			expectParseConverged(doc);
		});
	});
});
