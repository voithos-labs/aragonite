/**
 * The container-authoring seam a plugin block component builds on: the built-in
 * container wiring collapsed into one factory, so a plugin never touches an editor
 * context key. Call synchronously during component init — `getContext` reads the
 * ancestor contexts and `useContainerWindowing` sets its own.
 */

import { DEV } from 'esm-env';
import { getContext } from 'svelte';
import type { ComponentProps } from 'svelte';
// Type-only, erased at build: no runtime edge to `components/` here. It buys the
// two-way conformance check below.
import type BlockList from '../../components/BlockList.svelte';
import type {
	BlockEditActions,
	CommitAfterTick,
	ContainerEditActions,
	FocusActions,
	HistoryActions,
	MoveFocusOptions
} from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import type { AmbientPrefix, BlockComponent, ContainerBlockComponent } from '../../block-component';
import { expandContainerPatch, isCollapsedContainer } from '../../schema/reserved-chrome';
import { dispatchKindCommand, type KindCommandTarget } from '../../schema/block-commands';
import { eventToChord } from '../../schema/keybindings';
import { isReadingMode, type PresentationMode } from '../../presentation-mode';
import { devWarn } from '../../dev-warn';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices,
	type PluginEditorLookup
} from '../../editor-keys';
import { emitCommandError } from '../../editor-events';
import { pluginKindOwner } from '../../schema/plugin-install';
import { createBlockListState } from '../../reactivity/block-list-state.svelte';
import type { WindowResult } from '../../reactivity/block-window.svelte';
import type { RefSlots } from '../../reactivity/publish-ref.svelte';
import { useContainerWindowing } from '../../reactivity/use-container-windowing.svelte';
import { createBlockquoteOverrides } from '../blockquote-overrides';
import {
	composeWholeBlockFocusSurface,
	createContainerBlockComponent,
	focusAcrossBlockEdge,
	handleEditorGlobalChord,
	handleWholeBlockKeys,
	isEditableEventTarget
} from '../container-block-component';
import {
	createStandardNestedActions,
	setNestedActionsContexts,
	type NestedActionsOverrideFactory,
	type NodeScope
} from '../nested/nested-actions';

/**
 * The frozen inputs the host component feeds in. A function-valued field is a **live
 * read**, re-evaluated on every use; a plain-valued field is static configuration.
 * `getBoxEl` returns the chrome box whose direct `.block-list` child the windowing
 * lookups walk, so chrome siblings beside the list are fine.
 */
export interface ContainerBlockDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	getBoxEl(): HTMLElement | undefined;
	/**
	 * Opt into whole-block focus for an opaque, childless container: the element that
	 * takes DOM focus. The kind must also declare `blockFocus: 'whole-block'`. Supply
	 * a surface for EVERY steady state — a null degrades to the box with a dev warning.
	 */
	getFocusEl?: () => HTMLElement | null | undefined;
	/** Escape hatch only: the clamp derives from a declared `reservedChrome.isCollapsed`. */
	isCollapsed?: () => boolean;
	/** View-state hooks handed to a minted block command as `ctx.hooks`; typed `unknown`. */
	commandHooks?: () => unknown;
	/** Ambient prefix painted before the FIRST child's bytes — the listItem `- ` model. */
	getAmbientPrefix?: () => AmbientPrefix;
}

/**
 * The `BlockList` props the host spreads onto its rendered `<BlockList>`. Authored
 * rather than derived, so an internal prop edit fails the check below instead of
 * silently rewriting this contract.
 */
export interface ContainerBlockListProps {
	children: readonly NodeView[];
	blockIds: string[];
	slots: RefSlots<BlockComponent>;
	parentPath?: number[];
	window?: WindowResult;
	reorderable?: boolean;
	ambientPrefixForFirst?: AmbientPrefix;
}

// Two-way: BlockList accepts everything the contract promises (contract ⊆ component),
// and its props for those keys still satisfy the contract (component ⊆ contract).
type _BlockListAccepts =
	ContainerBlockListProps extends Pick<
		ComponentProps<typeof BlockList>,
		keyof ContainerBlockListProps
	>
		? true
		: never;
type _ContractCovers =
	Pick<
		ComponentProps<typeof BlockList>,
		keyof ContainerBlockListProps
	> extends ContainerBlockListProps
		? true
		: never;
const _conforms: [_BlockListAccepts, _ContractCovers] = [true, true];

// Re-exported so the plugin barrel surfaces it from the seam an author actually calls.
export type { ContainerBlockComponent };

