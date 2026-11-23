// @vitest-environment node
// Text read and written by an editor running latex, row for row as 0.11.5 read and wrote it: the
// table is 0.11.5's output, the unclosed ```math fence aside, ruled to read as the maker reads it.
// Miss-analysis: the package's reads were pinned per helper, so no row held the reading whole
// through a plugin value's grammar when the helpers moved into the editor.
import { describe, expect, it } from 'vitest';
import { grammar, type Block, type Piece } from '#lib/plugin.js';
import { makingOf } from '#lib/schema/block-type.js';
import { installPluginList } from '#lib/schema/plugin-unit.js';
import { latex } from '#packages/latex/src/index.js';

type Shape = (string | number | Shape)[];

/** A block as `[type, bytes, ...pieces]`, or `[type, children]` for one holding blocks; a piece is
 *  `[kind, from, to, children?]` in the block's bytes, text pieces left out. */
const READS: [source: string, blocks: Shape[]][] = [
	['$x^2$', [['paragraph', '$x^2$', ['latex/math', 0, 5]]]],
	['let $a+b$ be', [['paragraph', 'let $a+b$ be', ['latex/math', 4, 9]]]],
	['one part in $10^5$', [['paragraph', 'one part in $10^5$', ['latex/math', 12, 18]]]],
	['$5 and $10', [['paragraph', '$5 and $10']]],
	['$ x $', [['paragraph', '$ x $']]],
	['$HOME and $PATH', [['paragraph', '$HOME and $PATH']]],
	['costs $9', [['paragraph', 'costs $9']]],
	['between $10-$20', [['paragraph', 'between $10-$20']]],
	['$5$', [['paragraph', '$5$']]],
	['$$', [['paragraph', '$$']]],
	['a $$ b', [['paragraph', 'a $$ b']]],
	['$a$b$c$', [['paragraph', '$a$b$c$', ['latex/math', 0, 3], ['latex/math', 4, 7]]]],
	['*$x$*', [['paragraph', '*$x$*', ['emphasis', 0, 5, [['latex/math', 1, 4]]]]]],
	['$x\ny$', [['paragraph', '$x\ny$', ['latex/math', 0, 5]]]],
	['$a $b$', [['paragraph', '$a $b$', ['latex/math', 3, 6]]]],
	['$x$1', [['paragraph', '$x$1']]],
	['tab\t$x$', [['paragraph', 'tab\t$x$', ['latex/math', 4, 7]]]],
	['nb $x $', [['paragraph', 'nb $x $']]],
	['`$x$`', [['paragraph', '`$x$`', ['inlineCode', 0, 5]]]],
	['$1.50$ and $x$', [['paragraph', '$1.50$ and $x$', ['latex/math', 11, 14]]]],
	['$$\nx\n$$\n', [['latex/block', '$$\nx\n$$\n']]],
	['$$x^2$$\n', [['latex/block', '$$x^2$$\n']]],
	['$$\nx\n', [['paragraph', '$$\nx\n']]],
	['$$\n', [['paragraph', '$$\n']]],
	['```math\nx\n```\n', [['latex/block', '```math\nx\n```\n']]],
	['```math\nx\n', [['latex/block', '```math\nx\n']]],
	['~~~math\nx\n~~~\n', [['latex/block', '~~~math\nx\n~~~\n']]],
	[
		'para\n$$\nx\n$$\n',
		[
			['paragraph', 'para\n'],
			['latex/block', '$$\nx\n$$\n']
		]
	],
	[
		'para\n$$x$$\n',
		[
			['paragraph', 'para\n'],
			['latex/block', '$$x$$\n']
		]
	],
	[
		'$$ x\ny\n$$\n',
		[
			['paragraph', '$$ x\ny\n'],
			['paragraph', '$$\n']
		]
	],
	[
		'$$\na\n$$\n$$\nb\n$$\n',
		[
			['latex/block', '$$\na\n$$\n'],
			['latex/block', '$$\nb\n$$\n']
		]
	],
	['````math\n```\n````\n', [['latex/block', '````math\n```\n````\n']]],
	[
		'  $$\nx\n$$\n',
		[
			['paragraph', '  $$\nx\n'],
			['paragraph', '$$\n']
		]
	],
	['> $$\n> x\n> $$\n', [['blockquote', [['latex/block', '$$\nx\n$$\n']]]]],
	['- $$\n  x\n  $$\n', [['list', [['listItem', [['latex/block', '$$\nx\n$$\n']]]]]]],
	['$$\nx\n$$ trailing\n', [['paragraph', '$$\nx\n$$ trailing\n']]],
	['$$\r\nx\r\n$$\r\n', [['latex/block', '$$\r\nx\r\n$$\r\n']]],
	['$$\n\n$$\n', [['latex/block', '$$\n\n$$\n']]],
	['$$$$\n', [['latex/block', '$$$$\n']]],
	['$$x$$ y\n', [['paragraph', '$$x$$ y\n', ['latex/math', 1, 4]]]],
	['$$\nx\n$$', [['latex/block', '$$\nx\n$$']]],
	['``` math\nx\n```\n', [['latex/block', '``` math\nx\n```\n']]],
	['```mathematica\nx\n```\n', [['fencedCode', '```mathematica\nx\n```\n']]],
	[
		'para\n```math\nx\n```\n',
		[
			['paragraph', 'para\n'],
			['latex/block', '```math\nx\n```\n']
		]
	],
	['$$\nx\n\ny\n$$\n', [['latex/block', '$$\nx\n\ny\n$$\n']]],
	// A first word of `math` claims the fence, and so does an opener indented up to three spaces.
	['```math extra\nx\n```\n', [['latex/block', '```math extra\nx\n```\n']]],
	['   ```math\nx\n```\n', [['latex/block', '   ```math\nx\n```\n']]]
];

