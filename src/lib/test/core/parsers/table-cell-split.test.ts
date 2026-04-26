import { describe, it, expect } from 'vitest';
import { splitRowCells } from '../../../core/parsers/table';

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
