import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import { documentBody, type BodyParent } from '#lib/tree-operations/node-primitives.js';
import { fixUpEdit } from '#lib/tree-operations/fix-up/apply.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

// A body names its container once, as `owner`, and the document root names none. The fix-up
// reads the owner's fence lines and title off it, so a body is the only thing it takes.

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
});

/** Never called: `npm run check` fails once a directive inside goes unused. */
export function compileTimePins(children: CstNode[]): void {
	fixUpEdit(
		// @ts-expect-error a bare array can't say whose body it is, so the fix-up can't read the wrap
		{ children, lineEnding: '\n' },
		{ change: { op: 'noop' }, before: children },
		defaultGrammarView,
		createSharingState()
	);
	const body: BodyParent = {
		children: [],
		owner: undefined,
		lineEnding: '\n',
		// @ts-expect-error the kind is read off `owner`, so a copy beside it could disagree
		ownerKind: 'blockquote'
	};
	void body;
}
