// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { entityRendersGlyph, buildEntityWidget } from '../../../core/inline/entity-widget';

// The visibility gate: a decoded entity renders as an atomic widget only when its
// glyph is visible. Whitespace / control / zero-width decodings stay literal spans,
// because an invisible atomic island is a caret trap. `&nbsp;` (U+00A0) is on the
// literal side by the same logic that puts a plain space there — its glyph is an
// invisible column, indistinguishable from a space.
describe('entityRendersGlyph — the visibility gate', () => {
	it.each([
		{ name: 'named symbol (©)', decoded: '©' },
		{ name: 'ampersand (&amp;)', decoded: '&' },
		{ name: 'numeric letter (&#65; → A)', decoded: 'A' },
		{ name: 'multi-codepoint ligature (fj)', decoded: 'fj' },
		{ name: 'replacement char (invalid ref → �)', decoded: '�' }
	])('renders a glyph for $name', ({ decoded }) => {
		expect(entityRendersGlyph(decoded)).toBe(true);
	});

	it.each([
		{ name: 'non-breaking space (&nbsp; → U+00A0)', decoded: ' ' },
		{ name: 'plain space (&#32;)', decoded: ' ' },
		{ name: 'newline (&NewLine; → U+000A)', decoded: '\n' },
		{ name: 'tab (&Tab; → U+0009)', decoded: '\t' },
		{ name: 'zero-width space (&ZeroWidthSpace;)', decoded: '​' },
		{ name: 'word joiner (&#x2060;)', decoded: '⁠' },
		{ name: 'lone combining acute (&#x301;) — zero-advance mark', decoded: '́' }
	])('renders no glyph for $name', ({ decoded }) => {
		expect(entityRendersGlyph(decoded)).toBe(false);
	});

	it('renders no glyph for an absent decoded value', () => {
		expect(entityRendersGlyph(undefined)).toBe(false);
	});
});

describe('buildEntityWidget — atomic-island shell', () => {
	it('stamps the generic widget marker, source span, and the glyph', () => {
		const node: InlineNode = { kind: 'entityReference', start: 3, end: 9, decoded: '©' };
		const el = buildEntityWidget(node);
		expect(el.hasAttribute('data-inline-widget')).toBe(true);
		expect(el.getAttribute('contenteditable')).toBe('false');
		expect(el.dataset.sourceStart).toBe('3');
		expect(el.dataset.sourceEnd).toBe('9');
		expect(el.textContent).toBe('©');
	});
});
