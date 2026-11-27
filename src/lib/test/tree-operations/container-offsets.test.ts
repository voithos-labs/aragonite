import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { displayLength } from '#lib/core/lines.js';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { isReservedChromeChild } from '#lib/schema/reserved-chrome.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { allBlockPaths } from '../invariants/arbitraries/cst';
import { arbLawDocument } from '../range-laws/shapes';
import { testReading } from '../range-edit/test-host';
import {
	documentByteMap,
	leafAtRawOffset,
	rawOffsetOfLeaf
} from '#lib/tree-operations/container-offsets.js';
import { docAround, gridOf, registerPluginGrid } from '../selection/cross-block/plugin-grid-kind';
import { measured } from '#lib/tree-operations/top-level-starts.js';

// A fix-up that merges blocks tracks the caret as an offset into the merged block's raw, and a
// container's raw re-prefixes its children's lines, so the offset has to be mapped to a leaf.
// Miss-analysis: GH #193, every caret put into a container fell to its end, and tests pinned it.

const top = (source: string): CstNode => parse(source).children[0];

describe('a raw offset into a container', () => {
	it('lands in the leaf holding it, prefix stripped', () => {
		expect(leafAtRawOffset(top('> q\nAfter\n'), 3)).toEqual({ path: [0], offset: 1 });
		expect(leafAtRawOffset(top('- item\n  more\n'), 6)).toEqual({ path: [0, 0], offset: 4 });
	});

	it('reads a lazy line, which carries no prefix, column for column', () => {
		expect(leafAtRawOffset(top('> q\nAfter\n'), 'q\nAft'.length + 2)).toEqual({
			path: [0],
			offset: 'q\nAft'.length
		});
	});

	it('clamps an offset on a prefix to the start of that line’s text', () => {
		expect(leafAtRawOffset(top('> a\n> b\n'), 5)).toEqual({ path: [0], offset: 2 });
	});

	// Miss-analysis: every fixture indented with spaces, so a tab that cuts through a marker's
	// columns read the line's text from its start.
	it('reads a nested item indented with a tab from where its text starts', () => {
		const list = top('- a\n\t- b\n');
		expect(leafAtRawOffset(list, 8)).toEqual({ path: [0, 1, 0, 0], offset: 1 });
		expect(rawOffsetOfLeaf(list, [0, 1, 0, 0], 1)).toBe(8);
	});

	it('is refused for a container whose bytes it cannot map', () => {
		expect(leafAtRawOffset(top('| a |\n| - |\n| b |\n'), 3)).toBeNull();
		expect(rawOffsetOfLeaf(top('| a |\n| - |\n| b |\n'), [0, 0], 0)).toBeNull();
	});
});

describe('the leaf position back to a raw offset', () => {
	const nested = top('> - a\n>   b\n>\n> c\n');

	/** Every caret position in every leaf of `node`, as a path and an offset. */
	function positions(node: CstNode, path: number[] = []): { path: number[]; offset: number }[] {
		if (!node.children?.length) {
			return Array.from({ length: displayLength(node.raw) + 1 }, (_, offset) => ({ path, offset }));
		}
		return node.children.flatMap((child, i) => positions(child, [...path, i]));
	}

	it('comes back to the same leaf position through nested containers', () => {
		for (const at of positions(nested)) {
			const raw = rawOffsetOfLeaf(nested, at.path, at.offset);
			expect(raw, JSON.stringify(at)).not.toBeNull();
			expect(leafAtRawOffset(nested, raw!), JSON.stringify(at)).toEqual(at);
		}
	});
});

// Miss-analysis: every titled fixture had title text, and an empty one paired with the blank line
// below its tags, so the body under it read one line low (found by the caret-walk property).
describe('a title row with no text', () => {
	it('sits inside its tags, and the body below keeps its own lines', () => {
		testReading();
		const source = '<details open>\n<summary></summary>\n\nx\n\n</details>\n\nafter\n';
		const map = documentByteMap(measured(parse(source)));
		expect(map.byteOf([0, 0], 0)).toBe(source.indexOf('</summary>'));
		expect(map.byteOf([0, 1], 0)).toBe(source.indexOf('x'));
		expect(map.leafAt(source.indexOf('x'))).toEqual({ path: [0, 1], offset: 0 });
	});
});

