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
import type { PresentationMode } from '$lib/presentation-mode';

// G2.13: an edit on a loaded document leaves a tree that reloads to its own block shape —
// the load → edit → save → load cycle a consumer runs on every remount. Byte round-trip
// (G2.1) is blind to it: the blank-line loss preserved bytes exactly while dropping a block.

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(424242) } as const;

/**
 * The corpus plus the trailing blank line the parse folds into `doc.suffix`. Drawn here rather
 * than in the shared arbitrary, which every suite's seeds ride on: no source it produces carries
 * one, so every tail-materialization arm in the settle was dead by construction.
 */
const arbDoc = arbBlankSeparatedGfmDoc.chain((source) => fc.constantFrom(source, source + '\n'));

// The gestures whose separator handling the blank-line rule governs: Enter, block delete, a
// content commit, typing into a blank BLOCK, and the join in both directions.
type GestureOp = 'split' | 'delete' | 'update' | 'fill' | 'empty' | 'mergePrev' | 'mergeNext';
type Gesture = { op: GestureOp; at: number; offset: number };

// `fill` is drawn by its own property below rather than joining this list: a fourth arm re-rolls
// every seed of the three-gesture stream, trading the coverage it has for coverage it hasn't.
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
	if (gesture.op === 'mergePrev' || gesture.op === 'mergeNext') {
		return applyMerge(doc, gesture.at, gesture.op);
	}
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
			if (isProseLeaf) {
				const offset = Math.min(gesture.offset, displayLength(node.raw));
				settled(doc, (body) => splitNode(body, at, offset, undefined, mode, undefined).change);
			}
			return;
		case 'delete':
			settled(doc, (body) => deleteNode(body, at));
			return;
		case 'update':
			// Typing into the block, keeping its kind: the shape must still reload as it stands.
			// The content door DOES carry the suffix (`block-edit.updateBlockContent`).
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
 * Backspace and Delete across a block boundary, indexed over the merge-eligible adjacent pairs
 * so the draw always lands on one. Both doors: the forward one reparses the concatenation, the
 * backward one writes prev's deepest prose leaf — different sinks, one shape contract (GH #166).
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
			: mergeWithNext(body, i - 1, undefined, undefined).change
	);
}

/** A prose leaf plus the container holding it and the ancestors whose raw the write rebuilds. */
type LeafSlot = { holder: Document | CstNode; index: number; chain: CstNode[] };

function proseLeafSlots(node: Document | CstNode, chain: CstNode[] = []): LeafSlot[] {
	return (node.children ?? []).flatMap((child, index) => {
		// A list item's body is delimited by the INDENT its marker sets, so blanking a leaf inside
		// one re-reads the bytes the way it does around indented code (the exclusion below).
		if (child.kind === 'listItem') return [];
		if (child.children !== undefined) return proseLeafSlots(child, [...chain, child]);
		const editable = getBlockKindDescriptor(child.kind).supportsInline === true;
		return editable ? [{ holder: node, index, chain }] : [];
	});
}

/**
 * The reverse transition: a block that BECOMES the blank line (GH #96), indexed over the prose
 * leaves so the draw always lands on an editable one. The gesture is what `commitInput` sends
 * for an emptied block — the line ending alone. Container bodies are in the lane: a body head
 * answers to its container's own opener line, which no top-level draw can reach (GH #96 rework).
 */
function applyEmpty(doc: Document, at: number): void {
	const slots = proseLeafSlots(doc);
	if (slots.length === 0) return;
	const { holder, index, chain } = slots[at % slots.length];
	const children = holder.children!;
	const text = trailingLineEnding(children[index].raw);
	// A container body settles inside its own commit scope, which has no document tail to fold.
	if (holder === doc) settled(doc, () => updateNodeContent(doc, index, text).change);
	else {
		const owner = holder as CstNode;
		updateNodeContent({ children, ownerKind: owner.kind, owner }, index, text);
	}
	for (let i = chain.length - 1; i >= 0; i--) {
		getBlockKindDescriptor(chain[i].kind).rebuildRaw?.(chain[i]);
	}
}

/**
 * What a split may not touch: every NON-LINE-ENDING byte must survive. A multiset rather than
 * the string, because the setext rule reorders what survives — the underline moves up to follow
 * the first half; the line-count floor below is what watches the endings themselves.
 */
const survivingBytes = (bytes: string) => [...bytes.replace(/\r?\n/g, '')].sort().join('');
const lineCount = (t: string) => t.split('\n').length;

