/**
 * The structural commit over one or more block lists: copies each list's container chain, runs
 * the mutation against the copies, then publishes the ids, refs and settled separators. The undo
 * controller builds it and hands it the commit sequence every write runs through.
 */

import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import type { BlockComponent } from '../../block-component';
import type { CstNode } from '../../core/nodes';
import { documentLineEnding } from '../../core/lines';
import type { NodeView } from '../../core/node-views';
import type { RevealPolicy } from '../../selection/caret-landing';
import { docPathFrom } from '../../caret/coordinate-spaces';
import { assignIds } from '../../block-id';
import { replaceRefs } from '../../block-lists/child-refs';
import { isUnmountedBlockListState } from '../../block-lists/state-registry';
import { documentBody, nodeAt } from '../../tree-operations/node-primitives';
import {
	keepOneBlock,
	keepOpenTail,
	fixUpEdit,
	type EditKind,
	type FixedUpEdit
} from '../../tree-operations/fix-up/apply';
import { ensureUnsharedPath, rebuildOwnedContainer } from '../../tree-operations/unshare';
import type { SharingState } from '../../tree-operations/sharing';
import {
	rebuildUnsharedChain,
	sharedChainLevels,
	type AncestrySeamFold,
	type ContainerReclassification
} from '../../tree-operations/chain-rebuild';
import { attachedChainPrefix } from '../../tree-operations/node-primitives';
import { foldLandingFor, publishAncestryFolds, type FoldLanding } from '../ancestry-folds';
import type { EditorActionsDeps, UndoController } from '../deps';
import type {
	CommitAnnouncement,
	CommitLanding,
	CommitContainerStructuralArgs,
	CommitMultiScopeArgs,
	CommitStructuralArgs,
	ContainerScope,
	MultiScopeTarget,
	UndoGrouping
} from '../../action-contracts';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../../tree-operations/structural-change';
import type { BlockListState } from '../../block-lists/block-list-state.svelte';
import { assertIdsInLockstep, assertTopLevelUntouched } from '../../invariants/install';
import { checkSettledOnce, startCommitSettles } from '../../invariants/settle-once';
import { saveBytes } from './saved-bytes';
import { perfEnabled } from '../../perf/instruments';
import type { FrameWrite } from './commit-frame';
import { createScopeWriter, rebuildOwnedChains, type ScopeWriter } from './scope-writes';

// ── Dev invariant scoping (dev-only paths) ────────────────────────────────────

/** Direct children go along: a container's rebuild concatenates them into its raw. */
function withDirectChildren(containers: readonly CstNode[]): CstNode[] {
	const out: CstNode[] = [];
	for (const c of containers) {
		out.push(c);
		// Appended, never spread: a giant table's row list outnumbers an argument list (G4.60).
		for (const child of c.children ?? []) out.push(child);
	}
	return out;
}

/** The nodes down `path` below `root`, as far as it still resolves. */
function nodesOn(root: { children?: CstNode[] }, path: readonly number[]): CstNode[] {
	const nodes: CstNode[] = [];
	let list = root.children;
	for (const index of path) {
		const node = list?.[index];
		if (!node) break;
		nodes.push(node);
		list = node.children;
	}
	return nodes;
}

/** Every top-level block a commit could have written: placed by its change, new to the array, or
 *  owned by the undo step, which a write in place reaches with no copy and no position. */
function writtenTopLevel(
	children: readonly CstNode[],
	before: readonly CstNode[],
	change: StructuralChange,
	sharing: SharingState
): CstNode[] {
	const written = new Set<CstNode>();
	if (change.op === 'insert' || change.op === 'replace') {
		const placed = change.op === 'insert' ? change.count : change.newCount;
		for (const node of children.slice(change.at, change.at + placed)) written.add(node);
	}
	const kept = new Set(before);
	for (const node of children) {
		if (!kept.has(node) || !sharing.isShared(node)) written.add(node);
	}
	return [...written];
}

/** The frame's write plus where the caret lands after it; `commitScopes` builds it for every
 *  entry point. */
export interface CommitArgs extends Omit<FrameWrite, 'prepare' | 'check'> {
	entry: 'commitStructural' | 'commitMultiScope';
	history: UndoGrouping;
	landing?: CommitLanding;
	reveal?: RevealPolicy;
	announce?: CommitAnnouncement;
}

export function createStructuralCommit(
	deps: EditorActionsDeps,
	__commit: (args: CommitArgs) => Promise<boolean>
): Pick<
	UndoController,
	'commitStructural' | 'commitContainerStructural' | 'commitMultiScope' | 'getDocScope'
