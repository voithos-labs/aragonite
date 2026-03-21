import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';

describe('deferred GFM syntax round-trips without loss', () => {
	const cases: { name: string; source: string }[] = [
		{
			name: 'table',
			source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
		},
		{
			name: 'HTML block',
			source: '<div>\n  <p>Hello</p>\n</div>\n'
		},
		{
			name: 'indented code block',
			source: '    code line 1\n    code line 2\n'
		},
		{
			name: 'link reference definition',
			source: '[ref]: https://example.com "Title"\n'
		},
		{
			name: 'mixed with supported blocks',
			source: '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nParagraph.\n'
		},
		{
			name: 'footnote syntax',
			source: 'Text[^1].\n\n[^1]: Footnote content.\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
