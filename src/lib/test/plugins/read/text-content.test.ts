// @vitest-environment node
// `Block.textContent` reads a block as a reader does, with no DOM: the outline's label rules, then
// the block shapes past one line of prose, and `Block.body` with the markers it promises to drop.
// Miss-analysis: the reader's reading lived in the outline package alone, read only on headings,
// so no row held a table, a quote, a code block, a hard break or an escape to one answer.
import { describe, expect, it } from 'vitest';
import { definePlugin, grammar, inline, type Block } from '#lib/plugin.js';
import { makeBlock, DETACHED_READING } from '#lib/schema/doc-view.js';
import { parse } from '#lib';
import { toc } from '#packages/toc/src/index.js';

const read = (text: string, plugins: Parameters<typeof grammar>[0] = []): Block =>
	grammar(plugins).parse(text).blocks[0];

describe('Block.textContent', () => {
	// The outline's seven label rows, read off the heading itself.
	const labels: [string, string, string][] = [
		['drops emphasis markers', '# Plain *Bold* text\n', 'Plain Bold text'],
		['unwraps inline code', '# a `code` span\n', 'a code span'],
		['reduces a link to its text', '# see [text](http://x) here\n', 'see text here'],
		['reduces an image to its alt', '# a ![alt](img.png) pic\n', 'a alt pic'],
		['decodes an entity reference', '# fish &amp; chips\n', 'fish & chips'],
		['shows an autolink as its url', '# go <http://x.com> now\n', 'go http://x.com now'],
		['drops raw HTML tags, keeps their text', '# a <b>bold</b> tag\n', 'a bold tag']
	];
	for (const [name, source, expected] of labels) {
		it(name, () => expect(read(source).textContent).toBe(expected));
	}

	const shapes: [string, string, string][] = [
		['a hard break as a line break', 'a  \nb\\\nc\n', 'a\nb\nc'],
		['an escape as its character', '\\*not emphasis\\*\n', '*not emphasis*'],
		['an autolink as written', '<a@b.co> and www.x.dev\n', 'a@b.co and www.x.dev'],
		['a code block as its body', '```js\nlet x = 1\n```\n', 'let x = 1'],
		[
			'a table, a row per line and a tab between cells',
			'| a | b |\n| - | - |\n| *c* | d |\n',
			'a\tb\nc\td'
		],
		['a quote, a child per line', '> one\n>\n> two *x*\n', 'one\ntwo x'],
		['a list, an item per line', '- one\n- two\n  - three\n', 'one\ntwo\nthree']
	];
	for (const [name, source, expected] of shapes) {
		it(`reads ${name}`, () => expect(read(source).textContent).toBe(expected));
	}

	it("reads a widget as its type's textContent, and its bytes without one", () => {
		const draw = () => ({});
		const shown = inline<string>({
			name: 'shown',
			label: 'Shown',
			prefix: '{{',
			sample: '{{a}}',
			match: /\{\{(\w+)\}\}/,
			read: (match) => match[1],
			widget: { delete: 'whole', arrows: 'over', click: 'none' },
			draw,
			textContent: (data) => data.toUpperCase()
		});
		const plain = inline<string>({
			name: 'plain',
			label: 'Plain',
			prefix: '<<',
			sample: '<<a>>',
			match: /<<(\w+)>>/,
			read: (match) => match[1],
			widget: { delete: 'whole', arrows: 'over', click: 'none' },
			draw
		});
		const plugin = definePlugin({
			name: 'widgets',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ inlines: [shown, plain] })
		});
		expect(read('say {{hi}} and <<yo>>\n', [plugin]).textContent).toBe('say HI and <<yo>>');
	});

	// A drawn block reads as its body, and a line that is all marker has none.
	it("reads the table of contents' `[[toc]]` line as nothing, alone or in a quote", () => {
		expect(read('[[toc]]\n', [toc]).textContent).toBe('');
		expect(read('> [[toc]]\n>\n> after\n', [toc]).textContent).toBe('\nafter');
	});

	it('reads a block parsed outside any editor', () => {
		const node = parse('# a *b* &amp; c\n').children[0];
		expect(makeBlock(node, DETACHED_READING, null).textContent).toBe('a b & c');
	});
});

describe('Block.body', () => {
	const bodies: [string, string, string][] = [
		["a code block's, its fences left out", '```js\nlet x\nlet y\n```\n', 'let x\nlet y'],
		["an empty code block's", '```\n```\n', ''],
		["an unclosed code block's", '```js\nlet x\n', 'let x'],
		["a quote's, its markers left out", '> quoted *a*\n> b\n', 'quoted *a*\nb'],
		["a quote's, a blank line between its children kept", '> a\n>\n> b\n', 'a\n\nb'],
		["a list item's, its marker left out", '- a\n\n  b\n', 'a\n\nb'],
		["a table's, which keeps its bytes", '| a |\n| - |\n| b |\n', '| a |\n| - |\n| b |']
	];
	for (const [name, source, expected] of bodies) {
		it(`is ${name}`, () => {
			const block = read(source);
			expect((source.startsWith('- ') ? block.children[0] : block).body).toBe(expected);
		});
	}
});
