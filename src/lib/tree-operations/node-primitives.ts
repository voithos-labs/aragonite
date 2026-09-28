/**
 * The parent shapes, node constructors and path walks under every tree op. An op mutating a
 * container's children takes the array as a parameter, never `node.children`, which the caller
 * owns and writes back; a descendant found by walking the live tree is mutated in place after its
 * ancestors are copied (`unshare.ts`), or through `commitMultiScope` when the change is structural.
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { readBlocks } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';
import {
	documentLineEnding,
	ownTrailingLineEnding,
	trailingLineEnding,
	type LineEnding
} from '../core/lines';
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
	/** The container these children belong to; undefined is the document root, which has no rule. */
	owner: CstNode | undefined;
	/** The document's line ending, which every line an op writes into these children takes. */
	lineEnding: LineEnding;
	// The document's trailing blank line, from `documentBody` or a trial's copy; a container keeps
	// its own in `innerSuffix`, reached through `owner`.
	suffix?: string;
};

/** What the content writes accept: a whole `Document` counts as one (the root has no body rule). */
export type BodyParentArg = BodyParent | Document;

/**
 * The document as a body: its children (the commit's working copy, when given) and its trailing
 * blank line, read and written through to the live document so a rollback restores it.
 */
export function documentBody(
	doc: Document,
	children: CstNode[] = doc.children
): Document & BodyParent {
	// No `childIds`: an op that tracks ids on its parent must not splice the live document's array.
	return {
		kind: 'document',
		prefix: doc.prefix,
		children,
		owner: undefined,
		lineEnding: documentLineEnding(doc),
		get suffix() {
			return doc.suffix;
		},
		set suffix(value: string) {
			doc.suffix = value;
		}
	};
}

/**
 * What the separator fix-ups accept: anything that can say where the body starts. Wider than
 * the content writes, since a fix-up writes a line ending, not body text.
 */
export type SeparatorParent = {
	kind?: string;
	suffix?: string;
	children?: CstNode[];
	owner?: CstNode;
};

/** The line ending an op writing into `parent`'s children gives a new line. */
export const parentLineEnding = (parent: BodyParentArg): LineEnding =>
	'lineEnding' in parent ? parent.lineEnding : documentLineEnding(parent);

/**
 * Text made legal as a child's raw inside `owner`'s body. A child's bytes are never the
 * container's own syntax, so the write is always `literal`.
 */
export function normalizeBodyWrite(
	owner: NodeView | undefined,
	raw: string,
	lineEnding: LineEnding
): string {
	if (!owner) return raw;
	const rule = tryGetBlockKindDescriptor(owner.kind)?.bodyWrite;
	return rule ? rule.normalize(raw, { node: owner, mode: 'literal', lineEnding }) : raw;
}

/** {@link normalizeBodyWrite} for a caller holding the parent rather than the owner. */
export const forBody = (parent: BodyParentArg, raw: string): string =>
	normalizeBodyWrite('owner' in parent ? parent.owner : undefined, raw, parentLineEnding(parent));

/**
 * `raw` made legal as `node`'s own bytes before a reparse replaces the node; the rule runs first
 * because it reads the node's metadata as it stands, which the reparse re-derives.
 */
export function normalizeOwnRaw(node: NodeView, raw: string, lineEnding: LineEnding): string {
	const rule = tryGetBlockKindDescriptor(node.kind)?.rawWrite;
	return rule ? rule.normalize(raw, { node, mode: 'literal', lineEnding }) : raw;
}

/**
 * Write `raw` as `node`'s own bytes through its kind's rule, in place. Every write of a leaf's
 * bytes that bypasses the kind's editable element must go through here or {@link normalizeOwnRaw}.
 */
export function writeOwnRaw(
	node: CstNode,
	raw: string,
	lineEnding: LineEnding,
	grammar: GrammarView
): void {
	installOwnRaw(node, normalizeOwnRaw(node, raw, lineEnding), grammar);
}

/** Bytes already made legal for `node`, written in place with its parse-owned metadata. */
export function installOwnRaw(node: CstNode, legal: string, grammar: GrammarView): void {
	node.raw = legal;
	// A context-dependent kind's raw does not reparse to itself, so a fragment parse would only
	// mis-read metadata that was never parse-derived.
	if (tryGetBlockKindDescriptor(node.kind)?.contextDependentKind) return;
	// In place means no reparse replaces the node, so parse-owned metadata re-derives here.
	const reparsed = readBlocks(legal, { grammar, scope: 'fragment' }).children;
	if (reparsed.length === 1 && reparsed[0].kind === node.kind) node.metadata = reparsed[0].metadata;
}

// ── Node constructors ──

/**
 * A fresh object every call, since one instance at two tree positions would share its bytes
 * (G1.9). `lineEnding` is required because a paragraph's raw ends in the document's ending.
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
 * The stand-in for whatever the user types next, the line most likely to continue any block;
 * `probeLineOpensAsProse` checks at runtime that no registered opener claims it.
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

/** Ensure every container has at least one child block, so the cursor always has a target. A
 *  container with no bytes yet backfills its lines in `ending`, the document's. */
export function ensureEditableContainers(node: CstNode, ending: LineEnding): void {
	// A whole-block-focus kind is childless by design: the block itself is the caret target,
	// and a backfilled paragraph its raw cannot account for fails the stale-raw check.
	if (getBlockKindDescriptor(node.kind).blockFocus === 'whole-block') return;
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			// An in-place write on a descendant found by walking, see the file header.
			const chromeKind = reservedChromeKindOf(node.kind);
			const lineEnding = trailingLineEnding(node.raw, ending);
			// A container with a reserved title child re-creates that child too, or the backfilled
			// paragraph would occupy its position (G1.14).
			if (chromeKind !== undefined) {
				// The title child's kind is only known at runtime, so the literal takes the generic cast.
				node.children.push({ kind: chromeKind, leadingTrivia: '', raw: lineEnding } as CstNode);
			}
			// The paragraph holds the container's last line, so an open last line stays open in it.
			const lastLineEnding = node.raw === '' ? lineEnding : ownTrailingLineEnding(node.raw);
			node.children.push(emptyParagraph('', lastLineEnding));
			// The synthesized paragraph's ending already represents the blank `parseBlocks`
			// routed into innerPrefix; keeping both double-counts the line on rebuild.
			node.innerPrefix = '';
		}
		for (const child of node.children) {
			ensureEditableContainers(child, ending);
		}
	}
}
