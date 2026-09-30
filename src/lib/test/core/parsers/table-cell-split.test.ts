import { describe, it, expect } from 'vitest';
import {
	rowCellSpans,
	splitRowCells,
	matchTableDelimiterRow
} from '../../../core/parsers/table-line';

describe('rowCellSpans', () => {
	const spans = (text: string) => rowCellSpans(text).map((c) => [c.from, c.start, c.end, c.to]);

	it('puts each cell’s text inside the region between its pipes', () => {
		expect(spans('| a |bc|')).toEqual([
			[1, 2, 3, 4],
			[5, 5, 7, 7]
		]);
	});

	it('leaves the indent, the edge pipes and trailing whitespace outside every region', () => {
		expect(spans('  |a| \t')).toEqual([[3, 3, 4, 4]]);
		expect(spans('a | b')).toEqual([
			[0, 0, 1, 2],
			[3, 4, 5, 5]
		]);
	});

	it('marks an empty cell where its region ends', () => {
		expect(spans('|  |')).toEqual([[1, 3, 3, 3]]);
	});
});

describe('splitRowCells', () => {
	it('splits a simple row', () => {
		expect(splitRowCells('| a | b | c |')).toEqual(['a', 'b', 'c']);
	});

	it('treats pipes preceded by an odd number of backslashes as literal', () => {
		expect(splitRowCells('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
	});

	it('treats pipes preceded by an even number of backslashes as separators', () => {
		expect(splitRowCells('| a \\\\| b | c |')).toEqual(['a \\\\', 'b', 'c']);
	});

	it('strips all leading and trailing whitespace per cell (cosmetic padding is non-semantic)', () => {
		expect(splitRowCells('|  a  | b |')).toEqual(['a', 'b']);
		expect(splitRowCells('|    Right |    $100 |')).toEqual(['Right', '$100']);
	});

	it('preserves internal whitespace inside a cell', () => {
		expect(splitRowCells('| a b c | d  e |')).toEqual(['a b c', 'd  e']);
	});

	it('handles rows without leading or trailing pipes', () => {
		expect(splitRowCells('a | b | c')).toEqual(['a', 'b', 'c']);
	});

	it('returns empty cells for adjacent pipes', () => {
		expect(splitRowCells('| a |  | c |')).toEqual(['a', '', 'c']);
	});
});

describe('matchTableDelimiterRow', () => {
	it('returns null for non-delimiter rows', () => {
		expect(matchTableDelimiterRow('| Name | Age |')).toBeNull();
		expect(matchTableDelimiterRow('|   |   |')).toBeNull();
	});

	it('extracts column count and default alignments', () => {
		expect(matchTableDelimiterRow('| --- | --- | --- |')).toEqual({
			columnCount: 3,
			alignments: ['none', 'none', 'none']
		});
	});

	it('extracts left / center / right / none alignments by colon placement', () => {
		expect(matchTableDelimiterRow('| :--- | :---: | ---: | --- |')).toEqual({
			columnCount: 4,
			alignments: ['left', 'center', 'right', 'none']
		});
	});

	it('handles tight delimiters', () => {
		expect(matchTableDelimiterRow('|-|:-:|-:|')).toEqual({
			columnCount: 3,
			alignments: ['none', 'center', 'right']
		});
	});

	it('rejects cells whose non-whitespace contents are not :?-+:?', () => {
		expect(matchTableDelimiterRow('| --- | a-- |')).toBeNull();
	});
});
