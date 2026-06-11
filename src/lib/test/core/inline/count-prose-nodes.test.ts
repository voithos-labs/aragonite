import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { countProseNodes } from '../../../core/inline';

describe('countProseNodes', () => {
	it('counts inline-bearing nodes across nesting, skipping code and structural containers', () => {
		const source = [
			'# h',
			'',
			'para',
			'',
			'setext',
			'======',
			'',
			'- item one',
			'- item two',
			'',
			'```',
			'code',
			'```',
			'',
			'| a | b |',
			'| --- | --- |',
			'| c | d |',
			''
		].join('\n');
		const doc = parse(source);

		// heading + paragraph + setextHeading + 2 list-item paragraphs + 4 table cells
		expect(countProseNodes(doc.children)).toBe(9);
	});

	it('returns 0 for a doc with no prose kinds', () => {
		const doc = parse('```\nx\n```\n\n---\n');
		expect(countProseNodes(doc.children)).toBe(0);
	});
});
