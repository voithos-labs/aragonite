// @vitest-environment jsdom
// A destructive key at a `<br>` edge mid-cell deletes the whole tag in one key: the `<br>` is
// the one cell widget that cannot show a source, so the step-over arrows use would move the caret
// first and then delete a byte away from it. Each case has its arrow counterpart, which keeps
// the step-over.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mountCell } from './mount-cell';
import { settleEditor, dispatchKey } from '#lib/test/harness/settle.js';

// `<br>` at raw [4,8) with text on both sides, so both its edges are mid-cell: at a cell's
// text boundaries the navigation plan owns the key and it never reaches here.
const CELL = 'Left<br>Right';
const BR_START = 4;
const BR_END = 8;

let mounted: ReturnType<typeof mountCell>;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

describe('a destructive key at a mid-cell `<br>` edge deletes it whole, in one press', () => {
	const arms: Array<[string, string, number]> = [
		['Backspace at the trailing edge', 'Backspace', BR_END],
		['Delete at the leading edge', 'Delete', BR_START]
	];

	for (const [name, key, caret] of arms) {
		it(`${name} removes the widget's bytes`, async () => {
			mounted = mountCell(CELL);
			const { el, blockEdit, instance } = mounted;
			el.focus();
			instance.setSelection(caret, caret);

			dispatchKey(el, { key: key });
			await settleEditor();

			expect(vi.mocked(blockEdit.updateBlockContent).mock.calls).toHaveLength(1);
			const [index, text, , , caretAfter] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
			expect(index).toBe(0);
			expect(text).toBe('LeftRight');
			expect(caretAfter).toBe(BR_START);
		});

		it(`${name}: the arrow counterpart steps over it instead, writing nothing`, async () => {
			mounted = mountCell(CELL);
			const { el, blockEdit, instance } = mounted;
			el.focus();
			instance.setSelection(caret, caret);

			dispatchKey(el, { key: key === 'Backspace' ? 'ArrowLeft' : 'ArrowRight' });
			await settleEditor();

			expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
			// The caret crossed the widget rather than resting against it.
			expect(instance.getCursorOffset()).toBe(key === 'Backspace' ? BR_START : BR_END);
		});
	}

	// A destructive key pointing away from the widget takes the ordinary neighbouring character,
	// which rests on how `widgetAtCursor` breaks a direction tie.
	const nonEntry: Array<[string, string, number, string]> = [
		['Backspace at the LEADING edge', 'Backspace', BR_START, 'Lef<br>Right'],
		['Delete at the TRAILING edge', 'Delete', BR_END, 'Left<br>ight']
	];

	for (const [name, key, caret, after] of nonEntry) {
		it(`${name} takes the adjacent character, not the tag`, async () => {
			mounted = mountCell(CELL);
			const { el, blockEdit, instance } = mounted;
			el.focus();
			instance.setSelection(caret, caret);

			dispatchKey(el, { key: key });
			await settleEditor();

			// jsdom leaves this key to contenteditable, so no commit means nothing took it; the
			// browser outcome is in the `cell-inline-rendering` e2e spec.
			const calls = vi.mocked(blockEdit.updateBlockContent).mock.calls;
			if (calls.length > 0) expect(calls[0][1]).toBe(after);
			// Either way the tag survives: nothing wrote a text without it.
			for (const call of calls) expect(call[1]).toContain('<br>');
		});
	}

	// A cell renders an image as its literal source, not a widget, so the one-key delete must
	// not reach it, though the CST calls an image a widget by kind alone.
	it('leaves an image alone: a cell renders its source, not a widget', async () => {
		const withImage = 'Left![a](b)Right';
		mounted = mountCell(withImage);
		const { el, blockEdit, instance } = mounted;
		el.focus();
		instance.setSelection(withImage.indexOf(')') + 1, withImage.indexOf(')') + 1);

		dispatchKey(el, { key: 'Backspace' });
		await settleEditor();

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
