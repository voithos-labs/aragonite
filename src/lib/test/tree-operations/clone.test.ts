import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { cloneDocument } from '../../tree-operations/clone';

describe('cloneDocument', () => {
	it('produces a deep copy', () => {
		const doc = parse('# Title\n\nText.\n');
		const cloned = cloneDocument(doc);

		cloned.children[0].raw = '# Modified\n';
		expect(doc.children[0].raw).toBe('# Title\n');
	});

	it('serializes identically to the original', () => {
		const doc = parse('# Title\n\nText.\n\n> Quote\n');
		const cloned = cloneDocument(doc);

		expect(serialize(cloned)).toBe(serialize(doc));
	});

	it('deep clones container children', () => {
		const doc = parse('> Hello\n');
		const cloned = cloneDocument(doc);

		cloned.children[0].children![0].raw = 'Modified\n';
		expect(doc.children[0].children![0].raw).not.toBe('Modified\n');
	});
});
