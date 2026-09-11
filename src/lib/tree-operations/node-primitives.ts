/**
 * The parent shapes, mints and path walks under every tree op. Children-array contract: an op
 * mutating a container's top-level children takes the array as a parameter and mutates that,
 * never `node.children` (the caller owns and republishes it, so a direct splice is overwritten).
 * A descendant found by walking the live tree is the exception: mutate it in place on a
 * caller-unshared spine (`unshare.ts`), a STRUCTURAL one via `commitMultiScope`.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { parse } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';
import { trailingLineEnding } from '../core/lines';
import { getBlockKindDescriptor, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';

// ── Parent shapes and the kind's write rules ──

/** A children array an op mutates structurally: splice, delete, reorder. */
export type NodeParent = { children: CstNode[] };

/**
 * A {@link NodeParent} that has answered which container owns it, for the owner's `bodyWrite`
 * grammar and wrap slots. Nullable, not optional: skipping the question is a compile error.
 */
export type BodyParent = NodeParent & {
	ownerKind: AnyBlockKind | undefined;
	owner: CstNode | undefined;
	// Optional, not nullable: only a ceremony-backed site may carry the document's foldable
	// trailing line, because the settle consuming it appends a block.
	suffix?: string;
};

/** What the byte sinks accept: a whole `Document` IS the answer (the root owns no body grammar). */
export type BodyParentArg = BodyParent | Document;

/**
 * What the separator settles accept: anything that can answer where the body starts. Wider than
 * the byte sinks, since a settle writes a line ending, not body text.
 */
export type SeparatorParent = {
	kind?: string;
	ownerKind?: AnyBlockKind;
	suffix?: string;
	children?: CstNode[];
	owner?: CstNode;
};

const ownerKindOf = (parent: BodyParentArg): AnyBlockKind | undefined =>
	'ownerKind' in parent ? parent.ownerKind : undefined;

/** Text made legal as a child's raw inside a container of kind `ownerKind`. */
export function normalizeBodyWrite(ownerKind: AnyBlockKind | undefined, raw: string): string {
	const owner = ownerKind === undefined ? undefined : tryGetBlockKindDescriptor(ownerKind);
	return owner?.bodyWrite?.normalize(raw) ?? raw;
}

/** {@link normalizeBodyWrite} for a sink holding the parent rather than the owner's kind. */
export const forBody = (parent: BodyParentArg, raw: string): string =>
	normalizeBodyWrite(ownerKindOf(parent), raw);

/**
 * `raw` made legal as `node`'s OWN bytes, for a sink that REPLACES the node with a reparse: the
 * reparse re-derives metadata, so structure the rule restores from the old metadata lands first.
 */
export function normalizeOwnRaw(node: NodeView, raw: string): string {
	return tryGetBlockKindDescriptor(node.kind)?.normalizeRawWrite?.(raw, node) ?? raw;
}

/**
 * Write `raw` as `node`'s OWN bytes through its kind's rule, in place. Every sink writing a
 * leaf's bytes without the kind's surface in front of it owes this or {@link normalizeOwnRaw}.
 */
export function writeOwnRaw(node: CstNode, raw: string, grammar: GrammarView | undefined): void {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const legal = descriptor?.normalizeRawWrite?.(raw, node) ?? raw;
	node.raw = legal;
	// A context-dependent kind's raw does not reparse to itself, so a fragment parse would only
	// mis-read metadata that was never parse-derived.
	if (descriptor?.contextDependentKind) return;
	// In place means no reparse replaces the node, so parse-owned metadata re-derives here.
	const reparsed = parse(legal, { grammar, scope: 'fragment' }).children;
	if (reparsed.length === 1 && reparsed[0].kind === node.kind) node.metadata = reparsed[0].metadata;
}

// ── Node minting ──

/**
 * Every argument is required: a paragraph's raw ENDS in a line ending, so a mint site answers
 * which document it lands in (G4.20). Fresh every call, or a shared instance aliases across
 * tree positions (G1.9).
 */
