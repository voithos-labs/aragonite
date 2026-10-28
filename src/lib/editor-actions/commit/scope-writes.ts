/**
 * The writes a commit scope hands its mutation below its own list: copying a path, writing a leaf
 * and splicing a list there. The commit rebuilds every path a mutation owned once it returns, so a
 * mutation never copies, fixes up or rebuilds a deep path itself.
 */

import type { CstNode, Document } from '../../core/nodes';
import type { LineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import type { ContainerScope } from '../../action-contracts';
import type { BodyParent } from '../../tree-operations/node-primitives';
import type { SharingState } from '../../tree-operations/sharing';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import { spliceFixedUp } from '../../tree-operations/fix-up/apply';
import { updateNodeContent } from '../../tree-operations/content-write';
import { recordChildIdsChange } from '../../tree-operations/structural-change';
import {
	rebuildUnsharedChain,
	sharedChainLevels,
	type ContainerReclassification
} from '../../tree-operations/chain-rebuild';
import { attachedChainPrefix } from '../../tree-operations/node-primitives';

export interface ScopeWriter extends Pick<ContainerScope, 'own' | 'writeLeaf' | 'splice'> {
	/** The scope's list, which every path below it starts from. */
	readonly body: BodyParent;
	/** The paths the mutation owned below the scope and their nodes, outermost first. */
	readonly owned: readonly OwnedPath[];
	/** The lists a leaf write ran its fix-up in, by their children arrays. */
	readonly settledLists: ReadonlySet<readonly CstNode[]>;
}

export interface OwnedPath {
	path: readonly number[];
	chain: CstNode[];
}

/** The writes below `root`, the scope's own node or the document's working body. */
export function createScopeWriter(
	root: CstNode | (Document & BodyParent),
	sharing: SharingState,
	grammar: GrammarView,
	lineEnding: LineEnding
): ScopeWriter {
	const children = root.children!;
	const body: BodyParent = 'owner' in root ? root : { children, owner: root, lineEnding };
	const owned: OwnedPath[] = [];
	const settledLists = new Set<readonly CstNode[]>();

	const below = (rel: readonly number[]): CstNode[] => {
		const chain = ensureUnsharedPath({ children }, [...rel], sharing);
		// A short chain stops above a node an undo entry may still share, so nothing is written there.
		if (chain.length !== rel.length) {
			throw new Error(`commit scope: no node at [${rel.join(',')}]`);
		}
		return chain;
	};

	return {
		body,
		owned,
		settledLists,
		own(rel) {
			const chain = below(rel);
			if (chain.length > 0) owned.push({ path: [...rel], chain });
			return chain;
		},
		writeLeaf(rel, write) {
			// The leaf's own bytes are the write's; the containers above it are the commit's.
			const chain = below(rel);
			const holder = chain.length > 1 ? chain[chain.length - 2] : null;
			if (holder) owned.push({ path: rel.slice(0, -1), chain: chain.slice(0, -1) });
			const list = holder ? { children: holder.children!, owner: holder, lineEnding } : body;
			settledLists.add(list.children);
			const settled = updateNodeContent(list, rel[rel.length - 1], write, grammar, sharing);
			recordChildIdsChange(holder ?? root, settled.change);
			return settled;
		},
		splice(rel, at, count, add) {
			const chain = below(rel);
			const parent = chain.length > 0 ? chain[chain.length - 1] : root;
			spliceFixedUp(parent, at, count, add, grammar, sharing, lineEnding);
		}
	};
}

/** Rebuilds every path the writers owned, deepest first and each container once, before the fix-up
 *  reads their bytes; a node reading as other blocks lands in `readsWhole` for a later pass. */
export function rebuildOwnedChains(
	writers: readonly ScopeWriter[],
	sharing: SharingState,
	grammar: GrammarView,
	readsWhole?: Set<CstNode>
): ContainerReclassification[] {
	const chains = writers.flatMap(({ body, owned }) =>
		owned
			.map(({ chain }) => ({ root: body, chain: attachedChainPrefix(body, chain) }))
			.sort((a, b) => b.chain.length - a.chain.length)
	);
	const levels = sharedChainLevels(
		chains.map((o) => o.chain),
		readsWhole
	);
	return chains.flatMap(({ root, chain }, i) =>
		rebuildUnsharedChain(root, chain, sharing, null, grammar, undefined, levels[i])
	);
}
