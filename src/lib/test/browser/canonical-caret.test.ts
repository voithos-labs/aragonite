// @vitest-environment jsdom
// A collapsed caret the browser leaves where the editor never puts one moves to the spot the editor
// writes for that pixel, and every other caret stays where it is.
// Miss-analysis: every caret read was tested at the positions Chromium leaves, and Firefox leaves
// a caret on a hidden run's far side and inside a widget, which no suite ever built.
import { describe, it, expect, afterEach } from 'vitest';
import { createCaretWriter } from '#lib/browser/caret-writer.js';
import { rawSelectionFocus } from '#lib/browser/selection-read.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

/** A block under a presentation mode, built from HTML the way the render draws it. */
function mount(html: string, mode: string | null = 'live'): HTMLElement {
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	block.innerHTML = html;
	root.appendChild(block);
	document.body.appendChild(root);
	block.focus();
	return block;
}

const m = (text: string) => `<span class="md-marker">${text}</span>`;
/** `Some **bold** text`: strong [5,13), `bold` [7,11). */
const BOLD = `Some <strong>${m('**')}bold${m('**')}</strong> text`;
const widget = (start: number, end: number, inner: string) =>
	`<span data-inline-widget="" data-source-start="${start}" data-source-end="${end}" contenteditable="false">${inner}</span>`;

/** The browser's caret, put down without the editor's writer. */
function browserCaret(node: Node, offset: number): void {
	window.getSelection()!.collapse(node, offset);
}

function caret() {
	const sel = window.getSelection()!;
	return { node: sel.focusNode, offset: sel.focusOffset };
}

const textOf = (el: HTMLElement, data: string) =>
	[...el.querySelectorAll('*'), el]
		.flatMap((n) => [...n.childNodes])
		.find((n) => n.nodeType === Node.TEXT_NODE && n.textContent === data) as Text;

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe('a caret the browser left off its spot moves to it', () => {
	it('the far side of a closing run moves to the end of the text before it', () => {
		const el = mount(BOLD);
		const writer = createCaretWriter(
			() => {},
			() => false,
			() => false
		);
		browserCaret(textOf(el, ' text'), 0);
		expect(writer.canonicalizeCaret(el)).toBe(true);
		expect(caret()).toEqual({ node: textOf(el, 'bold'), offset: 4 });
		expect(rawSelectionFocus(el)).toBe(11);
	});

	it('the far side of an opening run moves to the end of the text before it', () => {
		const el = mount(BOLD);
		browserCaret(textOf(el, 'bold'), 0);
		createCaretWriter(
			() => {},
			() => false,
			() => false
		).canonicalizeCaret(el);
		expect(rawSelectionFocus(el)).toBe(5);
	});

	it('a caret inside a widget moves to the widget edge it reads as', () => {
		const el = mount(`Text ${widget(5, 10, '<span>x<sup>2</sup></span>')}`, null);
		browserCaret(textOf(el, '2'), 1);
		createCaretWriter(
			() => {},
			() => false,
			() => false
		).canonicalizeCaret(el);
		expect(caret()).toEqual({ node: el, offset: 2 });
		expect(rawSelectionFocus(el)).toBe(10);
	});

	it('a caret between a CRLF pair moves before it', () => {
		// Set as text: an HTML parse turns the pair into a lone `\n`.
		const el = mount('', null);
		el.textContent = 'ab\r\ncd';
		browserCaret(el.firstChild!, 3);
		createCaretWriter(
			() => {},
			() => false,
			() => false
		).canonicalizeCaret(el);
		expect(caret()).toEqual({ node: el.firstChild, offset: 2 });
	});

	it('a moved caret moves no further', () => {
		const el = mount(BOLD);
		const writer = createCaretWriter(
			() => {},
			() => false,
			() => false
		);
		browserCaret(textOf(el, ' text'), 0);
		writer.canonicalizeCaret(el);
		expect(writer.canonicalizeCaret(el)).toBe(false);
	});
});

describe('every other caret stays', () => {
	it.each([
		['a mode that reveals markers at the caret', BOLD, 'preview-inline', ' text', 0],
		[
			'a run that starts the text',
			`<strong>${m('**')}Lead${m('**')}</strong> in`,
			'live',
			'Lead',
			0
		],
		['a run after a line break', `a\n<strong>${m('**')}b${m('**')}</strong>`, 'live', 'b', 0],
		['a caret in plain text', BOLD, 'live', ' text', 2]
	])('%s', (_, html, mode, data, offset) => {
		const el = mount(html, mode);
		const at = textOf(el, data);
		browserCaret(at, offset);
		expect(
			createCaretWriter(
				() => {},
				() => false,
				() => false
			).canonicalizeCaret(el)
		).toBe(false);
		expect(caret()).toEqual({ node: at, offset });
	});

	it('a range keeps its far-side end', () => {
		const el = mount(BOLD);
		window.getSelection()!.setBaseAndExtent(textOf(el, 'Some '), 5, textOf(el, ' text'), 0);
		expect(
			createCaretWriter(
				() => {},
				() => false,
				() => false
			).canonicalizeCaret(el)
		).toBe(false);
		expect(rawSelectionFocus(el)).toBe(13);
	});

	it('the far side the editor wrote stays, until the browser moves the caret there', () => {
		const el = mount(BOLD);
		const writer = createCaretWriter(
			() => {},
			() => false,
			() => false
		);
		writer.placeCaretAtRaw(el, 13, { clamp: 'exact' });
		expect(writer.canonicalizeCaret(el)).toBe(false);
		expect(rawSelectionFocus(el)).toBe(13);

		browserCaret(textOf(el, ' text'), 1);
		writer.canonicalizeCaret(el);
		browserCaret(textOf(el, ' text'), 0);
		expect(writer.canonicalizeCaret(el)).toBe(true);
		expect(rawSelectionFocus(el)).toBe(11);
	});
});

describe('the check on every key', () => {
	afterEach(disablePerfInstruments);

	it('climbs only from the caret to its block, with no walk, for a caret in plain text', () => {
		const el = mount(BOLD);
		browserCaret(textOf(el, ' text'), 2);
		enablePerfInstruments();
		resetPerfInstruments();
		createCaretWriter(
			() => {},
			() => false,
			() => false
		).canonicalizeCaret(el);
		expect(perfSnapshot().caretCanonicalSteps).toBe(1);
		expect(perfSnapshot().caretCanonicalWalks).toBe(0);
	});
});