export function paragraphNode(leadingTrivia: string, text: string, lineEnding: string): CstNode {
	return { kind: 'paragraph', leadingTrivia, raw: text + lineEnding };
}

/** The empty-paragraph placeholder keeping an emptied document or container caret-addressable. */
export function emptyParagraph(leadingTrivia: string, lineEnding: string): CstNode {
	return paragraphNode(leadingTrivia, '', lineEnding);
}

// ── Path resolution ──

// Overloaded rather than view-only so a mutable document yields mutable nodes:
// a walk cannot introduce sharing, so the input's writability is the output's.
export function nodeAt(doc: Document, path: number[]): CstNode | Document | null;
export function nodeAt(doc: DocumentView, path: number[]): NodeView | DocumentView | null;
export function nodeAt(doc: DocumentView, path: number[]): NodeView | DocumentView | null {
	let cur: NodeView | DocumentView = doc;
	for (const idx of path) {
		if (!cur.children || idx < 0 || idx >= cur.children.length) return null;
		cur = cur.children[idx];
	}
	return cur;
}

/** `nodeAt` pre-narrowed through `isBlockNode`: null at the document root or on no match. */
export function blockNodeAt(doc: Document, path: number[]): CstNode | null;
export function blockNodeAt(doc: DocumentView, path: number[]): NodeView | null;
export function blockNodeAt(doc: DocumentView, path: number[]): NodeView | null {
	const node = nodeAt(doc, path);
	return node !== null && isBlockNode(node) ? node : null;
}

// Structural, not kind-based: a plugin may mint `'document'` as a block kind, so only the
// absence of `raw` discriminates.
export function isBlockNode(node: CstNode | Document): node is CstNode;
export function isBlockNode(node: NodeView | DocumentView): node is NodeView;
export function isBlockNode(node: NodeView | DocumentView): boolean {
	return 'raw' in node;
}

// ── Grammar stand-in and replacement shape ──

/**
 * The stand-in for whatever the user types next: the maximally-continuable line, so a probe
 * answers for the worst case. Openers are arbitrary code, so `probeLineOpensAsProse` is the
 * runtime check that it still reads as prose.
 */
export const NEXT_PROSE_LINE = 'x';

/** First node inherits the original block's leadingTrivia; subsequent nodes keep theirs. */
export function normalizeReplacementTrivia(original: CstNode, replacement: CstNode[]): CstNode[] {
	const originalTrivia = original.leadingTrivia ?? '';
	return replacement.map((node, i) => {
		const copy = { ...node };
		copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
		return copy;
	});
}

// ── Editable container backfill ──

/** Ensure every container has at least one child block, so the cursor always has a target. */
export function ensureEditableContainers(node: CstNode): void {
	// A whole-block-focus kind is childless by design: the block itself is the caret target,
	// and a backfilled paragraph its raw can't account for trips opaque-stale-raw.
	if (getBlockKindDescriptor(node.kind).blockFocus === 'whole-block') return;
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			// discovered-descendant mutation, see file header
			const chromeKind = reservedChromeKindOf(node.kind);
			// Backfilled lines are pure line ending, so they take the container's own (G4.20).
			const lineEnding = trailingLineEnding(node.raw);
			// A chrome-declaring container re-mints its child-0 leaf too, or the backfilled
			// paragraph would occupy the reserved slot (G1.14).
			if (chromeKind !== undefined) {
				// Runtime chrome kind, so the mint takes the generic cast.
				node.children.push({ kind: chromeKind, leadingTrivia: '', raw: lineEnding } as CstNode);
			}
			node.children.push(emptyParagraph('', lineEnding));
			// The synthesized paragraph's ending already represents the blank `parseBlocks`
			// routed into innerPrefix; keeping both double-counts the line on rebuild.
			node.innerPrefix = '';
		}
		for (const child of node.children) {
			ensureEditableContainers(child);
		}
	}
}
