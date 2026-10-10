// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { findNodeAtOffset, renderInlineNodes } from '../../core/inline-render';
import { renderOptions } from '../harness/fixture-grammar';

const render = (raw: string) =>
	renderInlineNodes(parseInline(raw, 0, raw.length), raw, renderOptions());

const markersOf = (frag: DocumentFragment) =>
	[...frag.querySelectorAll('.md-marker, .md-ref-label')].map((el) => el.textContent);

// Inline nesting depth is input-controlled, so a per-level recursion overflows the stack and
// strands the block in the failed-block fallback, which cannot heal.
describe('inline render at input-controlled nesting depth', () => {
	// Marker order is what a hand-rolled work stack gets wrong, and a no-throw assertion
	// would not notice.
	it('emits markers in source order through nested constructs', () => {
		const raw = 'x [**a _b_ c**](u) y';
		const frag = render(raw);

		expect(frag.textContent).toBe(raw);
		expect(markersOf(frag)).toEqual(['[', '**', '_', '_', '**', ']', '(u)']);
	});

	it('resolves an offset past the recursion ceiling', () => {
		const raw = '*'.repeat(32_000) + 'a' + '*'.repeat(32_000);
		const found = findNodeAtOffset(parseInline(raw, 0, raw.length), 32_000);

		expect(found?.node.kind).toBe('text');
		expect(found?.node.text).toBe('a');
	}, 120_000);
});
