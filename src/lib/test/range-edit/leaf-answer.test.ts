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
		['text into a cell', '| a | b |\n| - | - |\n', 3, 'x', [0, 0, 0], 'ax', 2]
	] as const)('%s', (_, source, at, clip, path, raw, caret) => {
		const { leaf } = paste(source, at, clip);
		expect(leaf?.path).toEqual(path);
		if (raw !== null) expect(leaf?.raw).toBe(raw);
		expect(leaf?.caret).toBe(caret);
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