export interface ContainerBlock {
	/** Spread onto `<BlockList {...blockListProps} />` inside the chrome box. */
	blockListProps: ContainerBlockListProps;
	/** The live EFFECTIVE mode, for gating edit affordances. Preferred over the DOM probe. */
	getPresentationMode(): PresentationMode;
	/**
	 * The live editor theme name (`data-editor-theme`). A body painted by an engine
	 * rather than CSS must key its render on this and re-render when it changes.
	 */
	getTheme(): string;
	/** The `BlockComponent` surface the host re-exports for BlockHost. */
	containerApi: ContainerBlockComponent;
	/**
	 * Commit a shallow metadata patch on THIS container as one undoable entry, through
	 * the kind's `rebuildRaw`. `afterTick` runs once the commit's DOM has settled.
	 */
	updateOwnMetadata(
		patch: Record<string, unknown>,
		afterTick?: CommitAfterTick
	): void | Promise<void>;
	/**
	 * Attach to the chrome box: a chord bubbling from an inner leaf resolves against
	 * this kind's keymap. Kind-only, so a bubbled undo/redo never double-fires.
	 */
	handleKeydown(e: KeyboardEvent): void;
	/**
	 * Hand the caret to the neighbour a plain arrow points at — the boundary exit for a
	 * plugin-owned editable whose caret has reached its own edge. Routes through the
	 * editor's focus traversal, so the landing inherits skip-non-focusable, container
	 * entry and windowing reveal. False for a modified or non-arrow key: leave it native.
	 */
	moveFocusOut(e: KeyboardEvent): boolean;
}

// ── Collapse gates ───────────────────────────────────────────────────────────

/**
 * Collapse-ness has ONE definition: the descriptor's `reservedChrome.isCollapsed`
 * probe. An explicit dep is dev-cross-checked against it, except in reading mode,
 * which cannot write — a reader's open section is legitimately ahead of the document.
 */
export function composeCollapseProbe(
	explicit: (() => boolean) | undefined,
	getNode: () => NodeView,
	getPresentationMode?: () => PresentationMode
): () => boolean {
	if (!explicit) return () => isCollapsedContainer(getNode());
	return () => {
		const value = explicit();
		if (DEV && value !== isCollapsedContainer(getNode()) && !isReadingMode(getPresentationMode)) {
			devWarn(
				'plugin-container',
				`isCollapsed dep disagrees with the declared reservedChrome.isCollapsed probe for kind "${getNode().kind}"`
			);
		}
		return value;
	};
}

/**
 * The expand door a reveal opens before descending into a collapsed body. Commits
 * `reservedChrome.expandPatch` as a real undoable edit, not a view-only divergence
 * from the CST; declines in reading mode, which commits nothing.
 */
export function composeExpandDoor(deps: {
	getNode: () => NodeView;
	isCollapsed: () => boolean;
	getPresentationMode: () => PresentationMode;
	commit: (patch: Record<string, unknown>) => void | Promise<void>;
}): () => Promise<boolean> {
	return async () => {
		if (!deps.isCollapsed() || isReadingMode(deps.getPresentationMode)) return false;
		const patch = expandContainerPatch(deps.getNode());
		if (!patch) return false;
		await deps.commit(patch);
		return true;
	};
}

/** While collapsed the body is unmounted, so `descendToBody` would mint an invisible one. */
export function gateDescendOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	descend: (innerIndex: number) => void | Promise<void>
): (innerIndex: number) => Promise<void> {
	return async (innerIndex) => {
		if (isCollapsed?.()) return;
		await descend(innerIndex);
	};
}

/**
 * While collapsed only the chrome row is mounted, so an interior `moveFocus`
 * targeting a body index dead-ends on the unmounted ref. Route body targets past the
 * container instead — the same exit an open container's past-end move takes.
 */
export function gateMoveFocusOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	moveWithin: FocusActions['moveFocus'],
	parentFocus: FocusActions,
	getIndex: () => number
): FocusActions['moveFocus'] {
	return async (innerIndex, position, options?: MoveFocusOptions) => {
		if (innerIndex >= 1 && isCollapsed?.()) {
			// Omit the options arg when unset, mirroring dispatchMoveFocus's own delegation.
			if (options) await parentFocus.moveFocus(getIndex() + 1, position, options);
			else await parentFocus.moveFocus(getIndex() + 1, position);
			return;
		}
		await moveWithin(innerIndex, position, options);
	};
}

export type NestedActionsOverrides = ReturnType<NestedActionsOverrideFactory>;

