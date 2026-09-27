import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { documentBody, type BodyParent } from '$lib/tree-operations/node-primitives';
import { ownerKindNameOf } from '$lib/tree-operations/settle';

// A body names its container once, as `owner`; the separator fix-ups read the container's kind
// off it, and the document root names none.

describe('ownerKindNameOf', () => {
	const quote = () => parse('> a\n>\n> b\n').children[0];

	it('reads a container node passed as its own parent', () => {
		expect(ownerKindNameOf(quote())).toBe('blockquote');
	});

	it("reads a body's owner", () => {
		const owner = quote();
		const body: BodyParent = { children: owner.children!, owner, lineEnding: '\n' };
		expect(ownerKindNameOf(body)).toBe('blockquote');
	});

	it('names no kind for the document body', () => {
		expect(ownerKindNameOf(documentBody(parse('a\n\nb\n')))).toBeUndefined();
	});
});

describe('documentBody', () => {
	it('names no owner', () => {
		expect(documentBody(parse('a\n')).owner).toBeUndefined();
	});

	it('reads and writes the trailing blank line through to the live document', () => {
		const doc = parse('a\n\n');
		const body = documentBody(doc, [...doc.children]);
		expect(body.suffix).toBe('\n');

		doc.suffix = '\n\n';
		expect(body.suffix).toBe('\n\n');

		body.suffix = '';
		expect(doc.suffix).toBe('');
	});

	it("leaves the document's id array out, so an op tracking ids never splices it", () => {
		const doc = parse('a\n\nb\n');
		doc.childIds = ['x', 'y'];
		expect(documentBody(doc).childIds).toBeUndefined();
	});

	it('refuses a second copy of the owner kind', () => {
		const body: BodyParent = {
			children: [],
			owner: undefined,
			lineEnding: '\n',
			// @ts-expect-error the kind is read off `owner`, so a copy beside it could disagree
			ownerKind: 'blockquote'
		};
		expect(body.owner).toBeUndefined();
	});
});
