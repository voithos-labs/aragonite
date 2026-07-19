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

	it('preserves textContent invariant — single blank-line body', () => {
		const node = makeFencedCodeNode('```\n\n```\n');
		const frag = renderCodeBlock(node);
		expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
	});
});

// Each fence line is wrapped so reading/preview modes can collapse the whole line
// (marker + its `\n`) with `display: none`; the wrappers must keep every raw byte
// in document order, so textContent stays equal to trimTrailingLineEnding(raw).
describe('renderCodeBlock — fence-line wrappers', () => {
	beforeEach(() => {
		__resetRegistryForTests();
		__resetBootForTests();
		bootstrapCodeLanguages();
	});

	function fenceLines(frag: DocumentFragment): HTMLElement[] {
		return Array.from(frag.querySelectorAll('.md-fence-line'));
	}

	it('wraps opener and closer, opener owns its trailing `\\n`', () => {
		const node = makeFencedCodeNode('```javascript\nconst x = 42;\n```\n', 'javascript');
		const lines = fenceLines(renderCodeBlock(node));

		expect(lines.length).toBe(2);
		const [opener] = lines;
		expect(opener.textContent).toBe('```javascript\n');
		expect(opener.querySelector('.md-fence')?.textContent).toBe('```');
		expect(opener.querySelector('.md-lang')?.textContent).toBe('javascript');
		expect(opener.lastChild?.nodeType).toBe(Node.TEXT_NODE);
		expect(opener.lastChild?.textContent).toBe('\n');
	});

	it('closer wrapper owns the line break that precedes it (bottom blank collapses)', () => {
		const node = makeFencedCodeNode('```\nhello\n```\n');
		const lines = fenceLines(renderCodeBlock(node));
		const closer = lines[1];

		// Leading `\n` re-homed off the body's last line, then the fence marker.
		expect(closer.firstChild?.nodeType).toBe(Node.TEXT_NODE);
		expect(closer.firstChild?.textContent).toBe('\n');
		expect(closer.textContent).toBe('\n```');
	});

	it('empty-body closer carries no leading `\\n` (opener `\\n` is the only separator)', () => {
		const node = makeFencedCodeNode('```\n```\n');
		const lines = fenceLines(renderCodeBlock(node));

		expect(lines.length).toBe(2);
		expect(lines[1].textContent).toBe('```');
		expect(lines[1].firstChild?.nodeType).toBe(Node.ELEMENT_NODE);
	});

	it('an unclosed fence wraps only the opener line', () => {
		const node = makeFencedCodeNode('```js\nconst x = 1\n', 'js', false);
		const lines = fenceLines(renderCodeBlock(node));

		expect(lines.length).toBe(1);
		expect(lines[0].textContent).toBe('```js\n');
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
