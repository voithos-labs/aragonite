import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// rangeDelete is driven with hand-built endpoints, so the table arm sees a char offset
// SelectionState would have snapped to a cell coordinate.
afterEach(() => expectDevWarns(['deleteFromProseIntoTable:end']));

// The cross-block delete reaches a code block's bytes through its own sink, not the code
// surface: the same-block arm writes the merged raw with no reparse behind it, so a join
// that MINTS a closer line out of two lines holding none splits the block on reload. Same
// class as issue #45, other door. Miss-analysis: `range-delete.test.ts` drove prose joins
// only, and the fence rule was pinned at the component funnel, which this arm never crosses.

const sharing = () => createSharingState();

describe('range delete inside a fenced code block', () => {
	it('grows the fence when the join mints a closer line', () => {
		const doc = parse('```js\n``\n`\nbody\n```\n\n# Heading\n');

		// Delete the line break between "``" and "`", which forms "```" on one line.
		rangeDelete(
			doc,
			{ path: [0], offset: 8 },
			{ path: [0], offset: 9 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('````js\n```\nbody\n````\n\n# Heading\n');
		expectParseConverged(doc);
	});

	it('leaves the heading a sibling instead of feeding it to a trailing fence', () => {
		const doc = parse('```js\n``\n`\nbody\n```\n\n# Heading\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 8 },
			{ path: [0], offset: 9 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'heading']);
	});

	it('leaves a join that mints no closer alone', () => {
		const doc = parse('```js\nab\ncd\n```\n\n# Heading\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 8 },
			{ path: [0], offset: 9 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('```js\nabcd\n```\n\n# Heading\n');
		expectParseConverged(doc);
	});

	// The rule is the block's own, not the document's: the same join inside a paragraph is
	// ordinary text, and escalating anything there would rewrite the user's bytes.
	it('leaves the same join inside a paragraph alone', () => {
		const doc = parse('``\n`\n\n# Heading\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [0], offset: 3 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('```\n\n# Heading\n');
	});
});

// Issue #55, #45 from the other side: a range reaching past the closer LOSES a terminator the
// metadata still claims, which no escalation can repair — there is no run to grow. The session
// keeps the block and its siblings, so the bytes are made legal for that shape. Miss-analysis:
// the #45 pins drove joins INSIDE one block (a minted terminator) and stopped at the one arm
// that writes raw in place; the truncation arms reparse, which re-derives honest `closed: false`
// metadata, so no pin could see the loss unless it drove them with a fenced-code endpoint.
describe('range delete that consumes a fenced code closer', () => {
	it('restores the closer the same-block range swallowed', () => {
		const doc = parse('```js\nbody\n```\n\npara\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 8 },
			{ path: [0], offset: 14 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('```js\nbo\n```\n\npara\n');
		expectParseConverged(doc);
	});

	it('restores it when a cross-block range pulls the next block into the body', () => {
		const doc = parse('```js\nbody\n```\n\npara\n\ntail\n');

		const { collapsedCaret } = rangeDelete(
			doc,
			{ path: [0], offset: 8 },
			{ path: [1], offset: 2 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('```js\nbora\n```\n\ntail\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'paragraph']);
		// The restored closer lands past the join, so the caret keeps the truncation's offset.
		expect(collapsedCaret).toEqual({ path: [0], offset: 8 });
		expectParseConverged(doc);
	});

	it('restores it when the range ends inside a table', () => {
		const doc = parse('```js\nbody\n```\n\n| a | b |\n| --- | --- |\n| c | d |\n\ntail\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 8 },
			{ path: [1], offset: 1 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'table', 'paragraph']);
		expectParseConverged(doc);
	});

	it('restores at the block’s own run length without regrowing it', () => {
		const doc = parse('````js\n```\nbody\n````\n\npara\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 13 },
			{ path: [0], offset: 20 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('````js\n```\nbo\n````\n\npara\n');
		expectParseConverged(doc);
	});

	it('mints the closer on the block’s own line ending (G4.20)', () => {
		const doc = parse('```js\r\nbody\r\n```\r\n\r\npara\r\n');

		rangeDelete(
			doc,
			{ path: [0], offset: 9 },
			{ path: [0], offset: 16 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('```js\r\nbo\r\n```\r\n\r\npara\r\n');
		expectParseConverged(doc);
	});

	// The parser preserves a missing final newline, so the joined slice carries none and the
	// reattached ending falls back to LF. The closer's ending is the BLOCK's, not the slice's.
	it('mints CRLF when the document’s last block has no trailing newline', () => {
		const doc = parse('```js\r\nbody\r\n```\r\n\r\npara');

		rangeDelete(
			doc,
			{ path: [0], offset: 9 },
			{ path: [1], offset: 4 },
			sharing(),
			undefined,
			undefined,
			undefined
		);

		expect(serialize(doc)).toBe('```js\r\nbo\r\n```\n');
		expectParseConverged(doc);
	});

	describe('through the chrome wall', () => {
		beforeEach(() => {
			// registerChromeLeaf registers a paste surface; the schema reset alone leaves it
			// orphaned, so a re-register would collide.
			__resetSchemaRegistriesForTests();
			__resetPasteSurfacesForTests();
			registerCalloutKind();
		});

		it('restores the closer of a code block truncated outside the wall', () => {
			const doc = parse('```js\nbody\n```\n\n:::callout Title\nBody1\n:::\n\nBelow\n');

			rangeDelete(
				doc,
				{ path: [0], offset: 8 },
				{ path: [1, 0], offset: 3 },
				sharing(),
				undefined,
				undefined,
				undefined
			);

			expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'callout', 'paragraph']);
			expectParseConverged(doc);
		});
	});
});
