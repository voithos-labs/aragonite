// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
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

describe('renderInlineNodes — entityReference', () => {
	it('renders entityReference with source bytes as text content', () => {
		const raw = '&copy;';
		const node: InlineNode = { kind: 'entityReference', start: 0, end: 6, decoded: '©' };
		const frag = renderInlineNodes([node], raw);
		const div = document.createElement('div');
		div.appendChild(frag);
		expect(div.textContent).toBe('&copy;');
		const span = div.querySelector('.md-entity');
		expect(span?.textContent).toBe('&copy;');
	});

	it('entity inside parsed paragraph: full-document textContent equals raw', () => {
		const raw = 'a &copy; b';
		const nodes = parseInline(raw, 0, raw.length);
		const frag = renderInlineNodes(nodes, raw);
		expect(frag.textContent).toBe(raw);
	});
});
