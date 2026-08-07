import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { Document } from '$lib/core/nodes';
import type { SelectionPoint } from '$lib/selection/primitives';

// GH #73: a blank block covered as a range's middle is the separating line of the block after
// it, and the ceremony splices through `deleteAtPath` — which has no successor hand-down of its
// own, while `clearRedundantSeparator` beside it only ever FREES a separator.
// Miss-analysis: every cross-block fixture put content blocks between its endpoints, so no case
// deleted a blank BLOCK; the survivor-trivia cases cover the start block's own separator, which
// is a different node from the one a deleted middle owes.

const TABLE = '| h1 | h2 |\n| --- | --- |\n| a | b |\n';

function del(source: string, start: SelectionPoint, end: SelectionPoint): Document {
	const doc = parse(source);
	rangeDelete(doc, start, end, createSharingState(), undefined);
	return doc;
}

describe('a deleted blank middle hands its line to the block below', () => {
	// The generic branch deletes the end endpoint too, so the successor that survives is the
	// block past it — one `clearRedundantSeparator` already stripped while the blank still stood.
	it('keeps the successor separated once the blank above it is gone', () => {
		const doc = del('a\n\n\nb\n\nc\n', { path: [0], offset: 1 }, { path: [2], offset: 1 });

		expect(serialize(doc)).toBe('a\n\nc\n');
		expectParseConverged(doc);
	});

	// A table end endpoint survives as its own block rather than merging into the prose start, so
	// the blank's successor is still there to be stranded — and a table cannot interrupt a
	// paragraph, which is what makes the loss a lost block rather than lost bytes.
	it('keeps a surviving table endpoint separated from the prose start', () => {
		const doc = del(
			`alpha\n\n\n${TABLE}`,
			{ path: [0], offset: 3 },
			{ path: [2], offset: 2, cellCoordinate: true }
		);

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expectParseConverged(doc);
	});
});

describe('the chrome wall branch keeps it too', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});

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
