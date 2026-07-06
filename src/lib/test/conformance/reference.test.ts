import { describe, it, expect } from 'vitest';
import { referenceInlineNodes } from './reference';

describe('referenceInlineNodes', () => {
	it('returns the inline children of a single paragraph', () => {
		const nodes = referenceInlineNodes('*a* b');
		expect(nodes).not.toBeNull();
		expect(nodes!.map((n) => n.type)).toEqual(['emph', 'text']);
	});

	it('returns null for non-paragraph documents', () => {
		expect(referenceInlineNodes('# heading')).toBeNull();
		expect(referenceInlineNodes('    code')).toBeNull();
		expect(referenceInlineNodes('a\n\nb')).toBeNull();
		expect(referenceInlineNodes('[a]: /url')).toBeNull();
	});

	it('returns null for empty input', () => {
		expect(referenceInlineNodes('')).toBeNull();
	});
});
