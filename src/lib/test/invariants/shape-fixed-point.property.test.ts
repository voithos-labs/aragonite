// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '$lib/core/nodes';
import { isBlankParagraph, parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode, splitNode, updateNodeContent } from '$lib/tree-operations';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { arbBlankSeparatedGfmDoc, arbInlineSource, freshOrFixedSeed } from './arbitraries';
import { displayLength, trailingLineEnding } from '$lib/core/lines';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { matchTableDelimiterRow, splitRowCells } from '$lib/core/parsers/table';
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

function applyGesture(doc: Document, gesture: Gesture, mode: PresentationMode | undefined): void {
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
			if (isProseLeaf)
				splitNode(doc, at, Math.min(gesture.offset, displayLength(node.raw)), mode, undefined);
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

/** Indentation alone delimits indented code, at any depth: see the property's own note. */
function holdsIndentedCode(node: Document | CstNode): boolean {
	return (node.children ?? []).some(
		(child) => child.kind === 'indentedCode' || holdsIndentedCode(child)
	);
}

/**
 * A delimiter row claiming MORE columns than the header line above it. The paragraph opener only
 * promotes the pair to a table when the counts agree, so this shape is prose that LOOKS like a
 * table, and cutting it re-reads as a different block run. Asked of the parser's own splitter and
 * delimiter matcher rather than a regex, so the count is the one the opener would have computed.
 */
function holdsWidenedDelimiterRow(source: string): boolean {
	const lines = source.split('\n');
	return lines.some((header, i) => {
		if (!header.includes('|')) return false;
		const delimiter = matchTableDelimiterRow(lines[i + 1] ?? '');
		return delimiter !== null && delimiter.columnCount > splitRowCells(header).length;
	});
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
	const parent = holder === doc ? doc : { children, ownerKind: (holder as CstNode).kind };
	updateNodeContent(parent, index, trailingLineEnding(children[index].raw));
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
 * Every non-line-ending byte of `before` still present in `after` — the live arm's relaxation of
 * the equality above, since closing and reopening a construct DUPLICATES its delimiter run. A
 * multiset over code UNITS: a cut between the halves of a surrogate pair is a real hazard, but a
 * pre-existing and mode-independent one, and code points would report it as a loss here.
 */
function keepsEveryByte(before: string, after: string): boolean {
	const budget = new Map<string, number>();
	for (const byte of after.replace(/\r?\n/g, '').split('')) {
		budget.set(byte, (budget.get(byte) ?? 0) + 1);
	}
	for (const byte of before.replace(/\r?\n/g, '').split('')) {
		const left = budget.get(byte) ?? 0;
		if (left === 0) return false;
		budget.set(byte, left - 1);
	}
	return true;
}

function divergenceAfterEdit(
	source: string,
	gesture: Gesture,
	mode?: PresentationMode
): string | null {
	const doc = parse(source);
	const before = serialize(doc);
	applyGesture(doc, gesture, mode);
	const divergence = describeConvergence(doc);
	if (divergence) return `${divergence} — after ${gesture.op}@${gesture.at}`;
	const bytes = serialize(doc);
	if (serialize(parse(bytes)) !== bytes) return `bytes not a round-trip: ${JSON.stringify(bytes)}`;
	// GH #95 shipped past both oracles above: the halves it left reload as themselves, and the
	// lines the drop took with them were simply no longer in the document to disagree.
	// A live split closes and reopens the construct it cut, so a delimiter run is legitimately
	// DUPLICATED across the halves; losing one stays forbidden in every mode.
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
	return null;
}

describe('G2.13 shape fixed point across load → edit → reload', () => {
	// GH #61, shape-exact: the two measured classes this arm diverges on, both pre-existing and
	// mode-independent — a delimiter row wider than its header, and the indented-code adjacency the
	// `empty` arm below already excludes for the same reason. Both lines come off when #61 closes.
	it('every gesture leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbBlankSeparatedGfmDoc, arbGesture, (source, gesture) => {
				fc.pre(!holdsWidenedDelimiterRow(source) && !holdsIndentedCode(parse(source)));
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
				fc.pre(!holdsIndentedCode(parse(source)));
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