/** A write over a block's bytes: what it held, what was written, how, and what the write leaves
 *  with the caret that started at the written text's end. */
const WRITES: [
	held: string,
	written: string,
	mode: 'authored' | 'literal',
	raw: string,
	caret: number
][] = [
	['$$\nx\n$$\n', '$$\nx\n', 'authored', '$$\nx\n$$\n', 5],
	['$$\nx\n$$\n', '$$\nx\n', 'literal', '$$\nx\n$$\n', 5],
	['$$\nx\n$$\n', '$$\nx\ny\n$$\n', 'authored', '$$\nx\ny\n$$\n', 10],
	['$$\nx\n$$\n', '$$\nx\ny\n$$\n', 'literal', '$$\nx\ny\n$$\n', 10],
	['$$\nx\n$$\n', '$$\nx\n$$\n$$\n', 'authored', '$$\nx\n$$\n$$\n', 11],
	['$$\nx\n$$\n', '$$\nx\n$$\n$$\n', 'literal', '$$\nx\n$$\n$$\n', 11],
	['$$x$$\n', '$$x\ny$$\n', 'authored', '$$\nx\ny\n$$\n', 10],
	['$$x$$\n', '$$x\ny$$\n', 'literal', '$$x$$\ny$$\n', 10],
	['$$x$$\n', '$$x\n', 'authored', '$$x$$\n', 4],
	['$$x$$\n', '$$x\n', 'literal', '$$x$$\n', 4],
	['$$\nx\n$$\n', '$$\n', 'authored', '$$\n$$\n', 3],
	['$$\nx\n$$\n', '$$\n', 'literal', '$$\n$$\n', 3],
	['$$\nx\n$$\n', 'x\n$$\n', 'authored', 'x\n$$\n', 5],
	['$$\nx\n$$\n', 'x\n$$\n', 'literal', 'x\n$$\n', 5],
	['$$\nx\n$$', '$$\nx', 'authored', '$$\nx\n$$', 4],
	['$$\nx\n$$', '$$\nx', 'literal', '$$\nx\n$$', 4],
	['$$\r\nx\r\n$$\r\n', '$$\r\nx\r\n', 'authored', '$$\r\nx\r\n$$\r\n', 7],
	['$$\r\nx\r\n$$\r\n', '$$\r\nx\r\n', 'literal', '$$\r\nx\r\n$$\r\n', 7],
	['$$\nx\n$$\n', '$$\nx\n$$ y\n', 'authored', '$$\nx\n$$ y\n$$\n', 10],
	['$$\nx\n$$\n', '$$\nx\n$$ y\n', 'literal', '$$\nx\n$$ y\n$$\n', 10],
	['$$\nx\n$$\n', '$$ a\nb\n', 'authored', '$$\n a\nb\n$$\n', 8],
	['$$\nx\n$$\n', '$$ a\nb\n', 'literal', '$$ a$$\nb\n', 9]
];

