// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { computeInlineContent } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';

// The atomic-island wrapper the render layer's portal builder stamps around a
// component widget, with interior text that is NOT the source bytes — modelling
// KaTeX's rendered glyphs. Mounting the real MathInline component (Svelte + KaTeX)
// is reserved for the e2e; the walk under test keys only on the four attributes and
// the presence of nonzero non-source interior, all of which this reproduces.
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

// Nonzero-interior byte-survival audit (G1.9). Inline math is the first widget whose
// rendered interior text is NOT its source bytes — every prior widget had zero interior
// textContent — so this is the first input class where a read-back trusting
// `.textContent` over the widget-aware walk leaks glyphs and drops the source.

const BLOCK_RAW = 'a $x^2$ b';
const SOURCE = '$x^2$';

function resetInlineState(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

beforeEach(() => {
	resetInlineState();
	registerMathInline();
});

afterEach(() => {
	resetInlineState();
	document.body.innerHTML = '';
});

// Mount the block as the render path builds it: outer text, the rendered math widget
// (the stamped atomic island with glyph-like interior), outer text.
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
	it('KaTeX renders interior text that is NOT the source bytes — the leak the walk dodges', () => {
		const { el, widget } = mountRenderedBlock();
		// The premise of the audit: this widget carries real interior text.
		expect((widget.textContent ?? '').length).toBeGreaterThan(0);
		// A naive `.textContent` read (the leaking path) reconstructs neither the block
		// raw nor even the `$…$` bytes — the glyphs replace the source.
		expect(el.textContent).not.toBe(BLOCK_RAW);
		expect(el.textContent).not.toContain(SOURCE);
	});

	it('the widget-aware walk reconstructs the exact source bytes', () => {
		const { el } = mountRenderedBlock();
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
	});

	// The walk reads text nodes verbatim and the widget via `data-source-*` against
	// the render-time raw, so an edit to the surrounding text nodes is captured
	// while the widget bytes stay exact — this is the "type/delete around it" case.
	it('typing after the widget survives read-back with the source intact', () => {
		const { el } = mountRenderedBlock();
		(el.lastChild as Text).data += '!';
		const readback = rawTextOfNode(el, BLOCK_RAW);
		expect(readback).toBe('a $x^2$ b!');
		// The read-back is what a commit serializes — round-trips byte-for-byte.
		expect(serialize(parse(readback))).toBe(readback);
	});

	it('deleting before the widget survives read-back with the source intact', () => {
		const { el } = mountRenderedBlock();
		(el.firstChild as Text).data = 'a';
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe('a$x^2$ b');
	});

	it('serialize round-trips the block raw — no glyph reaches the serialized output', () => {
		expect(serialize(parse(BLOCK_RAW))).toBe(BLOCK_RAW);
	});
});
