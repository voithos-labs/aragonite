import { describe, expect, it } from 'vitest';
import { grammar } from '#lib/plugin.js';
import { footnotes } from '#packages/footnotes/src/index.js';
// Plugin-internal: where a reference's jump lands, which only a mounted widget asks.
import { definitionStart } from '#packages/footnotes/src/footnotes-plugin.js';

const landing = (source: string, label: string) =>
	definitionStart(grammar([footnotes]).parse(source), label);

describe('footnote definition lookup (where a reference jump lands)', () => {
	it('lands at the start of the definition body, not on its marker', () => {
		const source = 'Prose [^a] and [^b].\n\n[^a]: A def.\n\n[^b]: B def.\n';
		expect(landing(source, 'a')).toBe(source.indexOf('A def.'));
		expect(landing(source, 'b')).toBe(source.indexOf('B def.'));
	});

	it('walks into a container to find a nested definition', () => {
		const source = 'Prose [^a].\n\n> [^a]: Quoted def.\n';
		expect(landing(source, 'a')).toBe(source.indexOf('Quoted'));
	});

	it('returns null for a label no definition carries', () => {
		expect(landing('An orphan [^missing].\n\n[^other]: Other def.\n', 'missing')).toBeNull();
	});

	it('answers with the first of two definitions sharing a label', () => {
		const source = 'Prose [^a].\n\n[^a]: First.\n\n[^a]: Second.\n';
		expect(landing(source, 'a')).toBe(source.indexOf('First.'));
	});

	it('finds a definition that sits before its reference', () => {
		expect(landing('[^a]: Defined up front.\n\nProse [^a].\n', 'a')).toBe(6);
	});
});
