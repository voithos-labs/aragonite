/**
 * The commit sequence (`runCommitCeremony`): undo snapshot, copy before write, mutate,
 * rollback on failure. A node shared with an undo snapshot stays read-only until the commit
 * copies it (G1.9). Keystroke batching is in text-batch.ts.
 */

import { isDevChecks } from '../../env';
import { tick } from 'svelte';
import type { BlockComponent } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import { documentLineEnding } from '../../core/lines';
import type { NodeView } from '../../core/node-views';
import type { EditorSelection, Landing } from '../../selection/primitives';
import type { LandOptions, RevealPolicy } from '../../selection/caret-landing';
import type { UndoEntry } from '../../undo/types';
import type { SelectionPoint } from '../../selection/primitives';
import { digestDoc } from '../../invariants/snapshot-integrity';
import { readCurrentSelection } from '../../selection/native-bridge';
import { asDocPath, pathsEqual } from '../../selection/path-math';
import { assertInvariant } from '../../assert';
import { checkLandingIsAValue, readCaretWhereabouts } from '../../invariants/landing-value';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { beginCommit, endCommit } from '../../invariants/commit-scope';
import { assignIds } from '../../block-id';
import { replaceRefs } from '../../reactivity/publish-ref.svelte';
import { blockNodeAt, documentBody, nodeAt } from '../../tree-operations/node-primitives';
import { settleSeparator } from '../../tree-operations/settle';
import { endsOpen, endWindowLines, keepOpenTail } from '../../tree-operations/open-tail';
import { keepOneBlock } from '../../tree-operations/keep-one-block';
import { ensureUnsharedPath, rebuildOwnedContainer } from '../../tree-operations/unshare';
import {
	attachedChainPrefix,
	rebuildUnsharedChain,
	sharedChainLevels,
	type AncestrySeamFold,
	type ContainerReclassification
} from '../../tree-operations/chain-rebuild';
import { foldLandingFor, publishAncestryFolds, type FoldLanding } from '../ancestry-folds';
import { createTextBatch } from './text-batch';
import { admitsSnapshot, admitsWrite } from './reading-write-gate';
import type { EditorActionsDeps, UndoController } from '../deps';
import type {
	CommitAfterTick,
	CommitAnnouncement,
	CommitLanding,
	CommitContainerStructuralArgs,
	CommitMultiScopeArgs,
	CommitSnapshotArg,
	CommitStructuralArgs,
	ContainerScope,
	MultiScopeTarget
} from '../../action-contracts';
import type { ScopedOpDescriptor } from '../../schema/operations';
import { toEditEvent } from '../../editor-events';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../../tree-operations/structural-change';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import {
	assertCommitPaths,
	assertCommittedNodes,
	assertIdsInLockstep,
	assertKeepsABlock,
	assertLastLineKept,
	assertUndoTopIntegrity
} from '../../invariants/install';
import { dropChildSpans } from '../../schema/child-spans';
import {
	docByteLength,
	perfEnabled,
	recordSnapshotClone,
	setUndoGauge
} from '../../perf/instruments';

type EntrySelection = UndoEntry['selection'];

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

/**
 * The top-level blocks a commit wrote: the ones its change placed, and the ones it copied to write
 * in place, which a `noop` change (a format toggle's marks) names no position for.
 */
function writtenTopLevel(
	children: readonly CstNode[],
	before: readonly CstNode[],
	change: StructuralChange
): CstNode[] {
	const written = new Set<CstNode>();
	if (change.op === 'insert' || change.op === 'replace') {
		const placed = change.op === 'insert' ? change.count : change.newCount;
		for (const node of children.slice(change.at, change.at + placed)) written.add(node);
	}
	const kept = new Set(before);
	for (const node of children) if (!kept.has(node)) written.add(node);
	return [...written];
}

/** `announceEdit` speaks a commit's announcement in the editor's edit live region; only the
 *  controller holds it, so nothing but a commit that wrote can speak there. Silent by default. */
