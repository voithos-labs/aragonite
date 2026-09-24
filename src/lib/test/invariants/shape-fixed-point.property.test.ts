// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '$lib/core/nodes';
import { isBlankParagraph, parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import {
	deleteNode,
	mergeIntoPrevDeepLeaf,
	mergeWithNext,
	splitNode,
	updateNodeContent
} from '$lib/tree-operations';
import { isMergeEligible } from '$lib/schema/merge-rules';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { settled } from '$lib/test/harness/settle-funnel';
import { keepsEveryByte } from '$lib/test/harness/live-oracles';
import { arbBlankSeparatedGfmDoc, arbInlineSource, freshOrFixedSeed } from './arbitraries';
import { displayLength, trailingLineEnding } from '$lib/core/lines';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import {
	registerLiveSplitRebalancer,
	__resetLiveSplitRebalancerForTests
} from '$lib/schema/inline-construct-policy';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import { getContentRange, undrawnSuffix } from '$lib/core/inline';
import type { PresentationMode } from '$lib/presentation-mode';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { rebuildUnsharedChain } from '$lib/tree-operations/chain-rebuild';
import { createSharingState } from '$lib/tree-operations/sharing';

// G2.13: an edit on a loaded document leaves a tree that reloads to the same block shape, which
// is the load, edit, save, load cycle a consumer runs on every remount. Byte round-trip (G2.1)
// cannot see it: bytes can be preserved exactly while a block disappears.

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(424242) } as const;

/**
 * The corpus plus the trailing blank line the parse puts into `doc.suffix`. Drawn here rather than
 * in the shared generator, which every suite's seeds depend on: no source it produces carries one,
 * so every branch that turns that tail into a block went untested.
 */
const arbDoc = arbBlankSeparatedGfmDoc.chain((source) => fc.constantFrom(source, source + '\n'));

// The gestures whose separator handling the blank-line rule governs: Enter, block delete, a
// content commit, typing into a blank block, and the join in both directions.
type GestureOp =
	'split' | 'delete' | 'update' | 'fill' | 'empty' | 'retype' | 'mergePrev' | 'mergeNext';
type Gesture = { op: GestureOp; at: number; offset: number };

// `fill` gets its own property below rather than joining this list: a fourth case re-rolls every
// seed of the three-gesture stream, trading coverage it has for coverage it does not.
const arbGesture: fc.Arbitrary<Gesture> = fc.record({
	op: fc.constantFrom('split', 'delete', 'update'),
	at: fc.nat({ max: 6 }),
	offset: fc.nat({ max: 40 })
});

