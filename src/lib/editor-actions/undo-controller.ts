/**
 * Undo/snapshot controller. Exposes snapshot pushers and commit primitives
 * that wrap structural mutations with undo + reactivity ceremony; the
 * keystroke-batch lifecycle is delegated to text-batch.ts.
 */

import { tick } from 'svelte';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import type { EditorSelection } from '../editor-keys';
import type { UndoEntry } from '../undo/types';
import type { SelectionPoint } from '../selection/primitives';
import { digestDoc } from '../invariants/sharing';
import { readCurrentSelection } from '../selection/native-bridge';
import { pathsEqual } from '../selection/path-math';
import { assertInvariant } from '../invariants/assert';
import { nodeAt } from '../tree-operations/node-ops';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../tree-operations/unshare';
import { createTextBatch } from './text-batch';
import type {
	CommitContainerStructuralArgs,
	CommitMultiScopeArgs,
	CommitStructuralArgs,
	ContainerScope,
	EditorActionsDeps,
	UndoController
} from './deps';
import type { OpDescriptor } from '../action-contracts';
import type { EditEvent } from '../editor-events';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { assertCommittedNodes, assertUndoTopIntegrity } from '../invariants/install';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { docByteLength, perfEnabled, recordSnapshotClone, setUndoGauge } from '../perf/instruments';

// ── Multi-scope commit types ──────────────────────────────────────────────────

/**
 * Order matters for the emitted event path — scopes[0] is the outermost.
 * `path` is the scope node's doc-absolute path; the primitive unshares each
 * scope's spine before `mutate` and rebuilds the owned chains after.
 */
export interface MultiScopeTarget {
	node: CstNode;
	state: BlockListState;
	path: number[];
}

// ── Dev invariant scoping (DEV-only paths) ────────────────────────────────────

/**
 * Top-level nodes a document-scope commit produced. Insert/replace name their
 * new positions in the StructuralChange; a `noop` (in-place kind change) names
 * nothing, so the caller passes the leaf via `explicit`.
 */
function touchedFromChange(
	change: StructuralChange,
	children: CstNode[],
	explicit: CstNode[] | undefined
): CstNode[] {
	if (change.op === 'insert') return children.slice(change.at, change.at + change.count);
	if (change.op === 'replace') return children.slice(change.at, change.at + change.newCount);
	return explicit ?? [];
}

/** A directly-mutated container plus its direct children (the changed leaves a strip rebuild concatenates). */
function touchedContainersWithChildren(containers: CstNode[] | undefined): CstNode[] {
	if (!containers) return [];
	const out: CstNode[] = [];
	for (const c of containers) {
		out.push(c);
		if (c.children) out.push(...c.children);
	}
	return out;
}

