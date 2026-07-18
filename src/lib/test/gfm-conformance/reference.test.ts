import { describe, it, expect } from 'vitest';
import { referenceInlineNodes, REFERENCE_VERSION } from './reference';
import packageJson from '../../../../package.json';

describe('referenceInlineNodes', () => {
	// The baseline is only meaningful against this exact reference version — a
	// commonmark bump that skips reference.ts must go red here, not drift silently.
	it('REFERENCE_VERSION matches the pinned devDependency', () => {
		expect(packageJson.devDependencies.commonmark).toBe(REFERENCE_VERSION);
	});

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

	it('returns null when the block layer trims or shifts what the inline stage sees', () => {
		expect(referenceInlineNodes(' a')).toBeNull();
		expect(referenceInlineNodes('a ')).toBeNull();
		expect(referenceInlineNodes('a\n')).toBeNull();
		expect(referenceInlineNodes('\na')).toBeNull();
		expect(referenceInlineNodes('Foo\n    bar')).toBeNull();
		expect(referenceInlineNodes('[foo]\n\n[foo]: /url')).toBeNull();
		expect(referenceInlineNodes('[foo]: /url\n===\n[foo]')).toBeNull();
	});

	it('keeps flush multi-line paragraphs, including hard breaks', () => {
		expect(referenceInlineNodes('a\nb')).not.toBeNull();
		expect(referenceInlineNodes('line  \nbreak')).not.toBeNull();
	});
});
