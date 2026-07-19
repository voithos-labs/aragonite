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

function descend(root: CstNode, rel: number[]): CstNode | null {
	let node: CstNode | undefined = root;
	for (const i of rel) node = node?.children?.[i];
	return node ?? null;
}

// GFM table-cell raw uses `|` and newline as delimiters; escape pipes and collapse
// newlines so a replacement carrying either lands as literal text in one cell
// instead of splitting the row or spilling into adjacent cells.
function escapeTableCell(replacement: string): string {
	return replacement.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
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
			const escape = leaf.kind === 'tableCell' ? escapeTableCell : undefined;
			leaf.raw = applyRangesToText(leaf.raw, ranges, template, escape);
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
		return replaceable.length;
	}

	return {
		replaceOne: (match: Match, template: string) => replaceSubtrees([match], template),
		replaceAll: (matches: Match[], template: string) => replaceSubtrees(matches, template)
	};
}
