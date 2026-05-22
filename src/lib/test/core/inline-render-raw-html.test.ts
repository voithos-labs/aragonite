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
