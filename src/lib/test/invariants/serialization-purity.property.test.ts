import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '../../core/nodes';
import { serialize } from '../../core/serializer';
import { arbParsedDoc, freshOrFixedSeed } from './arbitraries';

// G2.6: the serializer reads ONLY raw / trivia / prefix / suffix — never
// `metadata` or editor-level fields (`ownerEpoch`), and never recurses into
// `children` (a container's full subtree lives in its own `raw`). Corrupting
// every metadata and editor-level field in the tree must leave serialize output
// byte-identical. Guards the raw-as-truth decision against Phase-3 creep where a
// serializer might start reconstructing output from parsed fields.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

const JUNK = { poisoned: true, nested: { deep: [1, 2, 3] } } as const;

// `useUndefined` is drawn per node from a seeded arbitrary so failures replay
// deterministically; alternating junk vs. undefined catches both a serializer
// that reads a present-but-wrong field and one that falls back when it's absent.
function corruptDerivedFields(node: CstNode, useUndefined: () => boolean): void {
	node.metadata = useUndefined() ? undefined : (JUNK as unknown as CstNode['metadata']);
	node.ownerEpoch = useUndefined() ? undefined : (JUNK as unknown as number);
	if (node.children) {
		for (const child of node.children) corruptDerivedFields(child, useUndefined);
	}
}

describe('G2.6 serialization purity', () => {
	it('mutating metadata + ownerEpoch throughout leaves serialize unchanged', () => {
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
