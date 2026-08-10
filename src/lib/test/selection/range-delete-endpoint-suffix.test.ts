import { describe, it, expect } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';

// Miss-analysis: every truncated-endpoint pin cut inside prose lines, so no surviving slice
// ever ended in a blank line — only indented code holds one inside a leaf's raw.
function run(
	source: string,
	start: { path: number[]; offset: number },
	end: { path: number[]; offset: number }
): string {
	const doc = parse(source);
	const result = rangeDelete(
		doc,
		start,
		end,
		createSharingState(),
		undefined,
		undefined,
		undefined
	);
	return serialize(result.newDoc);
}

describe('a truncated endpoint ending in a blank line keeps it (GH #97)', () => {
	it('keeps the blank line the selection never covered', () => {
		const survivor = run(
			'    a\n\n    b\n\nafter',
			{ path: [0], offset: 7 },
			{ path: [1], offset: 5 }
		);

		expect(survivor).toBe('    a\n\n');
	});

	it('the CRLF twin keeps its CRLF line', () => {
		const survivor = run(
			'    a\r\n\r\n    b\r\n\r\nafter',
			{ path: [0], offset: 9 },
			{ path: [1], offset: 5 }
		);

		expect(survivor).toBe('    a\r\n\r\n');
	});
});
