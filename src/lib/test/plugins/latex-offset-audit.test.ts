// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { computeInlineContent } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import {
	buildCoreInlineWidget,
	__resetInlineWidgetsForTests
} from '$lib/core/inline/inline-widgets';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerMathInline, MATH_INLINE } from '../../../routes/test/plugins/latex/latex-kind';

// Nonzero-interior byte-survival audit (A11 / G1.9). Inline math is the FIRST live
// widget that renders real interior text nodes: KaTeX emits glyph text (`x`, `2`, …)
// whose bytes are NOT the `$…$` source. Every prior widget (image, `<br>`) had zero
// interior textContent, so a read-back path that trusted `.textContent` instead of
// the widget-aware walk (`data-source-*`) was never exercised on this input class.
// This pins the walk against that path: the walk reconstructs the source bytes; a
// naive `.textContent` read would leak the rendered glyphs and drop `$x^2$`.

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
// (real KaTeX via the registered descriptor), outer text.
function mountRenderedBlock(): { el: HTMLElement; widget: HTMLElement } {
	const math = computeInlineContent(parse(BLOCK_RAW).children[0]).find(
		(n) => n.kind === MATH_INLINE
	) as InlineNode;
	const widget = buildCoreInlineWidget(math, BLOCK_RAW) as HTMLElement;
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
