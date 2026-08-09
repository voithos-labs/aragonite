import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { SelectionPoint } from '$lib/selection/primitives';

// Issue #60: the generic merge installed the survivor straight from a fragment reparse, which
// mints its own leading trivia, so the start block's separator was dropped and its bytes butted
// against the block above — one paragraph on reload. Miss-analysis: every cross-block fixture put
// the start endpoint in the document's FIRST block, whose trivia is '' either way, and asserted
// the merged bytes without ever reparsing them.

const sharing = () => createSharingState();

function del(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	rangeDelete(doc, start, end, sharing(), undefined, undefined);
	return doc;
}

describe('cross-block merge keeps the start block’s separator', () => {
	it('keeps the blank line above a survivor merged from offset 0', () => {
		const doc = del(
			'alpha\n\nbravo\n\ncharlie\n',
			{ path: [1], offset: 0 },
			{ path: [2], offset: 4 }
		);

		expect(serialize(doc)).toBe('alpha\n\nlie\n');
		expectParseConverged(doc);
	});

	// The loss never depended on the offset: a mid-block start reparses to a fragment whose first
	// block opens the bytes, so its minted trivia is '' just the same.
	it('keeps it for a mid-block start too', () => {
		const doc = del(
			'alpha\n\nbravo\n\ncharlie\n',
			{ path: [1], offset: 2 },
			{ path: [2], offset: 4 }
		);

		expect(serialize(doc)).toBe('alpha\n\nbrlie\n');
		expectParseConverged(doc);
	});

	it.each([0, 2])('mints no separator for a start block at index 0 (offset %i)', (offset) => {
		const doc = del('bravo\n\ncharlie\n', { path: [0], offset }, { path: [1], offset: 4 });

		expect(doc.children[0].leadingTrivia).toBe('');
		expect(serialize(doc)).toBe(offset === 0 ? 'lie\n' : 'brlie\n');
		expectParseConverged(doc);
	});

	// Inside a container the separator is a prefixed blank line the rebuild re-emits, so a dropped
	// trivia glues two quote paragraphs into one.
	it('keeps a nested survivor’s blank quote line', () => {
		const doc = del(
			'alpha\n\n> one\n>\n> two\n\ncharlie\n',
			{ path: [1, 1], offset: 0 },
			{ path: [2], offset: 4 }
		);

		expect(serialize(doc)).toBe('alpha\n\n> one\n>\n> lie\n');
		expectParseConverged(doc);
	});

	// A blank survivor is itself a blank line, so it and its follower share one separator: both
	// would reload as a second empty paragraph.
	it('leaves a blank survivor and its follower one separator between them', () => {
		const doc = del(
			'alpha\n\nbravo\n\ncharlie\n\ndelta\n',
			{ path: [1], offset: 0 },
			{ path: [2], offset: 7 }
		);

		expect(serialize(doc)).toBe('alpha\n\n\ndelta\n');
		expectParseConverged(doc);
	});

	// With no follower to hold it, the survivor's own separator is what keeps the empty block
	// alive: a lone trailing blank line reloads as the document suffix, not a block.
	it('keeps a trailing blank survivor’s separator', () => {
		const doc = del(
			'alpha\n\nbravo\n\ncharlie\n',
			{ path: [1], offset: 0 },
			{ path: [2], offset: 7 }
		);

		expect(serialize(doc)).toBe('alpha\n\n\n');
		expectParseConverged(doc);
	});
});

// The wall branches install their endpoints through the shared reparse, which always carried the
// slot's trivia. Pinned here so the generic branch's fix and theirs stay one rule.
describe('the wall branches keep it too', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});

	it('chrome: a start endpoint outside the container keeps its separator', () => {
		const doc = del(
			'Head\n\nAbove\n\n:::callout Title\nBody1\n:::\n',
			{ path: [1], offset: 3 },
			{ path: [2, 1], offset: 3 }
		);

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expectParseConverged(doc);
	});

	it('table: a prose start endpoint keeps its separator', () => {
		const doc = del(
			'alpha\n\nbravo\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n',
			{ path: [1], offset: 3 },
			{ path: [2], offset: 2, cellCoordinate: true }
		);

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expectParseConverged(doc);
	});
});
