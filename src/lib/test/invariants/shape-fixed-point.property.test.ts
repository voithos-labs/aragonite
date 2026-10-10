// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { isBlankParagraph, parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import {
	deleteNode,
	mergeIntoPrevDeepLeaf,
	mergeWithNext,
	splitNode,
	updateNodeContent
} from '#lib/tree-operations/index.js';
import { isMergeEligible } from '#lib/schema/merge-rules.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { settled } from '#lib/test/harness/settle-funnel.js';
import { keepsEveryByte } from '#lib/test/harness/live-oracles.js';
import {
	arbBlankSeparatedGfmDoc,
	arbInlineSource,
	arbRespelledContainerDoc,
	freshOrFixedSeed
} from './arbitraries';
import {
	displayLength,
	documentLineEnding,
	firstDisplayLine,
	firstLineEnding,
	isBlankText,
	splitLines,
	ownTrailingLineEnding,
	trailingLineEnding,
	trimTrailingLineEnding
} from '#lib/core/lines.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt, documentBody } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import {
	registerLiveSplitRebalancer,
	__resetLiveSplitRebalancerForTests
} from '#lib/schema/inline-construct-policy.js';
import { rebalanceLiveSplit } from '#lib/components/blocks/text/live-split-rebalance.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { rebuildUnsharedChain } from '#lib/tree-operations/chain-rebuild.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { fixtureReading } from '../harness/fixture-grammar';

// An edit on a loaded document leaves a tree that reloads to the same block shape (G2.13), which
// byte round-trip cannot see: bytes can survive exactly while a block disappears.

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(424242) } as const;

/** The corpus plus the trailing blank line the parse puts into `doc.suffix`, drawn here since the
 *  shared generator never produces one and every suite's seeds depend on it. */
const arbDoc = arbBlankSeparatedGfmDoc.chain((source) =>
	fc.constantFrom(source, source + (firstLineEnding(source) ?? '\n'))
);

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
	// Prose leaves only: a container descends to its leaf and a fence keeps the newline in its body,
	// and a raw-text leaf's halves can rejoin on reload, a separate class from the blank-line rule.
	const isProseLeaf =
		node.children === undefined && getBlockKindDescriptor(node.kind).supportsInline === true;
	switch (gesture.op) {
		case 'split':
			if (isProseLeaf) {
				const offset = Math.min(gesture.offset, displayLength(node.raw));
				settled(
					doc,
					(body) =>
						splitNode(body, at, offset, createSharingState(), fixtureReading({}, mode)).change
				);
			}
			return;
		case 'delete':
			settled(doc, (body) => deleteNode(body, at, defaultGrammarView, createSharingState()));
			return;
		case 'update':
			// Typing into the block, keeping its kind: the shape still has to reload as it stands.
			// The content-write path does carry the suffix (`block-edit.updateBlockContent`).
			settled(
				doc,
				() => updateNodeContent(doc, at, node.raw, defaultGrammarView, createSharingState()).change
			);
			return;
	}
}

/** Typing into a blank block, indexed over the blank blocks so the draw always lands on one, since
 *  `update` rewrites a node's own bytes and so never changes its blankness. */
function applyFill(doc: Document, at: number): void {
	const blanks = doc.children.flatMap((node, i) => (isBlankParagraph(node) ? [i] : []));
	if (blanks.length === 0) return;
	const target = blanks[at % blanks.length];
	const text = 'x' + trailingLineEnding(doc.children[target].raw, documentLineEnding(doc));
	settled(
		doc,
		() => updateNodeContent(doc, target, text, defaultGrammarView, createSharingState()).change
	);
}

/** Backspace and Delete across a block boundary, drawn over the merge-eligible adjacent pairs;
 *  both write the joined text into the surviving block's leaf and remove the one it absorbed. */
