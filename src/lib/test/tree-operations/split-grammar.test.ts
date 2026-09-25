// Miss-analysis: every split case parsed and reparsed in the global grammar, so none saw Enter
// rebuild a kind the editor had switched off, and the shape property never runs a filtered one.

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createRegistryView } from '$lib/schema/registry-view';
import { splitNode } from '$lib/tree-operations';
import { describeConvergence } from '../harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';

const noIndentedCode = createRegistryView({ syntax: { indentedCode: false } }).grammar;

describe('a split reads its halves in the editor grammar', () => {
	it('Enter before a tab leaves a paragraph when indented code is off', () => {
		const doc = parse('Loaded\n\n\tcode\n', { grammar: noIndentedCode });
		splitNode(doc, 1, 0, undefined, fixtureReading({ grammar: noIndentedCode }));

		expect(serialize(doc)).toBe('Loaded\n\n\n\tcode\n');
		expect(doc.children.map((n) => n.kind)).not.toContain('indentedCode');
		expect(describeConvergence(doc, noIndentedCode)).toBeNull();
	});

	it('the same split in the global grammar still makes the code block', () => {
		const doc = parse('Loaded\n\nx\tcode\n');
		splitNode(doc, 1, 1, undefined, fixtureReading());

		expect(doc.children.map((n) => n.kind)).toContain('indentedCode');
		expect(describeConvergence(doc)).toBeNull();
	});
});
