/**
 * Find/replace writes. One mechanism: per affected TOP-LEVEL subtree, reparse its
 * substituted source and commit a count:1 replace at its index. replaceOne is the
 * single-subtree case; replaceAll batches every affected subtree under one undo
 * entry. O(affected subtrees), not O(document). Identity holds for every unaffected
 * top-level block. Aliasing-safe by construction: the live commit replaces a slot
 * with freshly-parsed nodes (the clone is private), never writing through a
 * snapshot-shared node — so no carry-through into a stamped window.
 */
import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { cloneNode } from '../tree-operations/clone';
import { rebuildAncestryRaw } from '../schema/container-raw';
import {
	replacePreservingFirst,
	stampStructuralChange
} from '../tree-operations/structural-change';
import { applyRangesToText } from '../search/replace';
import type { Match } from '../search/document-scan';
import type { EditorActionsDeps, UndoController } from './deps';
import { toEditEvent } from '../editor-events';

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
			if (leaf) leaf.raw = applyRangesToText(leaf.raw, ranges, template);
		}
		// A nested leaf's edit must propagate up the clone's materialized container
		// raw before we reparse from `child.raw`; a top-level leaf (rel empty) needs none.
		for (const ranges of byLeaf.values()) {
			const rel = ranges[0].path.slice(1);
			if (rel.length > 0) rebuildAncestryRaw(child, rel);
		}
		const newNodes = parse(child.raw).children;
		// leadingTrivia is positional (the separator before this block) and lives off
		// `raw`, so parsing `child.raw` alone drops it — carry it onto the first node.
		if (newNodes[0]) newNodes[0].leadingTrivia = child.leadingTrivia;
		return newNodes;
	}

	async function replaceSubtrees(groups: Map<number, Match[]>, template: string): Promise<void> {
		const indices = [...groups.keys()].sort((a, b) => b - a); // last-first keeps lower indices valid
		if (indices.length === 0) return;
		const seed = groups.get(indices[indices.length - 1])![0];
		controller.pushUndoSnapshot(seed.path[0], seed.start); // one entry for the whole batch
		let total = 0;
		for (const topIndex of indices) {
			const newNodes = buildSubtree(topIndex, groups.get(topIndex)!, template);
			total += newNodes.length;
			await controller.commitStructural({
				snapshot: 'skip', // batch shares the single snapshot pushed above
				mutate: (children) => {
					children.splice(topIndex, 1, ...newNodes);
					const change = replacePreservingFirst(topIndex, 1, newNodes.length);
					stampStructuralChange(children, change, deps.sharing);
					return change;
				}
				// op omitted → no per-commit edit event; one is emitted after the batch
			});
		}
		deps.events.emit(
			'edit',
			toEditEvent({ kind: 'replaceBlock', detail: { count: total } }, [], Date.now())
		);
	}

	return {
		replaceOne: (match: Match, template: string) =>
			replaceSubtrees(
				groupBy([match], (m) => m.path[0]),
				template
			),
		replaceAll: (matches: Match[], template: string) =>
			matches.length === 0
				? Promise.resolve()
				: replaceSubtrees(
						groupBy(matches, (m) => m.path[0]),
						template
					)
	};
}
