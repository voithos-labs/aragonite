// The editor's current text, cached per content version, and G1.52, the dev check that catches a
// byte write the version never heard about.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createCurrentSource } from '#lib/editor-actions/commit/current-source.js';
import { checkCurrentSource } from '#lib/invariants/current-source.js';
import { disablePerfInstruments, enablePerfInstruments } from '#lib/perf/instruments.js';
import { takeDevWarns } from '../../support/warn-gate';

// Counted, since the check's cost is one serialization and an echoing host reads on every key.
vi.mock('#lib/core/serializer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/core/serializer.js')>();
	return { ...actual, serialize: vi.fn(actual.serialize) };
});

afterEach(disablePerfInstruments);

function harness(source: string) {
	const doc = parse(source);
	let version = 0;
	const text = createCurrentSource({ version: () => version, doc: () => doc });
	vi.mocked(serialize).mockClear();
	return {
		doc,
		text,
		bump: () => version++,
		serializations: () => vi.mocked(serialize).mock.calls.length
	};
}

describe('the current text', () => {
	it('follows a write the version announces', () => {
		const h = harness('one\n');
		expect(h.text.read()).toBe('one\n');
		h.doc.children[0].raw = 'two\n';
		h.bump();
		expect(h.text.read()).toBe('two\n');
		expect(takeDevWarns()).toEqual([]);
	});

	it('serializes once per version for the unchecked read', () => {
		const h = harness('one\n');
		h.text.readUnchecked();
		h.text.readUnchecked();
		h.text.readUnchecked();
		expect(h.serializations()).toBe(1);
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
		h.text.read();
		h.doc.children[0].raw = 'two\n';

		expect(h.text.read()).toBe('one\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:current-source']);
	});

	it('checks a reused text at most once per version', () => {
		const h = harness('one\n');
		h.text.read();
		h.text.read();
		h.text.read();
		expect(h.serializations()).toBe(2);

		h.bump();
		h.text.read();
		h.text.read();
		expect(h.serializations()).toBe(4);
	});

	it('is skipped while the perf instruments are armed, which would time it', () => {
		enablePerfInstruments();
		const h = harness('one\n');
		h.text.read();
		h.text.read();
		expect(h.serializations()).toBe(1);
	});
});
