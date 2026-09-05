import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

describe('bare www. autolink floor (GFM §6.9)', () => {
	// `.` is trailing punctuation, so the trim can eat the prefix's own dot and land BELOW
	// the `www.` floor. The floor check must reject at-or-below, not only exactly.
	it.each(['(www.)', 'see www..', 'www.!', 'see www.', 'www.'])(
		'does not autolink %j — nothing survives the trim past the prefix',
		(raw) => {
			const autolinks = inlineOf(raw).filter((n) => n.kind === 'autolink');
			expect(autolinks.map((n) => n.url)).toEqual([]);
		}
	);

	it('still autolinks a real www domain inside parens, trimming only the paren', () => {
		const autolinks = inlineOf('(www.example.com)').filter((n) => n.kind === 'autolink');
		expect(autolinks.map((n) => n.url)).toEqual(['http://www.example.com']);
	});
});
