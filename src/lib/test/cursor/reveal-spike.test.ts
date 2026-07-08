// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSourceReveal } from '../../cursor/reveal-source';
import { findRawOffsetTarget, rawOffsetAtNode, rawTextOfNode } from '../../cursor/widget-offset';

// Fixture: a paragraph "a $x^2$ b" whose $…$ math renders as one atomic widget.
//   raw:  a _ $ x ^ 2 $ _ b   (index 0..8, length 9)
//   text before "a " = [0,2); widget "$x^2$" = [2,7); text after " b" = [7,9)
const BLOCK_RAW = 'a $x^2$ b';
const SRC_START = 2;
const SRC_END = 7;

// Rendered widget stub. Inner textContent is one char — deliberately a different
// length from the 5-byte source range, so a walker that read textContent instead
// of data-source-* would diverge (mirrors widget-offset.test.ts's rationale).
function renderedWidget(): HTMLElement {
	const w = document.createElement('span');
	w.setAttribute('data-inline-widget', '');
	w.setAttribute('contenteditable', 'false');
	w.setAttribute('data-source-start', String(SRC_START));
	w.setAttribute('data-source-end', String(SRC_END));
	const inner = document.createElement('span');
	inner.textContent = 'X';
	w.appendChild(inner);
	return w;
}

function mountBlock(): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(document.createTextNode('a '), renderedWidget(), document.createTextNode(' b'));
	document.body.appendChild(el);
	el.focus();
	return el;
}

function depsFor(el: HTMLElement) {
	return {
		get container() {
			return el;
		},
		get sourceStart() {
			return SRC_START;
		},
		get sourceEnd() {
			return SRC_END;
		},
		get source() {
			return BLOCK_RAW.slice(SRC_START, SRC_END);
		},
		renderWidget: renderedWidget
	};
}

/** Raw offset of the live collapsed caret, via the one offset-translation home. */
function caretRaw(el: HTMLElement): number {
	const range = window.getSelection()!.getRangeAt(0);
	return rawOffsetAtNode(el, range.startContainer, range.startOffset);
}

describe('source-reveal spike — caret-landing model (A1)', () => {
	let el: HTMLElement;

	beforeEach(() => {
		el = mountBlock();
		window.getSelection()?.removeAllRanges();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('an opaque widget cannot address an interior source offset — it snaps to an edge', () => {
		// The justification for reveal: with the widget rendered, a request for an
		// interior source position (start+2) resolves to the trailing EDGE, never
		// the interior glyph. An atomic widget yields only raw SRC_START or SRC_END.
		const pos = findRawOffsetTarget(el, SRC_START + 2);
		expect(pos).not.toBeNull();
		expect(rawOffsetAtNode(el, pos!.node, pos!.offset)).toBe(SRC_END);
	});

	it('reveal(offset) swaps to editable source and lands the caret at the requested interior offset', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.reveal(2);

		expect(reveal.isRevealed()).toBe(true);
		// Opaque widget gone; its source bytes are now real, addressable text.
		expect(el.querySelector('[data-inline-widget]')).toBeNull();
		expect(el.textContent).toContain('$x^2$');
		// The interior offset the rendered widget could not reach (contrast above).
		expect(caretRaw(el)).toBe(SRC_START + 2);
	});

	it('reveal() defaults to the widget leading edge (node.start)', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.reveal();
		expect(caretRaw(el)).toBe(SRC_START);
	});

	it('reveal(source.length) lands the caret at the widget trailing edge (node.end)', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.reveal(SRC_END - SRC_START);
		expect(caretRaw(el)).toBe(SRC_END);
	});

	it('reveal clamps an out-of-range offset to the nearest edge', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.reveal(999);
		expect(caretRaw(el)).toBe(SRC_END);
		reveal.reveal(-5);
		expect(caretRaw(el)).toBe(SRC_START);
	});

	it('reveal while already revealed re-places the caret without a second swap', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.reveal(1);
		expect(caretRaw(el)).toBe(SRC_START + 1);
		reveal.reveal(3);
		expect(reveal.isRevealed()).toBe(true);
		expect(caretRaw(el)).toBe(SRC_START + 3);
		// Still exactly one source region, not two nested swaps.
		expect(el.querySelector('[data-inline-widget]')).toBeNull();
		expect(el.textContent).toBe('a $x^2$ b');
	});

	it('commit() re-renders the opaque widget and lands the caret at the trailing edge (node.end)', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.reveal(2);
		reveal.commit();

		expect(reveal.isRevealed()).toBe(false);
		const widget = el.querySelector('[data-inline-widget]');
		expect(widget).not.toBeNull();
		expect(widget!.getAttribute('data-source-start')).toBe(String(SRC_START));
		expect(widget!.getAttribute('data-source-end')).toBe(String(SRC_END));
		expect(caretRaw(el)).toBe(SRC_END);
	});

	it('commit() is a no-op when not revealed', () => {
		const reveal = createSourceReveal(depsFor(el));
		reveal.commit();
		expect(reveal.isRevealed()).toBe(false);
		expect(el.querySelector('[data-inline-widget]')).not.toBeNull();
	});

	it('reveal→commit with no edit preserves the block raw byte-for-byte (A11 round-trip)', () => {
		const reveal = createSourceReveal(depsFor(el));
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
		reveal.reveal(2);
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
		reveal.commit();
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
	});
});
