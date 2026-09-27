// @vitest-environment jsdom
// Miss-analysis: the renderer counted backticks while the caret and toggle code split the bytes
// around `text`, and every fixture came from the scanner, where the two readings always agree.
import { describe, it, expect } from 'vitest';
import { constructContentRange, parseInline } from '$lib/core/inline';
import { renderInlineNodes } from '$lib/core/inline-render';
import type { InlineNode } from '$lib/core/nodes';
import { codeSpanFence } from '$lib/core/inline/scan/code-spans';
import { renderOptions } from '../../harness/fixture-grammar';

/** The code span as the page draws it: the marker text on each side of the `<code>`. */
function drawnFences(node: InlineNode, raw: string): { open: string; close: string } {
	const div = document.createElement('div');
	div.appendChild(renderInlineNodes([node], raw, renderOptions()));
	const code = div.querySelector('code')!;
	return {
		open: code.previousSibling?.textContent ?? '',
		close: code.nextSibling?.textContent ?? ''
	};
}

/** The same code span as the caret, deletion and the toggles read it. */
function contentFences(node: InlineNode, raw: string): { open: string; close: string } {
	const content = constructContentRange(node);
	if (!content) return { open: '', close: '' };
	return { open: raw.slice(node.start, content.start), close: raw.slice(content.end, node.end) };
}

describe('the page and the edit code read one fence off a code span', () => {
	const scanned = (raw: string): [string, InlineNode, string] => [
		raw,
		parseInline(raw, 0, raw.length)[0],
		raw
	];
	it.each([
		scanned('`a`'),
		scanned('`` a`b ``'),
		scanned('` `'),
		// A plugin's own syntax for a built-in code span, which `text` places.
		['a plugin-made span', { kind: 'inlineCode', start: 0, end: 5, text: 'x' }, '{{x}}'],
		// No `text` to place the content, so the whole node is content.
		['a span with no text', { kind: 'inlineCode', start: 0, end: 3 }, '`x`'],
		[
			'a span whose text leaves an odd split',
			{ kind: 'inlineCode', start: 0, end: 4, text: 'x' },
			'`x``'
		]
	] as [string, InlineNode, string][])('%s', (_label, node, raw) => {
		expect(drawnFences(node, raw)).toEqual(contentFences(node, raw));
	});
});

describe('codeSpanFence', () => {
	it.each([
		['a scanned double fence', parseInline('`` a`b ``', 0, 9)[0], 2],
		['a plugin-made span', { kind: 'inlineCode', start: 0, end: 5, text: 'x' }, 2],
		['a span with no text', { kind: 'inlineCode', start: 0, end: 3 }, 0],
		[
			'a span whose text leaves an odd split',
			{ kind: 'inlineCode', start: 0, end: 4, text: 'x' },
			0
		]
	] as [string, InlineNode, number][])('%s is %i wide', (_label, node, fence) => {
		expect(codeSpanFence(node)).toBe(fence);
	});
});