/**
 * What a JOIN may not spend: every non-whitespace byte survives somewhere in the result.
 * One-directional and whitespace-blind by design — a join legitimately eats the separating
 * blank line (whose bytes can be spaces and tabs) and legitimately MINTS bytes when it lands
 * inside a container, whose continuation markers re-prefix the absorbed lines.
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
 * A join's shape divergence, minus GH #61's class. The two point opposite ways, which is what
 * separates them: a FOLD reads fewer blocks than the tree holds, because indentation beside the
 * survivor's new bytes claims them, and it is pre-existing at every seam (the split lane excludes
 * the same class by kind). A reload that reads MORE is the join's own: a one-node sink installed
 * bytes describing several, which is GH #166 itself.
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
	// GH #95 shipped past both oracles above: the halves it left reload as themselves, and the
	// lines the drop took with them were simply no longer in the document to disagree.
	// A live split closes and reopens the construct it cut, so a delimiter run is legitimately
	// DUPLICATED across the halves; losing one stays forbidden in every mode — or terminal
	// whitespace the screen never painted, declared by the candidate and checked by the verifier.
	const keptBytes =
		mode === 'live'
			? keepsEveryByte(before, bytes)
			: survivingBytes(bytes) === survivingBytes(before);
	if (gesture.op === 'split' && !keptBytes) {
		return `split dropped non-line-ending bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	if (gesture.op === 'split' && lineCount(bytes) < lineCount(before)) {
		return `split dropped a line ending: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	// A truncating join leaves halves that reload as themselves, so the shape oracle above is blind
	// to it: the lost line's bytes are simply no longer there to disagree (GH #166's forward sink).
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

	// GH #73: `update` rewrites a node's OWN bytes, so no gesture above can change a block's
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

	// GH #166: the join had no gesture here at all, so neither sink was ever read back — the
	// forward one dropped every block past the first, the backward one wrote a leaf whose own
	// reload disagreed with it. Its own property for the same reason `fill` has one.
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

	// GH #96: the mirror of the fill. Blanking a leaf beside indentation-delimited content
	// re-reads the bytes, so the content-commit door absorbs the seam its neighbours now make,
	// the way the split and delete doors do (GH #61's class).
	it('emptying a block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'empty', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	/**
	 * DIFFERENTIAL on purpose: the claim the split rewrite owes is that closing and reopening a
	 * construct diverges nowhere the byte-literal cut already does — not that the split seam is
	 * defect-free, which it is not. Over the INLINE corpus, where ~22% of draws actually rewrite
	 * against ~3% of the block-shaped one. What it sees: reload shape, round-trip, and byte loss.
	 * What it cannot see is a marker SURFACING, which the rewrite's own verification and the unit
	 * suite own — a mutation inside the rewrite is caught by that verification before this runs.
	 */
	describe('with the live split rebalancer registered', () => {
		// The slot is register-once, so the arm hands it back rather than leaving the production
		// value installed for whatever file the runner loads into this worker next.
		beforeAll(() => registerLiveSplitRebalancer(rebalanceLiveSplit));
		afterAll(() => __resetLiveSplitRebalancerForTests());

		const arbInlineDoc = fc
			.array(arbInlineSource, { minLength: 1, maxLength: 3 })
			.map((paragraphs) => paragraphs.join('\n\n') + '\n');

		/** The drawn offset wrapped into the target block, so both arms cut at the same place and
		 *  the draw lands INSIDE the constructs rather than clamping past them. */
		function interiorSplit(source: string, gesture: Gesture): Gesture {
			const children = parse(source).children;
			if (children.length === 0) return { ...gesture, op: 'split' };
			const raw = children[gesture.at % children.length].raw;
			return { ...gesture, op: 'split', offset: gesture.offset % (displayLength(raw) + 1) };
		}

		// The collision the two rules make, pinned deterministically rather than left for a seed to
		// draw: the rebalancer drops a block's TERMINAL whitespace (#106) because the screen never
		// painted it, and the byte oracle below forbids losing a byte. The exception is the
		// verifier's own, so the two agree — and it is WHITESPACE-ONLY, which is what keeps a
		// dropped `<`/`>` pair a loss.
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

	// Non-vacuity: the oracle must actually fire on a shape the parser would fold away, or
	// the property above proves nothing about the class it was written for.
	it('the oracle rejects trivia the parser would read as an extra block', () => {
		const doc = parse('a\n\nb\n');
		doc.children[1].leadingTrivia = '\n\n';
		expect(describeConvergence(doc)).toMatch(/live has 2 children, reparsed has 3/);
	});
});
