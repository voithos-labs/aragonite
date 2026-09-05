// @vitest-environment jsdom
//
// The entry paths that reach a whole-block kind with a character offset in hand: a shift-click's
// hit-test, and the restore road a consumer's `setSelection` rides. Both must leave the funnel
// carrying a whole-unit endpoint.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom lays nothing out, so the click's caret read is stubbed exactly as
// `keyboard-shift-click.test.ts` stubs it; the branch under test is what the funnel stores.
vi.mock('$lib/selection/native-bridge', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/selection/native-bridge')>()),
	readNativeCaretInBlock: vi.fn()
}));
vi.mock('$lib/cursor/point-offset', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/cursor/point-offset')>()),
	offsetFromViewportPoint: vi.fn()
}));

import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { handleShiftClick } from '$lib/selection/keyboard-extend';
import { restoreSelection } from '$lib/selection/selection-restore';
import { readNativeCaretInBlock } from '$lib/selection/native-bridge';
import { offsetFromViewportPoint } from '$lib/cursor/point-offset';
import { parse } from '$lib/core/parser';

const BREAK_DOC = 'Above text\n\n---\n\ntail text\n';
const clickOffset = vi.mocked(offsetFromViewportPoint);
const anchorCaret = vi.mocked(readNativeCaretInBlock);
const el = () => document.createElement('div');

beforeEach(() => {
	clickOffset.mockReset();
	anchorCaret.mockReset();
});

describe('whole-block endpoints arriving from an entry path', () => {
	it('snaps a shift-click that hit-tested characters over a whole-block kind', () => {
		const doc = parse(BREAK_DOC);
		const s = createSelectionState({ getDoc: () => doc });
		clickOffset.mockReturnValue(1);
		anchorCaret.mockReturnValue({ path: [0], offset: 6 });

		expect(handleShiftClick(s, el(), [1], 0, 0, el(), [0])).toBe(true);
		expect(s.focus).toEqual({ path: [1], offset: 3 });
	});

	it('snaps an arbitrary interior offset handed in by setSelection', async () => {
		const doc = parse(BREAK_DOC);
		const s = createSelectionState({ getDoc: () => doc });

		const outcome = await restoreSelection(
			{ anchor: { path: [1], offset: 2 }, focus: { path: [2], offset: 4 } },
			{
				getDoc: () => doc,
				selectionState: s,
				getBlockElByPath: () => document.createElement('div'),
				revealTarget: async () => true
			}
		);

		expect(outcome).toBe('applied');
		expect(s.start).toEqual({ path: [1], offset: 0 });
	});
});
