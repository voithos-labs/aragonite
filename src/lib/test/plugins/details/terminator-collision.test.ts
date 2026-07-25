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
import { registerDetailsKind } from '$lib/plugins/details/details-kind';

/**
 * `</details>` is a fixed terminator with no fence length to escalate, so a body
 * line reproducing it is UNREPRESENTABLE — every byte sequence containing that
 * literal line closes the element, in aragonite and on GitHub alike. The rebuild
 * cannot repair it either: escaping the child's bytes would diverge the
 * container's raw from its live children, which is what G1.12 fires on.
 *
 * These pin the resulting contract: the collision is reachable through the real
 * commit path (not just a synthetic raw poke), the bytes still round-trip, and
 * G1.12 catches the divergence — so the dev channel and the e2e invariant watcher
 * see it rather than it corrupting silently. Repair needs a commit-path escape
 * seam; until then this is the guarded floor, and these tests fail loudly if the
 * guard regresses.
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
	it('diverges from its own bytes when a body child becomes the close tag', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0);

		const details = h.deps.doc.children[0];
		expect(details.kind).toBe('details');
		expect(details.children?.map((c) => c.kind)).toEqual(['details-summary', 'htmlBlock']);

		// The live tree says one details holding the line; its own bytes say otherwise.
		expect(parse(serialize(h.deps.doc)).children.map((c) => c.kind)).toEqual([
			'details',
			'htmlBlock'
		]);
	});

	it('is caught by the opaque staleness guard rather than corrupting silently', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0);

		const violation = checkOpaqueStaleRaw(h.deps.doc.children[0]);
		expect(violation?.code).toBe('opaque-stale-raw');
		expect(violation?.detail).toMatchObject({ reason: 'reparse-diverges' });
	});

	// The open tag is the same collision from the other side: it inflates the
	// opener's depth counter, so the scan finds no matching close and the details
	// kind disappears entirely on reload.
	it('is caught the same way when a body child becomes the open tag', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '<details>\n', 0);

		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])?.code).toBe('opaque-stale-raw');
	});

	// Byte round-trip is NOT the property at risk here, and saying so keeps the
	// next reader from mistaking this for a serializer bug.
	it('keeps the byte round-trip intact throughout', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '</details>\n', 0);

		const bytes = serialize(h.deps.doc);
		expect(serialize(parse(bytes))).toBe(bytes);
	});

	// The fence-bearing sibling: a fenced body line reproducing the tag is content,
	// so the container survives. This is what makes the collision above specific to
	// an UNFENCED occurrence rather than to the tag bytes.
	it('survives a close tag that sits inside a fenced code body', async () => {
		const h = mountDetails(OPEN_DETAILS);
		await h.bundle.blockEdit.updateBlockContent(1, '```\n</details>\n```\n', 0);

		expect(checkOpaqueStaleRaw(h.deps.doc.children[0])).toBeNull();
	});
});
