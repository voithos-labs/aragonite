// @vitest-environment jsdom
// The entry paths that reach a whole-block kind with a character offset in hand: a shift-click's
// hit-test, and the restore path a consumer's `setSelection` takes. Both must leave
// `enterCrossBlock` holding a whole-block endpoint.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom lays nothing out, so the click's caret read is stubbed exactly as
// `keyboard-shift-click.test.ts` stubs it; the branch under test is what the selection state stores.
vi.mock('#lib/selection/native-bridge.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/selection/native-bridge.js')>()),
	readNativeCaretInBlock: vi.fn()
}));
vi.mock('#lib/caret/point-offset.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/caret/point-offset.js')>()),
	offsetFromViewportPoint: vi.fn()
}));

import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { handleShiftClick } from '#lib/selection/keyboard-extend.js';
import { readNativeCaretInBlock } from '#lib/selection/native-bridge.js';
import { offsetFromViewportPoint } from '#lib/caret/point-offset.js';
import { parse } from '#lib/core/parser.js';
import { restoreLandingOver } from '../harness/restore-landing';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

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

		expect(handleShiftClick(s, testCaretWriter, el(), [1], 0, 0, el(), [0])).toBe(true);
		expect(s.focus).toEqual({ path: [1], offset: 3 });
	});

	it('snaps an arbitrary interior offset handed in by setSelection', async () => {
		const doc = parse(BREAK_DOC);
		const s = createSelectionState({ getDoc: () => doc });

		const outcome = await restoreLandingOver(doc, s).landing.restore({
			anchor: { path: [1], offset: 2 },
			focus: { path: [2], offset: 4 }
		});

		expect(outcome).toBe('applied');
		expect(s.start).toEqual({ path: [1], offset: 0 });
	});
});
