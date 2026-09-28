/**
 * Rebuilds container `raw` up a node's ancestors, looking up `descriptor.rebuildRaw`, so a
 * plugin container joins in by declaring one. A container's metadata follows its rebuilt bytes
 * (`docs/design/editor.md` § The container `raw` contract).
 */

import type { AnyBlockKind, CstNode } from '../core/nodes';
import { describeMetadataDivergence } from '../core/metadata-parity';
import { readBlocks } from '../core/parser';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { assignChildIdsDeep, idsForPositions } from '../block-id';
import { perfEnabled, recordContainerKindReparse, recordOpenerLineRead } from '../perf/instruments';
import { tryGetBlockKindDescriptor, type BlockKindDescriptor } from './block-kind-descriptor';
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
	const reading = followBytes(node, rawBefore, grammar);
	// No position to put a new node at, so the node takes its reading in place.
	if (reading.outcome === 'reread') takeReread(node, reading.node);
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
	/** The bytes read as one node of the kind over other children: that node takes the position. */
	| { outcome: 'reread'; node: CstNode }
	/** The bytes read as something other than one node of the kind: `blocks` is that reading. */
	| { outcome: 'diverged'; blocks: CstNode[] };

export interface FollowOptions {
	/** Only the title row changed, which no metadata comes from (`ReservedChrome`). */
	titleRowOnly?: boolean;
	/** A child's bytes stopped reading as one node where they stand, so the whole node is read. */
	whole?: boolean;
}

const KEPT: BytesReading = { outcome: 'kept' };

/** Reads `node`'s bytes as a reload would after a rewrite from `rawBefore`, taking in place the
 *  metadata they give it: the one place that knows which lines a kind's metadata comes from. */
export function followBytes(
	node: CstNode,
	rawBefore: string,
	grammar: GrammarView,
	options: FollowOptions = {}
): BytesReading {
	const contract = tryGetBlockKindDescriptor(node.kind)?.containerContract;
	if (options.whole) return rereadWhole(node, contract, grammar);
	const openerMoved = firstLine(rawBefore) !== firstLine(node.raw);
	// A closing line's ending counts: an opaque container can keep it in metadata.
	const closerMoved = closingLine(rawBefore) !== closingLine(node.raw);
	if (contract === 'opaque' && (closerMoved || (openerMoved && !options.titleRowOnly))) {
		return rereadWhole(node, contract, grammar);
	}
	if (!openerMoved) return KEPT;
	const strip = contract === 'strip';
	if (!strip && !isBlockOpenerRegistered(node.kind)) return KEPT;
	const opened = soleNodeOfKind(readOpenerLine(node.raw, grammar), node.kind);
	// A strip container's metadata is all on its first line, so that line alone re-reads it.
	if (opened) {
		const same = !strip || describeMetadataDivergence(node, opened) === null;
		return same ? KEPT : rereadWhole(node, contract, grammar);
	}
	// A first line that opens another kind changes the reading, for a kind whose opener says so.
	return isBlockOpenerRegistered(node.kind) ? rereadWhole(node, contract, grammar) : KEPT;
}

/**
 * What the grammar opens `line` as, read in isolation: asked of the opener registry and never
 * a kind list, so a kind registered later is covered the day it registers.
 */
export function lineOpensAs(line: string, grammar: GrammarView): AnyBlockKind {
	return readBlocks(`${line}\n`, { grammar, scope: 'fragment' }).children[0]?.kind ?? 'paragraph';
}

const closingLine = (raw: string): string => lastLine(raw) + ownTrailingLineEnding(raw);

function readOpenerLine(raw: string, grammar: GrammarView): CstNode[] {
	if (perfEnabled()) recordOpenerLineRead();
	return readBlocks(`${firstLine(raw)}\n`, { grammar, scope: 'fragment' }).children;
}

/** The one node of `kind` that `blocks` are, or the sole child of the one block wrapping it (a
 *  list item reads back inside a list), or null. */
function soleNodeOfKind(blocks: readonly CstNode[], kind: AnyBlockKind): CstNode | null {
	if (blocks.length !== 1) return null;
	if (blocks[0].kind === kind) return blocks[0];
	const wrapped = blocks[0].children;
	return wrapped?.length === 1 && wrapped[0].kind === kind ? wrapped[0] : null;
}

function rereadWhole(
	node: CstNode,
	contract: BlockKindDescriptor['containerContract'],
	grammar: GrammarView
): BytesReading {
	const blocks = parseContainerRaw(node.raw, grammar);
	const reread = soleNodeOfKind(blocks, node.kind);
	if (!reread) return { outcome: 'diverged', blocks };
	// A strip container's metadata is its line prefix, which decides how every child line reads.
	if (contract === 'strip' && !sameChildren(node, reread))
		return { outcome: 'reread', node: reread };
	takeMetadata(node, reread);
	return KEPT;
}

function sameChildren(live: CstNode, reread: CstNode): boolean {
	const children = live.children ?? [];
	const rereadChildren = reread.children ?? [];
	return (
		(live.innerSuffix ?? '') === (reread.innerSuffix ?? '') &&
		children.length === rereadChildren.length &&
		children.every((child, i) => {
			const other = rereadChildren[i];
			return (
				child.kind === other.kind &&
				child.leadingTrivia === other.leadingTrivia &&
				child.raw === other.raw
			);
		})
	);
}

/**
 * Takes the metadata a parse of `node`'s own bytes derived, so the next rebuild reads what a
 * reload would. False when the parse isn't one block of the node's kind, and nothing is taken.
 */
export function adoptParsedMetadata(node: CstNode, parsed: readonly CstNode[]): boolean {
	if (parsed.length !== 1 || parsed[0].kind !== node.kind) return false;
	takeMetadata(node, parsed[0]);
	return true;
}

function takeMetadata(node: CstNode, reread: CstNode): void {
	// Unchanged metadata keeps its object, since every reader of it re-runs when the object changes.
	if (describeMetadataDivergence(node, reread) === null) return;
	// A fresh object from the parse, so no undo entry shares it.
	node.metadata = reread.metadata;
}

/** A node's reading taken into the node itself: every child position keeps its id. */
function takeReread(node: CstNode, reread: CstNode): void {
	node.metadata = reread.metadata;
	node.children = reread.children;
	node.innerPrefix = reread.innerPrefix;
	node.innerSuffix = reread.innerSuffix;
	node.childSpans = undefined;
	node.childIds = idsForPositions(node.childIds, reread.children?.length ?? 0);
	assignChildIdsDeep(node);
}

/** One parse of a container's own bytes, the cost the kind and metadata re-derive pay. */
export function parseContainerRaw(raw: string, grammar: GrammarView): CstNode[] {
	if (perfEnabled()) recordContainerKindReparse(raw.length);
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
