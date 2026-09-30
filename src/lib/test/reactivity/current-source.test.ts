// The editor's current text, cached per content version, and G1.52, the dev check that catches a
// byte write the version never heard about.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createCurrentSource } from '$lib/reactivity/current-source';
import { checkCurrentSource } from '$lib/invariants/current-source';
import { takeDevWarns } from '../support/warn-gate';

function harness(source: string) {
	const doc = parse(source);
	let version = 0;
	const read = createCurrentSource({ version: () => version, doc: () => doc });
	return { doc, read, bump: () => version++ };
}

describe('the current text', () => {
	it('follows a write the version announces', () => {
		const h = harness('one\n');
		expect(h.read()).toBe('one\n');
		h.doc.children[0].raw = 'two\n';
		h.bump();
		expect(h.read()).toBe('two\n');
		expect(takeDevWarns()).toEqual([]);
	});
});

describe('G1.52 the text served for an unchanged version is the document', () => {
	it('passes a match and names a mismatch', () => {
		const doc = parse('one\n');
		expect(checkCurrentSource('one\n', doc)).toBeNull();
		expect(checkCurrentSource('two\n', doc)?.code).toBe('current-source-stale');
	});

	it('fires when a write changes the bytes without a bump', () => {
		const h = harness('one\n');
		h.read();
		h.doc.children[0].raw = 'two\n';

		expect(h.read()).toBe('one\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:current-source']);
	});
});
