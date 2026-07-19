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

describe('renderCodeBlock — indented opener fence (parser accepts 0–3 spaces)', () => {
	beforeEach(() => {
		__resetRegistryForTests();
		__resetBootForTests();
		bootstrapCodeLanguages();
	});

	// The fence-open grammar admits 0–3 leading spaces before the run. Those
	// indent bytes must render ahead of the fence marker so textContent stays
	// equal to trimTrailingLineEnding(raw): CodeBlock reads the block back through
	// el.textContent and commits it, so any drift corrupts the fence on the first
	// keystroke (indent 0 is the control that passes regardless).
	for (const marker of ['`', '~'] as const) {
		const fence = marker.repeat(3);
		for (let indent = 0; indent <= 3; indent++) {
			const pad = ' '.repeat(indent);
			it(`preserves textContent — ${indent}-space ${marker} opener`, () => {
				const raw = `${pad}${fence}js\ncode\n${fence}\n`;
				const node = makeFencedCodeNode(raw, 'js', true, marker, 3);
				const frag = renderCodeBlock(node);
				expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
			});
		}
	}

	it('round-trips indented-opener bytes through the textContent readback (CodeBlock readText)', () => {
		const raw = '  ```js\nconst x = 1\n```\n';
		const node = makeFencedCodeNode(raw, 'js');
		const host = document.createElement('div');
		host.appendChild(renderCodeBlock(node));
		// CodeBlock.readText() is el.textContent; commitInput writes readText() + '\n'.
		expect(host.textContent + '\n').toBe(raw);
	});
});
