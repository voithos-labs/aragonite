// @vitest-environment jsdom
//
// The caret half of the cell's write door. A cell's `normalizeRawWrite` escapes every free `|`
// at the write sink, so an offset reported against just-written text lands one byte early per
// escape; the door maps the COMMIT caret, and the pending cursor is a separate dep that bypasses
// it. Scope is the commit half only: `focusCell` is stubbed here, so the "Enter stays put" half
// is guarded on exact bytes by e2e/tests/blocks/table/cell-inline-reveal.spec.ts — do not thin it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { resetInlineState } from '../text/math-widget-fixture';
import { mountCell } from './mount-cell';

// `x $a$ yz`: a math widget at raw [2,5) with prose on both sides, so every caret
// offset this test names sits OUTSIDE the widget span and reads back unambiguously.
const CELL = 'x $a$ yz';

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** The keydown handlers await the shared prelude, so a commit lands several
 *  microtasks after dispatch — and the render effect one more after that. */
async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await tick();
}

/** The ephemeral source text node the reveal swapped the widget island for. */
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

describe('a reveal commit in a cell parks its caret in escaped space', () => {
	it('a `|` typed into the revealed source moves the caret it sits before', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		// ArrowLeft at the widget's trailing edge opens its source reveal; the edit
		// inside it is ephemeral DOM by design (onInput is suppressed while revealed).
		press(el, 'ArrowLeft');
		await settle();
		revealedSource(el).textContent = '$a|$';
		press(el, 'Enter');
		await settle();

		// The door escaped the free `|`, so the commit caret is 7 — past `$a\|$`.
		const [, , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(7);
		// The parked caret addresses the same bytes, so it must be the same offset. Unmapped it is 6 —
		// between the inserted `\` and the `|` it frees, inside the widget the user just edited.
		expect(instance.getCursorOffset()).toBe(committedCaret);
	});

	it('a source edit with no free pipe parks where it always did', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		press(el, 'ArrowLeft');
		await settle();
		revealedSource(el).textContent = '$ab$';
		press(el, 'Enter');
		await settle();

		// Non-vacuity: the mapping is identity when the sink inserts nothing, so the
		// escape path cannot be a blanket offset shift.
		const [, , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(6);
		expect(instance.getCursorOffset()).toBe(6);
	});
});
