// @vitest-environment jsdom
// Miss-analysis: the reading-mode marker sweep enumerated the arms that already emit `md-marker`,
// so the autolink arm — which emitted none — was never a row anything could assert on.
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';

function renderedInto(raw: string, tagConstructMarkers = false): HTMLDivElement {
	const div = document.createElement('div');
	div.appendChild(renderInlineNodes(parseInline(raw, 0, raw.length), raw, { tagConstructMarkers }));
	return div;
}

const markerTexts = (div: HTMLDivElement): (string | null)[] =>
	[...div.querySelectorAll('.md-marker')].map((span) => span.textContent);

describe('renderInlineNodes — angle autolink brackets', () => {
	it('renders `<` and `>` as marker spans flanking the anchor', () => {
		const div = renderedInto('Visit <https://example.com> now');
		expect(markerTexts(div)).toEqual(['<', '>']);
		expect(div.querySelector('a.md-autolink')?.textContent).toBe('https://example.com');
	});

	it('keeps the brackets in the DOM: textContent still equals raw', () => {
		const raw = 'Visit <https://example.com> now';
		expect(renderedInto(raw).textContent).toBe(raw);
	});

	it('angle email form gets the same brackets and keeps its synthesized mailto: href', () => {
		const div = renderedInto('Mail <support@example.com> now');
		expect(markerTexts(div)).toEqual(['<', '>']);
		const anchor = div.querySelector('a.md-autolink');
		expect(anchor?.getAttribute('href')).toBe('mailto:support@example.com');
		expect(anchor?.textContent).toBe('support@example.com');
	});

	it('blocked-scheme angle autolink stays an inert span and still sheds its brackets', () => {
		const div = renderedInto('<javascript:alert(1)>');
		expect(div.querySelector('a')).toBeNull();
		const inert = div.querySelector('span.md-autolink.md-link-blocked');
		expect(inert?.textContent).toBe('javascript:alert(1)');
		expect(markerTexts(div)).toEqual(['<', '>']);
		expect(div.textContent).toBe('<javascript:alert(1)>');
	});

	// Unstamped ⟺ not revealable: preview-inline reveals unstamped markers on block focus,
	// so a stamp here without a revealable policy row would hide the brackets for good.
	it('stays unstamped even when the render tags construct markers', () => {
		const div = renderedInto('Visit <https://example.com> now', true);
		expect(markerTexts(div)).toEqual(['<', '>']);
		expect(div.querySelectorAll('[data-construct-start], [data-construct-end]')).toHaveLength(0);
	});
});

describe('renderInlineNodes — bare autolink forms carry no brackets', () => {
	// The over-fix guard: `node.url` is synthesized for these, so a url-driven detection would
	// invent markers the source never had.
	it.each([
		{ form: 'bare url', raw: 'Visit https://example.com now', linked: 'https://example.com' },
		{ form: 'bare www', raw: 'Visit www.example.com now', linked: 'www.example.com' },
		{ form: 'bare email', raw: 'Mail foo@bar.com now', linked: 'foo@bar.com' }
	])('$form emits no marker span', ({ raw, linked }) => {
		const div = renderedInto(raw);
		expect(markerTexts(div)).toEqual([]);
		expect(div.querySelector('a.md-autolink')?.textContent).toBe(linked);
		expect(div.textContent).toBe(raw);
	});
});
