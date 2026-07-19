// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { rawTextOfNode } from '../../cursor/widget-offset';
import type { InlineNode } from '../../core/nodes';

describe('renderInlineNodes — hardLineBreak (textContent equals raw)', () => {
	const cases: { name: string; raw: string }[] = [
		{ name: 'LF backslash break', raw: 'a\\\nb' },
		{ name: 'CRLF backslash break', raw: 'a\\\r\nb' },
		{ name: 'LF two-space break', raw: 'a  \nb' },
		{ name: 'CRLF two-space break', raw: 'a  \r\nb' }
	];

	for (const { name, raw } of cases) {
		it(`${name}: hardLineBreak fragment textContent equals raw slice`, () => {
			const nodes = parseInline(raw, 0, raw.length);
			const breakNode = nodes.find((n) => n.kind === 'hardLineBreak');
			expect(breakNode, `expected hardLineBreak in: ${JSON.stringify(raw)}`).toBeDefined();
			const fragRaw = raw.slice(breakNode!.start, breakNode!.end);
			const frag = renderInlineNodes([breakNode!], raw);
			expect(frag.textContent).toBe(fragRaw);
		});

		it(`${name}: full-document fragment textContent equals raw`, () => {
			const nodes = parseInline(raw, 0, raw.length);
			const frag = renderInlineNodes(nodes, raw);
			expect(frag.textContent).toBe(raw);
		});
	}
});

describe('renderInlineNodes — escape', () => {
	it('renders escape as marker span + text node, textContent equals raw', () => {
		const raw = '\\*';
		const node: InlineNode = { kind: 'escape', start: 0, end: 2 };
		const frag = renderInlineNodes([node], raw);
		const div = document.createElement('div');
		div.appendChild(frag);
		expect(div.textContent).toBe('\\*');
		const marker = div.querySelector('.md-marker');
		expect(marker?.textContent).toBe('\\');
	});

	it('escape inside parsed paragraph: full-document textContent equals raw', () => {
		const raw = '\\*foo\\*';
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw);
		expect(frag.textContent).toBe(raw);
	});
});

describe('renderInlineNodes — entityReference widget (visible glyph)', () => {
	it('renders a visible entity as an atomic widget of its decoded glyph', () => {
		const raw = '&copy;';
		const node: InlineNode = { kind: 'entityReference', start: 0, end: 6, decoded: '©' };
		const frag = renderInlineNodes([node], raw);
		const div = document.createElement('div');
		div.appendChild(frag);
		// The DOM shows the glyph; there is no literal-source span.
		const widget = div.querySelector<HTMLElement>('[data-inline-widget]');
		expect(widget?.textContent).toBe('©');
		expect(widget?.getAttribute('contenteditable')).toBe('false');
		expect(div.querySelector('.md-entity')).toBeNull();
	});

	it("carries the source bytes on data-source-* so the raw walk reads back '&copy;'", () => {
		const raw = 'a &copy; b';
		const nodes = parseInline(raw, 0, raw.length);
		const container = document.createElement('div');
		container.appendChild(renderInlineNodes(nodes, raw));
		const widget = container.querySelector<HTMLElement>('[data-inline-widget]')!;
		expect(widget.dataset.sourceStart).toBe('2');
		expect(widget.dataset.sourceEnd).toBe('8');
		// The glyph contributes 0 to the raw walk; its bytes ride the attrs, so the
		// walk-summed raw tiles the source exactly (G2.4/G2.5-style partition).
		expect(rawTextOfNode(container, raw)).toBe(raw);
		expect(container.textContent).toBe('a © b');
	});
});

describe('renderInlineNodes — entityReference literal span (invisible glyph)', () => {
	// A whitespace/control/zero-width decoding keeps its literal-source span: an
	// invisible atomic island would be a caret trap. `&nbsp;` (U+00A0) sits here —
	// its glyph is an invisible column, indistinguishable from a plain space.
	it.each([
		{ name: 'nbsp (whitespace)', raw: '&nbsp;', decoded: ' ' },
		{ name: 'zero-width space (format)', raw: '&#8203;', decoded: '​' },
		{ name: 'newline (control)', raw: '&#10;', decoded: '\n' }
	])('renders $name as a literal .md-entity span', ({ raw, decoded }) => {
		const node: InlineNode = { kind: 'entityReference', start: 0, end: raw.length, decoded };
		const div = document.createElement('div');
		div.appendChild(renderInlineNodes([node], raw));
		expect(div.querySelector('[data-inline-widget]')).toBeNull();
		const span = div.querySelector('.md-entity');
		expect(span?.textContent).toBe(raw);
		expect(div.textContent).toBe(raw);
	});
});

