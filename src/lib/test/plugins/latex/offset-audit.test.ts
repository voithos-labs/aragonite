// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse, serialize, type InlineNode } from '$lib';
import { computeInlineContent } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';

// The render layer's wrapper span around a component widget, with glyph-like text in place of
// KaTeX's; the traversal reads only its attributes, so the real component is left to the e2e.
function stampMathWidget(node: InlineNode): HTMLElement {
	const wrapper = document.createElement('span');
	wrapper.dataset.inlineWidget = '';
	wrapper.dataset.sourceStart = String(node.start);
	wrapper.dataset.sourceEnd = String(node.end);
	wrapper.setAttribute('contenteditable', 'false');
	for (const glyph of ['x', '2']) {
		const g = document.createElement('span');
		g.textContent = glyph;
		wrapper.appendChild(g);
	}
	return wrapper;
}

// Inline math's rendered text is not its source bytes, so reading back `.textContent` instead
// of the widget-aware traversal would leak glyphs and drop the source.

const BLOCK_RAW = 'a $x^2$ b';
const SOURCE = '$x^2$';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathInline();
});

afterEach(() => {
	resetPluginPlatformForTests();
	document.body.innerHTML = '';
});

// Mount the block the way the render path builds it: outer text, the rendered math widget
// with its glyph-like interior, outer text.
function mountRenderedBlock(): { el: HTMLElement; widget: HTMLElement } {
	const math = computeInlineContent(parse(BLOCK_RAW).children[0]).find(
		(n) => n.kind === MATH_INLINE
	) as InlineNode;
	const widget = stampMathWidget(math);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(document.createTextNode('a '), widget, document.createTextNode(' b'));
	document.body.appendChild(el);
	return { el, widget };
}

describe('inline-math widget: nonzero-interior byte survival', () => {
	it('KaTeX renders interior text that is not the source bytes: the leak the walk dodges', () => {
		const { el, widget } = mountRenderedBlock();
		// The premise of the audit: this widget carries real interior text.
		expect((widget.textContent ?? '').length).toBeGreaterThan(0);
		// A plain `.textContent` read reconstructs neither the block raw nor even the
		// `$…$` bytes: the glyphs replace the source.
		expect(el.textContent).not.toBe(BLOCK_RAW);
		expect(el.textContent).not.toContain(SOURCE);
	});

	it('the widget-aware walk reconstructs the exact source bytes', () => {
		const { el } = mountRenderedBlock();
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
	});

	// The traversal reads text nodes verbatim and the widget through `data-source-*`, so an edit
	// around the widget is captured while the widget's own bytes stay exact.
	it('typing after the widget survives read-back with the source intact', () => {
		const { el } = mountRenderedBlock();
		(el.lastChild as Text).data += '!';
		const readback = rawTextOfNode(el, BLOCK_RAW);
		expect(readback).toBe('a $x^2$ b!');
		// The read-back is what a commit serializes, and it round-trips byte for byte.
		expect(serialize(parse(readback))).toBe(readback);
	});

	it('deleting before the widget survives read-back with the source intact', () => {
		const { el } = mountRenderedBlock();
		(el.firstChild as Text).data = 'a';
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe('a$x^2$ b');
	});

	it('serialize round-trips the block raw: no glyph reaches the serialized output', () => {
		expect(serialize(parse(BLOCK_RAW))).toBe(BLOCK_RAW);
	});
});
