// A content write closes an opener it leaves open only when the write typed the opener and the bytes
// below don't close it already; an opener the write merely exposed reads on as a reload reads it.
// Miss-analysis (GH #768): the auto-close rows typed fresh openers only, so none retyped a broken
// opener whose old closer still stood below.
// Miss-analysis (#800): every fresh row typed a fence, so none typed an opener that backs out.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { registerDetailsKind } from '#lib/plugins/details/details-kind.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import { registerMermaidKind } from '#lib/plugins/mermaid/mermaid-kind.js';
import { testView } from '#lib/test/harness/test-view.js';
import { typingOver } from '#lib/test/harness/typing.js';

beforeEach(() => {
	registerMathBlock(testView());
	registerMermaidKind(testView());
});

describe('closing a fence a write leaves open', () => {
	// Each fence kind, and the `$$` block, loses its opener's first marker byte and gets it back.
	const RESTORES: Array<[kind: string, raw: string]> = [
		['fencedCode', '```js\ncode\n```\n'],
		['fencedCode', '~~~js\ncode\n~~~\n'],
		['mathFence', '```math\nx\n```\n'],
		['mermaid', '```mermaid\nA\n```\n'],
		['mathBlock', '$$\nx\n$$\n']
	];
	for (const [kind, raw] of RESTORES) {
		it(`restores ${kind} (${raw.slice(0, 3)}) when its opener's backspaced marker is typed back`, () => {
			const source = `para\n\n${raw}\nafter\n`;
			const opened = raw.slice(0, raw.lastIndexOf('\n', raw.length - 2) + 1);
			const { doc, type } = typingOver(source);

			expect(type(1, raw.slice(1))).toBe(`para\n\n${raw.slice(1)}\nafter\n`);
			expect(type(1, opened)).toBe(source);
			expect(doc.children[1].kind).toBe(kind);
		});
	}

	// A fence typed on its own line gets its own closer, whatever fences sit further down.
	// Miss-analysis: no fresh-fence row had a second fence further down.
	const FRESH: Array<[name: string, source: string, written: string, expected: string]> = [
		['above other blocks', 'para\n\nafter\n', '```\n', '```\n```\n\nafter\n'],
		['above a bare-fenced block', 'para\n\n```\nx\n```\n', '```\n', '```\n```\n\n```\nx\n```\n'],
		[
			'above a bare-fenced block, another fence further down',
			'para\n\n```\nx\n```\n\n```py\ny\n```\n',
			'```\n',
			'```\n```\n\n```\nx\n```\n\n```py\ny\n```\n'
		],
		[
			'above a code block with a language',
			'para\n\n```js\ncode\n```\n',
			'```\n',
			'```\n```\n\n```js\ncode\n```\n'
		],
		[
			'above a fence flush beneath it, as a loaded file can have',
			'``\n```\nx\n```\n\n```py\ny\n```\n',
			'```\n',
			'```\n```\n```\nx\n```\n\n```py\ny\n```\n'
		],
		[
			'onto a paragraph of two lines, a fence below',
			'a\nb\n\n```\nx\n```\n\n```py\ny\n```\n',
			'```a\nb\n',
			'```a\nb\n```\n\n```\nx\n```\n\n```py\ny\n```\n'
		]
	];
	for (const [name, source, written, expected] of FRESH) {
		it(`closes a fence typed ${name}`, () => {
			const { type } = typingOver(source);

			expect(type(0, written)).toBe(expected);
		});
	}

	it('restores a broken opener whose document ends in an open fence, which stays open', () => {
		const source = 'para\n\n```js\ncode\n```\n\ntext\n\n```\nopen tail\n';
		const { type } = typingOver(source);

		type(1, '``js\ncode\n```\n');
		expect(type(1, '```js\ncode\n')).toBe(source);
	});

	// The accepted edge: with no body under the retyped opener it reads as a fresh fence, so it
	// gets a closer of its own and the stranded closer reads on; one undo takes the backtick back.
	it('gives a retyped opener with an empty body a closer of its own', () => {
		const { type } = typingOver('para\n\n```js\n```\n\nafter\n');

		type(1, '``js\n```\n');
		expect(type(1, '```js\n')).toBe('para\n\n```js\n```\n```\n\nafter\n');
	});
});

// An opener that backs out when unclosed (`$$`) gets its reading's closer once a line
// below would close it; with nothing below to close it, it stays text.
describe('closing an opener that backs out', () => {
	beforeEach(() => {
		installPlugins([admonitionsPlugin()]);
		registerDetailsKind(testView());
	});

	it('closes `$$` above a math block', () => {
		const { type } = typingOver('para\n\n$$\nx\n$$\n');

		expect(type(0, '$$\n')).toBe('$$\n$$\n\n$$\nx\n$$\n');
	});

	// A directive's first line holds no caret, so it reads down as a reload does, closer and all.
	it('leaves `:::note` above a directive block unclosed, reading the block below in', () => {
		const { doc, type } = typingOver('para\n\n:::tip\nbody\n:::\n');

		expect(type(0, ':::note\n')).toBe(':::note\n\n:::tip\nbody\n:::\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['admonition']);
	});

	// Leaving it text is what a reload of those bytes reads, so nothing has to close it.
	it.each([
		['`$$` above paragraphs', 'para\n\nnext\n', '$$\n', '$$\n\nnext\n'],
		[
			'`<details>` above a details block, which a blank line ends anyway',
			'para\n\n<details>\n<summary>s</summary>\n\nx\n\n</details>\n',
			'<details>\n',
			'<details>\n\n<details>\n<summary>s</summary>\n\nx\n\n</details>\n'
		]
	])('leaves %s as written', (_name, source, written, expected) => {
		const { type } = typingOver(source);

		expect(type(0, written)).toBe(expected);
	});
});