/** Each surface spreads its base first: a gate ADDS a member, never replaces one. */
export function composeCollapseGates(
	base: NestedActionsOverrides,
	gates: {
		descendToBody: NonNullable<BlockEditActions['descendToBody']>;
		moveFocus: FocusActions['moveFocus'];
	}
): NestedActionsOverrides {
	return {
		...base,
		blockEdit: { ...base.blockEdit, descendToBody: gates.descendToBody },
		focus: { ...base.focus, moveFocus: gates.moveFocus }
	};
}

// ── Kind-command target ──────────────────────────────────────────────────────

/**
 * The kind-command target a plugin container bubbles into `dispatchKindCommand`.
 * `runCommand` is inert — a plugin container owns no built-in kind commands, so a
 * chord resolves only through a registered one. The `?? ''` arm gives an unowned kind
 * the base per-instance EditorContext.
 */
export function buildContainerKindTarget(
	deps: Pick<ContainerBlockDeps, 'getNode' | 'commandHooks'>,
	updateOwnMetadata: ContainerBlock['updateOwnMetadata'],
	pluginEditor?: PluginEditorLookup
): KindCommandTarget {
	return {
		get kind() {
			return deps.getNode().kind;
		},
		runCommand: () => false,
		getCommandContext: () => ({
			node: deps.getNode(),
			updateMetadata: (patch) => {
				void updateOwnMetadata(patch);
			},
			hooks: deps.commandHooks?.(),
			editor: pluginEditor?.(pluginKindOwner(deps.getNode().kind) ?? '')
		})
	};
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createContainerBlock(deps: ContainerBlockDeps): ContainerBlock {
	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const {
		controller,
		stickyColumn,
		edgeAffinity,
		selection,
		reorder,
		events: editorEvents,
		registryView
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		presentationMode: getPresentationMode,
		theme: getTheme
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const editorDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY);
	const pluginEditor = editorDoc?.pluginEditor;
	const linkRef = editorDoc?.linkRef;

	const listState = createBlockListState(deps.getNode);

	// One live scope over the frozen thunks, shared by every factory this seam wires.
	// Passed by reference, never spread — spreading would snapshot the getters.
	const scope: NodeScope = {
		get index() {
			return deps.getIndex();
		},
		get node() {
			return deps.getNode();
		},
		get path() {
			return deps.getPath();
		}
	};

	const collapsed = composeCollapseProbe(deps.isCollapsed, deps.getNode, getPresentationMode);

	const blockquoteOverrides = createBlockquoteOverrides({
		scope,
		state: listState,
		parentBlockEdit,
		parentFocus,
		controller
	});

	// All three override the same `defaults`, so they coexist; for a non-collapsing
	// container the gates are inert.
	const overrideFactory: NestedActionsOverrideFactory = (defaults) =>
		composeCollapseGates(blockquoteOverrides(defaults), {
			descendToBody: gateDescendOnCollapse(collapsed, defaults.blockEdit.descendToBody),
			moveFocus: gateMoveFocusOnCollapse(
				collapsed,
				defaults.focus.moveFocus,
				parentFocus,
				deps.getIndex
			)
		});

	const bundle = createStandardNestedActions(
		listState,
		{
			scope,
			stickyColumn,
			grammar: registryView.grammar,
			getPresentationMode,
			linkRef,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		overrideFactory
	);

	setNestedActionsContexts(bundle);

	const windowing = useContainerWindowing({
		getIndex: deps.getIndex,
		getParentPath: deps.getPath,
		getChildren: () => deps.getNode().children ?? [],
		getChildIds: () => listState.innerBlockIds,
		getListEl: () => deps.getBoxEl()?.querySelector(':scope > .block-list') ?? null,
		getOwnEl: () => deps.getBoxEl()?.closest('.block-host') ?? null,
		provideLeafChannel: true,
		isCollapsed: collapsed
	});

	// One composed surface feeds the shim AND the keydown gate, so a fallback-focused
	// box passes the same containment check the affordances use.
	const wholeBlockSurface = deps.getFocusEl
		? composeWholeBlockFocusSurface(
				deps.getFocusEl,
				() => deps.getBoxEl(),
				() => deps.getNode().kind
			)
		: undefined;

	// Through a closure, not the `updateOwnMetadata` value: that const is declared
	// below, and is only ever read at reveal time.
	const expandCollapsed = composeExpandDoor({
		getNode: deps.getNode,
		isCollapsed: collapsed,
		getPresentationMode,
		commit: (patch) => updateOwnMetadata(patch)
	});

	const containerApi = createContainerBlockComponent({
		selection,
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		refSlots: listState.refSlots,
		get nodeChildrenLength() {
			return deps.getNode().children?.length ?? 0;
		},
		get node() {
			return deps.getNode();
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow,
		isCollapsed: collapsed,
		expandCollapsed,
		getFocusEl: wholeBlockSurface,
		getBoxEl: () => deps.getBoxEl()
	});

	const blockListProps: ContainerBlockListProps = {
		get children() {
			return deps.getNode().children ?? [];
		},
		get blockIds() {
			return listState.innerBlockIds;
		},
		slots: listState.refSlots,
		get parentPath() {
			return deps.getPath();
		},
		get window() {
			return windowing.window;
		},
		// Opaque containers are a reorder boundary, so a handle on a chrome or body row
		// would be dead; the container itself reorders through its parent's BlockList.
		reorderable: false,
		get ambientPrefixForFirst() {
			return deps.getAmbientPrefix?.() ?? '';
		}
	};

	const updateOwnMetadata: ContainerBlock['updateOwnMetadata'] = (patch, afterTick) =>
		parentBlockEdit.updateBlockMetadata(deps.getIndex(), patch, { afterTick });

	const kindTarget = buildContainerKindTarget(deps, updateOwnMetadata, pluginEditor);

	const globalChordDeps = {
		getKind: () => deps.getNode().kind,
		history,
		pluginEditor,
		onCommandError: (report: Parameters<typeof emitCommandError>[1]) =>
			emitCommandError(editorEvents, report),
		getKeybindingOverrides: keybindingOverrides,
		isReading: () => isReadingMode(getPresentationMode)
	};

	const handleKeydown = (e: KeyboardEvent): void => {
		if (e.defaultPrevented) return;
		const chord = eventToChord(e);
		// Own-surface only: a chord bubbling from an inner leaf already met the global tier
		// there, and re-firing it here would double-fire.
		if (chord && ownsWholeBlockFocus(e) && handleEditorGlobalChord(chord, globalChordDeps)) {
			e.preventDefault();
			return;
		}
		if (
			chord &&
			dispatchKindCommand(
				chord,
				kindTarget,
				keybindingOverrides(),
				(report) => emitCommandError(editorEvents, report),
				getPresentationMode
			)
		) {
			e.preventDefault();
			return;
		}
		handleWholeBlockKeydown(e);
	};

	const moveFocusOut = (e: KeyboardEvent): boolean => {
		if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
		// Classified through the doors before the move (G2.10 / G4.31). A plugin editable
		// exposes no caret X to measure, so a vertical exit carries the column it arrived
		// with, exactly as a whole-block pass-through does.
		stickyColumn.noteKey(e);
		edgeAffinity.note(e);
		return focusAcrossBlockEdge(e.key, { getIndex: deps.getIndex, focus: parentFocus });
	};

	// The three gates keep a focused sibling (a toolbar button would double-fire its click
	// and an Enter split) and a plugin's own editable surface untouched.
	function ownsWholeBlockFocus(e: KeyboardEvent): boolean {
		if (!wholeBlockSurface) return false;
		const focusEl = wholeBlockSurface();
		if (!focusEl || !focusEl.contains(document.activeElement)) return false;
		return !isEditableEventTarget(e.target);
	}

	// The whole-block-focus affordances, dispatched from the wrapper's bubble phase.
	function handleWholeBlockKeydown(e: KeyboardEvent): void {
		if (!ownsWholeBlockFocus(e)) return;

		// A whole-block surface is tabindex-focusable independent of contenteditable,
		// so this path is live in reading mode: arrows stay, edits gate.
		const reading = isReadingMode(getPresentationMode);

		// Alt-arrow reorder is inline because `runCommand` is inert here, so unlike
		// ThematicBreak it cannot come from dispatchKindCommand.
		if (e.key === 'ArrowUp' && e.altKey) {
			e.preventDefault();
			if (!reading) void reorder.nudgeReorderUnit(deps.getPath(), -1);
			return;
		}
		if (e.key === 'ArrowDown' && e.altKey) {
			e.preventDefault();
			if (!reading) void reorder.nudgeReorderUnit(deps.getPath(), 1);
			return;
		}

		handleWholeBlockKeys(e, {
			getIndex: deps.getIndex,
			getRaw: () => deps.getNode().raw,
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			isReading: () => reading,
			stickyColumn,
			edgeAffinity
		});
	}

	return {
		blockListProps,
		containerApi,
		updateOwnMetadata,
		handleKeydown,
		moveFocusOut,
		getPresentationMode,
		getTheme
	};
}
