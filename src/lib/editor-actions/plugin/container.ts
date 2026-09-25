/**
 * What a plugin's container component builds on: the built-in container wiring in one
 * factory, so a plugin never touches an editor context key. Call synchronously during
 * component init: `getContext` reads the ancestor contexts and `useContainerWindowing`
 * sets its own.
 */

import { isDevChecks } from '../../env';
import { getContext } from 'svelte';
import type { ComponentProps } from 'svelte';
// Type only, erased at build: no runtime import of `components/` here. It is for the
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
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { expandContainerPatch, isCollapsedContainer } from '../../schema/reserved-chrome';
import { dispatchKindCommand, type KindCommandTarget } from '../../schema/block-commands';
import { eventToChord } from '../../schema/keybindings';
import { isReadingMode, type PresentationMode } from '../../presentation-mode';
import { devWarn } from '../../dev-warn';
import { blockAccessibleName } from '../../a11y-strings';
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
import { captureScrollPosition } from '../../cursor/scroll-hold';
import { emitCommandError } from '../../editor-events';
import type { EditorContext } from '../../schema/plugin-install';
import { owningPluginEditor } from '../../schema/plugin-kind';
import { createBlockListState } from '../../reactivity/block-list-state.svelte';
import type { WindowResult } from '../../reactivity/block-window.svelte';
import type { RefSlots } from '../../reactivity/publish-ref.svelte';
import { useContainerWindowing } from '../../reactivity/use-container-windowing.svelte';
import { createContainerExitOverrides } from '../container-exit-overrides';
import {
	createContainerBlockComponent,
	focusAcrossBlockEdge,
	handleEditorGlobalChord,
	handleWholeBlockKeys
} from '../container-block-component';
import {
	composeWholeBlockFocusSurface,
	createWholeBlockInputProxy,
	holdsWholeBlockFocus,
	isEditableEventTarget
} from '../whole-block-focus-surface';
import {
	createStandardNestedActions,
	setNestedActionsContexts,
	type NestedActionsOverrideFactory,
	type NodeScope
} from '../nested/nested-actions';

/**
 * The inputs the host component feeds in. A function-valued field is a live read,
 * re-evaluated on every use; a plain-valued field is static configuration. `getBoxEl` returns
 * the block's box, whose direct `.block-list` child windowing reads (other elements may sit
 * beside it). It must read a `$state` element, or the list's first height guesses, made
 * before the box exists, are never redone.
 */
export interface ContainerBlockDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	getBoxEl(): HTMLElement | undefined;
	/**
	 * Opt into whole-block focus for a childless container: the element that takes DOM
	 * focus. The kind must also declare `blockFocus: 'whole-block'`. Supply an element for
	 * every steady state; a null falls back to the box with a dev warning.
	 */
	getFocusEl?: () => HTMLElement | null | undefined;
	/** Escape hatch only: the collapsed state comes from a declared `reservedChrome.isCollapsed`. */
	isCollapsed?: () => boolean;
	/** View-state hooks handed to a block command as `ctx.hooks`; typed `unknown`. */
	commandHooks?: () => unknown;
	/** The marker prefix drawn before the first child's bytes, like a list item's `- `. */
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

// Two-way: BlockList accepts everything the contract promises (contract within component),
// and its props for those keys still satisfy the contract (component within contract).
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

// Re-exported so the plugin barrel exports it from the module an author actually calls.
export type { ContainerBlockComponent };

export interface ContainerBlock {
	/** Spread onto `<BlockList {...blockListProps} />` inside the block's box. */
	blockListProps: ContainerBlockListProps;
	/** The live effective mode, for disabling edit controls. Preferred over reading the DOM. */
	getPresentationMode(): PresentationMode;
	/**
	 * The live editor theme name (`data-editor-theme`). A body drawn by a rendering library
	 * rather than CSS must key its render on this and re-render when it changes.
	 */
	getTheme(): string;
	/**
	 * This editor instance's options for the plugin owning this block's kind, from its
	 * `{ plugin, options }` entry, so two editors in one process configure the same kind
	 * differently. `unknown`, like `commandHooks`: the plugin narrows it.
	 */
	getOptions(): unknown;
	/** This editor's context for the plugin that owns this block's kind; undefined in a bare
	 *  harness. Its `computeInlineContent` reads the inline syntax this editor draws. */
	getEditor(): EditorContext | undefined;
	/** The `BlockComponent` the host re-exports for BlockHost. */
	containerApi: ContainerBlockComponent;
	/**
	 * Commit a shallow metadata patch on this container as one undo entry, through the
	 * kind's `rebuildRaw`. `afterTick` runs once the commit's DOM has rendered.
	 */
	updateOwnMetadata(
		patch: Record<string, unknown>,
		afterTick?: CommitAfterTick
	): void | Promise<void>;
	/**
	 * Attach to the block's box: a chord bubbling from an inner leaf resolves against this
	 * kind's keymap. Kind keymap only, so a bubbled undo or redo never fires twice.
	 */
	handleKeydown(e: KeyboardEvent): void;
	/**
	 * Hand the caret to the neighbour a plain arrow points at: the exit for a plugin's own
	 * editor whose caret has reached its edge. Goes through the editor's focus traversal, so
	 * the move skips unfocusable blocks, enters containers and scrolls unmounted targets
	 * into view. False for a modified or non-arrow key: leave it to the browser.
	 */
	moveFocusOut(e: KeyboardEvent): boolean;
	/**
	 * The user's scroll position, read now. Call before a state change that swaps this
	 * block's view for one of a different height, then await the returned restore: the
	 * scroll container is back where it was once the swap has rendered. A scroll-into-view
	 * in progress takes priority, and the restore does nothing.
	 */
	captureScrollPosition(): () => Promise<void>;
}

