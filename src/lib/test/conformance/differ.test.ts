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
		// commonmark strips one flanking space inside code spans; ours keeps raw bytes
		const divergence = diffInput('`  a  `');
		expect(divergence).not.toBeNull();
		expect(divergence!.input).toBe('`  a  `');
		expect(divergence!.ours).not.toEqual(divergence!.theirs);
	});
});

describe('runDiff', () => {
	it('partitions inputs into skipped, equal, and divergent, with skip reasons', () => {
		const result = runDiff(['# heading', ' a', 'plain', '`  a  `']);
		expect(result.skipped).toBe(2);
		expect(result.skippedNotParagraph).toBe(1);
		expect(result.skippedPartialSpan).toBe(1);
		expect(result.compared).toBe(2);
		expect(result.divergences.map((d) => d.input)).toEqual(['`  a  `']);
	});
});
