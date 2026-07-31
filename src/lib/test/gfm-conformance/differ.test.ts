import { describe, it, expect } from 'vitest';
import { diffInput, runDiff } from './differ';

describe('diffInput', () => {
	it('returns null for reference-skipped input (no single-paragraph inline reading)', () => {
		expect(diffInput('# heading')).toBeNull();
		expect(diffInput('a\n\nb')).toBeNull();
	});

	it('returns null when the reference paragraph does not span the whole input', () => {
		expect(diffInput(' a')).toBeNull();
		expect(diffInput('[foo]\n\n[foo]: /url')).toBeNull();
	});

	it('returns null when both parsers agree', () => {
		expect(diffInput('*emphasis* and `code`')).toBeNull();
	});

	it('returns both normalized sides for a divergent input', () => {
		// A GFM bare autolink diverges permanently (the reference has no autolink extension),
		// so it is a stable exemplar no parser fix converges away — `gfm-bare-autolink` class.
		const divergence = diffInput('https://example.com');
		expect(divergence).not.toBeNull();
		expect(divergence!.input).toBe('https://example.com');
		expect(divergence!.ours).not.toEqual(divergence!.theirs);
	});
});

describe('runDiff', () => {
	it('partitions inputs into skipped, equal, and divergent, with skip reasons', () => {
		const result = runDiff(['# heading', ' a', 'plain', 'https://example.com']);
		expect(result.skipped).toBe(2);
		expect(result.skippedNotParagraph).toBe(1);
		expect(result.skippedPartialSpan).toBe(1);
		expect(result.compared).toBe(2);
		expect(result.divergences.map((d) => d.input)).toEqual(['https://example.com']);
	});
});
