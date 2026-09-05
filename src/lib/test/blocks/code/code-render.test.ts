// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderCodeBlock } from '$lib/components/blocks/code/code-renderer';
import {
	bootstrapCodeLanguages,
	__resetBootForTests
} from '$lib/components/blocks/code/code-bootstrap';
import { __resetRegistryForTests } from '$lib/components/blocks/code/code-languages';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';
import { fencedCode } from './fenced-code-fixture';

// Language registry is register-once; reset + re-bootstrap before every test so a
// leaked registration can't let one describe's grammar bleed into the next.
beforeEach(() => {
	__resetRegistryForTests();
	__resetBootForTests();
	bootstrapCodeLanguages();
});

describe('renderCodeBlock', () => {
	it('renders opener marker + tokenized body + closer marker', () => {
		const node = fencedCode('```javascript\nconst x = 42;\n```\n', 'javascript');
		const frag = renderCodeBlock(node);

		const markers = frag.querySelectorAll('.md-marker');
		expect(markers.length).toBeGreaterThan(0);

		const keyword = frag.querySelector('.code-tok-keyword');
		expect(keyword).not.toBeNull();
		expect(keyword?.textContent).toBe('const');
	});

	it('renders info string with .md-lang class', () => {
		const node = fencedCode('```python\nprint()\n```\n', 'python');
		const frag = renderCodeBlock(node);

		const langSpan = frag.querySelector('.md-lang');
		expect(langSpan).not.toBeNull();
		expect(langSpan?.textContent).toBe('python');
	});

	const shapes: Array<[string, CstNode]> = [
		[
			'closed fence with highlighting',
			fencedCode('```javascript\nconst x = 42;\n```\n', 'javascript')
		],
		['closed fence without info string', fencedCode('```\nhello\nworld\n```\n')],
		['unclosed fence', fencedCode('```js\nconst x = 1\n', 'js', { closed: false })],
		['empty body', fencedCode('```\n```\n')],
		['tilde fences', fencedCode('~~~yaml\nkey: value\n~~~\n', 'yaml', { fenceMarker: '~' })],
		['unknown language', fencedCode('```klingon\nkapla\n```\n', 'klingon')],
		['fresh unclosed fence (opener only)', fencedCode('```\n', '', { closed: false })],
		['single blank-line body', fencedCode('```\n\n```\n')]
	];

	for (const [name, node] of shapes) {
		it(`preserves textContent invariant — ${name}`, () => {
			expect(renderCodeBlock(node).textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}
});

// Each fence line is wrapped so reading/preview modes can collapse the whole line with
// `display: none`; the wrappers must keep every raw byte in document order.
describe('renderCodeBlock — fence-line wrappers', () => {
	function fenceLines(frag: DocumentFragment): HTMLElement[] {
		return Array.from(frag.querySelectorAll('.md-fence-line'));
	}

	it('wraps opener and closer, opener owns its trailing `\\n`', () => {
		const node = fencedCode('```javascript\nconst x = 42;\n```\n', 'javascript');
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
		const node = fencedCode('```\nhello\n```\n');
		const lines = fenceLines(renderCodeBlock(node));
		const closer = lines[1];

		// Leading `\n` re-homed off the body's last line, then the fence marker.
		expect(closer.firstChild?.nodeType).toBe(Node.TEXT_NODE);
		expect(closer.firstChild?.textContent).toBe('\n');
		expect(closer.textContent).toBe('\n```');
	});

	it('empty-body closer carries no leading `\\n` (opener `\\n` is the only separator)', () => {
		const node = fencedCode('```\n```\n');
		const lines = fenceLines(renderCodeBlock(node));

		expect(lines.length).toBe(2);
		expect(lines[1].textContent).toBe('```');
		expect(lines[1].firstChild?.nodeType).toBe(Node.ELEMENT_NODE);
	});

	it('an unclosed fence wraps only the opener line', () => {
		const node = fencedCode('```js\nconst x = 1\n', 'js', { closed: false });
		const lines = fenceLines(renderCodeBlock(node));

		expect(lines.length).toBe(1);
		expect(lines[0].textContent).toBe('```js\n');
	});
});

describe('renderCodeBlock — indented opener fence (parser accepts 0–3 spaces)', () => {
	// CodeBlock reads the block back through el.textContent and commits it, so indent bytes
	// rendered out of order corrupt the fence on the first keystroke (indent 0 is the control).
	for (const marker of ['`', '~'] as const) {
		const fence = marker.repeat(3);
		for (let indent = 0; indent <= 3; indent++) {
			const pad = ' '.repeat(indent);
			it(`preserves textContent — ${indent}-space ${marker} opener`, () => {
				const raw = `${pad}${fence}js\ncode\n${fence}\n`;
				const node = fencedCode(raw, 'js', { fenceMarker: marker });
				const frag = renderCodeBlock(node);
				expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
			});
		}
	}

	it('round-trips indented-opener bytes through the textContent readback (CodeBlock readText)', () => {
		const raw = '  ```js\nconst x = 1\n```\n';
		const node = fencedCode(raw, 'js');
		const host = document.createElement('div');
		host.appendChild(renderCodeBlock(node));
		// CodeBlock.readText() is el.textContent; commitInput writes readText() + '\n'.
		expect(host.textContent + '\n').toBe(raw);
	});
});

// CodeBlock reads its rendered textContent back as raw on commit (CodeBlock.readText), so a
// stray or dropped trailing `\r` is a CRLF round-trip corruption; interiors are pinned below.
describe('renderCodeBlock — CRLF trailing line ending', () => {
	const shapes: Array<[string, CstNode]> = [
		['closed no-info', fencedCode('```\r\nhello\r\nworld\r\n```\r\n')],
		['no-body', fencedCode('```\r\n```\r\n')],
		['unclosed', fencedCode('```\r\ncode\r\n', '', { closed: false })],
		['fresh unclosed (opener only)', fencedCode('```\r\n', '', { closed: false })],
		['tilde', fencedCode('~~~\r\nkey: value\r\n~~~\r\n', '', { fenceMarker: '~' })],
		['indented opener', fencedCode('  ```\r\ncode\r\n```\r\n')]
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
			const node = fencedCode('```\n' + '\n'.repeat(blanks) + '```\n');
			expect(renderCodeBlock(node).textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}
});

// A closer with no final line ending hits trimTrailingLineEnding's no-op branch in
// trimSliceTail; textContent must still equal the raw verbatim or the closer dies on readback.
describe('renderCodeBlock — closer without a final line ending', () => {
	for (const [name, raw] of [
		['LF', '```\ncode\n```'],
		['CRLF', '```\r\ncode\r\n```']
	] as const) {
		it(`preserves textContent — ${name}`, () => {
			const node = fencedCode(raw);
			const frag = renderCodeBlock(node);
			expect(frag.textContent).toBe(raw);
			expect(frag.textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}
});

// tokenizeBody highlights an LF copy (template.innerHTML would drop every interior `\r`) and
// restores each line's own ending positionally, reaching `\n` INSIDE token spans too.
describe('renderCodeBlock — CRLF interior in the language path', () => {
	const shapes: Array<[string, CstNode]> = [
		['multi-line tagged body', fencedCode('```js\r\nlet a = 1\r\nlet b = 2\r\n```\r\n', 'js')],
		[
			'token spanning lines (template string)',
			fencedCode('```js\r\nconst s = `a\r\nb\r\nc`\r\n```\r\n', 'js')
		],
		[
			'token spanning lines (block comment)',
			fencedCode('```js\r\n/* a\r\nb\r\nc */\r\nlet x = 1\r\n```\r\n', 'js')
		],
		['mixed \\r\\n and \\n lines', fencedCode('```js\r\nlet a = 1\nlet b = 2\r\n```\r\n', 'js')],
		[
			'unclosed tagged body',
			fencedCode('```js\r\nlet a = 1\r\nlet b = 2\r\n', 'js', { closed: false })
		],
		['fresh unclosed tagged (opener only)', fencedCode('```js\r\n', 'js', { closed: false })]
	];

	for (const [name, node] of shapes) {
		it(`preserves textContent — ${name}`, () => {
			expect(renderCodeBlock(node).textContent).toBe(trimTrailingLineEnding(node.raw));
		});
	}

	it('restores the interior `\\r` while highlighting still resolves tokens', () => {
		const node = fencedCode('```js\r\nlet a = 1\r\nlet b = 2\r\n```\r\n', 'js');
		const frag = renderCodeBlock(node);
		expect(frag.querySelector('.code-tok-keyword')?.textContent).toBe('let');
		expect(frag.textContent).toContain('let a = 1\r\nlet b = 2');
	});

	it('a token span still wraps the whole multi-line literal after restore', () => {
		const node = fencedCode('```js\r\nconst s = `a\r\nb`\r\n```\r\n', 'js');
		const frag = renderCodeBlock(node);
		expect(frag.querySelector('.code-tok-string')?.textContent).toBe('`a\r\nb`');
	});
});