export function createUndoController(
	deps: EditorActionsDeps,
	announceEdit: (message: string) => void = () => {}
): UndoController {
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

	/** Snapshots share the live tree's nodes and copy only the top-level children array, so an
	 *  edit copies the path it writes first (G1.9, `tree-operations/unshare.ts`). */
	function shareSnapshot(): Pick<UndoEntry, 'snapshot' | 'integrity'> {
		deps.sharing.markSnapshotTaken();
		const snapshot: Document = {
			kind: 'document',
			prefix: deps.doc.prefix,
			children: [...deps.doc.children],
			suffix: deps.doc.suffix
		};
		return { snapshot, integrity: isDevChecks() ? digestDoc(snapshot) : undefined };
	}

	function recordSnapshotPerf(): void {
		if (!perfEnabled()) return;
		recordSnapshotClone(docByteLength(deps.doc));
		const undo = deps.undoManager.getStacks().undo;
		let liveBytes = 0;
		for (const entry of undo) liveBytes += docByteLength(entry.snapshot);
		setUndoGauge(liveBytes, undo.length);
	}

	const readLive = () => readCurrentSelection(deps.selectionState, deps.blockRefs);

	/**
	 * What an entry records as "where the caret was". The gap caret outranks only the caller's
	 * fallback, since no block ref reports it.
	 */
	function entrySelection(fallback: () => EditorSelection): EntrySelection {
		const live = readLive();
		if (live) return live;
		const gap = deps.selectionState.gapCaret;
		return gap ? { gapCaret: gap } : fallback();
	}

	// ── Undo steps ───────────────────────────────────────────────────────────

	// The outermost open step owns these; a step inside a step adds only depth. The entry is held
	// by identity: a first write that rolls back removes it, and the next write opens it again.
	let stepDepth = 0;
	let stepEntry: UndoEntry | null = null;
	// Read when the step opens, since a gesture may collapse its range before its first write.
	let stepSelection: EntrySelection | null = null;
	let stepPushed = false;
	// Set by the author's input while a step is open; until it closes, writes push alone.
	let stepEnded = false;
	// The entry the typing batch's first keystroke went into, and whether a keystroke's own
	// commit is being called, which joins it.
	let typingEntry: UndoEntry | null = null;
	let joiningTyping = false;

	const inOpenStep = () => stepDepth > 0 && !stepEnded;
	const isTop = (entry: UndoEntry | null) =>
		entry !== null && deps.undoManager.peekUndo() === entry;

	const joinsStep = () => inOpenStep() && isTop(stepEntry);
	const isJoinedPush = () => (joiningTyping && isTop(typingEntry)) || joinsStep();

	function pushEntry(entry: UndoEntry): void {
		deps.undoManager.push(entry);
		if (inOpenStep()) {
			stepEntry = entry;
			stepPushed = true;
		}
		recordSnapshotPerf();
	}

	/** The selection a push records: the open step's, else the push's own. */
	function selectionFor(own: () => EntrySelection): EntrySelection {
		return inOpenStep() && stepSelection ? stepSelection : own();
	}

	async function undoStep(seed: CommitSnapshotArg, run: () => Promise<unknown>): Promise<void> {
		// A step opened after the author's input is a new gesture, so it groups its own writes.
		if (stepDepth === 0 || stepEnded) {
			stepEntry = null;
			stepSelection = entrySelection(() => collapsedSelectionAtPath(seed.path, seed.offset));
			stepEnded = false;
		}
		stepDepth++;
		try {
			await run();
		} finally {
			stepDepth--;
			if (stepDepth === 0) {
				// The next keystroke starts its own entry rather than joining the gesture's.
				if (stepPushed && !stepEnded) textBatch.interrupt();
				stepEntry = null;
				stepSelection = null;
				stepPushed = false;
				stepEnded = false;
			}
		}
	}

	// Synchronous: a commit pushes as it is called, so this covers the call, not the awaited tail.
	// Safe because `updateBlockContent` pushes the keystroke's batch entry before its commit.
	function joinTypingBatch<T>(write: () => T): T {
		const outer = joiningTyping;
		joiningTyping = true;
		try {
			return write();
		} finally {
			joiningTyping = outer;
		}
	}

	function endUndoStep(): void {
		if (stepDepth === 0) return;
		stepEnded = true;
		stepEntry = null;
	}

	// ── Entry pushes ─────────────────────────────────────────────────────────

	// A push inside a step after its first returns before the snapshot, so it neither marks the
	// tree shared nor clears the redo stack.
	function pushCommitSnapshot(fallbackPath: number[], offset: number): void {
		if (isJoinedPush() || !admitsSnapshot(deps.reading)) return;
		pushEntry({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection: selectionFor(() =>
				entrySelection(() => collapsedSelectionAtPath(fallbackPath, offset))
			)
		});
	}

	// Path from the live focused leaf, offset from the caller: the live caret is already
	// past the edit, but its path still points at the same leaf.
	function pushTypingSnapshot(leafPath: number[], offset: number): void {
		if (joinsStep()) {
			typingEntry = stepEntry;
			return;
		}
		const selection = selectionFor(() => {
			const live = readLive();
			const liveIsCollapsed =
				!!live &&
				pathsEqual(live.anchor.path, live.focus.path) &&
				live.anchor.offset === live.focus.offset;
			return liveIsCollapsed
				? collapsedSelectionAtPath(live.anchor.path, offset)
				: collapsedSelectionAtPath(leafPath, offset);
		});
		const entry = { ...shareSnapshot(), blockIds: [...deps.blockIds], selection };
		pushEntry(entry);
		typingEntry = entry;
	}

	const textBatch = createTextBatch({
		pushSnapshot: pushTypingSnapshot,
		emitInput: (leafPath, byteLength) =>
			deps.events.emit('edit', {
				op: 'input',
				path: leafPath,
				detail: { byteLength },
				timestamp: Date.now()
			})
	});

	// ── Internal commit primitive ────────────────────────────────────────────

	/** What the commit sequence runs; `commitScopes` builds it for every entry point. */
	interface CommitArgs {
		/** Names the write in a reading-mode refusal when there is no `op`. */
		entry: 'commitStructural' | 'commitMultiScope';
		snapshot: CommitSnapshotArg;
		/** False when every scope changed nothing; `wasOpen` is whether the document ended with no
		 *  final line break before it. */
		mutate: (wasOpen: boolean) => boolean;
		op?: ScopedOpDescriptor;
		afterTick?: CommitAfterTick;
		landing?: CommitLanding;
		reveal?: RevealPolicy;
		announce?: CommitAnnouncement;
		/** A function, since the copied nodes only exist once `mutate` has made them. */
		touchedNodes: () => CstNode[];
		/** Restores what `mutate` wrote, the top-level array included. */
		rollback: () => void;
		discardIfNoop?: boolean;
	}

	interface RollbackFrame {
		restore(): void;
	}

	/** Everything a commit that throws or bails on discardIfNoop restores; the scopes' state exists
	 *  only once `mutate` has copied it, so restore() hands that to `rollback`. */
	function captureRollbackFrame(args: CommitArgs, pushes: boolean): RollbackFrame {
		// A whole-stack restore, not a pop: the push may evict the oldest entry at the cap. A
		// commit that joins its step's entry pushes nothing, so it has no stacks to restore.
		const savedStacks = pushes ? deps.undoManager.getStacks() : null;
		// The trailing-line fix-up can consume the document's suffix, which no scope holds.
		const savedDocSuffix = deps.doc.suffix;
		return {
			restore() {
				if (savedStacks) deps.undoManager.restoreStacks(savedStacks);
				deps.doc.suffix = savedDocSuffix;
				args.rollback();
			}
		};
	}

	/** The one path to the `error` event, so every throw site reports alike (`docs/design/editor.md` § The event channel). */
	function reportCommitError(args: CommitArgs, error: unknown): void {
		deps.events.emit('error', {
			origin: 'commit',
			error,
			context: { op: args.op?.kind, path: args.op?.eventPath }
		});
	}

	/** `discarded` is a `discardIfNoop` commit that changed nothing: no write, but it still lands. */
	type CommitOutcome = 'written' | 'discarded' | 'failed';

	function runCommitCeremony(args: CommitArgs): CommitOutcome {
		deps.caretMemory.forget();
		textBatch.interrupt();

		if (isDevChecks()) {
			// Both declared paths must be document-absolute; `invariants` imports nothing at
			// runtime, so the number[] to DocPath conversion lives here.
			assertCommitPaths(
				deps.doc,
				asDocPath(args.snapshot.path),
				args.op?.eventPath ? asDocPath(args.op.eventPath) : null
			);
		}

		// Outside the try: the stacks must be saved before the push below.
		const rollback = captureRollbackFrame(args, !isJoinedPush());

		// A `discardIfNoop` commit that changed nothing takes the throw path's restore minus
		// the error event.
		let discarded = false;
		try {
			// Inside the try: readCurrentSelection walks live block refs, plugin leaves included,
			// so it can throw like every other step.
			pushCommitSnapshot(args.snapshot.path, args.snapshot.offset);
			const wasOpen = endsOpen(deps.doc);
			const changed = args.mutate(wasOpen);
			if (args.discardIfNoop && !changed) {
				// The mutation ran but no scope changed: unwind as a throw would.
				rollback.restore();
				discarded = true;
			} else if (isDevChecks()) {
				const touched = args.touchedNodes();
				assertCommittedNodes(touched, deps.reading.grammar);
				assertLastLineKept(deps.doc, wasOpen);
				assertKeepsABlock(deps.doc, touched);
			}
			if (!discarded && isDevChecks()) {
				// A missed copy before write corrupts the newest undo entry, so the commit catches it
				// rather than some distant undo (G1.9). Never throws.
				assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
			}
		} catch (err) {
			rollback.restore();
			reportCommitError(args, err);
			// Loud in dev; production swallows it so one failed edit does not kill the editor.
			// The tree is intact either way: rolled back, or never installed.
			if (isDevChecks()) throw err;
			return 'failed';
		}

		if (!discarded) {
			// After the result is installed, so nothing caches the new version against a
			// half-installed tree; a discarded commit rolled back, so it announces nothing.
			deps.bumpContentVersion();
			// A commit moves what the gap caret's boundary index names, and nothing can say which
			// boundary the user meant; after the push, so the stored entry keeps the gap.
			deps.selectionState.clearGapCaret();
		}

		if (!discarded && args.op) {
			deps.events.emit('edit', toEditEvent(args.op, args.op.eventPath, Date.now()));
		}

		return discarded ? 'discarded' : 'written';
	}

	/** The commit's landing, checked in dev to have moved no caret while it was read. */
	function readLanding(landing: CommitLanding | undefined): Landing | null {
		if (!landing) return null;
		if (!isDevChecks()) return landing();
		const before = readCaretWhereabouts();
		const value = landing();
		assertInvariant('landing-is-a-value', () =>
			checkLandingIsAValue(before, readCaretWhereabouts())
		);
		return value;
	}

	// Bracket the synchronous commit so the decorations never read a half-applied tree.
	// Cleared before the first await. Resolves to whether bytes landed.
	async function __commit(args: CommitArgs): Promise<boolean> {
		const op = args.op?.kind ?? args.entry;
		const target = args.op?.eventPath ?? args.snapshot.path;
		// A refused write lands nothing, while a discarded no-op still lands: whether a commit
		// lands is its own question, not whether it wrote.
		if (!admitsWrite(deps.reading, op, () => blockNodeAt(deps.doc, target)?.kind)) return false;
		// Read before any await, so an undo or swap during the landing's mount makes it give up.
		const stamp = deps.caretLanding.generation();
		beginCommit();
		let outcome: CommitOutcome;
		try {
			outcome = runCommitCeremony(args);
		} finally {
			endCommit();
		}
		if (outcome === 'failed') return false;
		await tick();
		// Awaited, so the promise every caller holds means "the caret is placed". No rollback on a
		// throw: the commit succeeded and the tree is correct, so it is reported and the next runs.
		try {
			await args.afterTick?.();
		} catch (err) {
			reportCommitError(args, err);
		}
		try {
			const landing = readLanding(args.landing);
			if (landing) await landOrRestore(landing, { stamp, reveal: args.reveal });
		} catch (err) {
			reportCommitError(args, err);
		}
		if (outcome !== 'written') return false;
		if (args.announce) announceEdit(args.announce());
		return true;
	}

	async function landOrRestore(landing: Landing, opts: LandOptions): Promise<void> {
		if ('anchor' in landing) await deps.caretLanding.restore(landing, opts);
		else await deps.caretLanding.land(landing, opts);
	}

	// ── Structural-mutation commit ───────────────────────────────────────────

	/** The multi-scope commit over the document scope alone. */
	function commitStructural(args: CommitStructuralArgs): Promise<boolean> {
		return commitScopes({
			entry: 'commitStructural',
			topLevelOffTree: true,
			scopes: [getDocScope()],
			snapshot: args.snapshot,
			mutate: ([doc]) => [args.mutate(doc.children)],
			op: args.op,
			afterTick: args.afterTick,
			landing: args.landing,
			reveal: args.reveal,
			announce: args.announce,
			discardIfNoop: args.discardIfNoop,
			trackCaret: [args.trackCaret],
			touchedNodes: args.touchedNodes
		});
	}

	function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<boolean> {
		const { containerNode, path, state, snapshot, mutate, op, afterTick, discardIfNoop } = args;
		return commitMultiScope({
			scopes: [{ node: containerNode, state, path }],
			snapshot,
			mutate: ([scope]) => [mutate(scope)],
			op,
			afterTick,
			landing: args.landing,
			reveal: args.reveal,
			announce: args.announce,
			discardIfNoop,
			trackCaret: [args.trackCaret]
		});
	}

	// ── Multi-scope structural commit ────────────────────────────────────────

	interface PreparedScope {
		target: MultiScopeTarget;
		isDoc: boolean;
		/** The document's working array is a plain one the publish installs, not the tree's own. */
		offTree: boolean;
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
		/** The bytes before mutate; without them `serialize()` emits a half-applied document. None at
		 *  the document, whose rollback is its saved array, so a commit there costs no per-block copy. */
		savedRaws: SavedRaw[];
	}

	interface SavedRaw {
		node: CstNode;
		raw: string;
		metadata: CstNode['metadata'];
	}

	/** The bytes at risk, with the metadata a rebuild re-reads from them: the copied ancestors plus
	 *  direct children, matching `savedChildren`. */
	function captureScopeRaws(chain: CstNode[], owned: CstNode): SavedRaw[] {
		const save = (node: CstNode): SavedRaw => ({ node, raw: node.raw, metadata: node.metadata });
		return [...chain.map(save), ...(owned.children ?? []).map(save)];
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

	/**
	 * Copies the scope's ancestors and attaches a working children array (`tree-operations/unshare.ts`).
	 * `topLevelBefore` is the document's array before the commit wrote any.
	 */
	function prepareScopeView(
		s: MultiScopeTarget,
		topLevelBefore: CstNode[],
		topLevelOffTree: boolean
	): PreparedScope {
		const isDoc = (s.node as unknown) === (deps.doc as unknown);
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
		const savedRaws = isDoc ? [] : captureScopeRaws(chain, owned);
		if (!isDoc) owned.children = [...(owned.children ?? [])];
		const offTree = isDoc && topLevelOffTree;
		// Off the tree's `$state` proxy, where every index a splice shifts is a tracked write.
		const children = offTree ? [...topLevelBefore] : owned.children!;
		const lineEnding = documentLineEnding(deps.doc);
		return {
			target: s,
			isDoc,
			offTree,
			chain,
			owned,
			view: {
				node: owned,
				children,
				sharing: deps.sharing,
				lineEnding,
				body: isDoc ? documentBody(deps.doc, children) : { children, owner: owned, lineEnding },
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
					rebuildOwnedContainer(node, deps.sharing);
				}
			},
			ids,
			refs,
			savedChildren,
			savedChildIds,
			savedStateIds,
			savedStateRefs,
			savedRaws
		};
	}

	/**
	 * Document-scope ids go through the deps setters; container ids live on the copied node,
	 * because the state's setter would write the stale shared node's property.
	 */
	function publishScopeView(p: PreparedScope, change: StructuralChange, entry: string): void {
		if (p.offTree) {
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
		/** In-place writes a `noop` change names no position for, read once `mutate` returns. */
		touchedNodes?: readonly CstNode[];
		/** True when the mutation writes the top level only through the array it's handed, so that
		 *  array can stay off the tree until the document scope publishes. */
		topLevelOffTree?: boolean;
	}

	/** One structural commit across one or more block lists: one undo snapshot, one edit event.
	 *  Mutate through the provided scope views, never nodes read before the commit. */
	async function commitScopes<const S extends readonly MultiScopeTarget[]>(
		args: ScopedCommitArgs<S>
	): Promise<boolean> {
		const { scopes, snapshot, mutate, op, discardIfNoop, trackCaret } = args;
		const offTree = args.topLevelOffTree ?? false;
		const prepared: PreparedScope[] = [];
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
			mutate: (wasOpen) => {
				for (const s of scopes) assertScopeIdentity(s);
				const topLevel = deps.doc.children;
				topLevelBefore = topLevel;
				// A container scope's copies land in the live top-level array, so the commit writes a
				// fresh one, and an unwind puts back the one it replaced.
				if (!offTree) deps.doc.children = [...topLevel];
				// Pushed as each resolves, so a scope that fails to prepare still leaves the
				// rollback holding the state of the scopes prepared before it.
				for (const s of scopes) prepared.push(prepareScopeView(s, topLevel, offTree));
				const changes = mutate(prepared.map((p) => p.view) as { [K in keyof S]: ContainerScope });
				// A scope array built at runtime loses the tuple type, so this runtime check
				// backs up the types.
				const changeList: StructuralChange[] = [...changes];
				if (changeList.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changeList.length} changes for ${scopes.length} scopes`
					);
				}
				for (let i = 0; i < prepared.length; i++) {
					endWindowLines(prepared[i].view.body, changeList[i], deps.sharing, deps.reading.grammar);
				}
				for (let i = 0; i < prepared.length; i++) {
					// `savedChildren` is the scope's array from before the mutation, so the blank-line
					// fix-up reads which blocks were blank off it.
					changeList[i] = settleSeparator(
						prepared[i].view.body,
						prepared[i].savedChildren ?? [],
						changeList[i],
						deps.reading.grammar,
						deps.sharing,
						trackCaret?.[i]
					);
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
			afterTick: args.afterTick,
			// A collapsed container recreated every block in its range, so its position replaces the
			// caller's rather than following it.
			landing: () =>
				foldLanding
					? { path: docPathFrom(foldLanding.path), offset: foldLanding.offset }
					: (args.landing?.() ?? null),
			reveal: args.reveal,
			announce: args.announce,
			discardIfNoop,
			touchedNodes: () => {
				const touched: CstNode[] = [];
				// Appended one by one, never spread: a giant table's row list outnumbers an argument
				// list (G4.60).
				const add = (nodes: readonly CstNode[]) => nodes.forEach((node) => touched.push(node));
				prepared.forEach((p, i) => {
					if (p.isDoc) {
						add(writtenTopLevel(p.owned.children!, p.savedChildren ?? [], settled[i]));
						// The caller's list names positions from before any merge, so it holds only for `noop`.
						if (settled[i].op === 'noop') add(args.touchedNodes ?? []);
						return;
					}
					// A detached scope is outside the tree, and checking it would fire stale-raw on a node
					// the document does not contain.
					const attached = attachedChainPrefix(deps.doc, p.chain).length === p.chain.length;
					if (attached) add(withDirectChildren([p.owned]));
				});
				add(withDirectChildren(reclassified.map((r) => r.replacement)));
				return touched;
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
					// The chain rebuild rewrote these bytes and the metadata it read from them, and both have
					// to match the children restored above.
					for (const { node, raw, metadata } of p.savedRaws) {
						node.raw = raw;
						node.metadata = metadata;
						dropChildSpans(node);
					}
					// Without this, the ids and refs written before the throw keep reflecting it.
					if (p.isDoc) p.target.state.innerBlockIds = p.savedStateIds;
					replaceRefs(p.target.state.innerBlockRefs, p.savedStateRefs);
				}
				// Last: the restores above write into the working array this one replaces.
				if (topLevelBefore) deps.doc.children = topLevelBefore;
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

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		// The same selection read as the snapshot pushes: this is the entry an undo or redo
		// pushes onto the opposite stack, so a gap caret or a selected image's caret survives.
		return {
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			// Fallback when nothing is focused (a headless harness, a programmatic capture).
			selection: entrySelection(() => collapsedSelectionAt(0, 0))
		};
	}

	return {
		sharing: deps.sharing,
		pushUndoSnapshotDebounced: (leafPath, offset, batchKey) => {
			if (admitsSnapshot(deps.reading)) textBatch.keystroke(leafPath, offset, batchKey);
		},
		armUndoPause: textBatch.armPause,
		commitStructural,
		commitContainerStructural,
		commitMultiScope,
		getDocScope,
		captureCurrentState,
		flushDebouncedCheckpoint: textBatch.interrupt,
		undoStep,
		joinTypingBatch,
		endUndoStep,
		isolateUndoEntry: (write) => {
			// Both sides: the first break makes the write push its own snapshot instead of
			// joining the burst before it, the second keeps the next keystroke out of it.
			textBatch.interrupt();
			write();
			textBatch.interrupt();
		}
	};
}
