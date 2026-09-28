/**
 * Rebuilds container `raw` up a node's ancestors, looking up `descriptor.rebuildRaw`, so a
 * plugin container joins in by declaring one. A container's metadata follows its rebuilt bytes
 * (`docs/design/editor.md` § The container `raw` contract).
 */

import type { AnyBlockKind, CstNode } from '../core/nodes';
import { describeMetadataDivergence } from '../core/metadata-parity';
import { readBlocks } from '../core/parser';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { perfEnabled, recordContainerKindReparse } from '../perf/instruments';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { isBlockOpenerRegistered, type GrammarView } from './block-openers';
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
 * Calls the `rebuildRaw` on the kind's descriptor, then re-reads the metadata a moved outer line
 * may carry; throws on a leaf.
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
	followBytes(node, rawBefore, grammar);
}

/**
 * The chain rebuild's step, which re-derives kind and metadata itself once it knows whether an
 * outer line moved; a rebuild outside the chain uses {@link rebuildContainerRaw}.
 */
export function rebuildContainerRawIfContainer(node: CstNode, changed?: ChildRawChange): void {
	tryGetBlockKindDescriptor(node.kind)?.rebuildRaw?.(node, changed);
}

// ── Metadata that follows the bytes ──────────────────────────────────────────

/** What a container's position holds once its rewritten bytes are read as a reload reads them. */
export type BytesReading =
	| { outcome: 'kept' }
	/** The bytes no longer read as one node of the kind: `blocks` is what they read as. */
	| { outcome: 'diverged'; blocks: CstNode[] };

export interface FollowOptions {
	/** Only the title row changed, which no metadata comes from (`ReservedChrome`). */
	titleRowOnly?: boolean;
}

const KEPT: BytesReading = { outcome: 'kept' };

/**
 * Reads `node`'s bytes as a reload would after a rewrite from `rawBefore`, taking in place the
 * metadata they give it: the one place that knows which lines a kind's metadata comes from.
 */
export function followBytes(
	node: CstNode,
	rawBefore: string,
	grammar: GrammarView,
	options: FollowOptions = {}
): BytesReading {
	const opaque = tryGetBlockKindDescriptor(node.kind)?.containerContract === 'opaque';
	const openerMoved = firstLine(rawBefore) !== firstLine(node.raw);
	// A closing line's ending counts: an opaque container can keep it in metadata.
	const closerMoved = closingLine(rawBefore) !== closingLine(node.raw);
	if (opaque && (closerMoved || (openerMoved && !options.titleRowOnly))) {
		return rereadWhole(node, grammar);
	}
	// Otherwise only an opener line that now opens another kind changes the reading.
	if (!openerMoved || !isBlockOpenerRegistered(node.kind)) return KEPT;
	if (lineOpensAs(firstLine(node.raw), grammar) === node.kind) return KEPT;
	return rereadWhole(node, grammar);
}

/**
 * What the grammar opens `line` as, read in isolation: asked of the opener registry and never
 * a kind list, so a kind registered later is covered the day it registers.
 */
export function lineOpensAs(line: string, grammar: GrammarView): AnyBlockKind {
	return readBlocks(`${line}\n`, { grammar, scope: 'fragment' }).children[0]?.kind ?? 'paragraph';
}

const closingLine = (raw: string): string => lastLine(raw) + ownTrailingLineEnding(raw);

function rereadWhole(node: CstNode, grammar: GrammarView): BytesReading {
	const blocks = parseContainerRaw(node.raw, grammar);
	return adoptParsedMetadata(node, blocks) ? KEPT : { outcome: 'diverged', blocks };
}

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