// Miss-analysis: an empty cell sat right past its pipe, where no letter typed into it goes, and a
// paste into one took the cell's own write, whose row rebuild hid the core's bytes.
describe('an empty cell', () => {
	it('sits past the space a letter typed into it keeps before it', () => {
		const source = '| a | b |\n| --- | --- |\n|  | 2 |\n';
		const map = documentByteMap(measured(parse(source)));
		expect(map.byteOf([0, 1, 0], 0)).toBe(source.indexOf('|  |') + 2);
		expect(map.byteOf([0, 1, 1], 0)).toBe(source.indexOf('2'));
	});
});

// The byte map reads a list's offsets as its items' own, without splitting its lines, which holds
// only while a list's bytes are its items' and nothing else: tabs, lazy lines and loose items too.
describe('a list holds its items’ bytes and nothing else', () => {
	const lists = (node: CstNode | Document): CstNode[] =>
		(node.children ?? []).flatMap((child) => [
			...(child.kind === 'list' ? [child] : []),
			...lists(child)
		]);
	it('over the law draw', () => {
		const grammar = testReading().grammar;
		for (const source of fc.sample(arbLawDocument, { numRuns: 300, seed: 20261105 })) {
			for (const list of lists(readAsOpened(source, { grammar, scope: 'document' }))) {
				const items = list.children!.map((c) => c.leadingTrivia + c.raw).join('');
				expect(items, JSON.stringify(source)).toBe(list.raw);
			}
		}
	});
});

// Miss-analysis: every grid here was a table, whose rows carry their own line endings; a plugin
// grid's rebuild may write the break between rows instead, and every cell read as one byte.
describe('a grid whose rows leave their line breaks to the grid', () => {
	it('maps each cell to its own bytes', () => {
		const doc = docAround(
			gridOf(registerPluginGrid(), [
				['ab', 'cd'],
				['ef', 'gh']
			])
		);
		const map = documentByteMap(measured(doc));
		const starts = [
			[1, 0, 0],
			[1, 0, 1],
			[1, 1, 0],
			[1, 1, 1]
		].map((path) => map.byteOf(path, 0));
		expect(starts).toEqual([5, 8, 11, 14]);
	});
});

// Miss-analysis: the cost rows counted blocks laid out, never the items a list's map read, so a
// copy of four items of a 10 MB list read every item's length through the editor's proxies.
describe('a list’s map reads only the items a lookup asks about', () => {
	const ITEMS = 4000;
	const counted = () => {
		const doc = parse(Array.from({ length: ITEMS }, (_, i) => `- item ${i}\n`).join(''));
		const list = doc.children[0] as CstNode;
		const reads = { count: 0 };
		// Each index read stands in for the trap a `$state` proxy pays.
		list.children = new Proxy(list.children!, {
			get: (items, key, receiver) => {
				if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++;
				return Reflect.get(items, key, receiver);
			}
		});
		return { doc, reads };
	};

	it('maps a byte near either end, and a byte back to its item, reading a handful of items', () => {
		for (const item of [3, ITEMS - 3]) {
			const { doc, reads } = counted();
			const map = documentByteMap(measured(doc));
			const byte = map.byteOf([0, item, 0], 2)!;
			expect(map.leafAt(byte)).toEqual({ path: [0, item, 0], offset: 2 });
			expect(reads.count, `item ${item}`).toBeLessThan(4 * Math.log2(ITEMS));
		}
	});

	it('sums the items when the list’s spans no longer hold them', () => {
		const { doc } = counted();
		const list = doc.children[0] as CstNode;
		list.childSpans = list.childSpans!.map((at) => (at === 0 ? 0 : at + 1));
		list.childSpans[list.childSpans.length - 1] = list.raw.length;
		expect(documentByteMap(measured(doc)).byteOf([0, 5, 0], 0)).toBe(5 * 9 + 2);
	});
});

