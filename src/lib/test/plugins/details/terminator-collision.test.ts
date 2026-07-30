import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '$lib/test/harness/editor-actions';
import { checkOpaqueStaleRaw } from '$lib/invariants/node-shape';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { splitNode } from '$lib/tree-operations/node-ops';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';

/**
 * `</details>` is a fixed terminator with no fence length to escalate, so bytes
 * reproducing it cannot be emitted into the body as-is. The repair is a
 * commit-path escape: the container's `bodyWrite` rule rewrites the offending
 * line's `<` to `&lt;` BEFORE the write lands, so the child's own raw carries the
 * escaped bytes and the container's raw never disagrees with its children.
 *
 * These pin both halves — that the escape fires where the container's grammar is
 * at stake, and that it declines everywhere else. The escape's placement upstream
 * of the leaf reparse is load-bearing and pinned here too: escaped bytes parse as
 * a paragraph, so the kind the child ends up with is the kind its bytes describe.
 */
beforeEach(() => {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
});

const OPEN_DETAILS = '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n';

function mountDetails(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	const bundle = createStandardNestedActions(
		createBlockListState(() => harness.deps.doc.children[0]),
		makeNestedActionsDeps({
			index: 0,
			getNode: () => harness.deps.doc.children[0],
			path: [0],
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: createContainerEditActions(harness.deps, controller)
			}
		})
	);
	return { ...harness, bundle };
}

describe('details terminator collision through the real commit path', () => {
	it('escapes a body child that becomes the close tag, leaving the container intact', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0);

		const details = h.deps.doc.children[0];
		expect(details.children?.[1].raw).toBe('&lt;/details>\n');
		// Upstream of the leaf reparse: the kind follows the ESCAPED bytes, so the
		// child stays prose instead of being minted as the htmlBlock the raw tag
		// would have parsed to.
		expect(details.children?.map((c) => c.kind)).toEqual(['details-summary', 'paragraph']);
	});

	it('converges with a fresh parse of its own bytes after the escape', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0);

		expect(parse(serialize(h.deps.doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])).toBeNull();
	});

	// The open tag is the same collision from the other side: unescaped it inflates
	// the opener's depth counter, so the scan finds no matching close and the
	// details kind disappears entirely on reload.
	it('escapes a body child that becomes the open tag', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '<details>\n', 0);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe('&lt;details>\n');
		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])).toBeNull();
	});

	// Byte round-trip is NOT the property at risk here, and saying so keeps the
	// next reader from mistaking this for a serializer bug.
	it('keeps the byte round-trip intact throughout', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0);

		const bytes = serialize(h.deps.doc);
		expect(serialize(parse(bytes))).toBe(bytes);
	});

	// The fence-bearing sibling: a fenced body line reproducing the tag is content
	// the container's own scan already skips, so the escape must decline. Escaping
	// here would corrupt the code's text — entities do not decode inside a fence.
	it('declines to escape a close tag inside a fenced code body', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '```\n</details>\n```\n', 0);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe('```\n</details>\n```\n');
		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])).toBeNull();
	});

	// What closes the element is whatever CommonMark hands to raw-HTML passthrough,
	// which is looser than the container's own canonical recognizer. Each of these
	// reloads intact in aragonite — its recognizer never sees them — and closes the
	// element on GitHub, so the escape answers to the SPEC's tag-line shape.
	const passthroughVariants = [
		[' </details>', ' &lt;/details>'],
		['   </details>', '   &lt;/details>'],
		['</DETAILS>', '&lt;/DETAILS>'],
		['<details >', '&lt;details >'],
		// Not forward-typeable (the `>` escapes first) but reachable by paste or edit.
		['</details> ', '&lt;/details> ']
	] as const;

	it.each(passthroughVariants)('escapes the passthrough variant %j', async (typed, escaped) => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, `${typed}\n`, 0);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe(`${escaped}\n`);
		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])).toBeNull();
		expect(parse(serialize(h.deps.doc)).children.map((c) => c.kind)).toEqual(['details']);
	});

	// A balanced nested pair inside one htmlBlock child is legal markup the
	// container's depth scan already handles. Escaping it would rewrite the user's
	// HTML, which is why the rule is a depth scan and not a line match.
	it('declines to escape a balanced nested pair inside an html child', async () => {
		const h = mountDetails(OPEN_DETAILS);
		const nested = '<div>\n<details>\n<summary>x</summary>\n</details>\n</div>\n';
		await h.bundle.blockEdit.updateBlockContent(1, nested, 0);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe(nested);
	});
});

