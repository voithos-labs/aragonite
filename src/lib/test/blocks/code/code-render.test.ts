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

// Language registry is register-once; reset + re-bootstrap before every test so a
// leaked registration can't let one describe's grammar bleed into the next.
beforeEach(() => {
	__resetRegistryForTests();
	__resetBootForTests();
	bootstrapCodeLanguages();
});

describe('renderCodeBlock', () => {
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

// A CRLF-authored fence must keep textContent === trimTrailingLineEnding(raw): the
// block reads its rendered textContent back as raw on commit (CodeBlock.readText),
// so a stray trailing `\r` — or a dropped one — is a CRLF round-trip corruption.
// No-grammar shapes isolate the trailing-line-ending strip; the language path's
// interior-`\r` normalization is a separate ledgered defect, pinned below.
describe('renderCodeBlock — CRLF trailing line ending', () => {
	const shapes: Array<[string, CstNode]> = [
		['closed no-info', makeFencedCodeNode('```\r\nhello\r\nworld\r\n```\r\n')],
		['no-body', makeFencedCodeNode('```\r\n```\r\n')],
		['unclosed', makeFencedCodeNode('```\r\ncode\r\n', '', false)],
		['fresh unclosed (opener only)', makeFencedCodeNode('```\r\n', '', false)],
		['tilde', makeFencedCodeNode('~~~\r\nkey: value\r\n~~~\r\n', '', true, '~')],
		['indented opener', makeFencedCodeNode('  ```\r\ncode\r\n```\r\n')]
	];

	for (const [name, node] of shapes) {
		it(`preserves textContent — ${name}`, () => {
			expect(renderCodeBlock(node).textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}
});

// Keeping an all-blank body's separator (so it renders N blank lines, not N−1) must
// not disturb byte parity: textContent stays trimTrailingLineEnding(raw) in every mode.
describe('renderCodeBlock — all-blank body byte parity', () => {
	for (const blanks of [1, 2, 3]) {
		it(`preserves textContent — ${blanks} blank line(s)`, () => {
			const node = makeFencedCodeNode('```\n' + '\n'.repeat(blanks) + '```\n');
			expect(renderCodeBlock(node).textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}
});

// A closer with no final line ending (the block ends `…\n```` with nothing after)
// hits the trimTrailingLineEnding no-op branch in trimSliceTail — the tail carries
// no ending to strip. textContent must still equal the raw verbatim (LF and CRLF) so
// the closer survives CodeBlock's textContent readback on commit.
describe('renderCodeBlock — closer without a final line ending', () => {
	for (const [name, raw] of [
		['LF', '```\ncode\n```'],
		['CRLF', '```\r\ncode\r\n```']
	] as const) {
		it(`preserves textContent — ${name}`, () => {
			const node = makeFencedCodeNode(raw);
			const frag = renderCodeBlock(node);
			expect(frag.textContent).toBe(raw);
			expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}
});

// The language-highlight path keeps textContent === trimTrailingLineEnding(raw) for
// CRLF bodies too: tokenizeBody highlights an LF copy (the HTML parser behind
// template.innerHTML would otherwise drop every interior `\r`) and restores each
// line's original ending positionally. The restore reaches `\n` INSIDE token spans
// (multi-line strings, block comments), not just between tokens, and mixed `\r\n`/`\n`
// lines each keep their own ending. CodeBlock reads this textContent back as raw on
// commit, so a dropped interior `\r` is a CRLF round-trip corruption.
describe('renderCodeBlock — CRLF interior in the language path', () => {
	const shapes: Array<[string, CstNode]> = [
		[
			'multi-line tagged body',
			makeFencedCodeNode('```js\r\nlet a = 1\r\nlet b = 2\r\n```\r\n', 'js')
		],
		[
			'token spanning lines (template string)',
			makeFencedCodeNode('```js\r\nconst s = `a\r\nb\r\nc`\r\n```\r\n', 'js')
		],
		[
			'token spanning lines (block comment)',
			makeFencedCodeNode('```js\r\n/* a\r\nb\r\nc */\r\nlet x = 1\r\n```\r\n', 'js')
		],
		[
			'mixed \\r\\n and \\n lines',
			makeFencedCodeNode('```js\r\nlet a = 1\nlet b = 2\r\n```\r\n', 'js')
		],
		[
			'unclosed tagged body',
			makeFencedCodeNode('```js\r\nlet a = 1\r\nlet b = 2\r\n', 'js', false)
		],
		['fresh unclosed tagged (opener only)', makeFencedCodeNode('```js\r\n', 'js', false)]
	];

	for (const [name, node] of shapes) {
		it(`preserves textContent — ${name}`, () => {
			expect(renderCodeBlock(node).textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}

	it('restores the interior `\\r` while highlighting still resolves tokens', () => {
		const node = makeFencedCodeNode('```js\r\nlet a = 1\r\nlet b = 2\r\n```\r\n', 'js');
		const frag = renderCodeBlock(node);
		expect(frag.querySelector('.code-tok-keyword')?.textContent).toBe('let');
		expect(frag.textContent).toContain('let a = 1\r\nlet b = 2');
	});

	it('a token span still wraps the whole multi-line literal after restore', () => {
		const node = makeFencedCodeNode('```js\r\nconst s = `a\r\nb`\r\n```\r\n', 'js');
		const frag = renderCodeBlock(node);
		expect(frag.querySelector('.code-tok-string')?.textContent).toBe('`a\r\nb`');
	});
});