// ── Collapsed-container checks ───────────────────────────────────────────────

/**
 * "Collapsed" has one definition: the descriptor's `reservedChrome.isCollapsed`. An explicit
 * dep is checked against it in dev, except in reading mode, which cannot write: there a
 * section the user opened is legitimately ahead of the document.
 */
export function composeCollapseProbe(
	explicit: (() => boolean) | undefined,
	getNode: () => NodeView,
	getPresentationMode?: () => PresentationMode
): () => boolean {
	if (!explicit) return () => isCollapsedContainer(getNode());
	return () => {
		const value = explicit();
		if (
			isDevChecks() &&
			value !== isCollapsedContainer(getNode()) &&
			!isReadingMode(getPresentationMode)
		) {
			devWarn(
				'plugin-container',
				`isCollapsed dep disagrees with the declared reservedChrome.isCollapsed probe for kind "${getNode().kind}"`
			);
		}
		return value;
	};
}

/**
 * The expand a scroll-into-view runs before descending into a collapsed body. Commits
 * `reservedChrome.expandPatch` as a real undoable edit, not a view that disagrees with the
 * CST; declines in reading mode, which commits nothing.
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

/**
 * The `updateOwnMetadata` check: reading mode writes no bytes (plugin-contract.md), so the
 * commit declines as a no-op and dev mode names the kind that asked.
 */
export function composeMetadataDoor(deps: {
	getNode: () => NodeView;
	getPresentationMode: () => PresentationMode;
	commit: (patch: Record<string, unknown>, afterTick?: CommitAfterTick) => void | Promise<void>;
}): ContainerBlock['updateOwnMetadata'] {
	return (patch, afterTick) => {
		if (isReadingMode(deps.getPresentationMode)) {
			devWarn(
				'plugin-container',
				`updateOwnMetadata declined: reading mode writes no bytes (kind "${deps.getNode().kind}")`
			);
			return;
		}
		return deps.commit(patch, afterTick);
	};
}

/** While collapsed the body is unmounted, so `descendToBody` would create an invisible one. */
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
 * While collapsed only the title row is mounted, so an interior `moveFocus` aimed at a body
 * index stops on the unmounted ref. Body targets go past the container instead, the same
 * exit an open container's past-the-end move takes.
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

