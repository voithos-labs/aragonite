import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { documentBody, type BodyParent } from '$lib/tree-operations/node-primitives';
import { settleSeparatorOnBlank } from '$lib/tree-operations/settle';
import { createSharingState } from '$lib/tree-operations/sharing';

// A body names its container once, as `owner`, and the document root names none. The separator
// fix-ups read the owner's fence lines and title off it, so a body is the only thing they take.

describe('the separator fix-ups take a body', () => {
	it('refuses a bare children array, which names no owner', () => {
		const { children } = parse('> a\n>\n>\n> b\n').children[0];
		// @ts-expect-error a bare array can't say whose body it is, so the fix-up can't read the wrap
		settleSeparatorOnBlank({ children: children!, lineEnding: '\n' }, 1, createSharingState());
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
