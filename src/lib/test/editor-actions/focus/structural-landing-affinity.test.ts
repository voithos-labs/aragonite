// @vitest-environment jsdom
//
// The side a cross-block landing settles. Miss (#172): the affinity suite covered the key
// classifier and the collapse door, and nothing asked what a moveFocus landing answers — an
// absent call at a seat is invisible to tests written against the calls that exist.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createEdgeAffinityState } from '$lib/cursor/edge-affinity';
import { makeEditorActionsDeps, mockRef } from '$lib/test/harness/editor-actions';
import type { FocusPosition } from '$lib/block-component';

// `**bold**` above a fence: the landing lands in the closer's hidden run, where 'near' reads as
// inside the construct and 'outside' as after it (docs/design/live-mode.md § 4.2).
const BOLD_ABOVE_FENCE = 'a **bold**\n\n```\ncode\n```\n';

function harnessFor(source: string) {
	const { deps, doc } = makeEditorActionsDeps(parse(source).children);
	// The real state, not the harness mock: the assertion is the side it answers, and a mock
	// answers null however the seat calls it.
	const affinity = createEdgeAffinityState();
	deps.edgeAffinity = affinity;
	deps.setBlockRefs(doc.children.map(() => mockRef({ focus: vi.fn() })));
	const focus = createFocusActions(deps, createUndoController(deps));
	return {
		affinity,
		move: (index: number, position: FocusPosition) => focus.moveFocus(index, position)
	};
}

describe("moveFocus — the side a landing at a block's end settles (#172)", () => {
	it('answers outside: the caret was seated at an extreme, it did not step there', async () => {
		const h = harnessFor(BOLD_ABOVE_FENCE);

		await h.move(0, 'end');

		expect(h.affinity.get()).toBe('outside');
	});

	it('re-answers outside after a reset, the state every structural commit leaves behind', async () => {
		const h = harnessFor(BOLD_ABOVE_FENCE);
		h.affinity.reset();

		await h.move(0, 'end');

		expect(h.affinity.get()).toBe('outside');
	});

	// A numeric position is a caller that knows its byte (a split's continuation), not an
	// arrival at an edge — it has no side to settle and must not claim one.
	it('leaves a targeted numeric landing alone', async () => {
		const h = harnessFor(BOLD_ABOVE_FENCE);

		await h.move(0, 3);

		expect(h.affinity.get()).toBeNull();
	});
});
