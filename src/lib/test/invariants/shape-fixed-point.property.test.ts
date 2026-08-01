import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode, splitNode, updateNodeContent } from '$lib/tree-operations';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { arbBlankSeparatedGfmDoc, freshOrFixedSeed } from './arbitraries';
import { displayLength } from '$lib/core/lines';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

// G2.13: an edit on a loaded document leaves a tree that reloads to its own block shape —
// the load → edit → save → load cycle a consumer runs on every remount. Byte round-trip
// (G2.1) is blind to it: the blank-line loss preserved bytes exactly while dropping a block.

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(424242) } as const;

// The gestures whose separator handling the blank-line rule governs: Enter, block delete,
// and a content commit. A deep-leaf merge writes a leaf's raw without reparsing its kind, a
// separate contract this oracle would report against.
type Gesture = { op: 'split' | 'delete' | 'update'; at: number; offset: number };

const arbGesture: fc.Arbitrary<Gesture> = fc.record({
	op: fc.constantFrom('split', 'delete', 'update'),
	at: fc.nat({ max: 6 }),
	offset: fc.nat({ max: 40 })
});

function applyGesture(doc: Document, gesture: Gesture): void {
	const count = doc.children.length;
	if (count === 0) return;
	const at = gesture.at % count;
	const node: CstNode = doc.children[at];
	// Enter and Backspace split a PROSE leaf: a container descends to its leaf, and a
	// verbatim block (a fence) takes the newline into its own body. Neither reaches
	// splitNode, so neither is an editing-reachable tree.
	const isProseLeaf =
		node.children === undefined && getBlockKindDescriptor(node.kind).supportsInline === true;
	switch (gesture.op) {
		case 'split':
			if (isProseLeaf) splitNode(doc, at, Math.min(gesture.offset, displayLength(node.raw)));
			return;
		case 'delete':
			deleteNode(doc, at);
			return;
		case 'update':
			// Typing into the block, keeping its kind: the shape must still reload as it stands.
			updateNodeContent(doc, at, node.raw);
			return;
	}
}

function divergenceAfterEdit(source: string, gesture: Gesture): string | null {
	const doc = parse(source);
	applyGesture(doc, gesture);
	const divergence = describeConvergence(doc);
	if (divergence) return `${divergence} — after ${gesture.op}@${gesture.at}`;
	const bytes = serialize(doc);
	return serialize(parse(bytes)) === bytes
		? null
		: `bytes not a round-trip: ${JSON.stringify(bytes)}`;
}

describe('G2.13 shape fixed point across load → edit → reload', () => {
	it('every gesture leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbBlankSeparatedGfmDoc, arbGesture, (source, gesture) => {
				const divergence = divergenceAfterEdit(source, gesture);
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	// Non-vacuity: the oracle must actually fire on a shape the parser would fold away, or
	// the property above proves nothing about the class it was written for.
	it('the oracle rejects trivia the parser would read as an extra block', () => {
		const doc = parse('a\n\nb\n');
		doc.children[1].leadingTrivia = '\n\n';
		expect(describeConvergence(doc)).toMatch(/live has 2 children, reparsed has 3/);
	});
});
