import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';

describe('thematic break — leading indentation (CommonMark §4.1)', () => {
	it('does not treat a 4-space-indented rule as a thematic break', () => {
		// 4+ columns of leading indentation is indented code, not a thematic break.
		expect(parse('    ---\n').children[0].kind).not.toBe('thematicBreak');
	});

	it('treats a leading tab as indentation, not a thematic break', () => {
		expect(parse('\t***\n').children[0].kind).not.toBe('thematicBreak');
	});

	it('still recognizes thematic breaks at 0–3 spaces of indentation', () => {
		expect(parse('---\n').children[0].kind).toBe('thematicBreak');
		expect(parse('  ***\n').children[0].kind).toBe('thematicBreak');
		expect(parse('   ___\n').children[0].kind).toBe('thematicBreak');
	});
});
