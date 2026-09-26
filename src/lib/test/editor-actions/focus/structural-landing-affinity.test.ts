// @vitest-environment jsdom
//
// The side of a hidden marker a cross-block move lands on. Miss-analysis (#172): the affinity
// suite covered the key classifier and the selection collapse, and nothing asked what a
// moveFocus arrival answers; a missing call is invisible to tests written against the calls
// that exist.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { makeEditorActionsDeps, stubBlockComponent } from '$lib/test/harness/editor-actions';
import type { FocusPosition } from '$lib/block-component';

// `**bold**` above a fence: the caret lands in the closer's hidden run, where 'near' reads as
// inside the construct and 'outside' as after it (docs/design/live-mode.md § 4.2).
const BOLD_ABOVE_FENCE = 'a **bold**\n\n```\ncode\n```\n';

function harnessFor(source: string) {
	const { deps, doc } = makeEditorActionsDeps(parse(source).children);
	// The real state, not the harness mock: the assertion is the side it answers, and a mock
	// answers null however the move calls it.
	const memory = createCaretMemory();
	deps.caretMemory = memory;
	deps.setBlockRefs(doc.children.map(() => stubBlockComponent({ focus: vi.fn() })));
	const focus = createFocusActions(deps, createUndoController(deps));
	return {
		memory,
		move: (index: number, position: FocusPosition) => focus.moveFocus(index, position)
	};
}

describe("moveFocus: the side a landing at a block's end settles (#172)", () => {
	it('answers outside: the caret was placed at an extreme, it did not step there', async () => {
		const h = harnessFor(BOLD_ABOVE_FENCE);

		await h.move(0, 'end');

		expect(h.memory.side()).toBe('outside');
	});

	it('re-answers outside after a reset, the state every structural commit leaves behind', async () => {
		const h = harnessFor(BOLD_ABOVE_FENCE);
		h.memory.forget();

		await h.move(0, 'end');

		expect(h.memory.side()).toBe('outside');
	});

	// A numeric position is a caller that knows its byte (a split's second half), not an
	// arrival at an edge: it has no side to decide and must not claim one.
	it('leaves a targeted numeric landing alone', async () => {
		const h = harnessFor(BOLD_ABOVE_FENCE);

		await h.move(0, 3);

		expect(h.memory.side()).toBeNull();
	});
});
