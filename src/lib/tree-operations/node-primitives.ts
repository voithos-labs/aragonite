/**
 * The parent shapes, node constructors and path walks under every tree op. An op mutating a
 * container's children takes the array as a parameter, never `node.children`, which the caller
 * owns and writes back; a descendant found by walking the live tree is mutated in place after its
 * ancestors are copied (`unshare.ts`), or through `commitMultiScope` when the change is structural.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { parse } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';
import { trailingLineEnding } from '../core/lines';
import { dropSuffixUnderBlankLine } from '../core/inline';
import { getBlockKindDescriptor, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';

// ── Parent shapes and the kind's write rules ──

/** A children array an op mutates structurally: splice, delete, reorder. */
export type NodeParent = { children: CstNode[] };

/**
 * A {@link NodeParent} that names the container owning it, for the owner's `bodyWrite` rule and
 * `innerPrefix`/`innerSuffix`. Nullable, not optional: leaving the owner out is a compile error.
 */
export type BodyParent = NodeParent & {
	ownerKind: AnyBlockKind | undefined;
	owner: CstNode | undefined;
	// Optional, not nullable: only a caller inside a commit may carry the document's trailing
	// blank line, because the fix-up that consumes it appends a block.
	suffix?: string;
};

/** What the content writes accept: a whole `Document` counts as one (the root has no body rule). */
export type BodyParentArg = BodyParent | Document;

/**
 * What the separator fix-ups accept: anything that can say where the body starts. Wider than
 * the content writes, since a fix-up writes a line ending, not body text.
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

/** {@link normalizeBodyWrite} for a caller holding the parent rather than the owner's kind. */
export const forBody = (parent: BodyParentArg, raw: string): string =>
	normalizeBodyWrite(ownerKindOf(parent), raw);

/**
 * `raw` made legal as `node`'s own bytes, for a write that replaces the node with a reparse: the
 * reparse re-derives metadata, so structure the rule restores from the old metadata is applied
 * first. An undrawn suffix under a blank line goes before the kind's own rule runs.
 */
export function normalizeOwnRaw(node: NodeView, raw: string): string {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (!descriptor) return raw;
	const kept = dropSuffixUnderBlankLine(node, raw);
	return descriptor.normalizeRawWrite?.(kept, node) ?? kept;
}

/**
 * Write `raw` as `node`'s own bytes through its kind's rule, in place. Every write of a leaf's
 * bytes that bypasses the kind's editable element must use this or {@link normalizeOwnRaw}.
 */
export function writeOwnRaw(node: CstNode, raw: string, grammar: GrammarView): void {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const legal = normalizeOwnRaw(node, raw);
	node.raw = legal;
	// A context-dependent kind's raw does not reparse to itself, so a fragment parse would only
	// mis-read metadata that was never parse-derived.
	if (descriptor?.contextDependentKind) return;
	// In place means no reparse replaces the node, so parse-owned metadata re-derives here.
	const reparsed = parse(legal, { grammar, scope: 'fragment' }).children;
	if (reparsed.length === 1 && reparsed[0].kind === node.kind) node.metadata = reparsed[0].metadata;
}

// ── Node constructors ──

/**
 * Every argument is required: a paragraph's raw ends in a line ending, so the caller says which
 * document's ending it takes (G4.20). A fresh object every call, or one instance would sit at
 * several tree positions (G1.9).
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

// Structural, not kind-based: a plugin may register `'document'` as a block kind, so only the
// absence of `raw` tells the root apart.
export function isBlockNode(node: CstNode | Document): node is CstNode;
export function isBlockNode(node: NodeView | DocumentView): node is NodeView;
export function isBlockNode(node: NodeView | DocumentView): boolean {
	return 'raw' in node;
}

// ── Grammar stand-in and replacement shape ──

/**
 * The stand-in for whatever the user types next: the line most likely to continue any block, so
 * a trial parse answers for the worst case. Openers are arbitrary code, so
 * `probeLineOpensAsProse` is the runtime check that it still reads as prose.
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
	// and a backfilled paragraph its raw cannot account for fails the stale-raw check.
	if (getBlockKindDescriptor(node.kind).blockFocus === 'whole-block') return;
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			// An in-place write on a descendant found by walking, see the file header.
			const chromeKind = reservedChromeKindOf(node.kind);
			// Backfilled lines are pure line ending, so they take the container's own (G4.20).
			const lineEnding = trailingLineEnding(node.raw);
			// A container with a reserved title child re-creates that child too, or the backfilled
			// paragraph would occupy its position (G1.14).
			if (chromeKind !== undefined) {
				// The title child's kind is only known at runtime, so the literal takes the generic cast.
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
