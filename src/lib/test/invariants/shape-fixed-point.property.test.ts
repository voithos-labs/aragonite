import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '$lib/core/nodes';
import { isBlankParagraph, parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode, splitNode, updateNodeContent } from '$lib/tree-operations';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { arbBlankSeparatedGfmDoc, freshOrFixedSeed } from './arbitraries';
import { displayLength, trailingLineEnding } from '$lib/core/lines';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

// G2.13: an edit on a loaded document leaves a tree that reloads to its own block shape —
// the load → edit → save → load cycle a consumer runs on every remount. Byte round-trip
// (G2.1) is blind to it: the blank-line loss preserved bytes exactly while dropping a block.

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(424242) } as const;

// The gestures whose separator handling the blank-line rule governs: Enter, block delete, a
// content commit, and typing into a blank BLOCK. A deep-leaf merge writes a leaf's raw without
// reparsing its kind, a separate contract this oracle would report against.
type Gesture = { op: 'split' | 'delete' | 'update' | 'fill' | 'empty'; at: number; offset: number };

// `fill` is drawn by its own property below rather than joining this list: a fourth arm re-rolls
// every seed of the three-gesture stream, trading the coverage it has for coverage it hasn't.
const arbGesture: fc.Arbitrary<Gesture> = fc.record({
	op: fc.constantFrom('split', 'delete', 'update'),
	at: fc.nat({ max: 6 }),
	offset: fc.nat({ max: 40 })
});

function applyGesture(doc: Document, gesture: Gesture): void {
	const count = doc.children.length;
	if (count === 0) return;
	if (gesture.op === 'fill') return applyFill(doc, gesture.at);
	if (gesture.op === 'empty') return applyEmpty(doc, gesture.at);
	const at = gesture.at % count;
	const node: CstNode = doc.children[at];
	// Prose leaves only. A container descends to its leaf and a fence takes the newline into
	// its own body, so neither reaches splitNode; the raw-text leaves that DO reach it (indented
	// code, html) can split into halves that rejoin on reload, which is GH #61's pre-existing
	// class rather than the blank-line rule this oracle guards.
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

/**
 * Typing into a blank block, indexed over the blank blocks so the draw always lands on one:
 * `update` rewrites a node's own bytes and so can never change its blankness, which left the
 * transition the blank-line rule lives on unreachable by construction (GH #73).
 */
function applyFill(doc: Document, at: number): void {
	const blanks = doc.children.flatMap((node, i) => (isBlankParagraph(node) ? [i] : []));
	if (blanks.length === 0) return;
	const target = blanks[at % blanks.length];
	updateNodeContent(doc, target, 'x' + trailingLineEnding(doc.children[target].raw));
}

/**
 * The reverse transition: a block that BECOMES the blank line (GH #96), indexed over the prose
 * leaves so the draw always lands on an editable one. The gesture is what `commitInput` sends
 * for an emptied block — the line ending alone.
 */
function applyEmpty(doc: Document, at: number): void {
	const leaves = doc.children.flatMap((node, i) =>
		node.children === undefined && getBlockKindDescriptor(node.kind).supportsInline === true
			? [i]
			: []
	);
	if (leaves.length === 0) return;
	const target = leaves[at % leaves.length];
	updateNodeContent(doc, target, trailingLineEnding(doc.children[target].raw));
}

/**
 * What a split may not touch: every NON-LINE-ENDING byte must survive. A multiset rather than
 * the string, because the setext rule reorders what survives — the underline moves up to follow
 * the first half; the line-count floor below is what watches the endings themselves.
 */
const survivingBytes = (bytes: string) => [...bytes.replace(/\r?\n/g, '')].sort().join('');
const lineCount = (t: string) => t.split('\n').length;

function divergenceAfterEdit(source: string, gesture: Gesture): string | null {
	const doc = parse(source);
	const before = serialize(doc);
	applyGesture(doc, gesture);
	const divergence = describeConvergence(doc);
	if (divergence) return `${divergence} — after ${gesture.op}@${gesture.at}`;
	const bytes = serialize(doc);
	if (serialize(parse(bytes)) !== bytes) return `bytes not a round-trip: ${JSON.stringify(bytes)}`;
	// GH #95 shipped past both oracles above: the halves it left reload as themselves, and the
	// lines the drop took with them were simply no longer in the document to disagree.
	if (gesture.op === 'split' && survivingBytes(bytes) !== survivingBytes(before)) {
		return `split dropped non-line-ending bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	if (gesture.op === 'split' && lineCount(bytes) < lineCount(before)) {
		return `split dropped a line ending: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	return null;
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

	// GH #73: `update` rewrites a node's OWN bytes, so no gesture above can change a block's
	// blankness and the transition the blank-line rule lives on was unreachable by construction.
	it('typing into a blank block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbBlankSeparatedGfmDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'fill', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	// GH #96: the mirror of the fill. Documents holding indented code sit out — indentation alone
	// delimits it, so blanking a neighbour genuinely re-reads the bytes (GH #61's class) and no
	// separator settle can hold that.
	it('emptying a block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbBlankSeparatedGfmDoc, fc.nat({ max: 6 }), (source, at) => {
				fc.pre(!parse(source).children.some((node) => node.kind === 'indentedCode'));
				const divergence = divergenceAfterEdit(source, { op: 'empty', at, offset: 0 });
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
