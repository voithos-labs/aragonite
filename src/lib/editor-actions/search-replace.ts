/**
 * Find and replace writes. For each affected top-level subtree, reparse its substituted
 * source and commit a replace at its index: one commit per subtree, and safe against undo
 * snapshots because the commit installs freshly parsed nodes rather than writing through a
 * shared one. Returns the count actually replaced.
 */
import type { CstNode } from '../core/nodes';
import { cloneNode } from '../tree-operations/clone';
import { spliceMany } from '../tree-operations/splice-many';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { blockFacts } from '../schema/block-facts';
import { installOwnRaw, normalizeReplacementTrivia } from '../tree-operations/node-primitives';
import { readAsOpened } from '../schema/opened-reading';
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
import { emitEdit } from './commit/emit-edit';
import { docPathFrom } from '../core/coordinate-spaces';
import { documentLineEnding } from '../core/lines';
import { keepUnchanged } from '../block-id';

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
	// Reparse top-level child `topIndex` with its descendant matches substituted; `applied` counts
	// the matches installed, and a leaf that would lose its kind keeps its bytes.
	function buildSubtree(
		topIndex: number,
		matches: Match[],
		template: string
	): { nodes: CstNode[]; applied: number } {
		const child = cloneNode(deps.doc.children[topIndex]);
		const byLeaf = groupBy(matches, (m) => m.path.slice(1).join(','));
		const installed: number[][] = [];
		let applied = 0;
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
			const legal = legalizeWrite(target, index, substituted, 'literal', deps.reading.grammar);
			if (!keepsItsKind(leaf, legal.text)) continue;
			installOwnRaw(leaf, legal.text, deps.reading.grammar);
			installed.push(rel);
			applied += ranges.length;
		}
		if (applied === 0) return { nodes: [], applied };
		// Before the reparse from `child.raw`, a nested leaf's edit is written up into the clone's
		// container raws by the same rebuild typing uses; a top-level leaf needs none.
		const cloneSharing = createSharingState();
		for (const rel of installed) {
			if (rel.length === 0) continue;
			const chain: CstNode[] = [];
			for (let depth = 1; depth < rel.length; depth++)
				chain.push(descend(child, rel.slice(0, depth))!);
			rebuildUnsharedChain(child, chain, cloneSharing, null, deps.reading.grammar);
			rebuildContainerRaw(child, deps.reading.grammar);
		}
		const newNodes = readAsOpened(child.raw, {
			grammar: deps.reading.grammar,
			scope: 'fragment'
		}).children;
		// leadingTrivia is positional and lives off `raw`, so parsing `child.raw` alone drops it.
		return { nodes: normalizeReplacementTrivia(child, newNodes), applied };
	}

	/** A childless container matched as a leaf is reparsed, so its metadata follows the new bytes;
	 *  one with children is excluded, as its raw is rebuilt from theirs. */
	function isReplaceable(match: Match): boolean {
		const top: CstNode | undefined = deps.doc.children[match.path[0]];
		const node = top ? descend(top, match.path.slice(1)) : null;
		if (!node) return false;
		return !getBlockKindDescriptor(node.kind).isContainer || (node.children?.length ?? 0) === 0;
	}

	/** A block drawn as a picture of its source, or a childless container, keeps its kind wherever
	 *  it sits: a substitution that reads it back as another block (a diagram as code) is declined. */
	function keepsItsKind(leaf: CstNode, text: string): boolean {
		const container = getBlockKindDescriptor(leaf.kind).isContainer;
		if (!container && blockFacts(leaf.kind).textPosition === 'always') return true;
		const read = readAsOpened(text, { grammar: deps.reading.grammar, scope: 'fragment' }).children;
		return read.length === 1 && read[0].kind === leaf.kind;
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
				let built: { nodes: CstNode[]; applied: number };
				try {
					built = buildSubtree(topIndex, group, template);
				} catch (error) {
					// buildSubtree runs the container writer, which can run plugin code outside
					// any commit, so nothing else would report this error.
					deps.events.emit('error', {
						origin: 'commit',
						error,
						context: { op: 'replaceBlock', path: docPathFrom([topIndex]) }
					});
					break;
				}
				if (built.applied === 0) continue;
				const newNodes = built.nodes;
				const wrote = await controller.commitStructural({
					snapshot: { path: docPathFrom([topIndex]), offset: 0 },
					mutate: (children) => {
						// The blocks the replacement left alone stay as they were, so they stay mounted.
						keepUnchanged(children[topIndex], newNodes[0]);
						spliceMany(children, topIndex, 1, newNodes);
						const change = replacePreservingFirst(topIndex, 1, newNodes.length);
						stampStructuralChange(children, change, deps.sharing);
						return change;
					}
					// op omitted: no per-commit edit event; one is emitted after the batch
				});
				if (!wrote) continue;
				newBlockCount += newNodes.length;
				applied += built.applied;
			}
		});
		if (applied === 0) return 0;
		// A single-subtree replace names its block's path in the event; a multi-subtree batch has none.
		const eventPath = indices.length === 1 ? docPathFrom([indices[0]]) : [];
		const op = { kind: 'replaceBlock', detail: { count: newBlockCount } } as const;
		// The batch's commits carry no op, so none named the blocks it replaced.
		emitEdit(deps, toEditEvent(op, eventPath, Date.now()), 'unknown');
		return applied;
	}

	return {
		replaceOne: (match: Match, template: string) => replaceSubtrees([match], template),
		replaceAll: (matches: Match[], template: string) => replaceSubtrees(matches, template)
	};
}
