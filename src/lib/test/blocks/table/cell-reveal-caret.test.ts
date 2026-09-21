// @vitest-environment jsdom
//
// The caret half of how a cell writes. `normalizeRawWrite` escapes every free `|` as the bytes
// are written, so an offset reported against just-written text lands one byte early for each
// escape; the commit caret is mapped, while the pending cursor is passed separately and skips
// that mapping. Only the commit half is covered here: `focusCell` is stubbed, so the "Enter stays
// put" half is checked on exact bytes by e2e/tests/blocks/table/cell-inline-reveal.spec.ts.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { resetInlineState } from '../text/math-widget-fixture';
import { mountCell, settleTicks } from './mount-cell';

// `x $a$ yz`: a math widget at raw [2,5) with prose on both sides, so every caret offset
// this test names sits outside the widget span and reads back unambiguously.
const CELL = 'x $a$ yz';

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** The source text node swapped in where the widget was. */
function revealedSource(el: HTMLElement): Text {
	const found = Array.from(el.childNodes).find(
		(c) => c.nodeType === Node.TEXT_NODE && c.textContent === '$a$'
	);
	expect(found, 'the reveal did not swap the widget for its source').toBeDefined();
	return found as Text;
}

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
	resetInlineState();
});

describe('a reveal commit in a cell puts the caret its caret in escaped space', () => {
	it('a `|` typed into the revealed source moves the caret it sits before', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		// ArrowLeft at the widget's trailing edge shows its source; the edit inside it
		// lives only in the DOM by design, since `onInput` is suppressed while it shows.
		press(el, 'ArrowLeft');
		await settleTicks();
		revealedSource(el).textContent = '$a|$';
		press(el, 'Enter');
		await settleTicks();

		// The write escaped the free `|`, so the commit caret is 7, past `$a\|$`.
		const [, , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(7);
		// The remembered caret counts into the same bytes, so it must be the same offset. Unmapped
		// it is 6, between the inserted `\` and the `|` it frees, inside the widget just edited.
		expect(instance.getCursorOffset()).toBe(committedCaret);
	});

	it('a source edit with no free pipe puts the caret where it always did', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		press(el, 'ArrowLeft');
		await settleTicks();
		revealedSource(el).textContent = '$ab$';
		press(el, 'Enter');
		await settleTicks();

		// Non-vacuity: the mapping leaves the offset alone when nothing is inserted, so
		// the escaping cannot be a blanket shift.
		const [, , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(6);
		expect(instance.getCursorOffset()).toBe(6);
	});
});
