import { describe, it, expect } from 'vitest';
import { splitRowCells, matchTableDelimiterRow } from '../../../core/parsers/table';

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

	it('trims one space of cell padding on each side, no further', () => {
		expect(splitRowCells('|  a  | b |')).toEqual([' a ', 'b']);
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
