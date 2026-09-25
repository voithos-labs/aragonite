import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '$lib';
import { declaredPluginKind } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import { checkOpaqueStaleRaw } from '$lib/invariants/node-shape';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { splitNode } from '$lib/tree-operations/node-ops';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { fixtureLinkRef } from '../../harness/fixture-grammar';

// The structural paths into the same `</details>` escape: they write the body themselves,
// with no per-block commit to apply the rule.

beforeEach(() => {
	resetPluginPlatformForTests();
	registerDetailsKind();
});

// Enter is the second way into the body. Both halves are reachable, which is why the write
// escapes both: the anchored recognizer spares a tag line with text on either side, and the
// split is what leaves it alone on its line.
describe('details terminator escape at the split entry point', () => {
	const detailsOwner = () => ({ ownerKind: declaredPluginKind(DETAILS), owner: undefined });

	it('escapes the second half when the cut strands a trailing tag', () => {
		const parent = {
			children: parse('foo</details>\n').children,
			...detailsOwner(),
			lineEnding: '\n' as const
		};
		splitNode(parent, 0, 3, undefined, undefined, fixtureLinkRef());

		expect(parent.children.map((c) => c.raw)).toEqual(['foo\n', '&lt;/details>\n']);
	});

	it('escapes the first half when the cut strands a leading tag', () => {
		// `</details>foo` parses as an htmlBlock; the tag line survived unescaped only
		// because the trailing text kept it from matching the anchored terminator.
		const parent = {
			children: parse('</details>foo\n').children,
			...detailsOwner(),
			lineEnding: '\n' as const
		};
		expect(parent.children[0].kind).toBe('htmlBlock');

		splitNode(parent, 0, 10, undefined, undefined, fixtureLinkRef());

		expect(parent.children.map((c) => c.raw)).toEqual(['&lt;/details>\n', 'foo\n']);
	});

	it('leaves both halves alone at the document root, where no container claims them', () => {
		const parent = {
			children: parse('foo</details>\n').children,
			ownerKind: undefined,
			owner: undefined,
			lineEnding: '\n' as const
		};
		splitNode(parent, 0, 3, undefined, undefined, fixtureLinkRef());

		expect(parent.children.map((c) => c.raw)).toEqual(['foo\n', '</details>\n']);
	});
});

// The cross-block operations write the body themselves rather than going through the
// per-block path. Joining two lines can create a terminator line out of two that each held
// none, which is why they need the rule as much as typing does.
describe('details terminator escape at the cross-block entry points', () => {
	// Both children are ordinary loaded shapes: the tag sits mid-line, where the
	// anchored recognizer never sees it. The delete is what strands it at column 0.
	const MID_LINE_TAG =
		'<details>\n<summary>T</summary>\n\nalpha\nbeta\n\nxx</details>\nmore\n\n</details>\n';

	it('escapes a terminator the cross-block delete creates at the join', () => {
		const doc = parse(MID_LINE_TAG);
		expect(doc.children[0].children?.length).toBe(3);

		rangeDelete(
			doc,
			{ path: [0, 1], offset: 6 },
			{ path: [0, 2], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			fixtureLinkRef()
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
			fixtureLinkRef()
		);

		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(checkOpaqueStaleRaw(doc.children[0])).toBeNull();
	});
});