// Enter is the second door into the body. BOTH halves are reachable, which is why
// the sink escapes both: the anchored recognizer spares a tag line with text on
// either side, and the cut is what strands it alone.
describe('details terminator escape at the split door', () => {
	const detailsOwner = () => ({ ownerKind: declaredPluginKind(DETAILS) });

	it('escapes the second half when the cut strands a trailing tag', () => {
		const parent = { children: parse('foo</details>\n').children, ...detailsOwner() };
		splitNode(parent, 0, 3);

		expect(parent.children.map((c) => c.raw)).toEqual(['foo\n', '&lt;/details>\n']);
	});

	it('escapes the first half when the cut strands a leading tag', () => {
		// `</details>foo` parses as an htmlBlock — the tag line only survived unescaped
		// because the trailing text kept it off the anchored terminator.
		const parent = { children: parse('</details>foo\n').children, ...detailsOwner() };
		expect(parent.children[0].kind).toBe('htmlBlock');

		splitNode(parent, 0, 10);

		expect(parent.children.map((c) => c.raw)).toEqual(['&lt;/details>\n', 'foo\n']);
	});

	it('leaves both halves alone at the document root, where no container claims them', () => {
		const parent = { children: parse('foo</details>\n').children, ownerKind: undefined };
		splitNode(parent, 0, 3);

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
			undefined
		);

		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(checkOpaqueStaleRaw(doc.children[0])).toBeNull();
	});
});

describe('details terminator escape caret image', () => {
	it('maps the caret past the inserted entity so the re-render seats it correctly', () => {
		const h = mountDetails(OPEN_DETAILS);

		// Caret after the typed `>` (offset 10) lands after the escaped `>` (13):
		// the `<` ahead of it grew to `&lt;`.
		expect(h.bundle.blockEdit.mapCommittedOffset?.('</details>\n', 10)).toBe(13);
	});

	it('leaves a caret in an untouched line where it was', () => {
		const h = mountDetails(OPEN_DETAILS);

		expect(h.bundle.blockEdit.mapCommittedOffset?.('plain body\n', 5)).toBe(5);
	});

	it('is a no-op over already-escaped bytes, so a re-commit cannot double-escape', () => {
		const h = mountDetails(OPEN_DETAILS);

		expect(h.bundle.blockEdit.mapCommittedOffset?.('&lt;/details>\n', 13)).toBe(13);
	});

	// The contract names `normalize` as the idempotent member; assert it directly
	// rather than through its caret image, which shares the same scan.
	it('normalize is idempotent over every shape the escape touches', () => {
		const normalize = getBlockKindDescriptor(declaredPluginKind(DETAILS)).bodyWrite!.normalize;
		const inputs = [
			'</details>\n',
			'<details>\n',
			' </details>\r\n',
			'</DETAILS>',
			'</details>\n<details>\n',
			'```\n</details>\n```\n',
			'<div>\n<details>\n</details>\n</div>\n'
		];

		for (const input of inputs) {
			const once = normalize(input);
			expect(normalize(once)).toBe(once);
		}
	});

	// A caret is mapped through the same escape that moved the bytes, so folding the
	// entities back must reproduce the prefix the user had. Checked at every offset:
	// a per-line predicate with multi-byte insertions is exactly where an off-by-one
	// hides from a hand-picked case.
	it('mapOffset is the exact image of normalize at every offset', () => {
		const bodyWrite = getBlockKindDescriptor(declaredPluginKind(DETAILS)).bodyWrite!;
		const inputs = ['</details>\n', ' </details>\nx\n', '</details>\n<details>\n', 'plain\n'];

		for (const raw of inputs) {
			for (let offset = 0; offset <= raw.length; offset++) {
				const mapped = bodyWrite.normalize(raw).slice(0, bodyWrite.mapOffset(raw, offset));
				expect(mapped.replaceAll('&lt;', '<')).toBe(raw.slice(0, offset));
			}
		}
	});

	// Every prefix of the tag, keystroke by keystroke. `</details` — no `>` yet — is
	// ALREADY a type-6 line (the shape's tail admits end-of-line), and a browser
	// left holding it swallows what follows until it finds a `>`. Escaping from that
	// keystroke on also means the block never oscillates through htmlBlock: the kind
	// stays prose the whole way, so no intermediate state is a kind change.
	it('escapes from the first keystroke the spec would pass through, never oscillating', async () => {
		const h = mountDetails(OPEN_DETAILS);
		const typed = '</details>';
		const kinds: string[] = [];

		for (let i = 1; i <= typed.length; i++) {
			await h.bundle.blockEdit.updateBlockContent(1, `${typed.slice(0, i)}\n`, i - 1, i);
			kinds.push(h.deps.doc.children[0].children?.[1].kind ?? '?');
		}

		expect(new Set(kinds)).toEqual(new Set(['paragraph']));
		expect(h.deps.doc.children[0].children?.[1].raw).toBe('&lt;/details>\n');
		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])).toBeNull();
	});

	// The structural door: a commit whose kind genuinely changes still escapes. Its
	// caret mapping is pinned end-to-end in the details e2e — the unit harness mounts
	// no refs, so no focus landing is observable here.
	it('escapes on a kind-changing commit, the structural door', async () => {
		const h = mountDetails('<details>\n<summary>T</summary>\n\n```\nx\n```\n\n</details>\n');
		expect(h.deps.doc.children[0].children?.[1].kind).toBe('fencedCode');

		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0, 10);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe('&lt;/details>\n');
		expect(h.deps.doc.children[0].children?.[1].kind).toBe('paragraph');
	});
});
