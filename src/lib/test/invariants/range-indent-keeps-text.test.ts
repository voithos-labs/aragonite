// G1.58: the check passes a list move or a code indent and fails a lost or reordered word.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { checkIndentKeepsText, leafText } from '$lib/invariants/range-indent-keeps-text';

const textOf = (source: string) => leafText(parse(source), [0, 0]);

describe('G1.58 an indent over a range keeps the text it holds', () => {
	it('passes items nested and renumbered', () => {
		expect(checkIndentKeepsText(textOf('1. a\n2. b\n'), textOf('1. a\n   1. b\n'))).toBeNull();
	});

	it('fails a lifted item read in a new place', () => {
		const before = textOf('- a\n  - b\n  - c\n');
		expect(checkIndentKeepsText(before, textOf('- a\n  - c\n- b\n'))?.code).toBe(
			'range-indent-keeps-text'
		);
	});

	it('passes code lines indented', () => {
		const before = textOf('```\none\ntwo\n```\n');
		expect(checkIndentKeepsText(before, textOf('```\none\n\ttwo\n```\n'))).toBeNull();
	});

	it('fails an item that lost its text', () => {
		expect(checkIndentKeepsText(textOf('- a\n- b\n'), textOf('- a\n-\n'))?.code).toBe(
			'range-indent-keeps-text'
		);
	});
});
