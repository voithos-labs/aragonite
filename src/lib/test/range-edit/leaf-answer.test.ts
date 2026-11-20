// A paste that is one write of one text block says so, so the editor commits it as that block's
// own write, the one a typed letter ends in; a paste that sets a block boundary names none.
// Miss-analysis: the core answered every paste as whole-document bytes, so nothing could tell a
// text landing from a structural one without reading the result again.
import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { noTransforms, testReading } from './test-host';

function paste(source: string, at: number, clip: string, to = at) {
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	const gesture = { paste: clip, plain: false, holds: 'text' as const };
	return editRange(source, { from: at, to }, gesture, 'source', host);
}

describe('the leaf a paste names', () => {
	it.each([
		['text mid-paragraph', 'alpha bravo\n', 6, 'x', [0], 'alpha xbravo\n', 7],
		['lines into a quote’s paragraph', '> ab\n', 3, 'x\ny', [0, 0], 'ax\nyb\n', 4],
		['one line after text, whatever it reads as alone', 'para text\n', 5, '# h', [0], null, 8],
		['text into a cell', '| a | b |\n| - | - |\n', 3, 'x', [0, 0, 0], 'ax', 2],
		['text into a fenced code body', '```\ncode\n```\n', 6, 'x', [0], '```\ncoxde\n```\n', 7],
		['a space alone, which the block places', 'ab\n', 1, ' ', [0], 'a b\n', 2]
	] as const)('%s', (_, source, at, clip, path, raw, caret) => {
		const { leaf } = paste(source, at, clip);
		expect(leaf?.path).toEqual(path);
		if (raw !== null) expect(leaf?.raw).toBe(raw);
		expect(leaf?.caret).toBe(caret);
	});

	// Miss-analysis: the named block's bytes were the write's own, LF lines in a CRLF document, and
	// no row read them where the document's ending is not LF.
	it('writes the lines a paste adds in the document’s line ending', () => {
		const { leaf, source } = paste('one\r\n\r\ntwo\r\n', 10, 'a\nb');
		expect(source).toBe('one\r\n\r\ntwoa\r\nb\r\n');
		expect(leaf).toEqual({ path: [1], raw: 'twoa\r\nb\r\n', caret: 7 });
	});

	// Miss-analysis: the literal rows pasted lines of text, so none read a blank pasted line, which
	// the source wrote bare while the named block wrote it behind the code's indent.
	it.each([
		{
			name: 'mid-code',
			doc: '    code\n    more\n',
			at: 6,
			clip: 'x\n\ny',
			leaf: { path: [0], raw: '    cox\n\n    yde\n    more\n', caret: 14 },
			left: '    cox\n\n    yde\n    more\n'
		},
		{
			name: 'before text on the caret’s line, which keeps the indent',
			doc: '    code\n',
			at: 6,
			clip: 'x\n\n',
			leaf: { path: [0], raw: '    cox\n\n    de\n', caret: 13 },
			left: '    cox\n\n    de\n'
		},
		{
			name: 'before spaces alone on the caret’s line, which the source reads as none',
			doc: '    code  \n    more\n',
			at: 8,
			clip: 'x\n\n',
			leaf: { path: [0], raw: '    codex\n\n  \n    more\n', caret: 11 },
			left: '    codex\n\n  \n    more\n'
		},
		{
			name: 'in a quote',
			doc: '>     code\n',
			at: 10,
			clip: 'x\n\ny',
			leaf: { path: [0, 0], raw: '    codex\n\n    y\n', caret: 16 },
			left: '>     codex\n>\n>     y\n'
		}
	])(
		'names indented code by the bytes its source holds, $name',
		({ doc, at, clip, leaf, left }) => {
			const got = paste(doc, at, clip);
			expect(got.source).toBe(left);
			expect(got.leaf).toEqual(leaf);
		}
	);

	// Miss-analysis: a cell's whole text read as a block held alone, so the paste emptied the cell
	// and landed in its padding; every cell row pasted at a caret or over part of the text.
	it('names the cell for a paste over the cell’s whole text', () => {
		const grid = '| A | B |\n| --- | --- |\n| one | 2 |\n';
		const { leaf, source } = paste(grid, 26, 'two', 29);
		expect(source).toBe('| A | B |\n| --- | --- |\n| two | 2 |\n');
		expect(leaf).toEqual({ path: [0, 1, 0], raw: 'two', caret: 3 });
	});

	it.each([
		['two paragraphs, which cut the block', 'alpha bravo\n', 6, 'one\n\ntwo'],
		['a table at a paragraph’s end', 'alpha\n', 5, '| a |\n| - |'],
		['a line ending at a paragraph’s end, whose caret leaves the text', 'abc\n\nnext\n', 3, 'x\n'],
		['text into a title row', ':::note Title\nbody\n:::\n', 10, 'x']
	] as const)('none for %s', (_, source, at, clip) => {
		expect(paste(source, at, clip).leaf).toBeUndefined();
	});

	it('none over a range across blocks, whose blocks the removal changes first', () => {
		expect(paste('alpha\n\nbravo\n', 2, 'x', 9).leaf).toBeUndefined();
	});
});
