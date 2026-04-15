import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';

describe('non-GFM syntax round-trips without loss', () => {
	const cases: { name: string; source: string }[] = [
		{
			name: 'footnote syntax',
			source: 'Text[^1].\n\n[^1]: Footnote content.\n'
		},
		{
			name: 'mixed supported and non-standard blocks',
			source: '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nParagraph.\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
