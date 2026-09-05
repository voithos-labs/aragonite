import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { checkOpaqueStaleRaw } from '$lib/invariants/node-shape';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { splitNode } from '$lib/tree-operations/node-ops';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';

// The structural doors into the same `</details>` escape: they reach the body through
// their own sinks, with no per-block commit to carry the rule.

beforeEach(() => {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
});

// Enter is the second door into the body. BOTH halves are reachable, which is why
// the sink escapes both: the anchored recognizer spares a tag line with text on
// either side, and the cut is what strands it alone.
describe('details terminator escape at the split door', () => {
	const detailsOwner = () => ({ ownerKind: declaredPluginKind(DETAILS), owner: undefined });

	it('escapes the second half when the cut strands a trailing tag', () => {
		const parent = { children: parse('foo</details>\n').children, ...detailsOwner() };
		splitNode(parent, 0, 3, undefined, undefined, undefined);

		expect(parent.children.map((c) => c.raw)).toEqual(['foo\n', '&lt;/details>\n']);
	});

	it('escapes the first half when the cut strands a leading tag', () => {
		// `</details>foo` parses as an htmlBlock — the tag line only survived unescaped
		// because the trailing text kept it off the anchored terminator.
		const parent = { children: parse('</details>foo\n').children, ...detailsOwner() };
		expect(parent.children[0].kind).toBe('htmlBlock');

		splitNode(parent, 0, 10, undefined, undefined, undefined);

		expect(parent.children.map((c) => c.raw)).toEqual(['&lt;/details>\n', 'foo\n']);
	});

	it('leaves both halves alone at the document root, where no container claims them', () => {
		const parent = {
			children: parse('foo</details>\n').children,
			ownerKind: undefined,
			owner: undefined
		};
		splitNode(parent, 0, 3, undefined, undefined, undefined);

		expect(parent.children.map((c) => c.raw)).toEqual(['foo\n', '</details>\n']);
	});
});

// The cross-block family reaches the body through its own sinks, not through the
// per-block ones. A join can MINT a terminator line out of two lines that each
// held none — which is why these doors need the rule as much as typing does.
describe('details terminator escape at the cross-block doors', () => {
	// Both children are ordinary loaded shapes: the tag sits mid-line, where the
	// anchored recognizer never sees it. The delete is what strands it at column 0.
	const MID_LINE_TAG =
		'<details>\n<summary>T</summary>\n\nalpha\nbeta\n\nxx</details>\nmore\n\n</details>\n';

	it('escapes a terminator the cross-block delete mints at the join', () => {
		const doc = parse(MID_LINE_TAG);
		expect(doc.children[0].children?.length).toBe(3);

		rangeDelete(
			doc,
			{ path: [0, 1], offset: 6 },
			{ path: [0, 2], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(checkOpaqueStaleRaw(doc.children[0])).toBeNull();
	});

	it('escapes a terminator a same-block delete strands at column 0', () => {
		const doc = parse('<details>\n<summary>T</summary>\n\nzz</details>\n\n</details>\n');

		rangeDelete(
			doc,
			{ path: [0, 1], offset: 0 },
			{ path: [0, 1], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(checkOpaqueStaleRaw(doc.children[0])).toBeNull();
	});
});
