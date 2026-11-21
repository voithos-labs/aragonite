// The hover card over an editor: a resting hover opens the rows through `openRows`, and the
// pointer leaving the card closes it after the grace, as leaving the word does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor, MarkAt, SelectionAction } from '#lib/plugin.js';
import { createHoverCard } from '#packages/spellcheck/src/hover-card.js';
import { HOVER_GRACE_MS, HOVER_OPEN_MS } from '#packages/spellcheck/src/hover.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ACTION: SelectionAction = { label: 'Spelling', rows: () => [] };
const anchor = { left: 40, top: 10, right: 70, bottom: 30 } as DOMRect;
const AT: MarkAt = { range: { from: 0, to: 4 }, anchor, rects: [] };

/** An editor holding the one word `tset`, whose `openRows` hands back a menu the test can close. */
function cardOverEditor() {
	const opened: { range: unknown; pointer?: (inside: boolean) => void }[] = [];
	let open = false;
	const text = { kind: 'text', from: 0, to: 4, text: 'tset', children: [], is: () => false };
	const editor = {
		blockAt: () => ({ pieces: [text] }),
		selection: null,
		on: () => () => {},
		openRows(_action: SelectionAction, range: unknown, _anchor: unknown, pointer?: () => void) {
			opened.push({ range, pointer });
			open = true;
			return {
				get isOpen() {
					return open;
				},
				close: () => void (open = false)
			};
		}
	} as unknown as Editor;
	return { card: createHoverCard(editor, ACTION), opened, isOpen: () => open };
}

describe('the hover card', () => {
	it('opens the rows over the word once the pointer rests on it', () => {
		const { card, opened } = cardOverEditor();
		card.hover(AT);
		vi.advanceTimersByTime(HOVER_OPEN_MS);
		expect(opened.map((o) => o.range)).toEqual([{ from: 0, to: 4, word: 'tset' }]);
	});

	it('stays while the pointer is on it, and closes after the grace once the pointer leaves it', () => {
		const { card, opened, isOpen } = cardOverEditor();
		card.hover(AT);
		vi.advanceTimersByTime(HOVER_OPEN_MS);
		opened[0].pointer!(true);
		card.hover(null);
		vi.advanceTimersByTime(HOVER_GRACE_MS);
		expect(isOpen()).toBe(true);
		opened[0].pointer!(false);
		vi.advanceTimersByTime(HOVER_GRACE_MS);
		expect(isOpen()).toBe(false);
	});
});
