import { describe, it, expect } from 'vitest';
import { diffInput, runDiff } from './differ';

describe('diffInput', () => {
	it('returns null for reference-skipped input (no single-paragraph inline reading)', () => {
		expect(diffInput('# heading')).toBeNull();
		expect(diffInput('a\n\nb')).toBeNull();
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
	it('partitions inputs into skipped, equal, and divergent', () => {
		const { divergences, skipped, compared } = runDiff(['# heading', 'plain', '`  a  `']);
		expect(skipped).toBe(1);
		expect(compared).toBe(2);
		expect(divergences.map((d) => d.input)).toEqual(['`  a  `']);
	});
});
