/**
 * Type pins for the bytes-scoped view (G1.9 as a type). The `@ts-expect-error`
 * directives are the assertions: `npm run check` fails if a byte-field write
 * starts compiling through a view (the directive becomes "unused") or if the
 * `childIds`/`ownerEpoch` carve-out stops compiling. The pin function is never
 * invoked — the writes must not execute; the runtime cases cover the two
 * behaviors that do run (carve-out writes, view serialization).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { DocumentView, NodeView } from '../../core/node-views';

export function compileTimePins(node: NodeView, doc: DocumentView): void {
	// @ts-expect-error raw is serialized bytes — readonly on a view
	node.raw = '# changed\n';
	// @ts-expect-error kind is serialized bytes — readonly on a view
	node.kind = 'paragraph';
	// @ts-expect-error leadingTrivia is serialized bytes — readonly on a view
	node.leadingTrivia = '\n';
	// @ts-expect-error children structure is serialized bytes — readonly on a view
	node.children = [];
	// @ts-expect-error the children array is readonly on a view
	node.children?.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
	// @ts-expect-error metadata is serialized-byte-derived — readonly on a view
	node.metadata = undefined;
	// @ts-expect-error the document's children array is readonly on a view
	doc.children = [];
	// The bookkeeping carve-out MUST keep compiling — G1.9 is bytes-scoped.
	node.childIds = ['a'];
	node.ownerEpoch = 3;
}

const SOURCE = '# h\n\n- a\n- b\n';

describe('node views — bytes-scoped readonly (G1.9)', () => {
	it('accepts the bookkeeping carve-out writes (childIds, ownerEpoch)', () => {
		const doc: DocumentView = parse(SOURCE);
		const node = doc.children[0];
		node.childIds = ['a'];
		node.ownerEpoch = 3;
		expect(node.childIds).toEqual(['a']);
		expect(node.ownerEpoch).toBe(3);
	});

	it('serialize() accepts a DocumentView and round-trips', () => {
		const doc: DocumentView = parse(SOURCE);
		expect(serialize(doc)).toBe(SOURCE);
	});
});
