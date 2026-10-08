// @vitest-environment jsdom
// Every caret write the editor makes asks the drawn caret to repaint (G4.143): each method of the
// one caret writer, called once, requests exactly one paint, and a refused write requests none.
import { describe, expect, it } from 'vitest';
import { createCaretWriter, type CaretWriter } from '#lib/caret/widget-offset.js';

function paragraph(text: string): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = text;
	document.body.replaceChildren(el);
	el.focus();
	return el;
}

/** One call per writer method; typed over every key, so a new method cannot skip its row. */
const CALLS: Record<keyof CaretWriter, (writer: CaretWriter, el: HTMLElement) => void> = {
	placeCaretAtRaw: (writer, el) => writer.placeCaretAtRaw(el, 2, { clamp: 'exact' }),
	selectRawRange: (writer, el) => writer.selectRawRange(el, 1, 3),
	extendSelectionToRaw: (writer, el) => writer.extendSelectionToRaw(el, 4),
	selectSurfaceContent: (writer, el) => writer.selectSurfaceContent(el),
	selectDomRange: (writer, el) => {
		const range = document.createRange();
		range.selectNodeContents(el);
		writer.selectDomRange(range);
	},
	clear: (writer) => writer.clear()
};

describe('every caret writer method requests one paint', () => {
	it('the table names every method the writer has', () => {
		const writer = createCaretWriter(() => {});
		expect(Object.keys(writer).sort()).toEqual(Object.keys(CALLS).sort());
	});

	it.each(Object.entries(CALLS))('%s', (_, call) => {
		let requests = 0;
		const writer = createCaretWriter(() => requests++);
		const el = paragraph('hello');
		window.getSelection()!.collapse(el.firstChild, 0);
		call(writer, el);
		expect(requests).toBe(1);
	});

	it('a write the browser refuses requests nothing', () => {
		let requests = 0;
		const writer = createCaretWriter(() => requests++);
		const text = paragraph('hello').firstChild!;
		const pastTheEnd = { startContainer: text, startOffset: 99, endContainer: text, endOffset: 99 };
		expect(writer.selectDomRange(pastTheEnd as unknown as Range)).toBe(false);
		expect(requests).toBe(0);
	});
});
