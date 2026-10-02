// The commit-time reparse reads one block's text with no positional context, so a commit must
// not create a position-scoped kind wherever the edited block sits.
// Miss-analysis: GH #52, kit fixtures are whole documents and no built-in kind reads position.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { updateNodeContent } from '../../tree-operations';
import { FRONT_MATTER, registerDocumentTopKind } from '../support/position-scoped-kind';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createSharingState } from '$lib/tree-operations/sharing';

const BROKEN_CLOSER = '---\ntitle: x\n--\n';

describe('a position-scoped kind and the commit-time reparse', () => {
	it('a mid-document content commit does not create it', () => {
		const kind = registerDocumentTopKind();
		const doc = parse('intro\n\nbody\n');

		updateNodeContent(doc, 1, FRONT_MATTER, defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => c.kind)).not.toContain(kind);
	});

	// A position-scoped kind comes only from a document parse, so authoring one in place needs a
	// reload; positional context on the commit reparse would change this.
	it('a document-top content commit does not create it either', () => {
		const kind = registerDocumentTopKind();
		const doc = parse('intro\n\nbody\n');

		updateNodeContent(doc, 0, FRONT_MATTER, defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => c.kind)).not.toContain(kind);
	});

	// A known divergence: nothing reparses across a block boundary after a commit, so two blocks
	// whose bytes read as one stay split. Don't delete this to make it green.
	it('breaking the closer and restoring it leaves the halves split', () => {
		const kind = registerDocumentTopKind();
		const source = FRONT_MATTER + '\nbody\n';
		const doc = parse(source);
		expect(doc.children[0].kind).toBe(kind);

		updateNodeContent(doc, 0, BROKEN_CLOSER, defaultGrammarView, createSharingState());
		updateNodeContent(doc, 1, 'title: x\n---\n', defaultGrammarView, createSharingState());

		expect(serialize(doc)).toBe(source);
		expect(doc.children.map((c) => c.kind)).toEqual([
			'thematicBreak',
			'setextHeading',
			'paragraph'
		]);
		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual([kind, 'paragraph']);
	});
});