> {
	// ── Structural-mutation commit ───────────────────────────────────────────

	/** The multi-scope commit over the document scope alone. */
	function commitStructural(args: CommitStructuralArgs): Promise<boolean> {
		return commitScopes({
			entry: 'commitStructural',
			scopes: [getDocScope()],
			snapshot: args.snapshot,
			mutate: ([doc]) => [args.mutate(doc.children, doc)],
			op: args.op,
			landing: args.landing,
			reveal: args.reveal,
			announce: args.announce,
			discardIfNoop: args.discardIfNoop,
			history: args.history,
			trackCaret: [args.trackCaret]
		});
	}

	function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<boolean> {
		const { containerNode, path, state, snapshot, mutate, op, discardIfNoop } = args;
		return commitMultiScope({
			scopes: [{ node: containerNode, state, path }],
			snapshot,
			mutate: ([scope]) => [mutate(scope)],
			op,
			landing: args.landing,
			reveal: args.reveal,
			announce: args.announce,
			discardIfNoop,
			history: args.history,
			trackCaret: [args.trackCaret]
		});
	}

	// ── Multi-scope structural commit ────────────────────────────────────────

	interface PreparedScope {
		target: MultiScopeTarget;
		/** The document's working array is a plain one the publish installs, not the tree's own. */
		isDoc: boolean;
		chain: CstNode[];
		owned: CstNode;
		view: ContainerScope;
		ids: string[];
		refs: (BlockComponent | undefined)[];
		/** The arrays before the swap: what rollback restores when mutate spliced in place. */
		savedChildren: CstNode[] | undefined;
		savedChildIds: string[] | undefined;
		/** publishScopeView writes the mutated ids and refs before the ancestor rebuild can throw. */
		savedStateIds: string[];
		savedStateRefs: (BlockComponent | undefined)[];
		/** Puts back the bytes before mutate; without it `serialize()` emits a half-applied document.
		 *  Nothing at the document, whose rollback is its saved array, so it costs no per-block copy. */
		restoreBytes: () => void;
		/** What the mutation said it did beyond its splice, and the fix-up's result once it ran. */
		edit: EditKind;
		settled: FixedUpEdit | null;
		writer: ScopeWriter;
	}

	/**
	 * Runs over all scopes before any is copied: preparing an earlier scope copies nodes a
	 * later, overlapping scope still points at.
	 */
	function assertScopeIdentity(s: MultiScopeTarget): void {
		if ((s.node as unknown) === (deps.doc as unknown)) return;
		// A stale path that is still in range would copy and rebuild the wrong ancestors.
		assertInvariant('multi-scope-commit-path', () =>
			nodeAt(deps.doc, s.path) === s.node
				? null
				: {
						code: 'multi-scope-commit-path',
						message: `commit: path [${s.path.join(',')}] does not resolve to scope node (${s.node.kind})`
					}
		);
	}

	// The registry drops an unmounted container, so a state found there is live; one a caller held
	// across an await may not be, and its getters read the dead component's props.
	function assertScopeStateMounted(s: MultiScopeTarget): void {
		assertInvariant('block-list-state-mounted', () =>
			isUnmountedBlockListState(s.state)
				? {
						code: 'block-list-state-mounted',
						message: `commit: the ${s.node.kind} at [${s.path.join(',')}] was handed the state of a container that has unmounted`
					}
				: null
		);
	}

	const isDocScope = (s: MultiScopeTarget) => (s.node as unknown) === (deps.doc as unknown);

	/**
	 * Copies the scope's ancestors and attaches a working children array (`tree-operations/unshare.ts`).
	 * `topLevelBefore` is the document's array before the commit wrote any.
	 */
	function prepareScopeView(s: MultiScopeTarget, topLevelBefore: CstNode[]): PreparedScope {
		const isDoc = isDocScope(s);
		const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
		if (!isDoc && chain.length !== s.path.length) {
			// A short chain leaves the container node shared with an undo entry, and writing it
			// would corrupt that entry (G1.9), so the commit throws rather than write it.
			const message = `commitMultiScope: unshared chain depth ${chain.length} != scope path depth ${s.path.length} (path [${s.path.join(',')}])`;
			assertInvariant('multi-scope-scope-depth', () => ({
				code: 'multi-scope-scope-depth',
				message
			}));
			throw new Error(message);
		}
		// Where the commit turns a read-only view into a mutable node (core/node-views.ts):
		// the copied chain owns the scope node, and the document scope owns the root.
		const owned = isDoc ? (s.node as CstNode) : chain[chain.length - 1];
		// A container that never mounted has no ids, which is not an empty list: starting from
		// `[]` writes one id per structural change against N children, and nothing fixes it.
		const ids = isDoc
			? [...s.state.innerBlockIds]
			: [...(owned.childIds ?? assignIds(owned.children ?? []))];
		const refs = [...s.state.innerBlockRefs];
		// The state's ids are replaced by assignment, so the array itself is the saved copy; its refs
		// are replaced in place, so they are copied.
		const savedStateIds = s.state.innerBlockIds;
		const savedStateRefs = [...s.state.innerBlockRefs];
		const savedChildren = isDoc ? topLevelBefore : owned.children;
		const savedChildIds = owned.childIds;
		// The copied ancestors plus direct children, matching `savedChildren`.
		const restoreBytes = isDoc ? () => {} : saveBytes([...chain, ...(owned.children ?? [])]);
		if (!isDoc) owned.children = [...(owned.children ?? [])];
		// Off the tree's `$state` proxy, where every index a splice shifts is a tracked write.
		const children = isDoc ? [...topLevelBefore] : owned.children!;
		const lineEnding = documentLineEnding(deps.doc);
		const writer = createScopeWriter(
			isDoc ? documentBody(deps.doc, children) : owned,
			deps.sharing,
			deps.reading.grammar,
			lineEnding
		);
		const prepared: PreparedScope = {
			target: s,
			isDoc,
			chain,
			owned,
			view: {
				node: owned,
				children,
				sharing: deps.sharing,
				lineEnding,
				body: writer.body,
				rebuild: (node) => {
					// The commit rebuilds the scope's own chain, and a shared node is an undo entry's.
					assertInvariant('scope-rebuild-off-chain', () =>
						node === owned || chain.includes(node) || deps.sharing.isShared(node)
							? {
									code: 'scope-rebuild-off-chain',
									message: `ContainerScope.rebuild: a ${node.kind} on the commit's chain or shared`
								}
							: null
					);
					rebuildOwnedContainer(node);
				},
				describeEdit: (edit) => {
					prepared.edit = { ...prepared.edit, ...edit };
					return () => prepared.settled;
				},
				own: writer.own,
				writeLeaf: writer.writeLeaf,
				splice: writer.splice
			},
			ids,
			refs,
			savedChildren,
			savedChildIds,
			savedStateIds,
			savedStateRefs,
			restoreBytes,
			edit: {},
			settled: null,
			writer
		};
		return prepared;
	}

	/**
	 * Document-scope ids go through the deps setters; container ids live on the copied node,
	 * because the state's setter would write the stale shared node's property.
	 */
	function publishScopeView(p: PreparedScope, change: StructuralChange, entry: string): void {
		if (p.isDoc) {
			deps.doc.children = p.view.children;
			// Re-read through the tree, whose proxy is the array from here on (unshare.ts header).
			p.view.children = p.view.body.children = deps.doc.children;
		}
		applyStructuralChangeToIdsRefs(change, p.ids, p.refs);
		assertIdsInLockstep(
			`${entry} [${p.target.path.join(',')}]`,
			p.ids.length,
			p.owned.children?.length ?? 0
		);
		if (p.isDoc) {
			p.target.state.innerBlockIds = p.ids;
		} else {
			p.owned.childIds = p.ids;
		}
		replaceRefs(p.target.state.innerBlockRefs, p.refs);
	}

	function commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<boolean> {
		return commitScopes({ ...args, entry: 'commitMultiScope' });
	}

	interface ScopedCommitArgs<
		S extends readonly MultiScopeTarget[]
	> extends CommitMultiScopeArgs<S> {
		entry: CommitArgs['entry'];
	}

	/** One structural commit across one or more block lists: one undo snapshot, one edit event.
	 *  Mutate through the provided scope views, never nodes read before the commit. */
	async function commitScopes<const S extends readonly MultiScopeTarget[]>(
		args: ScopedCommitArgs<S>
	): Promise<boolean> {
		const { scopes, snapshot, mutate, op, discardIfNoop, trackCaret } = args;
		const prepared: PreparedScope[] = [];
		// Top-level blocks a container scope copied into the tree's own array, with what stood there.
		const replacedSlots: [index: number, node: CstNode][] = [];
		let settled: StructuralChange[] = [];
		// Containers whose kind the chain rebuild changed: the replacements are what the dev
		// checks read, and the index is what an unwind restores.
		const reclassified: ContainerReclassification[] = [];
		// Containers the ancestor rebuild collapsed into their parent, with where the caret goes: a
		// collapse recreates every block in its range, so a swallowed scope has no ref to focus.
		const folds: AncestrySeamFold[] = [];
		let foldLanding: FoldLanding | null = null;
		let unwindFolds: (() => void) | null = null;
		let topLevelBefore: CstNode[] | null = null;
		return __commit({
			entry: args.entry,
			snapshot,
			apply: (wasOpen) => {
				startCommitSettles();
				for (const s of scopes) {
					assertScopeStateMounted(s);
					assertScopeIdentity(s);
				}
				if (scopes.slice(1).some(isDocScope)) {
					throw new Error('commitMultiScope: the document scope goes first');
				}
				const topLevel = deps.doc.children;
				topLevelBefore = topLevel;
				const hasDoc = scopes.length > 0 && isDocScope(scopes[0]);
				// A container's copied ancestors land in the tree's array: a fresh one the unwind drops,
				// or, beside a document scope, the tree's own, whose slots the unwind puts back.
				if (!hasDoc) deps.doc.children = [...topLevel];
				// Containers first, so the document's working copy holds what they copied. Pushed as
				// each resolves, so a scope that fails to prepare leaves the earlier ones to the rollback.
				for (const s of hasDoc ? scopes.slice(1) : scopes) {
					if (hasDoc) replacedSlots.push([s.path[0], topLevel[s.path[0]]]);
					prepared.push(prepareScopeView(s, topLevel));
				}
				if (hasDoc) prepared.unshift(prepareScopeView(scopes[0], topLevel));
				const treeAtMutate = hasDoc && devChecksOn && !perfEnabled() ? [...topLevel] : null;
				const changes = mutate(prepared.map((p) => p.view) as { [K in keyof S]: ContainerScope });
				if (treeAtMutate) assertTopLevelUntouched(deps.doc.children, topLevel, treeAtMutate);
				// A scope array built at runtime loses the tuple type, so this runtime check
				// backs up the types.
				const changeList: StructuralChange[] = [...changes];
				if (changeList.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changeList.length} changes for ${scopes.length} scopes`
					);
				}
				const deepestFirst = [...prepared].sort((a, b) => b.chain.length - a.chain.length);
				reclassified.push(
					...rebuildOwnedChains(
						deepestFirst.map((p) => p.writer),
						deps.sharing,
						deps.reading.grammar
					)
				);
				for (let i = 0; i < prepared.length; i++) {
					const p = prepared[i];
					const reportsEdit = () => changeList[i].op !== 'noop' || Object.keys(p.edit).length > 0;
					// A leaf written into the scope's own list ran the write's part of the fix-up there, so
					// the pass below finishes that one fix-up rather than repeating it.
					const list = p.view.body.children;
					const written = prepared.some((q) => q.writer.settledLists.has(list));
					assertInvariant('settle-once', () =>
						written ? null : checkSettledOnce(list, reportsEdit())
					);
					// `savedChildren` is the scope's array from before the mutation, so the blank-line
					// fix-up reads which blocks were blank off it.
					p.settled = fixUpEdit(
						p.view.body,
						{ change: changeList[i], before: p.savedChildren ?? [], ...p.edit },
						deps.reading.grammar,
						deps.sharing,
						trackCaret?.[i]
					);
					changeList[i] = p.settled.change;
					// Before the tail step, which reads the block now last; the empty paragraph is blank, so
					// that step leaves its line ending as it is.
					if (prepared[i].isDoc) {
						changeList[i] = keepOneBlock(prepared[i].view.body, changeList[i], deps.sharing);
					}
					publishScopeView(prepared[i], changeList[i], args.entry);
				}
				settled = changeList;
				// Deepest first, so an outer chain concatenates current inner raws; the attached prefix
				// keeps a scope spliced out of the tree from being rebuilt off its emptied children.
				const order = [...prepared].sort((a, b) => b.chain.length - a.chain.length);
				// An ancestor several scopes share is rebuilt once, by the last chain holding it.
				const levels = sharedChainLevels(order.map((p) => p.chain));
				order.forEach((p, i) => {
					const before = folds.length;
					reclassified.push(
						...rebuildUnsharedChain(
							deps.doc,
							attachedChainPrefix(deps.doc, p.chain),
							deps.sharing,
							folds,
							deps.reading.grammar,
							undefined,
							levels[i]
						)
					);
					foldLanding = foldLandingFor(folds.slice(before), p.target.path) ?? foldLanding;
				});
				unwindFolds = publishAncestryFolds(deps, folds);
				keepOpenTail(deps.doc, wasOpen, deps.sharing, deps.reading.grammar);
				return changeList.some((c) => c.op !== 'noop') || folds.length > 0;
			},
			op,
			// A collapsed container recreated every block in its range, so its position replaces the
			// caller's rather than following it.
			landing: () =>
				foldLanding
					? { path: docPathFrom(foldLanding.path), offset: foldLanding.offset }
					: (args.landing?.() ?? null),
			reveal: args.reveal,
			announce: args.announce,
			discardIfNoop,
			history: args.history ?? 'entry',
			written: () => {
				const nodes: CstNode[] = [];
				// A set: a doc scope's caller can name a block the scope's change already placed.
				const tops = new Set<CstNode>();
				// Appended one by one, never spread: a giant table's row list outnumbers an argument
				// list (G4.60).
				const add = (into: CstNode[], from: readonly CstNode[]) =>
					from.forEach((node) => into.push(node));
				prepared.forEach((p, i) => {
					if (p.isDoc) {
						const placed = writtenTopLevel(
							p.owned.children!,
							p.savedChildren ?? [],
							settled[i],
							deps.sharing
						);
						add(nodes, placed);
						placed.forEach((node) => tops.add(node));
						return;
					}
					// A detached scope is outside the tree, and checking it would fire stale-raw on a node
					// the document does not contain.
					const attached = attachedChainPrefix(deps.doc, p.chain);
					if (attached.length === p.chain.length) add(nodes, withDirectChildren([p.owned]));
					if (attached.length > 0) tops.add(p.chain[0]);
				});
				// Re-read by path through the tree, whose proxies are the nodes from here on.
				for (const p of prepared) {
					const root: { children?: CstNode[] } = p.isDoc ? deps.doc : p.owned;
					for (const { path } of p.writer.owned)
						add(nodes, withDirectChildren(nodesOn(root, path)));
				}
				add(nodes, withDirectChildren(reclassified.map((r) => r.replacement)));
				// A chain's top whose kind the rebuild changed sits in the document as its replacement.
				for (const r of reclassified) {
					if (prepared.some((p) => p.chain[0] === r.previous)) tops.add(r.replacement);
				}
				return { nodes, tops: [...tops] };
			},
			rollback: () => {
				// Collapses unwind first: each restores a whole parent array, which the kind
				// changes below then correct index by index.
				unwindFolds?.();
				// The reverse of the order they happened in, so an index is never restored
				// under a node the next restore is about to replace.
				for (let i = reclassified.length - 1; i >= 0; i--) {
					const { siblings, index, previous } = reclassified[i];
					siblings[index] = previous;
				}
				for (const p of prepared) {
					p.owned.children = p.savedChildren;
					p.owned.childIds = p.savedChildIds;
					// The chain rebuild rewrote these bytes and what it read from them, and all of it has to
					// match the children restored above.
					p.restoreBytes();
					// Without this, the ids and refs written before the throw keep reflecting it.
					if (p.isDoc) p.target.state.innerBlockIds = p.savedStateIds;
					replaceRefs(p.target.state.innerBlockRefs, p.savedStateRefs);
				}
				// Last: the restores above write into the working array this one replaces.
				if (topLevelBefore) {
					deps.doc.children = topLevelBefore;
					for (const [index, node] of replacedSlots) topLevelBefore[index] = node;
				}
			}
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/** Forwards top-level ids through the deps setter, so the write reaches the `$state`
	 *  proxy; refs are the editor's own array, which every write mutates in place. */
	function createDocScopeAdapter(): BlockListState {
		return {
			get innerBlockIds() {
				return deps.blockIds;
			},
			set innerBlockIds(v: string[]) {
				deps.setBlockIds(v);
			},
			get innerBlockRefs() {
				return deps.blockRefs;
			},
			refSlots: deps.blockRefSlots
		};
	}

	/** The document root as a MultiScopeTarget, for edits whose common ancestor is the document. */
	function getDocScope(): MultiScopeTarget {
		return { node: deps.doc as unknown as NodeView, path: [], state: createDocScopeAdapter() };
	}

	return { commitStructural, commitContainerStructural, commitMultiScope, getDocScope };
}
