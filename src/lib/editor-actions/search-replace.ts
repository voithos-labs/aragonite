/**
 * Find/replace writes. Per affected TOP-LEVEL subtree, reparse its substituted source
 * and commit a replace at its index: O(affected subtrees), identity held elsewhere,
 * and aliasing-safe because the commit installs freshly-parsed nodes rather than
 * writing through a snapshot-shared one. Returns the count actually replaced.
 */
import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { cloneNode } from '../tree-operations/clone';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { writeOwnRaw } from '../tree-operations/node-ops';
import { rebuildAncestryRaw } from '../schema/container-raw';
import {
	replacePreservingFirst,
	stampStructuralChange
} from '../tree-operations/structural-change';
import { applyRangesToText } from '../search/replace';
import type { Match } from '../search/document-scan';
import type { EditorActionsDeps, UndoController } from './deps';
import { toEditEvent } from '../editor-events';
import { docPathFrom } from '../cursor/coordinate-spaces';

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
			// Reparsing a private clone bypasses `updateNodeContent`, so the kind's own raw
			// rule is applied here rather than inherited from that sink.
			writeOwnRaw(leaf, applyRangesToText(leaf.raw, ranges, template), deps.grammar);
		}
		// A nested leaf's edit must propagate up the clone's materialized container raw
		// before the reparse from `child.raw`; a top-level leaf needs none.
		for (const ranges of byLeaf.values()) {
			const rel = ranges[0].path.slice(1);
			if (rel.length > 0) rebuildAncestryRaw(child, rel);
		}
		const newNodes = parse(child.raw, { grammar: deps.grammar, scope: 'fragment' }).children;
		// leadingTrivia is positional and lives off `raw`, so parsing `child.raw` alone
		// drops it; carry it onto the first node.
		if (newNodes[0]) newNodes[0].leadingTrivia = child.leadingTrivia;
		return newNodes;
	}

	// A match can land on a container node itself, but its raw is metadata-derived, so
	// a direct substitution would drift and trip the G1.12/G1.13 staleness probes.
	// Skipped until a kind-aware write path exists (issue #41).
	function isReplaceable(match: Match): boolean {
		const top: CstNode | undefined = deps.doc.children[match.path[0]];
		const node = top ? descend(top, match.path.slice(1)) : null;
		return node !== null && !getBlockKindDescriptor(node.kind).isContainer;
	}

	async function replaceSubtrees(matches: Match[], template: string): Promise<number> {
		const replaceable = matches.filter(isReplaceable);
		const groups = groupBy(replaceable, (m) => m.path[0]);
		const indices = [...groups.keys()].sort((a, b) => b - a); // last-first keeps lower indices valid
		if (indices.length === 0) return 0;
		const seed = groups.get(indices[indices.length - 1])![0];
		// One pushed snapshot + per-subtree skip-commits = one undo entry, so a throw
		// mid-batch still recovers in one Ctrl+Z. Intentional.
		controller.pushUndoSnapshotPath(seed.path, seed.start);
		let newBlockCount = 0;
		let applied = 0;
		for (const topIndex of indices) {
			const group = groups.get(topIndex)!;
			let newNodes: CstNode[];
			try {
				newNodes = buildSubtree(topIndex, group, template);
			} catch (error) {
				// buildSubtree dispatches into the kind's `rebuildRaw` — plugin code running
				// outside every commit ceremony, so nothing else would attribute this.
				deps.events.emit('error', {
					origin: 'commit',
					error,
					context: { op: 'replaceBlock', path: docPathFrom([topIndex]) }
				});
				break;
			}
			newBlockCount += newNodes.length;
			applied += group.length;
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
		if (applied === 0) return 0;
		// A single-subtree replace has one operated node, so the aggregate event carries
		// its doc-absolute path (editor.md §12); a multi-subtree batch genuinely has none.
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
