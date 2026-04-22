// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderCodeBlock } from '../../../components/blocks/code/code-renderer';
import {
	bootstrapCodeLanguages,
	__resetBootForTests
} from '../../../components/blocks/code/code-bootstrap';
import { __resetRegistryForTests } from '../../../components/blocks/code/code-languages';
import { trimTrailingLineEnding } from '../../../core/lines';
import type { CstNode } from '../../../core/nodes';

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

describe('renderCodeBlock', () => {
	beforeEach(() => {
		__resetRegistryForTests();
		__resetBootForTests();
		bootstrapCodeLanguages();
	});

	it('renders opener marker + tokenized body + closer marker', () => {
		const node = makeFencedCodeNode('```javascript\nconst x = 42;\n```\n', 'javascript');
		const frag = renderCodeBlock(node);

		const markers = frag.querySelectorAll('.md-marker');
		expect(markers.length).toBeGreaterThan(0);

		const keyword = frag.querySelector('.code-tok-keyword');
		expect(keyword).not.toBeNull();
		expect(keyword?.textContent).toBe('const');
	});

	it('renders info string with .md-lang class', () => {
		const node = makeFencedCodeNode('```python\nprint()\n```\n', 'python');
		const frag = renderCodeBlock(node);

		const langSpan = frag.querySelector('.md-lang');
		expect(langSpan).not.toBeNull();
		expect(langSpan?.textContent).toBe('python');
	});

	it('preserves textContent invariant — closed fence with highlighting', () => {
		const node = makeFencedCodeNode('```javascript\nconst x = 42;\n```\n', 'javascript');
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});

	it('preserves textContent invariant — closed fence without info string', () => {
		const node = makeFencedCodeNode('```\nhello\nworld\n```\n');
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});

	it('preserves textContent invariant — unclosed fence', () => {
		const node = makeFencedCodeNode('```js\nconst x = 1\n', 'js', false);
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});

	it('preserves textContent invariant — empty body', () => {
		const node = makeFencedCodeNode('```\n```\n');
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});

	it('preserves textContent invariant — tilde fences', () => {
		const node = makeFencedCodeNode('~~~yaml\nkey: value\n~~~\n', 'yaml', true, '~');
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});

	it('preserves textContent invariant — unknown language', () => {
		const node = makeFencedCodeNode('```klingon\nkapla\n```\n', 'klingon');
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});

	it('preserves textContent invariant — fresh unclosed fence (opener only + trailing \\n)', () => {
		const node = makeFencedCodeNode('```\n', '', false);
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});
});
