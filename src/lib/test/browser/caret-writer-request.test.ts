// @vitest-environment jsdom
// Every caret write the editor makes asks the drawn caret to repaint (G4.143): each method of the
// one caret writer, called once, requests exactly one paint, a refused write none, and a read none.
import { describe, expect, it } from 'vitest';
import { createCaretWriter, type CaretWriter } from '#lib/browser/caret-writer.js';

function paragraph(text: string): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = text;
	document.body.replaceChildren(el);
	el.focus();
	return el;
}

/** The writer's one read, which leaves the selection as it stood. */
type WriterRead = 'focusEndsLine';

/** One call per writer method; typed over every key, so a new method cannot skip its row. A row
 *  that needs the writer's own caret first calls `fresh` after placing it, to count only its call. */
const CALLS: Record<
	Exclude<keyof CaretWriter, WriterRead>,
	(writer: CaretWriter, el: HTMLElement, fresh: () => void) => void
> = {
	placeCaretAtRaw: (writer, el) => writer.placeCaretAtRaw(el, 2, { clamp: 'exact' }),
	selectRawRange: (writer, el) => writer.selectRawRange(el, 1, 3),
	extendSelectionToRaw: (writer, el) => writer.extendSelectionToRaw(el, 4),
	selectSurfaceContent: (writer, el) => writer.selectSurfaceContent(el),
	selectDomRange: (writer, el) => {
		const range = document.createRange();
		range.selectNodeContents(el);
		writer.selectDomRange(range);
	},
	canonicalizeCaret: (writer, el) => {
		el.textContent = 'ab\r\ncd';
		window.getSelection()!.collapse(el.firstChild, 3);
		writer.canonicalizeCaret(el);
	},
	rewriteCaret: (writer, el, fresh) => {
		writer.placeCaretAtRaw(el, 2, { clamp: 'exact' });
		fresh();
		writer.rewriteCaret(el);
	},
	moveCaretToLineEdge: (writer) => {
		// jsdom lays out no lines, so the move itself is the browser's; the row counts the write.
		const sel = window.getSelection()!;
		if (typeof sel.modify !== 'function') Object.assign(sel, { modify: () => {} });
		writer.moveCaretToLineEdge('end');
	},
	extendToLineEdge: (writer) => {
		const sel = window.getSelection()!;
		if (typeof sel.modify !== 'function') Object.assign(sel, { modify: () => {} });
		writer.extendToLineEdge('start');
	},
	clear: (writer) => writer.clear()
};

describe('every caret writer method requests one paint', () => {
	it('the table names every method the writer has', () => {
		const writer = createCaretWriter(
			() => {},
			() => false,
			() => false
		);
		const read: WriterRead[] = ['focusEndsLine'];
		expect(Object.keys(writer).sort()).toEqual([...Object.keys(CALLS), ...read].sort());
	});

	it('asking whether the focus ends its line requests nothing and moves nothing', () => {
		let requests = 0;
		const writer = createCaretWriter(
			() => requests++,
			() => false,
			() => false
		);
		const text = paragraph('hello').firstChild!;
		const sel = window.getSelection()!;
		sel.collapse(text, 2);
		// jsdom lays out no lines, so the browser's move is a no-op: the focus already ends its line.
		if (typeof sel.modify !== 'function') Object.assign(sel, { modify: () => {} });
		expect(writer.focusEndsLine()).toBe(true);
		expect([sel.focusNode, sel.focusOffset, requests]).toEqual([text, 2, 0]);
	});

	it.each(Object.entries(CALLS))('%s', (_, call) => {
		let requests = 0;
		const writer = createCaretWriter(
			() => requests++,
			() => false,
			() => false
		);
		const el = paragraph('hello');
		window.getSelection()!.collapse(el.firstChild, 0);
		call(writer, el, () => (requests = 0));
		expect(requests).toBe(1);
	});

	it('a write the browser refuses requests nothing', () => {
		let requests = 0;
		const writer = createCaretWriter(
			() => requests++,
			() => false,
			() => false
		);
		const text = paragraph('hello').firstChild!;
		const pastTheEnd = { startContainer: text, startOffset: 99, endContainer: text, endOffset: 99 };
		expect(writer.selectDomRange(pastTheEnd as unknown as Range)).toBe(false);
		expect(writer.canonicalizeCaret(text.parentElement!)).toBe(false);
		// A caret the browser put there, not the writer, is not the writer's to place again.
		window.getSelection()!.collapse(text, 2);
		expect(writer.rewriteCaret(text.parentElement!)).toBe(false);
		expect(requests).toBe(0);
	});
});

// Miss-analysis: reading mode cleared a caret only after a jump, so an arrow, a cell's re-render
// or a host's call wrote one the writer never refused.
describe('in reading mode the writer writes no caret', () => {
	it('placeCaretAtRaw drops the selection instead and reports the refusal', () => {
		const writer = createCaretWriter(
			() => {},
			() => true,
			() => false
		);
		const el = paragraph('hello');
		window.getSelection()!.collapse(el.firstChild, 1);

		expect(writer.placeCaretAtRaw(el, 3, { clamp: 'exact' })).toBe(false);
		expect(window.getSelection()!.rangeCount).toBe(0);
	});

	it('a range still writes, so select-all and a drag keep working', () => {
		const writer = createCaretWriter(
			() => {},
			() => true,
			() => false
		);
		const el = paragraph('hello');

		expect(writer.selectRawRange(el, 1, 3)).toBe(true);
		expect(window.getSelection()!.toString()).toBe('el');
	});
});
