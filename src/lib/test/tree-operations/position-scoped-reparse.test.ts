// The commit-time reparse reads one block's text with no positional context, so before
// issue #52 a position-scoped opener saw line 0 wherever the edited block sat.
// Miss-analysis: the clean-room author pinned both directions from outside the repo, and
// nothing in-repo could red — every conformance kit fixture is a whole document, and no
// shipped kind gates on position, so the battery has no position-scoped exemplar. The
// fixture now lives in `test/support/position-scoped-kind.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { updateNodeContent } from '../../tree-operations';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { FRONT_MATTER, registerDocumentTopKind } from '../support/position-scoped-kind';

const BROKEN_CLOSER = '---\ntitle: x\n--\n';

describe('a position-scoped kind and the commit-time reparse', () => {
	beforeEach(__resetSchemaRegistriesForTests);
	afterEach(__resetSchemaRegistriesForTests);

	it('a mid-document content commit does not mint it', () => {
		const kind = registerDocumentTopKind();
		const doc = parse('intro\n\nbody\n');

		updateNodeContent(doc, 1, FRONT_MATTER);

		expect(doc.children.map((c) => c.kind)).not.toContain(kind);
	});

	// The narrowing this fix accepts: a position-scoped kind arrives from a document parse
	// only, so authoring one in place needs a reload. Positional context on the commit
	// reparse (issue #52's fix direction 1) would flip this pin.
	it('a document-top content commit does not mint it either', () => {
		const kind = registerDocumentTopKind();
		const doc = parse('intro\n\nbody\n');

		updateNodeContent(doc, 0, FRONT_MATTER);

		expect(doc.children.map((c) => c.kind)).not.toContain(kind);
	});

	// Pins a known divergence (issue #21's kind-agnostic class: two blocks whose bytes
	// jointly reparse as one, with nothing reparsing across a block boundary after a
	// commit). Not closed by the parse-scope signal — do not delete this to make it green.
	it('breaking the closer and restoring it leaves the halves split', () => {
		const kind = registerDocumentTopKind();
		const source = FRONT_MATTER + '\nbody\n';
		const doc = parse(source);
		expect(doc.children[0].kind).toBe(kind);

		updateNodeContent(doc, 0, BROKEN_CLOSER);
		updateNodeContent(doc, 1, 'title: x\n---\n');

		expect(serialize(doc)).toBe(source);
		expect(doc.children.map((c) => c.kind)).toEqual([
			'thematicBreak',
			'setextHeading',
			'paragraph'
		]);
		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual([kind, 'paragraph']);
	});
});