export function createUndoController(deps: EditorActionsDeps): UndoController {
	// ── Selection helpers ─────────────────────────────────────────────────────

	function collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection {
		const point: SelectionPoint = { path: [blockIndex], offset };
		return { anchor: point, focus: point };
	}

	function collapsedSelectionAtPath(path: number[], offset: number): EditorSelection {
		const point: SelectionPoint = { path: path.slice(), offset };
		return { anchor: point, focus: point };
	}

	// ── Snapshot pushers ─────────────────────────────────────────────────────

	/**
	 * Snapshots share the live tree's nodes (epoch-marked) instead of deep
	 * cloning — only the top-level children array is copied. Mutations must
	 * copy-path-on-write before touching any shared node (tree-operations/
	 * unshare.ts); the DEV integrity digest catches writes that don't.
	 */
	function shareSnapshot(): Pick<UndoEntry, 'snapshot' | 'integrity'> {
		deps.sharing.markSnapshotTaken();
		const snapshot: Document = {
			kind: 'document',
			prefix: deps.doc.prefix,
			children: [...deps.doc.children],
			suffix: deps.doc.suffix
		};
		return { snapshot, integrity: import.meta.env.DEV ? digestDoc(snapshot) : undefined };
	}

	function recordSnapshotPerf(): void {
		if (!perfEnabled()) return;
		recordSnapshotClone(docByteLength(deps.doc));
		const undo = deps.undoManager.getStacks().undo;
		let liveBytes = 0;
		for (const entry of undo) liveBytes += docByteLength(entry.snapshot);
		setUndoGauge(liveBytes, undo.length);
	}

	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		const selection =
			readCurrentSelection(deps.selectionState, deps.blockRefs) ??
			collapsedSelectionAt(blockIndex, offset);
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection
		});
		recordSnapshotPerf();
	}

	// Path from the live focused leaf; offset from the caller (pre-edit). The
	// live cursor is post-edit but its path still points at the same leaf.
	function pushUndoSnapshotAt(blockIndex: number, offset: number): void {
		const live = readCurrentSelection(deps.selectionState, deps.blockRefs);
		const liveIsCollapsed =
			!!live &&
			pathsEqual(live.anchor.path, live.focus.path) &&
			live.anchor.offset === live.focus.offset;
		const selection = liveIsCollapsed
			? collapsedSelectionAtPath(live.anchor.path, offset)
			: collapsedSelectionAt(blockIndex, offset);
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection
		});
		recordSnapshotPerf();
	}

	const textBatch = createTextBatch({
		pushSnapshot: pushUndoSnapshotAt,
		emitInput: (blockIndex, byteLength) =>
			deps.events.emit('edit', {
				op: 'input',
				path: [blockIndex],
				detail: { byteLength },
				timestamp: Date.now()
			})
	});

	// ── Internal commit primitive ────────────────────────────────────────────
	/**
	 * Universal commit ceremony: snapshot push, mutation, atomic publish, edit
	 * event emission, tick, post-tick callback. Public wrappers
	 * (`commitStructural`, `commitContainerStructural`, `commitMultiScope`)
	 * delegate here via one of the two kind-specific shapes. Document-kind
	 * owns top-level children/ids/refs and auto-syncs them from the returned
	 * StructuralChange; container-kind owns its own per-scope state inside
	 * the mutate callback and only needs the ceremony to fire the snapshot,
	 * event, and reactivity nudge around it.
	 */

	type CommitArgs =
		| {
				kind: 'document';
				snapshot: { blockIndex: number; offset: number } | 'skip';
				/**
				 * Mutate `children` in place; return a StructuralChange describing the
				 * array-shape mutation. The primitive auto-syncs ids/refs from the
				 * descriptor — do NOT splice them inside `mutate`.
				 */
				mutate: (children: CstNode[]) => StructuralChange;
				publish: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void;
				op?: OpDescriptor;
				eventPath: number[];
				afterTick?: () => void;
				/**
				 * Nodes for the dev invariant check when the StructuralChange doesn't
				 * name them. Split/insert/replace are derived from the change; an
				 * in-place kind change (`op: 'noop'`) must point at its leaf here.
				 */
				touchedNodes?: CstNode[];
		  }
		| {
				kind: 'container';
				snapshot: { blockIndex: number; offset: number } | 'skip';
				/**
				 * Apply the inner mutation directly to container state. Callbacks own
				 * their own scope copies + atomic publish back to node.children and
				 * the scope's BlockListState. No StructuralChange is returned to the
				 * primitive — descriptor application happens inside the callback.
				 */
				mutate: () => void;
				/** Post-mutation reactivity nudge (e.g. doc.children = [...doc.children]). */
				publish: () => void;
				op?: OpDescriptor;
				eventPath: number[];
				afterTick?: () => void;
				/**
				 * Directly-mutated containers (innermost scopes) for the dev invariant
				 * check. Thunk: the owned nodes only exist after `mutate` unshares.
				 */
				touchedNodes?: () => CstNode[];
		  };

	async function __commit(args: CommitArgs): Promise<void> {
		deps.stickyColumn.reset();
		textBatch.interrupt();

		if (args.snapshot !== 'skip') {
			pushUndoSnapshot(args.snapshot.blockIndex, args.snapshot.offset);
		}

		if (args.kind === 'document') {
			const childrenCopy = [...deps.doc.children];
			const idsCopy = [...deps.blockIds];
			const refsCopy = [...deps.blockRefs];

			const change = args.mutate(childrenCopy);
			applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);

			args.publish(childrenCopy, idsCopy, refsCopy);
			if (import.meta.env.DEV) {
				assertCommittedNodes(touchedFromChange(change, childrenCopy, args.touchedNodes));
			}
		} else {
			args.mutate();
			args.publish();
			if (import.meta.env.DEV) {
				assertCommittedNodes(touchedContainersWithChildren(args.touchedNodes?.()));
			}
		}
		if (import.meta.env.DEV) {
			// G1.9 commit seam: a missed copy-path-on-write in this commit's
			// mutations corrupts the freshest entry — catch it here, not at
			// some distant undo.
			assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
		}

		if (args.op) {
			// Cast: the centralized emitter sees `kind: OperationKind` and `detail: Record<string, unknown> | undefined`,
			// which TS can't narrow into the per-arm shapes of EditEvent. Subscribers still get a discriminated union.
			deps.events.emit('edit', {
				op: args.op.kind,
				path: args.eventPath,
				detail: args.op.detail,
				timestamp: Date.now()
			} as EditEvent);
		}

		await tick();
		args.afterTick?.();
	}

	// ── Structural-mutation ceremony ─────────────────────────────────────────
	/** `snapshot: 'skip'` lets composite operations share a single undo entry. */

	async function commitStructural(args: CommitStructuralArgs): Promise<void> {
		const { snapshot, mutate, op, afterTick, touchedNodes } = args;
		// eventPath derives from the snapshot when one is pushed; 'skip' means a
		// caller already owns the event path, so fall back to [] when no snapshot
		// coordinate is available.
		const eventPath = snapshot === 'skip' ? [] : [snapshot.blockIndex];
		await __commit({
			kind: 'document',
			snapshot,
			mutate,
			publish: (children, ids, refs) => {
				deps.doc.children = children;
				deps.setBlockIds(ids);
				deps.setBlockRefs(refs);
			},
			op,
			eventPath,
			afterTick,
			touchedNodes
		});
	}

	/** Single-scope case of commitMultiScope; kept as a named entry for its callers. */
	async function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void> {
		const { containerNode, path, state, snapshot, mutate, op, afterTick } = args;
		await commitMultiScope({
			scopes: [{ node: containerNode, state, path }],
			snapshot,
			mutate: ([scope]) => [mutate(scope)],
			op,
			afterTick
		});
	}

	// ── Multi-scope structural commit ────────────────────────────────────────

	interface PreparedScope {
		target: MultiScopeTarget;
		isDoc: boolean;
		chain: CstNode[];
		owned: CstNode;
		view: ContainerScope;
		ids: string[];
		refs: (BlockComponent | undefined)[];
	}

	/**
	 * Resolve one scope into an owned mutation view: verify the path still
	 * resolves to the scope node, unshare its spine, attach a working children
	 * array (write-then-re-read contract — tree-operations/unshare.ts header),
	 * and copy ids/refs for descriptor application.
	 */
	function prepareScopeView(s: MultiScopeTarget): PreparedScope {
		const isDoc = (s.node as unknown) === (deps.doc as unknown);
		if (!isDoc) {
			// A stale-but-in-range path would unshare and rebuild the wrong spine.
			assertInvariant('multi-scope-commit-path', () =>
				nodeAt(deps.doc, s.path) === s.node
					? null
					: {
							code: 'multi-scope-commit-path',
							message: `commit: path [${s.path.join(',')}] does not resolve to scope node (${s.node.kind})`
						}
			);
		}
		const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
		const owned = isDoc ? s.node : (chain[chain.length - 1] ?? s.node);
		const ids = isDoc ? [...s.state.innerBlockIds] : [...(owned.childIds ?? [])];
		const refs = [...s.state.innerBlockRefs];
		owned.children = [...(owned.children ?? [])];
		return {
			target: s,
			isDoc,
			chain,
			owned,
			view: { node: owned, children: owned.children!, sharing: deps.sharing },
			ids,
			refs
		};
	}

	/**
	 * Apply one scope's StructuralChange to its ids/refs and publish them.
	 * Doc-scope ids route through deps setters (top-level ids are per-snapshot
	 * copies); container ids live on the owned node — the state bundle's setter
	 * would write the stale shared node prop.
	 */
	function publishScopeView(p: PreparedScope, change: StructuralChange): void {
		applyStructuralChangeToIdsRefs(change, p.ids, p.refs);
		if (p.isDoc) {
			p.target.state.innerBlockIds = p.ids;
		} else {
			p.owned.childIds = p.ids;
		}
		p.target.state.innerBlockRefs = p.refs;
	}

	/**
	 * Atomic structural commit spanning multiple container scopes — one undo
	 * snapshot, per-scope children views, one edit event. Use for operations
	 * touching ≥2 container nodes (e.g., indent across parent + nested list).
	 *
	 * Copy-path-on-write: each scope's spine is unshared before `mutate`, the
	 * owned nodes get their working children arrays attached (so rebuild /
	 * renumber helpers reading node.children see live shape mid-mutate), and
	 * the owned spine chains are raw-rebuilt afterwards, deepest scope first.
	 * Mutate through the provided scope views, never pre-commit captures.
	 */
	async function commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void> {
		const { scopes, snapshot, mutate, op, afterTick } = args;
		let prepared: PreparedScope[] = [];
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				prepared = scopes.map(prepareScopeView);
				const changes = mutate(prepared.map((p) => p.view) as { [K in keyof S]: ContainerScope });
				// Dynamically-built scope arrays degrade to array typing, so the
				// runtime arity check stays as the backstop behind the tuple types.
				const changeList: readonly StructuralChange[] = changes;
				if (changeList.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changeList.length} changes for ${scopes.length} scopes`
					);
				}
				for (let i = 0; i < prepared.length; i++) {
					publishScopeView(prepared[i], changeList[i]);
				}
				// Deepest chains first: an inner scope's raw must be current before
				// an outer chain's rebuild concatenates it.
				for (const p of [...prepared].sort((a, b) => b.chain.length - a.chain.length)) {
					rebuildUnsharedChain(p.chain, deps.sharing);
				}
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op: op ? { kind: op.kind, detail: op.detail } : undefined,
			eventPath: op?.eventPath ?? [],
			afterTick,
			// The doc scope's node has no block descriptor — exclude it from kind-keyed checks.
			touchedNodes: () =>
				prepared.map((p) => p.owned).filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined)
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/**
	 * Expose the document root as a MultiScopeTarget so cross-scope ops with
	 * an LCA at doc level can include it. The synthetic BlockListState forwards
	 * ids/refs through deps setters so publish-time assignments reach the
	 * Svelte $state proxies.
	 */
	function getDocScope(): MultiScopeTarget {
		return {
			node: deps.doc as unknown as CstNode,
			path: [],
			state: {
				get innerBlockIds() {
					return deps.blockIds;
				},
				set innerBlockIds(v: string[]) {
					deps.setBlockIds(v);
				},
				get innerBlockRefs() {
					return deps.blockRefs;
				},
				set innerBlockRefs(v: (BlockComponent | undefined)[]) {
					deps.setBlockRefs(v);
				}
			}
		};
	}

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		const selection = readCurrentSelection(deps.selectionState, deps.blockRefs);
		// Fallback for unfocused-at-capture (headless harness, programmatic capture).
		return {
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection: selection ?? collapsedSelectionAt(0, 0)
		};
	}

	return {
		sharing: deps.sharing,
		pushUndoSnapshot,
		pushUndoSnapshotDebounced: textBatch.keystroke,
		commitStructural,
		commitContainerStructural,
		commitMultiScope,
		getDocScope,
		captureCurrentState,
		collapsedSelectionAt,
		clearDebouncedCheckpoint: textBatch.discard
	};
}
