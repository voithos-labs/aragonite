// @vitest-environment jsdom
// Miss-analysis: the reading-mode marker sweep enumerated the arms that already emit `md-marker`,
// so the autolink arm — which emitted none — was never a row anything could assert on.
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { renderOptions } from '../harness/fixture-grammar';

function renderedInto(raw: string, tagConstructMarkers = false): HTMLDivElement {
	const div = document.createElement('div');
	div.appendChild(
		renderInlineNodes(parseInline(raw, 0, raw.length), raw, renderOptions({ tagConstructMarkers }))
	);
	return div;
}

const markerTexts = (div: HTMLDivElement): (string | null)[] =>
	[...div.querySelectorAll('.md-marker')].map((span) => span.textContent);

describe('renderInlineNodes: angle autolink brackets', () => {
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

describe('renderInlineNodes: bare autolink forms carry no brackets', () => {
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

describe('renderInlineNodes: an address as a link text', () => {
	it.each(['[foo@bar.com](u)', '[https://x.co](u)', '[www.x.co](u)'])(
		'%s renders one anchor whose text is the address',
		(raw) => {
			const div = renderedInto(raw);
			const anchors = div.querySelectorAll('a');
			expect(anchors).toHaveLength(1);
			expect(anchors[0].getAttribute('href')).toBe('u');
			expect(anchors[0].textContent).toContain(raw.slice(1, raw.indexOf(']')));
			expect(div.textContent).toBe(raw);
		}
	);
});

// An open bracket keeps a www or url address as text, as cmark-gfm reads it; an email still links.
describe('renderInlineNodes: an address after an unclosed bracket', () => {
	it.each(['[a www.x.co', '[a https://x.co'])('%s renders no anchor', (raw) => {
		const div = renderedInto(raw);
		expect(div.querySelector('a, .md-autolink')).toBeNull();
		expect(div.textContent).toBe(raw);
	});

	it('an email there still renders its mailto anchor', () => {
		const div = renderedInto('[a foo@bar.com');
		expect(div.querySelector('a.md-autolink')?.getAttribute('href')).toBe('mailto:foo@bar.com');
	});
});
