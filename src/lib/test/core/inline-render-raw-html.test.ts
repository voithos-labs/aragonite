// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import type { InlineNode } from '../../core/nodes';

describe('renderInlineNodes — rawHtml (literal-default)', () => {
	it('renders open tag as md-raw-html span with source bytes', () => {
		const raw = '<span class="hl">';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		const span = frag.querySelector('span.md-raw-html');
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe('<span class="hl">');
	});

	it('renders close tag as md-raw-html span', () => {
		const raw = '</span>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		const span = frag.querySelector('span.md-raw-html');
		expect(span?.textContent).toBe('</span>');
	});

	it('renders comment as md-raw-html span', () => {
		const raw = '<!-- hi -->';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		const span = frag.querySelector('span.md-raw-html');
		expect(span?.textContent).toBe('<!-- hi -->');
	});

	it('full paragraph: textContent equals raw for literal-rendered HTML', () => {
		const raw = 'before <span>inner</span> after';
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw);
		expect(frag.textContent).toBe(raw);
	});
});

describe('renderInlineNodes — rawHtml (live <br> widget)', () => {
	it('<br> renders as live atomic widget, NOT md-raw-html span', () => {
		const raw = '<br>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('span.md-raw-html')).toBeNull();
		const widget = frag.querySelector('[data-inline-widget]');
		expect(widget).not.toBeNull();
		expect(widget?.querySelector('br')).not.toBeNull();
	});

	it('<br> widget carries data-source-start and data-source-end', () => {
		const raw = 'x<br>y';
		const node: InlineNode = { kind: 'rawHtml', start: 1, end: 5 };
		const frag = renderInlineNodes([node], raw);
		const widget = frag.querySelector('[data-inline-widget]') as HTMLElement;
		expect(widget.getAttribute('data-source-start')).toBe('1');
		expect(widget.getAttribute('data-source-end')).toBe('5');
	});

	it('<br> widget is contenteditable=false', () => {
		const raw = '<br>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		const widget = frag.querySelector('[data-inline-widget]') as HTMLElement;
		expect(widget.getAttribute('contenteditable')).toBe('false');
	});

	it('<BR> case-insensitive match', () => {
		const raw = '<BR>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('[data-inline-widget]')).not.toBeNull();
	});

	it('<br/> self-closing match', () => {
		const raw = '<br/>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('[data-inline-widget]')).not.toBeNull();
	});

	it('<br /> self-closing with space', () => {
		const raw = '<br />';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('[data-inline-widget]')).not.toBeNull();
	});

	it('</br> close form also matches the allowlist', () => {
		const raw = '</br>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('[data-inline-widget]')).not.toBeNull();
	});

	it('non-allowlist tags stay literal: <span> renders as md-raw-html', () => {
		const raw = '<span>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('span.md-raw-html')).not.toBeNull();
		expect(frag.querySelector('[data-inline-widget]')).toBeNull();
	});

	it('non-allowlist <sub> renders as md-raw-html (until plugin extends)', () => {
		const raw = '<sub>';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('span.md-raw-html')).not.toBeNull();
	});

	it('comments are never live (no tag name → predicate false)', () => {
		const raw = '<!--br-->';
		const node: InlineNode = { kind: 'rawHtml', start: 0, end: raw.length };
		const frag = renderInlineNodes([node], raw);
		expect(frag.querySelector('span.md-raw-html')).not.toBeNull();
	});
});
