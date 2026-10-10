// @vitest-environment jsdom
// `rawWrite` escapes every free `|` as a cell writes, so an offset counted before the escapes
// lands one byte early per escape, and the commit caret is mapped past them. `focusCell` is
// stubbed, so the "Enter stays put" half is covered by the `cell-inline-reveal` e2e spec.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerMathInline } from '#lib/plugins/latex/latex-kind.js';
import { mountCell } from './mount-cell';
import { settleEditor, dispatchKey } from '#lib/test/harness/settle.js';

// `x $a$ yz`: a math widget at raw [2,5) with prose on both sides, so every caret offset
// this test names sits outside the widget span and reads back unambiguously.
const CELL = 'x $a$ yz';

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
		dispatchKey(el, { key: 'ArrowLeft' });
		await settleEditor();
		revealedSource(el).textContent = '$a|$';
		dispatchKey(el, { key: 'Enter' });
		await settleEditor();

		// The cell hands the write 6, after `$a|$`; the write escapes the free `|`, so the caret
		// lands at 7, past `$a\|$`, not between the inserted `\` and the `|`.
		const [, , , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(6);
		expect(instance.getCursorOffset()).toBe(7);
	});

	it('a source edit with no free pipe puts the caret where it always did', async () => {
		registerMathInline();
		mounted = mountCell(CELL);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(5, 5);

		dispatchKey(el, { key: 'ArrowLeft' });
		await settleEditor();
		revealedSource(el).textContent = '$ab$';
		dispatchKey(el, { key: 'Enter' });
		await settleEditor();

		// The mapping leaves the offset alone when nothing is inserted, so it is not a blanket
		// shift.
		const [, , , , committedCaret] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(committedCaret).toBe(6);
		expect(instance.getCursorOffset()).toBe(6);
	});
});