/** Each group spreads its base first: a check adds a member, never replaces one. */
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
 * The kind-command target a plugin container hands to `dispatchKindCommand`. `runCommand`
 * is inert: a plugin container owns no built-in kind commands, so a chord resolves only
 * through a registered one.
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
			editor: owningPluginEditor(pluginEditor, deps.getNode().kind)
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
		stickyColumn,
		edgeAffinity,
		selection,
		reorder,
		revealAnchor,
		events: editorEvents,
		registryView,
		activePlugins
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		presentationMode: getPresentationMode,
		theme: getTheme
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const { pluginEditor, linkRef } = getContext<EditorDoc>(EDITOR_DOC_KEY);

	// Resolved by the kind's recorded owner, like the kind-command context's `editor`.
	const getEditor = (): EditorContext | undefined =>
		owningPluginEditor(pluginEditor, deps.getNode().kind);
	const getOptions = (): unknown => getEditor()?.options;

	const listState = createBlockListState(deps.getNode);

	// One live scope over the deps' getters, shared by every factory wired here. Passed by
	// reference, never spread, since spreading would snapshot the getters.
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

	const containerExitOverrides = createContainerExitOverrides({ scope, parentBlockEdit });

	// All three override the same `defaults`, so they coexist; for a container that cannot
	// collapse the checks are inert.
	const overrideFactory: NestedActionsOverrideFactory = (defaults) =>
		composeCollapseGates(containerExitOverrides(defaults), {
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

	// One composed focus element feeds the component and the keydown check, so a box focused
	// by the fallback passes the same containment check the key handling uses.
	const wholeBlockSurface = deps.getFocusEl
		? composeWholeBlockFocusSurface(
				deps.getFocusEl,
				() => deps.getBoxEl(),
				() => deps.getNode().kind
			)
		: undefined;

	// The editing host AltGr and IME input arrive through: keydown alone drops both, and a
	// whole-block kind has no editable element of its own to catch them.
	const inputProxy = wholeBlockSurface
		? createWholeBlockInputProxy({
				getBoxEl: () => deps.getBoxEl(),
				getFocusEl: wholeBlockSurface,
				isReading: () => isReadingMode(getPresentationMode),
				getLabel: () => blockAccessibleName(deps.getNode()),
				mint: (text) => void parentBlockEdit.insertParagraph(deps.getIndex() + 1, text)
			})
		: undefined;

	// Through a closure, not the `updateOwnMetadata` value: that const is declared below,
	// and is only ever read when a scroll-into-view expands the container.
	const expandCollapsed = composeExpandDoor({
		getNode: deps.getNode,
		isCollapsed: collapsed,
		getPresentationMode,
		commit: (patch) => updateOwnMetadata(patch)
	});

	const containerApi = createContainerBlockComponent({
		// The kind's descriptor is the declaration; the mounted component only reports it.
		get editable() {
			return getBlockKindDescriptor(deps.getNode().kind).editable;
		},
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
		getBoxEl: () => deps.getBoxEl(),
		inputProxy
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
		// A plugin container is a reorder boundary, so a drag handle on a title or body row
		// would be dead; the container itself reorders through its parent's BlockList.
		reorderable: false,
		get ambientPrefixForFirst() {
			return deps.getAmbientPrefix?.() ?? '';
		}
	};

	const updateOwnMetadata = composeMetadataDoor({
		getNode: deps.getNode,
		getPresentationMode,
		commit: (patch, afterTick) =>
			parentBlockEdit.updateBlockMetadata(deps.getIndex(), patch, { afterTick })
	});

	const kindTarget = buildContainerKindTarget(deps, updateOwnMetadata, pluginEditor);

	const globalChordDeps = {
		getKind: () => deps.getNode().kind,
		history,
		pluginEditor,
		onCommandError: (report: Parameters<typeof emitCommandError>[1]) =>
			emitCommandError(editorEvents, report),
		getKeybindingOverrides: keybindingOverrides,
		isReading: () => isReadingMode(getPresentationMode),
		activation: activePlugins
	};

	const handleKeydown = (e: KeyboardEvent): void => {
		if (e.defaultPrevented) return;
		const chord = eventToChord(e);
		// Only when this block itself holds focus: a chord bubbling from an inner leaf already
		// met the global chords there, and running it here would fire it twice.
		if (chord && ownsWholeBlockFocus(e) && handleEditorGlobalChord(chord, globalChordDeps)) {
			e.preventDefault();
			return;
		}
		if (
			chord &&
			dispatchKindCommand(
				chord,
				kindTarget,
				// A chord bubbling to a container carries no range command: the leaf below owns the format ids.
				{
					getPresentationMode,
					activation: activePlugins,
					isCrossBlockRange: () => selection.isCrossBlock,
					crossBlockCommands: undefined
				},
				keybindingOverrides(),
				(report) => emitCommandError(editorEvents, report)
			)
		) {
			e.preventDefault();
			return;
		}
		handleWholeBlockKeydown(e);
	};

	const moveFocusOut = (e: KeyboardEvent): boolean => {
		if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
		// Classified by the key classifiers before the move (G2.10, G4.31). A plugin editor
		// exposes no caret x to measure, so a vertical exit keeps the column it arrived with,
		// exactly as a whole-block pass-through does.
		stickyColumn.noteKey(e);
		edgeAffinity.note(e);
		return focusAcrossBlockEdge(e.key, { getIndex: deps.getIndex, focus: parentFocus });
	};

	// The three checks keep a focused sibling (a toolbar button would fire its click and an
	// Enter split) and a plugin's own editor untouched.
	function ownsWholeBlockFocus(e: KeyboardEvent): boolean {
		if (!wholeBlockSurface) return false;
		const proxy = inputProxy?.el();
		// Identity, not the attribute alone: a proxy keydown bubbling up from a nested block
		// would otherwise read as this one's.
		if (proxy && e.target === proxy) return true;
		const focusEl = wholeBlockSurface();
		if (!holdsWholeBlockFocus(focusEl, proxy)) return false;
		return !isEditableEventTarget(e.target);
	}

	// The whole-block key handling, dispatched from the wrapper's bubble phase.
	function handleWholeBlockKeydown(e: KeyboardEvent): void {
		if (!ownsWholeBlockFocus(e)) return;

		// A whole-block element is focusable by tabindex regardless of contenteditable, so
		// this path is live in reading mode: arrows work, edits are blocked.
		const reading = isReadingMode(getPresentationMode);

		// Alt-arrow reorder is inline because `runCommand` is inert here, so unlike
		// ThematicBreak it cannot come from dispatchKindCommand.
		if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
			e.preventDefault();
			if (!reading) void reorder.nudgeReorderUnit(deps.getPath(), e.key === 'ArrowUp' ? -1 : 1);
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
		captureScrollPosition: () =>
			captureScrollPosition(deps.getBoxEl(), () => revealAnchor.get() !== null),
		getPresentationMode,
		getTheme,
		getOptions,
		getEditor
	};
}
