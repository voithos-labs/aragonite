/**
 * Rebuilds container `raw` up a node's ancestors, looking up `descriptor.rebuildRaw`, so a
 * plugin container joins in by declaring one. An opaque container's metadata follows its rebuilt
 * bytes (`docs/design/editor.md` § The container `raw` contract).
 */

import type { CstNode } from '../core/nodes';
import { describeMetadataDivergence } from '../core/metadata-parity';
import { readBlocks } from '../core/parser';
import { trimTrailingLineEnding } from '../core/lines';
import { perfEnabled, recordContainerKindReparse } from '../perf/instruments';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import type { GrammarView } from './block-openers';
import type { ChildRawChange } from './child-spans';

/**
 * Rebuild `raw` for every container along `path`, innermost first. The leaf at the end of `path`
 * is not rebuilt: callers change its raw before calling. An empty path rebuilds `root`.
 */
export function rebuildAncestryRaw(root: CstNode, path: number[], grammar: GrammarView): void {
	if (path.length === 0) {
		rebuildContainerRaw(root, grammar);
		return;
	}

	const containers: CstNode[] = [];
	let current = root;
	for (let i = 0; i < path.length - 1; i++) {
		current = current.children![path[i]];
		containers.push(current);
	}

	for (let i = containers.length - 1; i >= 0; i--) {
		rebuildContainerRaw(containers[i], grammar);
	}
	rebuildContainerRaw(root, grammar);
}

/**
 * Calls the `rebuildRaw` on the kind's descriptor, then re-reads an opaque container's metadata
 * if its first or last line moved; throws on a leaf.
 */
export function rebuildContainerRaw(node: CstNode, grammar: GrammarView): void {
	const rebuild = tryGetBlockKindDescriptor(node.kind)?.rebuildRaw;
	if (!rebuild) {
		throw new Error(
			`rebuildContainerRaw: kind "${node.kind}" has no rebuildRaw; only container kinds are valid`
		);
	}
	const rawBefore = node.raw;
	rebuild(node);
	if (tryGetBlockKindDescriptor(node.kind)?.containerContract !== 'opaque') return;
	if (!outerLinesMoved(rawBefore, node.raw)) return;
	adoptParsedMetadata(node, parseContainerRaw(node.raw, grammar));
}

/**
 * The chain rebuild's step, which re-derives kind and metadata itself once it knows whether an
 * outer line moved; a rebuild outside the chain uses {@link rebuildContainerRaw}.
 */
export function rebuildContainerRawIfContainer(node: CstNode, changed?: ChildRawChange): void {
	tryGetBlockKindDescriptor(node.kind)?.rebuildRaw?.(node, changed);
}

// ── Metadata that follows the bytes ──────────────────────────────────────────

/**
 * Takes the metadata a parse of `node`'s own bytes derived, so the next rebuild reads what a
 * reload would. False when the parse isn't one block of the node's kind, and nothing is taken.
 */
export function adoptParsedMetadata(node: CstNode, parsed: readonly CstNode[]): boolean {
	if (parsed.length !== 1 || parsed[0].kind !== node.kind) return false;
	// Unchanged metadata keeps its object, since every reader of it re-runs when the object changes.
	if (describeMetadataDivergence(node, parsed[0]) === null) return true;
	// A fresh object from the parse, so no undo entry shares it.
	node.metadata = parsed[0].metadata;
	return true;
}

/** One parse of a container's own bytes, the cost the kind and metadata re-derive pay. */
export function parseContainerRaw(raw: string, grammar: GrammarView): CstNode[] {
	if (perfEnabled()) recordContainerKindReparse();
	return readBlocks(raw, { grammar, scope: 'fragment' }).children;
}

export function outerLinesMoved(rawBefore: string, rawAfter: string): boolean {
	return firstLine(rawBefore) !== firstLine(rawAfter) || lastLine(rawBefore) !== lastLine(rawAfter);
}

export function firstLine(raw: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? raw : raw.slice(0, nl);
}

/** The container's closing line: its last line carrying bytes, without the ending. */
export function lastLine(raw: string): string {
	const body = trimTrailingLineEnding(raw);
	const nl = body.lastIndexOf('\n');
	return nl < 0 ? body : body.slice(nl + 1);
}
