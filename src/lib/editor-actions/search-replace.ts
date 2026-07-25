/**
 * Find/replace writes. One mechanism: per affected TOP-LEVEL subtree, reparse its
 * substituted source and commit a count:1 replace at its index. replaceOne is the
 * single-subtree case; replaceAll batches every affected subtree under one undo
 * entry. O(affected subtrees), not O(document). Identity holds for every unaffected
 * top-level block. Aliasing-safe by construction: the live commit replaces a slot
 * with freshly-parsed nodes (the clone is private), never writing through a
 * snapshot-shared node — so no carry-through into a stamped window. Both entries
 * return the count actually replaced — matches on container nodes are skipped.
 */
import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { cloneNode } from '../tree-operations/clone';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
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

/**
 * Substituted text made legal as this kind's raw. This path reparses a private
 * clone rather than routing through `updateNodeContent`, so it is the one write
 * that must apply the kind's rule itself instead of inheriting it from the sink.
 * Reading it off the descriptor keeps the rule (and the kind's name) out of here:
 * a second implementation is what let two cell escapes disagree.
 */
function toLegalRaw(kind: CstNode['kind'], substituted: string): string {
	const normalize = getBlockKindDescriptor(kind).normalizeRawWrite;
	return normalize ? normalize(substituted) : substituted;
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
			const substituted = applyRangesToText(leaf.raw, ranges, template);
			leaf.raw = toLegalRaw(leaf.kind, substituted);
		}
		// A nested leaf's edit must propagate up the clone's materialized container
		// raw before we reparse from `child.raw`; a top-level leaf (rel empty) needs none.
		for (const ranges of byLeaf.values()) {
			const rel = ranges[0].path.slice(1);
			if (rel.length > 0) rebuildAncestryRaw(child, rel);
		}
		const newNodes = parse(child.raw, { grammar: deps.grammar }).children;
		// leadingTrivia is positional (the separator before this block) and lives off
		// `raw`, so parsing `child.raw` alone drops it — carry it onto the first node.
		if (newNodes[0]) newNodes[0].leadingTrivia = child.leadingTrivia;
		return newNodes;
	}

	// A match can land on a container node itself — a childless opaque container is
	// scanned as a leaf — but its raw is metadata-derived (rebuildRaw), and a direct
	// raw substitution would drift from metadata and trip the G1.12/G1.13 staleness
	// probes. Skipped until a kind-aware write path exists (see docs/issues.md).
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
		// One pushed snapshot + per-subtree skip-commits = one undo entry. A throw
		// mid-batch leaves earlier subtrees applied, but this single snapshot still
		// restores the original document on undo (the commit publishes only on
		// success), so recovery stays one Ctrl+Z — intentional.
		controller.pushUndoSnapshotPath(seed.path, seed.start);
		let newBlockCount = 0;
		let applied = 0;
		for (const topIndex of indices) {
			const group = groups.get(topIndex)!;
			let newNodes: CstNode[];
			try {
				newNodes = buildSubtree(topIndex, group, template);
			} catch (error) {
				// buildSubtree reparses and dispatches into the kind's `rebuildRaw` —
				// plugin code, running outside every commit ceremony, so nothing else
				// would attribute this. Report on the ceremony's own channel and stop:
				// the single snapshot above still restores the whole batch in one undo.
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
		// A single-subtree replace operates on one known top-level node, so the
		// aggregate event carries its doc-absolute path (editor.md §12); a batch
		// spanning several subtrees genuinely has no single operated node.
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
