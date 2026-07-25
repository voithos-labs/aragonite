import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { assignIds, generateBlockId } from '../block-id';

describe('assignIds', () => {
	it('returns an array of unique IDs matching children length', () => {
		const doc = parse('# A\n\n# B\n\n# C\n');
		const ids = assignIds(doc.children);

		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	it('generates unique IDs (UUIDs)', () => {
		const id1 = generateBlockId();
		const id2 = generateBlockId();
		expect(id1).not.toBe(id2);
		expect(typeof id1).toBe('string');
		expect(id1.length).toBeGreaterThan(0);
	});
});

// `crypto.randomUUID` is secure-context-only. An embedder serving the editor over
// plain http (an intranet, a LAN preview) has `crypto` but not that method, and a
// throwing id generator takes down every keyed render — while these ids are
// keyed-each keys, not secrets.
describe('generateBlockId without randomUUID', () => {
	it('falls back to a unique id instead of throwing', () => {
		// `randomUUID` lives on Crypto.prototype, so shadow it with an own undefined
		// rather than deleting — an insecure context reads exactly this shape.
		Object.defineProperty(globalThis.crypto, 'randomUUID', {
			value: undefined,
			configurable: true
		});
		try {
			const ids = new Set([generateBlockId(), generateBlockId(), generateBlockId()]);
			expect(ids.size).toBe(3);
			for (const id of ids) expect(id.length).toBeGreaterThan(0);
		} finally {
			Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
		}
	});
});