/** A write past the block's own element (a range delete, a paste, a replace): the fence's closing
 *  line comes back, grown past a body line that reads as it, on the run the written opener has. */
const CUT_WRITES: [held: string, written: string, raw: string][] = [
	['```math\nx^2\n```\n', '````math\nAfter\n', '````math\nAfter\n````\n'],
	['   ```math\nx^2\n```\n', '   ```math\nAfter\n', '   ```math\nAfter\n   ```\n'],
	['```math\nx^2\n```\n', '```math\ny\n```\n', '```math\ny\n```\n'],
	['```math\nx^2\n```\n', 'x^2\n```\n', 'x^2\n```\n'],
	['```math\nx^2\n```\n', '```math\n```\nx^2\n```\n', '````math\n```\nx^2\n````\n'],
	['$$\r\nx^2\r\n$$', '$$\r\nx^', '$$\r\nx^\r\n$$'],
	['```math\r\nx^2\r\n```', '```math\r\nAfter', '```math\r\nAfter\r\n```']
];

const pieces = (block: Block, list: readonly Piece[]): Shape[] =>
	list
		.filter((p) => p.kind !== 'text')
		.map((p) => {
			const children = pieces(block, p.children);
			const at: Shape = [p.kind, p.from - block.from, p.to - block.from];
			return children.length ? [...at, children] : at;
		});
const shape = (block: Block): Shape =>
	block.children.length
		? [block.type.name, block.children.map(shape)]
		: [block.type.name, block.text, ...pieces(block, block.pieces)];

describe('latex reads text as 0.11.5 did', () => {
	it.each(READS)('%j', (source, blocks) => {
		// Read per row: the suite's reset after each row drops what a grammar registered.
		expect(grammar([latex]).parse(source).blocks.map(shape)).toEqual(blocks);
	});
});

// An editor that doesn't list latex reads every form as GFM does.
it('reads nothing as math where latex is not listed', () => {
	const blocks = grammar([]).parse('$x$ and\n\n$$x$$\n\n```math\nx\n```\n').blocks;
	expect(
		blocks.map((b) => [b.type.name, b.pieces.filter((p) => p.kind !== 'text').length])
	).toEqual([
		['paragraph', 0],
		['paragraph', 0],
		['fencedCode', 0]
	]);
});

describe('a math block keeps its bytes legal as 0.11.5 did', () => {
	const [unit] = installPluginList([latex], ({ cause }) => {
		throw cause;
	});
	const rule = makingOf(unit.contribution.blocks![0])!.registration.rawWrite!;
	it.each(WRITES)('%j over %j (%s)', (held, written, mode, raw, caret) => {
		const lineEnding = held.includes('\r\n') ? '\r\n' : '\n';
		const ctx = { node: { kind: 'latex/block', raw: held, leadingTrivia: '' }, mode, lineEnding };
		expect(rule.normalize(written, ctx as never)).toBe(raw);
		expect(rule.mapOffset(written, written.length, ctx as never)).toBe(caret);
	});
	it.each(CUT_WRITES)('%j over %j', (held, written, raw) => {
		const lineEnding = held.includes('\r\n') ? '\r\n' : '\n';
		const ctx = {
			node: { kind: 'latex/block', raw: held, leadingTrivia: '' },
			mode: 'literal',
			lineEnding
		};
		expect(rule.normalize(written, ctx as never)).toBe(raw);
	});
});