function applyGesture(doc: Document, gesture: Gesture, mode: PresentationMode | undefined): void {
	const count = doc.children.length;
	if (count === 0) return;
	if (gesture.op === 'fill') return applyFill(doc, gesture.at);
	if (gesture.op === 'empty') return applyEmpty(doc, gesture.at);
	if (gesture.op === 'retype') return applyRetype(doc, gesture.at);
	if (gesture.op === 'mergePrev' || gesture.op === 'mergeNext') {
		return applyMerge(doc, gesture.at, gesture.op);
	}
	const at = gesture.at % count;
	const node: CstNode = doc.children[at];
	// Prose leaves only. A container descends to its leaf and a fence takes the newline into its
	// own body, so neither reaches `splitNode`; the raw-text leaves that do reach it (indented
	// code, html) can split into halves that rejoin on reload, which is GH #61's known class
	// rather than the blank-line rule this property checks.
	const isProseLeaf =
		node.children === undefined && getBlockKindDescriptor(node.kind).supportsInline === true;
	switch (gesture.op) {
		case 'split':
			if (isProseLeaf) {
				const offset = Math.min(gesture.offset, displayLength(node.raw));
				settled(doc, (body) => splitNode(body, at, offset, undefined, mode, undefined).change);
			}
			return;
		case 'delete':
			settled(doc, (body) => deleteNode(body, at));
			return;
		case 'update':
			// Typing into the block, keeping its kind: the shape still has to reload as it stands.
			// The content-write path does carry the suffix (`block-edit.updateBlockContent`).
			settled(doc, () => updateNodeContent(doc, at, node.raw).change);
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
	const text = 'x' + trailingLineEnding(doc.children[target].raw);
	settled(doc, () => updateNodeContent(doc, target, text).change);
}

/**
 * Backspace and Delete across a block boundary, indexed over the merge-eligible adjacent pairs so
 * the draw always lands on one. Both paths: the forward one reparses the concatenation, the
 * backward one writes the previous block's deepest prose leaf. Different writes, one shape
 * contract (GH #166).
 */
function applyMerge(doc: Document, at: number, op: 'mergePrev' | 'mergeNext'): void {
	const pairs = doc.children.flatMap((node, i) =>
		i > 0 && isMergeEligible(doc.children[i - 1].kind, node.kind) ? [i] : []
	);
	if (pairs.length === 0) return;
	const i = pairs[at % pairs.length];
	settled(doc, (body) =>
		op === 'mergePrev'
			? (mergeIntoPrevDeepLeaf(body, i, undefined, undefined, undefined)?.change ?? { op: 'noop' })
			: mergeWithNext(body, i - 1, undefined, undefined, defaultGrammarView).change
	);
}

/** A prose leaf plus the container holding it and the ancestors whose raw the write rebuilds. */
type LeafSlot = { holder: Document | CstNode; index: number; chain: CstNode[] };

function proseLeafSlots(node: Document | CstNode, chain: CstNode[] = []): LeafSlot[] {
	return (node.children ?? []).flatMap((child, index) => {
		if (child.children !== undefined) return proseLeafSlots(child, [...chain, child]);
		const editable = getBlockKindDescriptor(child.kind).supportsInline === true;
		return editable ? [{ holder: node, index, chain }] : [];
	});
}

/**
 * The reverse transition: a block that becomes the blank line (GH #96), indexed over the prose
 * leaves so the draw always lands on an editable one. The gesture is what `commitInput` sends for
 * an emptied block, the line ending alone. Container bodies are included, because the start of a
 * body answers to its container's own opener line, which no top-level draw reaches.
 */
function applyEmpty(doc: Document, at: number): void {
	const slots = proseLeafSlots(doc);
	if (slots.length === 0) return;
	const slot = slots[at % slots.length];
	writeLeaf(doc, slot, trailingLineEnding(slot.holder.children![slot.index].raw));
}

/**
 * A prose leaf's text written back the way a keystroke and its undo commit it: what the DOM holds
 * (up to the content end), the suffix no mode draws, then the line ending. Inside a list item too:
 * a task item's first paragraph reads its text differently from a standalone one.
 */
function applyRetype(doc: Document, at: number): void {
	const slots = proseLeafSlots(doc);
	if (slots.length === 0) return;
	const slot = slots[at % slots.length];
	const node = slot.holder.children![slot.index];
	const domText = node.raw.slice(0, getContentRange(node).end);
	writeLeaf(doc, slot, domText + undrawnSuffix(node) + trailingLineEnding(node.raw));
}

function writeLeaf(doc: Document, { holder, index, chain }: LeafSlot, text: string): void {
	const children = holder.children!;
	// A container body is fixed up inside its own commit scope, which has no document tail.
	if (holder === doc) settled(doc, () => updateNodeContent(doc, index, text).change);
	else {
		const owner = holder as CstNode;
		updateNodeContent({ children, ownerKind: owner.kind, owner }, index, text);
	}
	// The rebuild typing runs, which recomputes the blank line a changed opener line needs above it.
	rebuildUnsharedChain(doc, chain, createSharingState(), null, defaultGrammarView);
}

/**
 * What a split may not touch: every byte that is not a line ending survives. A multiset rather
 * than the string, because the setext rule reorders what survives: the underline moves up to
 * follow the first half. The line-count minimum below watches the endings themselves.
 */
const survivingBytes = (bytes: string) => [...bytes.replace(/\r?\n/g, '')].sort().join('');
const lineCount = (t: string) => t.split('\n').length;

/**
 * What a join may not spend: every non-whitespace byte survives somewhere in the result. It is
 * one-directional and ignores whitespace on purpose: a join legitimately eats the separating blank
 * line, whose bytes can be spaces and tabs, and legitimately adds bytes when it lands inside a
 * container, whose continuation markers re-prefix the absorbed lines.
 */
function keepsEveryContentByte(before: string, after: string): boolean {
	const counted = (text: string) => {
		const counts = new Map<string, number>();
		for (const byte of text.replace(/\s/g, '')) counts.set(byte, (counts.get(byte) ?? 0) + 1);
		return counts;
	};
	const kept = counted(after);
	for (const [byte, n] of counted(before)) {
		if ((kept.get(byte) ?? 0) < n) return false;
	}
	return true;
}

/**
 * A join's shape mismatch, minus GH #61's class. The two point opposite ways, which is what tells
 * them apart: reading fewer blocks than the tree holds means indentation beside the survivor's new
 * bytes claimed them, a known problem at every join (the split property excludes the same class by
 * kind). Reading more blocks is the join's own fault: a one-block write installed bytes describing
 * several, which is GH #166.
 */
function joinDivergence(doc: Document): string | null {
	const divergence = describeConvergence(doc);
	if (!divergence) return null;
	return parse(serialize(doc)).children.length < doc.children.length ? null : divergence;
}

function divergenceAfterEdit(
	source: string,
	gesture: Gesture,
	mode?: PresentationMode
): string | null {
	const doc = parse(source);
	const before = serialize(doc);
	applyGesture(doc, gesture, mode);
	const divergence = gesture.op.startsWith('merge')
		? joinDivergence(doc)
		: describeConvergence(doc);
	if (divergence) return `${divergence} — after ${gesture.op}@${gesture.at}`;
	const bytes = serialize(doc);
	if (serialize(parse(bytes)) !== bytes) return `bytes not a round-trip: ${JSON.stringify(bytes)}`;
	// GH #95 slipped past both checks above: the halves it left reload as themselves, and the lines
	// it dropped were no longer in the document to disagree. A live split closes and reopens the
	// construct it cut, so a delimiter run is legitimately duplicated across the halves; losing one
	// stays forbidden in every mode, except trailing whitespace the screen never painted, which the
	// candidate declares and the verifier checks.
	const keptBytes =
		mode === 'live'
			? keepsEveryByte(before, bytes)
			: survivingBytes(bytes) === survivingBytes(before);
	if (gesture.op === 'split' && !keptBytes) {
		return `split dropped non-line-ending bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	// Content bytes only: a list item's rebuild may change the indentation of its blank lines.
	if (gesture.op === 'retype' && !keepsEveryContentByte(before, bytes)) {
		return `retype changed the bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	if (gesture.op === 'split' && lineCount(bytes) < lineCount(before)) {
		return `split dropped a line ending: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	// A join that truncates leaves halves that reload as themselves, so the shape check above
	// cannot see it: the lost line's bytes are no longer there to disagree (GH #166, forward path).
	if (gesture.op.startsWith('merge') && !keepsEveryContentByte(before, bytes)) {
		return `${gesture.op} dropped content bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	return null;
}

describe('G2.13 shape fixed point across load → edit → reload', () => {
	it('every gesture leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbDoc, arbGesture, (source, gesture) => {
				const divergence = divergenceAfterEdit(source, gesture);
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	// GH #73: `update` rewrites a node's own bytes, so no gesture above can change a block's
	// blankness and the transition the blank-line rule lives on was unreachable by construction.
	it('typing into a blank block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'fill', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	// GH #166: the join had no gesture here at all, so neither write was ever read back: the
	// forward one dropped every block past the first, and the backward one wrote a leaf whose own
	// reload disagreed with it. It gets its own property for the same reason `fill` does.
	it.each(['mergePrev', 'mergeNext'] as const)(
		'%s leaves a tree that reloads to its own shape',
		(op) => {
			fc.assert(
				fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
					const divergence = divergenceAfterEdit(source, { op, at, offset: 0 });
					if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
				}),
				PARAMS
			);
		}
	);

	// GH #96: the mirror of the fill. Blanking a leaf beside indentation-delimited content re-reads
	// the bytes, so the content-commit path absorbs the join its neighbours now make, the way the
	// split and delete paths do (GH #61's class).
	it('emptying a block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'empty', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	it('writing a leaf its own bytes leaves them and the shape as they were', () => {
		fc.assert(
			fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'retype', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	/**
	 * A comparison on purpose: what the split rewrite has to show is that closing and reopening a
	 * construct differs nowhere the byte-literal cut already does, not that the split itself is
	 * defect-free, which it is not. Run over the inline corpus, where about 22% of draws rewrite
	 * against about 3% of the block-shaped one. It sees reload shape, round-trip and byte loss. It
	 * cannot see a marker appearing on screen: the rewrite's own verification and the unit suite
	 * cover that, and a mutation inside the rewrite is caught there before this runs.
	 */
	describe('with the live split rebalancer registered', () => {
		// The registration happens once, so this hands it back rather than leaving the production
		// value installed for whatever file the runner loads into this worker next.
		beforeAll(() => registerLiveSplitRebalancer(rebalanceLiveSplit));
		afterAll(() => __resetLiveSplitRebalancerForTests());

		const arbInlineDoc = fc
			.array(arbInlineSource, { minLength: 1, maxLength: 3 })
			.map((paragraphs) => paragraphs.join('\n\n') + '\n');

		/** The drawn offset wrapped into the target block, so both sides cut at the same place and
		 *  the draw lands inside the constructs rather than clamping past them. */
		function interiorSplit(source: string, gesture: Gesture): Gesture {
			const children = parse(source).children;
			if (children.length === 0) return { ...gesture, op: 'split' };
			const raw = children[gesture.at % children.length].raw;
			return { ...gesture, op: 'split', offset: gesture.offset % (displayLength(raw) + 1) };
		}

		// Where the two rules collide, pinned deterministically rather than left to a seed: the
		// rebalancer drops a block's trailing whitespace because the screen never painted it, and
		// the byte check below forbids losing a byte. The exception is the verifier's own, so the
		// two agree, and it covers whitespace only, which is what keeps a dropped `<`/`>` pair a
		// loss.
		it('a split may drop terminal whitespace the screen never painted (#106)', () => {
			expect(
				divergenceAfterEdit('~~foo~~  \n', { op: 'split', at: 0, offset: 5 }, 'live')
			).toBeNull();
		});

		it('a non-whitespace drop is still a loss, so the exception cannot widen', () => {
			expect(keepsEveryByte('~~foo~~  ', '~~foo~~')).toBe(true);
			expect(keepsEveryByte('<https://example.com> t', 'https://example.com t')).toBe(false);
		});

		it('a mid-line space lost with no terminal run to blame is a loss too', () => {
			expect(keepsEveryByte('a b\n', 'ab\n')).toBe(false);
		});

		it('a live split diverges nowhere the byte-literal split already does', () => {
			fc.assert(
				fc.property(arbInlineDoc, arbGesture, (source, drawn) => {
					const gesture = interiorSplit(source, drawn);
					if (divergenceAfterEdit(source, gesture) !== null) return;
					const divergence = divergenceAfterEdit(source, gesture, 'live');
					if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
				}),
				PARAMS
			);
		});
	});

	// The check has to actually fire on a shape the parser would merge away, or the property above
	// proves nothing about the class it was written for.
	it('the check rejects blank lines the parser would read as an extra block', () => {
		const doc = parse('a\n\nb\n');
		doc.children[1].leadingTrivia = '\n\n';
		expect(describeConvergence(doc)).toMatch(/live has 2 children, reparsed has 3/);
	});
});
