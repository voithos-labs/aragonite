import { describe, it, expect } from 'vitest';
import { sliceFencedCode, mapHljsClass } from '../../code-surface/code-renderer';
import type { CstNode } from '../../core/nodes';

function makeFencedCodeNode(
	raw: string,
	info = '',
	closed = true,
	fenceMarker: '`' | '~' = '`',
	fenceLength = 3
): CstNode {
	return {
		kind: 'fencedCode',
		leadingTrivia: '',
		raw,
		metadata: { fenceMarker, fenceLength, info, closed }
	};
}

describe('sliceFencedCode', () => {
	it('slices a closed fenced block with info string', () => {
		const node = makeFencedCodeNode('```python\nprint("hi")\n```\n', 'python');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```python\n');
		expect(result.body).toBe('print("hi")\n');
		expect(result.closerLine).toBe('```\n');
		expect(result.infoString).toBe('python');
	});

	it('slices a closed fenced block with no info string', () => {
		const node = makeFencedCodeNode('```\nhello\n```\n');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```\n');
		expect(result.body).toBe('hello\n');
		expect(result.closerLine).toBe('```\n');
		expect(result.infoString).toBe('');
	});

	it('handles an unclosed fence (body runs to EOF)', () => {
		const node = makeFencedCodeNode('```js\nconst x = 1\n', 'js', false);
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```js\n');
		expect(result.body).toBe('const x = 1\n');
		expect(result.closerLine).toBe('');
		expect(result.infoString).toBe('js');
	});

	it('handles an empty body', () => {
		const node = makeFencedCodeNode('```\n```\n');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```\n');
		expect(result.body).toBe('');
		expect(result.closerLine).toBe('```\n');
	});

	it('handles tilde fences', () => {
		const node = makeFencedCodeNode('~~~yaml\nkey: value\n~~~\n', 'yaml', true, '~');
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('~~~yaml\n');
		expect(result.body).toBe('key: value\n');
		expect(result.closerLine).toBe('~~~\n');
	});

	it('preserves info string with trailing attributes', () => {
		const node = makeFencedCodeNode('```js {1-3}\nconst x\n```\n', 'js {1-3}');
		const result = sliceFencedCode(node);
		expect(result.infoString).toBe('js {1-3}');
	});

	it('handles a four-backtick fence', () => {
		const node = makeFencedCodeNode('````python\ncode with ``` inside\n````\n', 'python', true, '`', 4);
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('````python\n');
		expect(result.body).toBe('code with ``` inside\n');
		expect(result.closerLine).toBe('````\n');
	});

	it('handles a degenerate opener-only raw', () => {
		const node = makeFencedCodeNode('```\n', '', false);
		const result = sliceFencedCode(node);
		expect(result.openerLine).toBe('```\n');
		expect(result.body).toBe('');
		expect(result.closerLine).toBe('');
	});
});

describe('mapHljsClass', () => {
	it('maps core hljs classes to code-tok classes', () => {
		expect(mapHljsClass('hljs-keyword')).toBe('code-tok-keyword');
		expect(mapHljsClass('hljs-string')).toBe('code-tok-string');
		expect(mapHljsClass('hljs-number')).toBe('code-tok-number');
		expect(mapHljsClass('hljs-comment')).toBe('code-tok-comment');
		expect(mapHljsClass('hljs-type')).toBe('code-tok-type');
		expect(mapHljsClass('hljs-built_in')).toBe('code-tok-function');
		expect(mapHljsClass('hljs-function')).toBe('code-tok-function');
		expect(mapHljsClass('hljs-title')).toBe('code-tok-function');
		expect(mapHljsClass('hljs-variable')).toBe('code-tok-variable');
		expect(mapHljsClass('hljs-operator')).toBe('code-tok-operator');
		expect(mapHljsClass('hljs-punctuation')).toBe('code-tok-punctuation');
		expect(mapHljsClass('hljs-meta')).toBe('code-tok-meta');
		expect(mapHljsClass('hljs-literal')).toBe('code-tok-literal');
		expect(mapHljsClass('hljs-attr')).toBe('code-tok-attr');
	});

	it('maps selector-* classes correctly', () => {
		expect(mapHljsClass('hljs-selector-tag')).toBe('code-tok-type');
		expect(mapHljsClass('hljs-selector-id')).toBe('code-tok-attr');
		expect(mapHljsClass('hljs-selector-class')).toBe('code-tok-attr');
	});

	it('maps diff and markdown-ish classes', () => {
		expect(mapHljsClass('hljs-addition')).toBe('code-tok-added');
		expect(mapHljsClass('hljs-deletion')).toBe('code-tok-removed');
		expect(mapHljsClass('hljs-section')).toBe('code-tok-heading');
	});

	it('returns code-tok-unknown for classes not in the map', () => {
		expect(mapHljsClass('hljs-quasi-arbitrary')).toBe('code-tok-unknown');
		expect(mapHljsClass('hljs-xyz')).toBe('code-tok-unknown');
	});

	it('returns code-tok-unknown for non-hljs class names', () => {
		expect(mapHljsClass('random-class')).toBe('code-tok-unknown');
		expect(mapHljsClass('')).toBe('code-tok-unknown');
	});
});
