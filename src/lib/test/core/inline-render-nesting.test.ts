// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { findNodeAtOffset, renderInlineNodes } from '../../core/inline-render';

const render = (raw: string) => renderInlineNodes(parseInline(raw, 0, raw.length), raw);

const markersOf = (frag: DocumentFragment) =>
	[...frag.querySelectorAll('.md-marker, .md-ref-label')].map((el) => el.textContent);

// Emphasis and links render as marker / content / marker triples around a nested
// child render, and inline nesting depth is input-controlled: `*`-run pairs nest one
// level per pair, so a 64 KB paragraph reaches five figures of depth. A per-level
// recursion is a stack overflow there — and the RangeError takes the whole block to
// the failed-block fallback, which cannot heal, since its error boundary resets on a
// `raw` change the block is no longer editable enough to receive. The sibling scan
// (`scanChildren`, autolinks.ts) was de-recursed for the same reason.
describe('inline render at input-controlled nesting depth', () => {
	// The marker order is what a hand-rolled work stack gets wrong, and a
	// no-throw assertion would not notice: pin the source order of every marker
	// alongside the header's textContent-equals-raw contract.
	it('emits markers in source order through nested constructs', () => {
		const raw = 'x [**a _b_ c**](u) y';
		const frag = render(raw);

		expect(frag.textContent).toBe(raw);
		expect(markersOf(frag)).toEqual(['[', '**', '_', '_', '**', ']', '(u)']);
	});

	// 16 KB nests ~4000 deep, well past the recursion ceiling and still affordable:
	// jsdom's own insert bookkeeping is superlinear in tree depth (a native DOM is
	// not), so the environment, not the renderer, is what caps the size here.
	it('renders past the recursion ceiling with full byte coverage', () => {
		const raw = '*'.repeat(8_000) + 'a' + '*'.repeat(8_000);
		expect(render(raw).textContent).toBe(raw);
	}, 60_000);

	it('resolves an offset past the recursion ceiling', () => {
		const raw = '*'.repeat(32_000) + 'a' + '*'.repeat(32_000);
		const found = findNodeAtOffset(parseInline(raw, 0, raw.length), 32_000);

		expect(found?.node.kind).toBe('text');
		expect(found?.node.text).toBe('a');
	}, 120_000);
});
