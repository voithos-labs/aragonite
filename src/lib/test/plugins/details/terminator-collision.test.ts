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

/**
 * `</details>` is a fixed terminator with no fence length to escalate, so the repair is a
 * commit-path escape: `bodyWrite` rewrites the offending line's `<` to `&lt;` BEFORE the
 * write lands, upstream of the leaf reparse, so the child's kind follows the escaped bytes.
 * Both halves are pinned: the escape fires where the grammar is at stake, and declines
 * everywhere else. The structural doors live in terminator-collision-structural.test.ts.
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

	// Byte round-trip is NOT the property at risk here: a red row points at the
	// escape, not the serializer.
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

	// What closes the element is raw-HTML passthrough, looser than the container's own
	// recognizer: each of these reloads intact here yet closes the element on GitHub,
	// so the escape answers to the SPEC's tag-line shape.
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

	// A balanced nested pair is legal markup the container's depth scan already
	// handles; escaping it would rewrite the user's HTML. Hence a scan, not a match.
	it('declines to escape a balanced nested pair inside an html child', async () => {
		const h = mountDetails(OPEN_DETAILS);
		const nested = '<div>\n<details>\n<summary>x</summary>\n</details>\n</div>\n';
		await h.bundle.blockEdit.updateBlockContent(1, nested, 0);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe(nested);
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

	// Checked at every offset, not a hand-picked one: a per-line predicate with
	// multi-byte insertions is exactly where an off-by-one hides.
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

	// `</details` with no `>` yet is ALREADY a type-6 line, and a browser left holding
	// it swallows what follows. Escaping from that keystroke on also keeps the block
	// from oscillating through htmlBlock, so no intermediate state is a kind change.
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

	// The structural door: a commit whose kind genuinely changes still escapes. Caret
	// mapping is pinned in the details e2e — this harness mounts no refs.
	it('escapes on a kind-changing commit, the structural door', async () => {
		const h = mountDetails('<details>\n<summary>T</summary>\n\n```\nx\n```\n\n</details>\n');
		expect(h.deps.doc.children[0].children?.[1].kind).toBe('fencedCode');

		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0, 10);

		expect(h.deps.doc.children[0].children?.[1].raw).toBe('&lt;/details>\n');
		expect(h.deps.doc.children[0].children?.[1].kind).toBe('paragraph');
	});
});
