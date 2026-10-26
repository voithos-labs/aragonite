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
import { documentLineEnding, type LineEnding } from '../core/lines';
import { tryGetBlockKindDescriptor, type WriteRule } from '../schema/block-kind-descriptor';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { checkWriteRuleKeepsBytes } from '../invariants/write-rule-keeps-bytes';
import { adoptParsedMetadata } from '../schema/container-raw';
import { spliceMany } from './splice-many';

// ── Parent shapes and the kind's write rules ──

/** A children array an op mutates structurally: splice, delete, reorder. */
export type NodeParent = {
	children: CstNode[];
	/** Called before each write through {@link spliceList}; a keystroke saves its list here. */
	beforeWrite?: () => void;
};

/** The one write to a list of blocks on the fix-up's path (G4.259): `count` blocks at `at`
 *  replaced by `add`, after telling the list's watcher. */
export function spliceList(
	parent: { children?: CstNode[]; beforeWrite?: () => void },
	at: number,
	count: number,
	add: readonly CstNode[]
): void {
	parent.beforeWrite?.();
	spliceMany((parent.children ??= []), at, count, add);
}

/**
 * Longest prefix of `chain` still attached under `root`: a node spliced out mid-commit would
 * rebuild against its emptied children to `raw: ''`, while the ancestors above it still rebuild.
 */
export function attachedChainPrefix(root: NodeParent, chain: CstNode[]): CstNode[] {
	let parentChildren = root.children;
	for (let i = 0; i < chain.length; i++) {
		if (!parentChildren.includes(chain[i])) return chain.slice(0, i);
		parentChildren = chain[i].children ?? [];
	}
	return chain;
}

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

/** A content write's parent as a body: a whole document reads as its own body. */
export function asBody(parent: BodyParentArg): BodyParent {
	return 'owner' in parent ? parent : documentBody(parent);
}

/** The body under `node`, a container found by walking the live tree, or the document itself. */
export function bodyUnder(node: CstNode | Document, lineEnding: LineEnding): BodyParent {
	return isBlockNode(node) ? { children: node.children!, owner: node, lineEnding } : asBody(node);
}

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
 * The write rule `node`'s kind declares, the one way to run it: a rule never deletes bytes outside
 * the written span (G1.143), which a dev build checks on every write it makes legal.
 */
export function kindWriteRule(node: NodeView): WriteRule | undefined {
	const rule = tryGetBlockKindDescriptor(node.kind)?.rawWrite;
	// A production build runs the rule bare, so a keystroke pays nothing for the check.
	if (!rule || !devChecksOn) return rule;
	return {
		...rule,
		normalize: (raw, ctx) => {
			const stored = rule.normalize(raw, ctx);
			assertInvariant('write-rule-keeps-bytes', () =>
				checkWriteRuleKeepsBytes(ctx.node, raw, stored)
			);
			return stored;
		}
	};
}

/**
 * `raw` made legal as `node`'s own bytes before a reparse replaces the node; the rule runs first
 * because it reads the node's metadata as it stands, which the reparse re-derives.
 */
export function normalizeOwnRaw(node: NodeView, raw: string, lineEnding: LineEnding): string {
	const rule = kindWriteRule(node);
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
	adoptParsedMetadata(node, readBlocks(legal, { grammar, scope: 'fragment' }).children);
}

// ── Node constructors ──

/**
 * A fresh object every call, since one instance at two tree positions would share its bytes
 * (G1.9). `lineEnding` is required because a paragraph's raw ends in the document's ending.
 */
export function paragraphNode(leadingTrivia: string, text: string, lineEnding: string): CstNode {
	return { kind: 'paragraph', leadingTrivia, raw: text + lineEnding };
}

export function emptyParagraph(leadingTrivia: string, lineEnding: string): CstNode {
	return paragraphNode(leadingTrivia, '', lineEnding);
}

// ── Path resolution ──

// Overloaded rather than view-only so a mutable document yields mutable nodes:
// a walk cannot introduce sharing, so the input's writability is the output's.
export function nodeAt(doc: Document, path: readonly number[]): CstNode | Document | null;
export function nodeAt(doc: DocumentView, path: readonly number[]): NodeView | DocumentView | null;
export function nodeAt(doc: DocumentView, path: readonly number[]): NodeView | DocumentView | null {
	let cur: NodeView | DocumentView = doc;
	for (const idx of path) {
		if (!cur.children || idx < 0 || idx >= cur.children.length) return null;
		cur = cur.children[idx];
	}
	return cur;
}

/** The block at `path`, or null for a path that leads nowhere and for the empty path, which is
 *  the document itself. */
export function blockNodeAt(doc: Document, path: readonly number[]): CstNode | null;
export function blockNodeAt(doc: DocumentView, path: readonly number[]): NodeView | null;
export function blockNodeAt(doc: DocumentView, path: readonly number[]): NodeView | null {
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
