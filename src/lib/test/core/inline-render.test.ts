// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';

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
