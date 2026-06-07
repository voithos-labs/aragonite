import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '../../core/nodes';
import { serialize } from '../../core/serializer';
import { arbParsedDoc } from './arbitraries';

// G2.6: the serializer reads ONLY raw / trivia / prefix / suffix — never the
// derived render caches (`inlineContent`) or `metadata`, and never recurses into
// `children` (a container's full subtree lives in its own `raw`). Corrupting
// every cache and metadata in the tree must leave serialize output byte-
// identical. Guards the raw-as-truth decision against Phase-3 creep where a
// serializer might start reconstructing output from parsed fields.

const PARAMS = { numRuns: 1000, seed: 424242 } as const;

const JUNK = { poisoned: true, nested: { deep: [1, 2, 3] } } as const;

// `useUndefined` is drawn per node from a seeded arbitrary so failures replay
// deterministically; alternating junk vs. undefined catches both a serializer
// that reads a present-but-wrong field and one that falls back when it's absent.
function corruptDerivedFields(node: CstNode, useUndefined: () => boolean): void {
	node.inlineContent = useUndefined()
		? undefined
		: (JUNK as unknown as CstNode['inlineContent']);
	node.metadata = useUndefined() ? undefined : (JUNK as unknown as CstNode['metadata']);
	if (node.children) {
		for (const child of node.children) corruptDerivedFields(child, useUndefined);
	}
}

describe('G2.6 serialization purity', () => {
	it('mutating inlineContent + metadata throughout leaves serialize unchanged', () => {
		fc.assert(
			fc.property(
				arbParsedDoc,
				fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
				(doc: Document, flags) => {
					const before = serialize(doc);
					let i = 0;
					const useUndefined = () => flags[i++ % flags.length];
					for (const child of doc.children) corruptDerivedFields(child, useUndefined);
					return serialize(doc) === before;
				}
			),
			PARAMS
		);
	});
});
