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
import { splitNode } from '$lib/tree-operations/node-ops';

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

	// A balanced nested pair inside one htmlBlock child is legal markup the
	// container's depth scan already handles. Escaping it would rewrite the user's
	// HTML, which is why the rule is the recognizer's own scan and not a line match.
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
		const parent = { children: parse('foo</details>\n').children };
		splitNode(parent, 0, 3);

		expect(parent.children.map((c) => c.raw)).toEqual(['foo\n', '</details>\n']);
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

	// The keystroke that completes the tag is a KIND CHANGE, not routine typing:
	// `</details` alone is already a type-6 html opener, so the block is an
	// htmlBlock until the `>` escapes it back to prose. Both commit doors must map
	// the caret; the landing itself is pinned end-to-end in the details e2e, which
	// is the only place the component measures a pre-escape DOM for real.
	it('escapes the completing keystroke even though it arrives as a kind change', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details\n', 0);
		expect(h.deps.doc.children[0].children?.[1].kind).toBe('htmlBlock');

		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 9, 10);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe('&lt;/details>\n');
		expect(h.deps.doc.children[0].children?.[1].kind).toBe('paragraph');
	});
});
