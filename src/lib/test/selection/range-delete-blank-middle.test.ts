import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { rangeDelete } from '#lib/selection/range-delete.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { registerCalloutForTests } from './chrome-plugins';
import { expectParseConverged } from '../harness/parse-converged';
import type { Document } from '#lib/core/nodes.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { fixtureReading } from '../harness/fixture-grammar';

// A blank block covered as a range's middle is the separating line of the block after it, but
// the `deleteAtPath` splice hands nothing down to that successor, and `clearRedundantSeparator`
// only ever frees a separator.
// Miss-analysis: GH #73; every cross-block fixture put content blocks between its endpoints.

const TABLE = '| h1 | h2 |\n| --- | --- |\n| a | b |\n';

function del(source: string, start: SelectionPoint, end: SelectionPoint): Document {
	const doc = parse(source);
	rangeDelete(
		doc,
		rangeCoverage(doc, coverRange(doc, start, end)),
		createSharingState(),
		fixtureReading(),
		'keyless'
	);
	return doc;
}

describe('a deleted blank middle hands its line to the block below', () => {
	// The plain branch deletes the end endpoint too, so the successor that survives is the block
	// past it, one `clearRedundantSeparator` already stripped while the blank still stood.
	it('keeps the successor separated once the blank above it is gone', () => {
		const doc = del('a\n\n\nb\n\nc\n', { path: [0], offset: 1 }, { path: [2], offset: 1 });

		expect(serialize(doc)).toBe('a\n\nc\n');
		expectParseConverged(doc);
	});

	// A table end endpoint survives as its own block, so the blank's successor can be stranded; a
	// table cannot interrupt a paragraph, so the loss is a whole block rather than bytes.
	it('keeps a surviving table endpoint separated from the prose start', () => {
		const doc = del(
			`alpha\n\n\n${TABLE}`,
			{ path: [0], offset: 3 },
			{ path: [2], offset: 1, cellCoordinate: true }
		);

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expectParseConverged(doc);
	});
});

describe('the chrome wall branch keeps it too', () => {
	beforeEach(registerCalloutForTests);

	it('separates a surviving container from the prose start', () => {
		const doc = del(
			'Above\n\n\n:::callout Title\nBody1\n:::\n',
			{ path: [0], offset: 3 },
			{ path: [2, 1], offset: 3 }
		);

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expectParseConverged(doc);
	});
});
