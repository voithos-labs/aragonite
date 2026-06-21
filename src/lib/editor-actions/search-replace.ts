/**
 * Find/replace writes. replaceOne mutates a single leaf surgically (identity
 * preserved). replaceAll rebuilds the whole document in one commit: surgical
 * per-leaf batching is infeasible here because a StructuralChange describes one
 * contiguous window, so non-contiguous matches sharing a container can't commit
 * as one change, and per-leaf sequential commits hit a stale state-registry once
 * the first unshares the shared spine. Whole-doc rebuild sidesteps both at the
 * cost of node identity — acceptable for an explicit batch op (focus is in the
 * bar, not the document).
 */
import type { CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { cloneDocument } from '../tree-operations/clone';
import { rebuildAncestryRaw } from '../schema/container-raw';
import { nodeAt } from '../tree-operations/node-ops';
import { expectStateForNode } from '../reactivity/state-registry';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations/structural-change';
import { applyRangesToText } from '../search/replace';
import type { Match } from '../search/document-scan';
import type { ContainerScope, EditorActionsDeps, UndoController } from './deps';

function asNode(n: CstNode | Document | null): CstNode | null {
	return n && 'raw' in n ? (n as CstNode) : null;
}

export function createSearchReplace(deps: EditorActionsDeps, controller: UndoController) {
	async function replaceOne(match: Match, template: string): Promise<void> {
		const leaf = asNode(nodeAt(deps.doc, match.path));
		if (!leaf) return;
		const newNodes = parse(applyRangesToText(leaf.raw, [match], template)).children;
		const idx = match.path[match.path.length - 1];
		const parentPath = match.path.slice(0, -1);

		if (parentPath.length === 0) {
			await controller.commitStructural({
				snapshot: { blockIndex: idx, offset: match.start },
				mutate: (children) => {
					children.splice(idx, 1, ...newNodes);
					const change = replacePreservingFirst(idx, 1, newNodes.length);
					stampStructuralChange(children, change, deps.sharing);
					return change;
				},
				op: { kind: 'replaceBlock', detail: { count: newNodes.length } }
			});
			return;
		}

		const parent = asNode(nodeAt(deps.doc, parentPath));
		if (!parent) return;
		const state = expectStateForNode(parent);
		await controller.commitContainerStructural({
			containerNode: parent,
			path: parentPath,
			state,
			snapshot: { blockIndex: idx, offset: match.start },
			mutate: (scope: ContainerScope) => {
				scope.children.splice(idx, 1, ...newNodes);
				const change = replacePreservingFirst(idx, 1, newNodes.length);
				stampStructuralChange(scope.children, change, scope.sharing);
				return change;
			},
			op: { kind: 'replaceBlock', detail: { count: newNodes.length }, eventPath: parentPath }
		});
	}

	async function replaceAll(matches: Match[], template: string): Promise<void> {
		if (matches.length === 0) return;

		// Build the replaced document on a private clone, then realize structural
		// changes (splits, kind changes) through one serialize→parse round-trip.
		const clone = cloneDocument(deps.doc);
		const byLeaf = new Map<string, { path: number[]; ranges: Match[] }>();
		for (const m of matches) {
			const key = m.path.join(',');
			let group = byLeaf.get(key);
			if (!group) {
				group = { path: m.path, ranges: [] };
				byLeaf.set(key, group);
			}
			group.ranges.push(m);
		}
		for (const { path, ranges } of byLeaf.values()) {
			const leaf = asNode(nodeAt(clone, path));
			if (leaf) leaf.raw = applyRangesToText(leaf.raw, ranges, template);
		}
		// serialize() reads top-level materialized raw, so containers holding an
		// edited leaf need their raw rebuilt before serialization. rebuildAncestryRaw
		// roots at a container with a relative path — the top-level child is that root.
		for (const { path } of byLeaf.values()) {
			if (path.length > 1) rebuildAncestryRaw(clone.children[path[0]], path.slice(1));
		}
		const newChildren = parse(serialize(clone)).children;

		await controller.commitStructural({
			snapshot: { blockIndex: matches[0].path[0], offset: matches[0].start },
			mutate: (children) => {
				const oldCount = children.length;
				children.splice(0, oldCount, ...newChildren);
				const change: StructuralChange = {
					op: 'replace',
					at: 0,
					count: oldCount,
					newCount: newChildren.length
				};
				stampStructuralChange(children, change, deps.sharing);
				return change;
			},
			op: { kind: 'replaceBlock', detail: { count: newChildren.length } }
		});
	}

	return { replaceOne, replaceAll };
}