// Miss-analysis: `byte-layout-parity` asks only caret positions and skips a leaf's line ending by
// contract, and `byte-map-spans` compares two answers that shared the clamp, so no row read a `\n`.
describe('every offset of a nested block, its line ending included', () => {
	const SHAPES: Record<string, string> = {
		quote: 'intro\n\n> foo bar\n> baz qux\n',
		'list item': '- foo bar\n  baz qux\n- next\n',
		callout: ':::note Title\nfoo bar\nbaz qux\n:::\n',
		alert: '> [!NOTE]\n> foo bar\n> baz qux\n',
		details: '<details>\n<summary>T</summary>\n\nfoo bar\nbaz qux\n\n</details>\n',
		footnote: 'x[^1]\n\n[^1]: foo bar\n    baz qux\n',
		table: '| foo | bar |\n|---|---|\n| baz | qux |\n'
	};
	const ENDINGS = [
		['LF', '\n'],
		['CRLF', '\r\n']
	] as const;

	for (const [name, lf] of Object.entries(SHAPES)) {
		for (const [ending, eol] of ENDINGS) {
			it(`${name}, ${ending}: each character at its byte, a last child's end past its line`, () => {
				installPlugins(SYNTAX_PLUGINS);
				const source = lf.replaceAll('\n', eol);
				const doc = readAsOpened(source, { grammar: defaultGrammarView, scope: 'document' });
				const map = documentByteMap(measured(doc));
				for (const path of allBlockPaths(doc).filter((at) => at.length > 1)) {
					const parent = blockNodeAt(doc, path.slice(0, -1))!;
					const index = path[path.length - 1];
					// A title row's line ending stays before its container's closing tag.
					if (isReservedChromeChild(parent, index)) continue;
					const { raw } = blockNodeAt(doc, path)!;
					const bytes = Array.from(raw, (_, i) => map.byteOf(path, i)!);
					const at = path.join('.');
					expect(bytes.map((byte) => source[byte]).join(''), `${at} reads its bytes`).toBe(raw);
					expect(new Set(bytes).size, `${at} takes a byte a character`).toBe(raw.length);
					if (index === parent.children!.length - 1) {
						expect(map.byteOf(path, raw.length), `${at} ends`).toBe(map.endOf(path, raw.length));
					}
				}
			});
		}
	}
});

// Miss-analysis: every container in the rows above gives its body a line of its own, so none read
// the branch for a body no raw line carries, an alert's empty body under its head line.
describe('an empty body under a head line, at its LF twin’s bytes', () => {
	const SHAPES: Record<string, string> = {
		'alert, the whole document': '> [!NOTE]\n',
		'alert, mid-document': 'intro\n\n> [!NOTE]\n\nafter\n',
		'alert, no final line ending after it': 'intro\n\n> [!NOTE]\n\nafter',
		'alert in a quote': '> > [!NOTE]\n',
		'alert in a list item': '- > [!NOTE]\n- next\n',
		'alert in a quote, mid-document': 'intro\n\n> > [!NOTE]\n\nafter\n'
	};

	/** The byte map's answer for each offset of the alert's empty body, and that body's raw. */
	const bodyBytes = (source: string) => {
		installPlugins(SYNTAX_PLUGINS);
		const doc = readAsOpened(source, { grammar: defaultGrammarView, scope: 'document' });
		const map = documentByteMap(measured(doc));
		const paths = allBlockPaths(doc).filter(
			(path) => blockNodeAt(doc, path.slice(0, -1))?.kind === 'githubAlert'
		);
		expect(paths, 'the alert holds one block').toHaveLength(1);
		const [path] = paths;
		const { raw } = blockNodeAt(doc, path)!;
		const bytes = Array.from({ length: raw.length + 1 }, (_, i) => map.byteOf(path, i)!);
		return { raw, bytes, end: map.endOf(path, raw.length) };
	};

	for (const [name, lf] of Object.entries(SHAPES)) {
		it(`${name}, LF: its line ending's byte, then past it`, () => {
			const { raw, bytes, end } = bodyBytes(lf);
			expect(raw).toBe('\n');
			expect(bytes).toEqual([lf.indexOf('\n', lf.indexOf(']')), end]);
		});

		it(`${name}, CRLF: at its LF twin's bytes, its \`\\n\` one past its \`\\r\``, () => {
			// Where each LF byte goes once every `\n` before it is written `\r\n`.
			const carried = (byte: number) => byte + lf.slice(0, byte).split('\n').length - 1;
			const [atEnding, past] = bodyBytes(lf).bytes.map(carried);
			const source = lf.replaceAll('\n', '\r\n');
			const { raw, bytes, end } = bodyBytes(source);
			expect(raw).toBe('\r\n');
			expect(bytes).toEqual([atEnding, atEnding + 1, past]);
			expect([source[bytes[0]], source[bytes[1]], end]).toEqual(['\r', '\n', past]);
		});
	}

	it('with no line ending of its own, sits at the end of the head line', () => {
		expect(bodyBytes('> [!NOTE]').bytes).toEqual([9]);
		expect(bodyBytes('intro\r\n\r\n> [!NOTE]').bytes).toEqual([18]);
	});
});