describe('inline-render — unresolvedReference', () => {
	it('renders <span class="md-unresolved-ref"> with raw source slice', () => {
		const node: InlineNode = {
			kind: 'unresolvedReference',
			start: 0,
			end: 15,
			label: 'missing',
			refKind: 'link'
		};
		const raw = '[text][missing]';
		const frag = renderInlineNodes([node], raw);
		const span = frag.querySelector('span.md-unresolved-ref');
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe('[text][missing]');
	});

	it('image variant gets a different class indicator for inspection', () => {
		const node: InlineNode = {
			kind: 'unresolvedReference',
			start: 0,
			end: 15,
			label: 'missing',
			refKind: 'image'
		};
		const raw = '![alt][missing]';
		const frag = renderInlineNodes([node], raw);
		const span = frag.querySelector('span.md-unresolved-ref');
		expect(span?.classList.contains('md-unresolved-ref-image')).toBe(true);
	});
});

describe('inline-render — reference label marker class', () => {
	it('reference link emits md-ref-label class on trailing label marker', () => {
		const raw = '[text][label]';
		const resolver = (l: string) => (l === 'label' ? { url: 'https://example.com' } : undefined);
		const inline = parseInline(raw, 0, raw.length, resolver);
		const frag = renderInlineNodes(inline, raw);
		const labelMarker = frag.querySelector('.md-ref-label');
		expect(labelMarker).not.toBeNull();
		expect(labelMarker?.textContent).toBe('[label]');
	});

	it('inline link (non-reference) does NOT emit md-ref-label', () => {
		const raw = '[text](https://example.com)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		expect(frag.querySelectorAll('.md-ref-label').length).toBe(0);
	});

	it('collapsed reference link emits md-ref-label on []', () => {
		const raw = '[text][]';
		const resolver = (l: string) => (l === 'text' ? { url: 'https://example.com' } : undefined);
		const inline = parseInline(raw, 0, raw.length, resolver);
		const frag = renderInlineNodes(inline, raw);
		const labelMarker = frag.querySelector('.md-ref-label');
		expect(labelMarker).not.toBeNull();
		expect(labelMarker?.textContent).toBe('[]');
	});
});

describe('inline-render — href + autolink anchor', () => {
	it('link node renders <a href={url}>', () => {
		const raw = '[text](https://example.com)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		const a = frag.querySelector('a');
		expect(a).not.toBeNull();
		expect(a?.getAttribute('href')).toBe('https://example.com');
	});

	it('link with title sets title attribute', () => {
		const raw = '[text](https://example.com "the title")';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		const a = frag.querySelector('a');
		expect(a?.getAttribute('title')).toBe('the title');
	});

	it('autolink renders as <a class="md-autolink" href={url}>', () => {
		const raw = 'see https://example.com here';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		const a = frag.querySelector('a.md-autolink');
		expect(a).not.toBeNull();
		expect(a?.getAttribute('href')).toBe('https://example.com');
		expect(a?.textContent).toBe('https://example.com');
	});

	it('email autolink renders <a> with mailto: href', () => {
		const raw = 'email foo@bar.com today';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		const a = frag.querySelector('a.md-autolink');
		expect(a?.getAttribute('href')).toBe('mailto:foo@bar.com');
		expect(a?.textContent).toBe('foo@bar.com');
	});

	it('www autolink renders an absolute http href with the text kept verbatim', () => {
		// GFM §6.9: the scheme is inserted for the href only, so activation navigates
		// absolutely instead of resolving the bare host against the current page.
		const raw = 'visit www.example.com now';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		const a = frag.querySelector('a.md-autolink');
		expect(a?.getAttribute('href')).toBe('http://www.example.com');
		expect(a?.textContent).toBe('www.example.com');
	});

	it('blocked-scheme link renders an inert span, not an anchor', () => {
		const raw = '[x](javascript:alert(1))';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		expect(frag.querySelector('a')).toBeNull();
		const span = frag.querySelector('span.md-link-blocked');
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe('x');
	});

	it('blocked data: href is inert', () => {
		const raw = '[x](data:text/html,<script>)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw);
		expect(frag.querySelector('a')).toBeNull();
		expect(frag.querySelector('span.md-link-blocked')).not.toBeNull();
	});

	it('resolveLinkUrl rewrites the href before rendering', () => {
		const raw = '[x](/note)';
		const inline = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(inline, raw, { resolveLinkUrl: (u) => `https://host${u}` });
		expect(frag.querySelector('a')?.getAttribute('href')).toBe('https://host/note');
	});
});
