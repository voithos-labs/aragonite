/**
 * Find and replace writes. For each affected top-level subtree, reparse its substituted
 * source and commit a replace at its index: one commit per subtree, and safe against undo
 * snapshots because the commit installs freshly parsed nodes rather than writing through a
 * shared one. Returns the count actually replaced.
 */
import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { cloneNode } from '../tree-operations/clone';
import { spliceMany } from '../tree-operations/splice-many';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	normalizeBodyWrite,
	normalizeReplacementTrivia,
	writeOwnRaw
} from '../tree-operations/node-primitives';
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
			// Reparsing a private clone bypasses `updateNodeContent`, so its two byte rules (the
			// kind's own raw rule and the owner's bodyWrite escape) are applied here.
			const owner = rel.length > 0 ? descend(child, rel.slice(0, -1)) : null;
			const substituted = normalizeBodyWrite(
				owner?.kind,
				applyRangesToText(leaf.raw, ranges, template)
			);
			writeOwnRaw(leaf, substituted, deps.reading.grammar);
		}
		// A nested leaf's edit must be written up into the clone's container raws before the
		// reparse from `child.raw`, through the rebuild typing uses, which also recomputes the blank
		// line above a list emptied to its marker. A top-level leaf needs none.
		const cloneSharing = createSharingState();
		for (const ranges of byLeaf.values()) {
			const rel = ranges[0].path.slice(1);
			if (rel.length === 0) continue;
			const chain: CstNode[] = [];
			for (let depth = 1; depth < rel.length; depth++)
				chain.push(descend(child, rel.slice(0, depth))!);
			rebuildUnsharedChain(child, chain, cloneSharing, null, deps.reading.grammar);
			rebuildContainerRaw(child);
		}
		const newNodes = parse(child.raw, {
			grammar: deps.reading.grammar,
			scope: 'fragment'
		}).children;
		// leadingTrivia is positional and lives off `raw`, so parsing `child.raw` alone drops it.
		return normalizeReplacementTrivia(child, newNodes);
	}

	/**
	 * A match can land on a container node itself. A childless one was scanned as a leaf, and
	 * this path reparses rather than writing in place, so the kind re-derives its metadata from
	 * the substituted bytes and nothing goes stale. One with children is excluded: its raw is
	 * rebuilt from theirs, and substituting into it would make the two disagree (G1.12/G1.13).
	 */
	function isReplaceable(match: Match): boolean {
		const top: CstNode | undefined = deps.doc.children[match.path[0]];
		const node = top ? descend(top, match.path.slice(1)) : null;
		if (!node) return false;
		return !getBlockKindDescriptor(node.kind).isContainer || (node.children?.length ?? 0) === 0;
	}

	/**
	 * The one hazard the reparse cannot absorb: a substitution that breaks a container's opener
	 * line comes back as a different kind entirely, a diagram silently becoming a plain code
	 * block. Accepted for leaves, declined here.
	 */
	function keepsItsKind(before: CstNode, after: CstNode[]): boolean {
		// Only where the substitution wrote the container's own raw: a childless one, scanned as
		// a leaf. One with children had a child edited, and a kind change there is the ordinary
		// structural replace every leaf already gets.
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
		// One snapshot for the whole batch, pushed outside any commit, so a batch that applies
		// nothing removes it below; otherwise the next Ctrl+Z would restore nothing.
		const stacksBeforePush = deps.undoManager.getStacks();
		controller.pushUndoSnapshotPath(seed.path, seed.start);
		let newBlockCount = 0;
		let applied = 0;
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
			newBlockCount += newNodes.length;
			applied += group.length;
			await controller.commitStructural({
				snapshot: 'skip', // the batch shares the single snapshot pushed above
				mutate: (children) => {
					spliceMany(children, topIndex, 1, newNodes);
					const change = replacePreservingFirst(topIndex, 1, newNodes.length);
					stampStructuralChange(children, change, deps.sharing);
					return change;
				}
				// op omitted: no per-commit edit event; one is emitted after the batch
			});
		}
		if (applied === 0) {
			deps.undoManager.restoreStacks(stacksBeforePush);
			return 0;
		}
		// A single-subtree replace has one edited node, so the aggregate event carries its
		// document-absolute path (editor.md §12); a multi-subtree batch genuinely has none.
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