function applyMerge(doc: Document, at: number, op: 'mergePrev' | 'mergeNext'): void {
	const pairs = doc.children.flatMap((node, i) =>
		i > 0 && isMergeEligible(doc.children[i - 1].kind, node.kind) ? [i] : []
	);
	if (pairs.length === 0) return;
	const i = pairs[at % pairs.length];
	settled(doc, (body) =>
		op === 'mergePrev'
			? (mergeIntoPrevDeepLeaf(body, i, createSharingState(), fixtureReading())?.change ?? {
					op: 'noop'
				})
			: mergeWithNext(body, i - 1, fixtureReading(), createSharingState()).change
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

/** A prose leaf becoming the blank line, as the typing write sends for an emptied block. Container
 *  bodies are included, since a body's start answers to its container's opener line. */
function applyEmpty(doc: Document, at: number): void {
	const slots = proseLeafSlots(doc);
	if (slots.length === 0) return;
	const slot = slots[at % slots.length];
	writeLeaf(
		doc,
		slot,
		trailingLineEnding(slot.holder.children![slot.index].raw, documentLineEnding(doc))
	);
}

/** A prose leaf's bytes written back as the page holds them, plus its own ending as the surface
 *  write adds it; list items are in, since a task item's first paragraph reads its text apart. */
function applyRetype(doc: Document, at: number): void {
	const slots = proseLeafSlots(doc);
	if (slots.length === 0) return;
	const slot = slots[at % slots.length];
	const node = slot.holder.children![slot.index];
	// The page holds the whole display, a setext underline included.
	writeLeaf(doc, slot, trimTrailingLineEnding(node.raw) + ownTrailingLineEnding(node.raw));
}

function writeLeaf(doc: Document, { holder, index, chain }: LeafSlot, text: string): void {
	const children = holder.children!;
	// A container body is fixed up inside its own commit scope, which has no document tail.
	if (holder === doc)
		settled(
			doc,
			() => updateNodeContent(doc, index, text, defaultGrammarView, createSharingState()).change
		);
	else {
		const owner = holder as CstNode;
		updateNodeContent(
			{ children, owner, lineEnding: documentLineEnding(doc) },
			index,
			text,
			defaultGrammarView,
			createSharingState()
		);
	}
	// The rebuild typing runs, which recomputes the blank line a changed opener line needs above it.
	rebuildUnsharedChain(doc, chain, createSharingState(), null, defaultGrammarView);
}

/** Every non-blank prose leaf's path, at any depth. */
function proseLeafPaths(nodes: readonly CstNode[], path: number[] = []): number[][] {
	return nodes.flatMap((node, i) => {
		if (node.children !== undefined) return proseLeafPaths(node.children, [...path, i]);
		const prose = getBlockKindDescriptor(node.kind).supportsInline === true;
		return prose && !isBlankText(node.raw) ? [[...path, i]] : [];
	});
}

/** A letter typed into a drawn leaf's first line through the keystroke's in-place route: one
 *  line of the document moves, by that letter alone, and the tree reloads as itself. */
function keystrokeMovesOneLine(source: string, pick: number, offset: number): void {
	const { deps } = makeEditorActionsDeps(source);
	const leaves = proseLeafPaths(deps.doc.children);
	if (leaves.length === 0) return;
	const leaf = leaves[pick % leaves.length];
	const owner = leaf.length > 1 ? (blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode) : null;
	const raw = (blockNodeAt(deps.doc, leaf) as CstNode).raw;
	const at = offset % (displayLength(firstDisplayLine(raw).text) + 1);
	const body = owner
		? { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) }
		: documentBody(deps.doc);
	const write = legalizeWrite(
		body,
		leaf.at(-1)!,
		raw.slice(0, at) + 'Q' + raw.slice(at),
		'authored'
	);
	const before = splitLines(serialize(deps.doc)).map((line) => line.raw);
	createLeafTyping(deps, createUndoController(deps)).writeLeafInPlace(docPathFrom(leaf), write, at);

	const after = splitLines(serialize(deps.doc)).map((line) => line.raw);
	const moved = after.flatMap((line, i) => (line === before[i] ? [] : [i]));
	const typedInto = (i: number) =>
		[...after[i].matchAll(/Q/g)].some(
			({ index: k }) => after[i].slice(0, k) + after[i].slice(k + 1) === before[i]
		);
	// A tab the content column cuts can't stay in front of the text, and a table row has its own
	// spelling rule (a pipe-less first cell gains pipes), so those lines may move further.
	const cutsTab = (i: number) => /^[ \t>]*\t/.test(before[i]);
	const inTable = leaf.some(
		(_, depth) => blockNodeAt(deps.doc, leaf.slice(0, depth))?.kind === 'table'
	);
	if (
		after.length !== before.length ||
		moved.length > 1 ||
		moved.some((i) => !typedInto(i) && !cutsTab(i) && !inTable)
	) {
		throw new Error(`${JSON.stringify(source)} at ${leaf}: ${JSON.stringify(after)}`);
	}
	expect(describeConvergence(deps.doc)).toBeNull();
}

/** What a split may not touch: every byte that is not a line ending survives. A sorted multiset,
 *  because the setext rule moves the underline up to follow the first half. */
const survivingBytes = (bytes: string) => [...bytes.replace(/\r?\n/g, '')].sort().join('');
const lineCount = (t: string) => t.split('\n').length;

/** Which line endings `text` holds; an edit on a one-ending document must keep it one-ending. */
function endingMix(text: string): 'none' | 'lf' | 'crlf' | 'mixed' {
	const crlf = /\r\n/.test(text);
	const lf = /(^|[^\r])\n/.test(text);
	if (crlf && lf) return 'mixed';
	return crlf ? 'crlf' : lf ? 'lf' : 'none';
}

/** What a join may not spend: every non-whitespace byte survives, checked one way only, since a
 *  join eats the blank separator and re-prefixes absorbed lines inside a container. */
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

/** A join's shape mismatch, excused only when the reload reads fewer blocks than the tree holds:
 *  neighbouring indentation taking the new bytes, a known class at every join. */
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
	const was = endingMix(before);
	const ending = endingMix(bytes);
	if ((was === 'lf' || was === 'crlf') && ending !== 'none' && ending !== was) {
		return `${gesture.op} wrote a second line ending: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	// A split that drops lines leaves halves that reload as themselves, so only a byte check sees
	// it; a live split may duplicate a delimiter run across the halves, never lose one.
	const keptBytes =
		mode === 'live'
			? keepsEveryByte(before, bytes)
			: survivingBytes(bytes) === survivingBytes(before);
	if (gesture.op === 'split' && !keptBytes) {
		return `split dropped non-line-ending bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	if (gesture.op === 'retype' && bytes !== before) {
		return `retype changed the bytes: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	if (gesture.op === 'split' && lineCount(bytes) < lineCount(before)) {
		return `split dropped a line ending: ${JSON.stringify(before)} → ${JSON.stringify(bytes)}`;
	}
	// A join that truncates leaves halves that reload as themselves, so only a byte check sees it.
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

	// Miss-analysis: `update` never changes a block's blankness, so no gesture reached it (GH #73).
	it('typing into a blank block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'fill', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	// Miss-analysis: the join had no gesture here, so neither of its writes was reloaded (GH #166).
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

	// The mirror of the fill: blanking a leaf beside indentation-delimited content makes the content
	// commit absorb the join its neighbours make, as the split and delete paths do.
	it('emptying a block leaves a tree that reloads to its own shape', () => {
		fc.assert(
			fc.property(arbDoc, fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'empty', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	// G2.16. Miss-analysis: the retype checked content bytes only, and the generator drew
	// every container line in the rebuild's own spelling, so a respelled item never reached it.
	it('writing a leaf its own bytes leaves them and the shape as they were', () => {
		fc.assert(
			fc.property(fc.oneof(arbDoc, arbRespelledContainerDoc), fc.nat({ max: 6 }), (source, at) => {
				const divergence = divergenceAfterEdit(source, { op: 'retype', at, offset: 0 });
				if (divergence) throw new Error(`${JSON.stringify(source)}: ${divergence}`);
			}),
			PARAMS
		);
	});

	it.each(['retype', 'empty'] as const)(
		'%s keeps the shape of a tab-indented item holding a table (#589)',
		(op) => {
			const source =
				'- | H0 |\n\t| --- |\n\tplain words\n\t\n\t\n\t\n\t- foo@bar.com\n\t  \n\t  \n\t  \n\t      code\n\t\n  \n**b**\n';
			expect(divergenceAfterEdit(source, { op, at: 4, offset: 0 })).toBeNull();
		}
	);

	// G2.16. Miss-analysis: no property typed into a container, so a keystroke that respelled every
	// line of its container passed every shape and round-trip check.
	it('a keystroke changes only the line it types on', () => {
		fc.assert(
			fc.property(
				fc.oneof(arbDoc, arbRespelledContainerDoc),
				fc.nat(),
				fc.nat(),
				keystrokeMovesOneLine
			),
			PARAMS
		);
	});

	/** Compared with the byte-literal cut, since the split itself is not defect-free: closing and
	 *  reopening a construct may differ nowhere the literal cut does not. */
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

		// The rebalancer drops trailing whitespace the screen never painted, which the byte check
		// allows only because the verifier makes the same whitespace-only exception.
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
