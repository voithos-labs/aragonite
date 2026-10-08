/**
 * Find and replace writes. For each affected top-level subtree, reparse its substituted
 * source and commit a replace at its index: one commit per subtree, and safe against undo
 * snapshots because the commit installs freshly parsed nodes rather than writing through a
 * shared one. Returns the count actually replaced.
 */
import type { CstNode } from '../core/nodes';
import { readBlocks } from '../core/parser';
import { cloneNode } from '../tree-operations/clone';
import { spliceMany } from '../tree-operations/splice-many';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { installOwnRaw, normalizeReplacementTrivia } from '../tree-operations/node-primitives';
import { legalizeWrite, type WriteTarget } from '../tree-operations/content-write';
import { rebuildContainerRaw } from '../schema/container-raw';
import { rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
import { createSharingState } from '../tree-operations/sharing';
import {
	replacePreservingFirst,
	stampStructuralChange
} from '../tree-operations/structural-change';
import { applyRangesToText } from '../search/replace';
import type { Match } from '../search/document-scan';
import type { EditorActionsDeps, UndoController } from './deps';
import { toEditEvent } from '../editor-events';
import { docPathFrom } from '../caret/coordinate-spaces';
import { documentLineEnding } from '../core/lines';

function descend(root: CstNode, rel: number[]): CstNode | null {
	let node: CstNode | undefined = root;
	for (const i of rel) node = node?.children?.[i];
	return node ?? null;
}

function groupBy<K>(matches: Match[], key: (m: Match) => K): Map<K, Match[]> {
	const groups = new Map<K, Match[]>();
	for (const m of matches) {
		const k = key(m);
		let g = groups.get(k);
		if (!g) {
			g = [];
			groups.set(k, g);
		}
		g.push(m);
	}
	return groups;
}

export function createSearchReplace(deps: EditorActionsDeps, controller: UndoController) {
	// Reparse top-level child `topIndex` with its descendant matches substituted.
	function buildSubtree(topIndex: number, matches: Match[], template: string): CstNode[] {
		const child = cloneNode(deps.doc.children[topIndex]);
		const byLeaf = groupBy(matches, (m) => m.path.slice(1).join(','));
		for (const ranges of byLeaf.values()) {
			const rel = ranges[0].path.slice(1);
			const leaf = descend(child, rel);
			if (!leaf) continue;
			// Reparsing a private clone bypasses `updateNodeContent`, so the write rule it runs (the
			// kind's own, then the container's) is applied here.
			const owner = rel.length > 0 ? descend(child, rel.slice(0, -1)) : null;
			const target: WriteTarget = owner?.children
				? { children: owner.children, owner, lineEnding: documentLineEnding(deps.doc) }
				: deps.doc;
			const index = owner ? rel[rel.length - 1] : topIndex;
			const substituted = applyRangesToText(leaf.raw, ranges, template);
			installOwnRaw(
				leaf,
				legalizeWrite(target, index, substituted, 'literal').text,
				deps.reading.grammar
			);
		}
		// Before the reparse from `child.raw`, a nested leaf's edit is written up into the clone's
		// container raws by the same rebuild typing uses; a top-level leaf needs none.
		const cloneSharing = createSharingState();
		for (const ranges of byLeaf.values()) {
			const rel = ranges[0].path.slice(1);
			if (rel.length === 0) continue;
			const chain: CstNode[] = [];
			for (let depth = 1; depth < rel.length; depth++)
				chain.push(descend(child, rel.slice(0, depth))!);
			rebuildUnsharedChain(child, chain, cloneSharing, null, deps.reading.grammar);
			rebuildContainerRaw(child, deps.reading.grammar);
		}
		const newNodes = readBlocks(child.raw, {
			grammar: deps.reading.grammar,
			scope: 'fragment'
		}).children;
		// leadingTrivia is positional and lives off `raw`, so parsing `child.raw` alone drops it.
		return normalizeReplacementTrivia(child, newNodes);
	}

	/** A childless container matched as a leaf is reparsed, so its metadata follows the new bytes;
	 *  one with children is excluded, as its raw is rebuilt from theirs. */
	function isReplaceable(match: Match): boolean {
		const top: CstNode | undefined = deps.doc.children[match.path[0]];
		const node = top ? descend(top, match.path.slice(1)) : null;
		if (!node) return false;
		return !getBlockKindDescriptor(node.kind).isContainer || (node.children?.length ?? 0) === 0;
	}

	/** A substitution that breaks a container's opener line reparses as another kind (a diagram
	 *  becoming a code block). Leaves accept that; a container's replace is declined. */
	function keepsItsKind(before: CstNode, after: CstNode[]): boolean {
		// Only a childless container had its own raw substituted; in one with children a child
		// was edited, and a kind change there is the ordinary structural replace.
		const childless = (before.children?.length ?? 0) === 0;
		if (!childless || !getBlockKindDescriptor(before.kind).isContainer) return true;
		return after.length === 1 && after[0].kind === before.kind;
	}

	async function replaceSubtrees(matches: Match[], template: string): Promise<number> {
		const replaceable = matches.filter(isReplaceable);
		const groups = groupBy(replaceable, (m) => m.path[0]);
		const indices = [...groups.keys()].sort((a, b) => b - a); // last-first keeps lower indices valid
		if (indices.length === 0) return 0;
		const seed = groups.get(indices[indices.length - 1])![0];
		let newBlockCount = 0;
		let applied = 0;
		// One entry for the whole batch, and none when it applies nothing.
		await controller.undoStep({ path: docPathFrom(seed.path), offset: seed.start }, async () => {
			for (const topIndex of indices) {
				const group = groups.get(topIndex)!;
				let newNodes: CstNode[];
				try {
					newNodes = buildSubtree(topIndex, group, template);
				} catch (error) {
					// buildSubtree calls the kind's `rebuildRaw`, plugin code running outside any
					// commit, so nothing else would report this error.
					deps.events.emit('error', {
						origin: 'commit',
						error,
						context: { op: 'replaceBlock', path: docPathFrom([topIndex]) }
					});
					break;
				}
				if (!keepsItsKind(deps.doc.children[topIndex], newNodes)) continue;
				const wrote = await controller.commitStructural({
					snapshot: { path: docPathFrom([topIndex]), offset: 0 },
					mutate: (children) => {
						spliceMany(children, topIndex, 1, newNodes);
						const change = replacePreservingFirst(topIndex, 1, newNodes.length);
						stampStructuralChange(children, change, deps.sharing);
						return change;
					}
					// op omitted: no per-commit edit event; one is emitted after the batch
				});
				if (!wrote) continue;
				newBlockCount += newNodes.length;
				applied += group.length;
			}
		});
		if (applied === 0) return 0;
		// A single-subtree replace names its block's path in the event; a multi-subtree batch has none.
		const eventPath = indices.length === 1 ? docPathFrom([indices[0]]) : [];
		deps.events.emit(
			'edit',
			toEditEvent({ kind: 'replaceBlock', detail: { count: newBlockCount } }, eventPath, Date.now())
		);
		return applied;
	}

	return {
		replaceOne: (match: Match, template: string) => replaceSubtrees([match], template),
		replaceAll: (matches: Match[], template: string) => replaceSubtrees(matches, template)
	};
}
