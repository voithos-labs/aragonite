import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { rangeDelete } from '#lib/selection/range-delete.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { registerCalloutForTests } from './chrome-plugins';
import { expectParseConverged } from '../harness/parse-converged';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';
import { fixtureReading } from '../harness/fixture-grammar';

// rangeDelete is driven with hand-built endpoints, so the table branch sees a character offset
// `SelectionState` would have snapped to a cell coordinate.
afterEach(() => allowDevWarns(['rangeCoverage:tableEdge']));

// A same-block join that makes a closer line out of two plain lines must not split the fence.
// Miss-analysis: joins were tested on text only, and the fence rule only at the component's write.

const sharing = () => createSharingState();

describe('range delete inside a fenced code block', () => {
	it('grows the fence when the join creates a closer line', () => {
		const doc = parse('```js\n``\n`\nbody\n```\n\n# Heading\n');

		// Delete the line break between "``" and "`", which forms "```" on one line.
		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [0], offset: 9 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('````js\n```\nbody\n````\n\n# Heading\n');
		expectParseConverged(doc);
	});

	it('leaves the heading a sibling instead of feeding it to a trailing fence', () => {
		const doc = parse('```js\n``\n`\nbody\n```\n\n# Heading\n');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [0], offset: 9 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'heading']);
	});

	it('leaves a join that creates no closer alone', () => {
		const doc = parse('```js\nab\ncd\n```\n\n# Heading\n');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [0], offset: 9 })),
			sharing(),
			fixtureReading(),
			'keyless'
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
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 2 }, { path: [0], offset: 3 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('```\n\n# Heading\n');
	});
});

// A range past the closer loses a terminator the metadata still claims, so the delete restores it.
// Miss-analysis: GH #55; the fence pins joined inside one block and never truncated past a closer.
describe('range delete that consumes a fenced code closer', () => {
	it('restores the closer the same-block range swallowed', () => {
		const doc = parse('```js\nbody\n```\n\npara\n');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [0], offset: 14 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('```js\nbo\n```\n\npara\n');
		expectParseConverged(doc);
	});

	it('restores it when a cross-block range pulls the next block into the body', () => {
		const doc = parse('```js\nbody\n```\n\npara\n\ntail\n');

		const { caret } = rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [1], offset: 2 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('```js\nbora\n```\n\ntail\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'paragraph']);
		// The restored closer lands past the join, so the caret keeps the truncation's offset.
		expect(caret(doc)).toEqual({ path: [0], offset: 8 });
		expectParseConverged(doc);
	});

	it('restores it when the range ends inside a table', () => {
		const doc = parse('```js\nbody\n```\n\n| a | b |\n| --- | --- |\n| c | d |\n\ntail\n');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [1], offset: 1 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'table', 'paragraph']);
		expectParseConverged(doc);
	});

	it('restores at the block’s own run length without regrowing it', () => {
		const doc = parse('````js\n```\nbody\n````\n\npara\n');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 13 }, { path: [0], offset: 20 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('````js\n```\nbo\n````\n\npara\n');
		expectParseConverged(doc);
	});

	it('creates the closer on the block’s own line ending (G4.20)', () => {
		const doc = parse('```js\r\nbody\r\n```\r\n\r\npara\r\n');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 9 }, { path: [0], offset: 16 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('```js\r\nbo\r\n```\r\n\r\npara\r\n');
		expectParseConverged(doc);
	});

	// The parser preserves a missing final newline, so the joined slice carries none: the
	// reattached ending is the document's CRLF, as is the restored closer's.
	it('creates CRLF when the document’s last block has no trailing newline', () => {
		const doc = parse('```js\r\nbody\r\n```\r\n\r\npara');

		rangeDelete(
			doc,
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 9 }, { path: [1], offset: 4 })),
			sharing(),
			fixtureReading(),
			'keyless'
		);

		expect(serialize(doc)).toBe('```js\r\nbo\r\n```\r\n');
		expectParseConverged(doc);
	});

	describe('through the chrome wall', () => {
		beforeEach(registerCalloutForTests);

		it('restores the closer of a code block truncated outside the wall', () => {
			const doc = parse('```js\nbody\n```\n\n:::callout Title\nBody1\n:::\n\nBelow\n');

			rangeDelete(
				doc,
				rangeCoverage(doc, coverRange(doc, { path: [0], offset: 8 }, { path: [1, 0], offset: 3 })),
				sharing(),
				fixtureReading(),
				'keyless'
			);

			expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'callout', 'paragraph']);
			expectParseConverged(doc);
		});
	});
});
