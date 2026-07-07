import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { scanInline } from '../../core/inline/scan';

// Old-parser parity pins — this suite dies at cutover with the old pipeline.
// The reference has no GFM autolink extension, so the old parser is the only
// oracle for bare/www/email recognition, boundary rules, trimming, and how
// autolinks nest under emphasis and link text.

const PARITY_CASES = [
	'https://bare.example',
	'www.example.com',
	'foo@bar.example.com',
	'Visit www.example.com.',
	'www.example.com/a(b)c)',
	'https://x.com&amp;y',
	'https://x.com`c`',
	'*https://x.y*',
	'**www.x.com**',
	'*https://x.y/a*b*',
	'[see www.x.com](/u)',
	'[*www.x.com*](/u)',
	'_a@b.c',
	'[www.x.com]',
	'(www.x.com)',
	'www.x.com/&bogus08;',
	'xhttps://a.b',
	'wwww.x.com',
	'www.x',
	'ftp://x.y',
	'<https://x.y>',
	'<a@b.c>',
	'<br/>',
	'<!-- c -->'
];

describe('gfm autolink output equals the old parser node-for-node', () => {
	for (const raw of PARITY_CASES) {
		it(JSON.stringify(raw), () => {
			expect(scanInline(raw, 0, raw.length)).toEqual(parseInline(raw, 0, raw.length));
		});
	}
});
