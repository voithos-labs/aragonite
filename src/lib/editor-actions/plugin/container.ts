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
import type { BlockEditActions, FocusActions, MoveFocusOptions } from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import type { AmbientPrefix, BlockComponent, ContainerBlockComponent } from '../../block-component';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { expandContainerPatch, isCollapsedContainer } from '../../schema/reserved-chrome';
import type { KindCommandTarget } from '../../schema/block-commands';
import { commandForKey } from '../../schema/commands';
import { isReadingMode, type PresentationMode } from '../../presentation-mode';
import { devWarn } from '../../dev-warn';
import { blockAccessibleName } from '../../a11y-strings';
import {
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices
} from '../../editor-keys';
import { captureScrollPosition } from '../../cursor/scroll-hold';
import type { EditorContext } from '../../schema/plugin-install';
import { componentPluginEditor } from '../../schema/block-component-registry';
import type { WindowResult } from '../../reactivity/block-window.svelte';
import type { RefSlots } from '../../reactivity/publish-ref.svelte';
import type { ChildList } from '../../reactivity/child-list';
import { useContainerWindowing } from '../../reactivity/use-container-windowing.svelte';
import { createContainerExitOverrides } from '../container-exit-overrides';
import { delegateMoveFocus } from '../focus/focus-dispatch';
import {
	createContainerBlockComponent,
	dispatchContainerChord,
	dispatchWholeBlockGlobalChord,
	focusAcrossBlockEdge,
	handleWholeBlockKeys
} from '../container-block-component';
import {
	composeWholeBlockFocusSurface,
	createWholeBlockInputProxy,
	holdsWholeBlockFocus,
	isEditableEventTarget
} from '../whole-block-focus-surface';
import type { NestedActionsOverrideFactory } from '../nested/nested-actions';
import { createContainerActions } from '../nested/container-actions';

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
	/** The element that takes DOM focus, opting a childless container into whole-block focus (the
	 *  kind also declares `blockFocus: 'whole-block'`); null falls back to the box, with a dev warning. */
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
	/** This editor's options for the plugin owning this block's kind (its `{ plugin, options }`
	 *  entry), so two editors can configure one kind differently. `unknown`: the plugin narrows it. */
	getOptions(): unknown;
	/** This editor's context for the plugin that owns this block's kind; undefined in a bare
	 *  harness. Its `computeInlineContent` reads the inline syntax this editor draws. */
	getEditor(): EditorContext | undefined;
	/** The `BlockComponent` the host re-exports for BlockHost. */
	containerApi: ContainerBlockComponent;
	/** Commit a shallow metadata patch as one undo entry, through the kind's `rebuildRaw`; the commit
	 *  puts the caret at `caret`, relative to this container (`[]` is the block), once it renders. */
	updateOwnMetadata(
		patch: Record<string, unknown>,
		options?: { caret?: { path: number[]; offset: number } }
	): void | Promise<void>;
	/**
	 * Attach to the block's box: a chord bubbling from an inner leaf resolves against this
	 * kind's keymap. Kind keymap only, so a bubbled undo or redo never fires twice.
	 */
	handleKeydown(e: KeyboardEvent): void;
	/** Hand the caret, through the editor's focus traversal, to the neighbour a plain arrow points
	 *  at once a plugin editor's caret reaches its edge. False for a modified or non-arrow key. */
	moveFocusOut(e: KeyboardEvent): boolean;
	/** Read the scroll position before swapping this block's view for one of another height, and
	 *  await the returned restore after the swap renders. A scroll-into-view in progress wins. */
	captureScrollPosition(): () => Promise<void>;
}

// ── Collapsed-container checks ───────────────────────────────────────────────

/** Collapsed means the descriptor's `reservedChrome.isCollapsed`; a dev build checks an explicit dep
 *  against it, except in reading mode, where a section the user opened is ahead of the document. */
export function composeCollapseProbe(
	explicit: (() => boolean) | undefined,
	getNode: () => NodeView,
	getPresentationMode: () => PresentationMode
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

/** Open a collapsed body before a descent goes into it, as an undoable commit of
 *  `reservedChrome.expandPatch`; declines in reading mode, which commits nothing. */
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

/** While collapsed the body is unmounted, so `descendToBody` would create an invisible one. */
export function gateDescendOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	descend: (innerIndex: number) => Promise<boolean>
): (innerIndex: number) => Promise<boolean> {
	return async (innerIndex) => {
		if (isCollapsed?.()) return false;
		return descend(innerIndex);
	};
}

/** While collapsed only the title row is mounted, so a `moveFocus` at a body index goes past the
 *  container instead, as an open container's past-the-end move does. */
export function gateMoveFocusOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	moveWithin: FocusActions['moveFocus'],
	parentFocus: FocusActions,
	getIndex: () => number
): FocusActions['moveFocus'] {
	return async (innerIndex, position, options?: MoveFocusOptions) => {
		if (innerIndex >= 1 && isCollapsed?.()) {
			await delegateMoveFocus(parentFocus, getIndex() + 1, position, options);
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

/** The kind-command target a plugin container hands to `dispatchKindCommand`. It has no
 *  `runCommand`, since a plugin container owns no built-in kind commands. */
export function buildContainerKindTarget(
	deps: Pick<ContainerBlockDeps, 'getNode' | 'commandHooks'>,
	updateOwnMetadata: ContainerBlock['updateOwnMetadata']
): KindCommandTarget {
	return {
		get kind() {
			return deps.getNode().kind;
		},
		getCommandContext: () => ({
			node: deps.getNode(),
			updateMetadata: (patch) => {
				void updateOwnMetadata(patch);
			},
			hooks: deps.commandHooks?.()
		})
	};
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createContainerBlock(deps: ContainerBlockDeps): ContainerBlock {
	const { caretMemory, selection, revealAnchor, commands } =
		getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { theme: getTheme } = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const { pluginEditor, reading } = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const getPresentationMode = reading.mode;

	const getEditor = (): EditorContext | undefined =>
		componentPluginEditor(pluginEditor, deps.getNode().kind);
	const getOptions = (): unknown => getEditor()?.options;

	const collapsed = composeCollapseProbe(deps.isCollapsed, deps.getNode, getPresentationMode);

	const {
		state: listState,
		parent: { blockEdit: parentBlockEdit, focus: parentFocus }
	} = createContainerActions({
		getNode: deps.getNode,
		getIndex: deps.getIndex,
		getPath: deps.getPath,
		childList: () => childList,
		// The exit rules and the collapse gates override the same defaults, so they coexist; for a
		// container that cannot collapse the gates are inert.
		overrides:
			({ scope, parent, reading }) =>
			(defaults) =>
				composeCollapseGates(
					createContainerExitOverrides({ scope, parentBlockEdit: parent.blockEdit, reading })(
						defaults
					),
					{
						descendToBody: gateDescendOnCollapse(collapsed, defaults.blockEdit.descendToBody),
						moveFocus: gateMoveFocusOnCollapse(
							collapsed,
							defaults.focus.moveFocus,
							parent.focus,
							deps.getIndex
						)
					}
				)
	});

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

	const childList: ChildList = {
		count: () => deps.getNode().children?.length ?? 0,
		refs: listState.refSlots,
		windowing,
		isCollapsed: collapsed,
		// Through a closure, not the `updateOwnMetadata` value: that const is declared below.
		openCollapsed: composeExpandDoor({
			getNode: deps.getNode,
			isCollapsed: collapsed,
			getPresentationMode,
			commit: (patch) => updateOwnMetadata(patch)
		})
	};

	const containerApi = createContainerBlockComponent({
		// The kind's descriptor is the declaration; the mounted component only reports it.
		get editable() {
			return getBlockKindDescriptor(deps.getNode().kind).editable;
		},
		selection,
		reading,
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		childList,
		get node() {
			return deps.getNode();
		},
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
		// The same declaration the keyboard's reorder reads, so a drag moves what Alt+Arrow moves.
		get reorderable() {
			return getBlockKindDescriptor(deps.getNode().kind).reorderChildren !== undefined;
		},
		get ambientPrefixForFirst() {
			return deps.getAmbientPrefix?.() ?? '';
		}
	};

	// Reading mode declines at the commit, which names the write in a dev build.
	const updateOwnMetadata: ContainerBlock['updateOwnMetadata'] = async (patch, options) => {
		await parentBlockEdit.updateBlockMetadata(deps.getIndex(), patch, options);
	};

	const kindTarget = buildContainerKindTarget(deps, updateOwnMetadata);
	// Focused as a whole, the block is the one a reorder chord moves; a key bubbling from an
	// inner leaf was that leaf's to move.
	const wholeBlockTarget: KindCommandTarget = {
		get kind() {
			return kindTarget.kind;
		},
		getCommandContext: kindTarget.getCommandContext,
		getPath: deps.getPath
	};

	const commandOf = (e: KeyboardEvent) => commandForKey(e, deps.getNode().kind, commands);

	const handleKeydown = (e: KeyboardEvent): void => {
		if (e.defaultPrevented) return;
		const ownsFocus = ownsWholeBlockFocus(e);
		// Only when this block itself holds focus: a chord bubbling from an inner leaf already
		// met the global chords there, and running it here would fire it twice.
		if (ownsFocus && dispatchWholeBlockGlobalChord(e, deps.getNode().kind, commands)) return;
		if (dispatchContainerChord(e, ownsFocus ? wholeBlockTarget : kindTarget, commands)) return;
		if (ownsFocus) handleWholeBlockKeydown(e);
	};

	const moveFocusOut = (e: KeyboardEvent): boolean => {
		if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
		// A plugin editor exposes no caret x to measure, so a vertical exit keeps the column it
		// arrived with, exactly as a whole-block pass-through does.
		caretMemory.noteKey(e, commandOf(e));
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

	// The whole-block key handling, dispatched from the wrapper's bubble phase. A whole-block
	// element is focusable by tabindex regardless of contenteditable, so it runs in reading mode.
	function handleWholeBlockKeydown(e: KeyboardEvent): void {
		handleWholeBlockKeys(e, {
			getIndex: deps.getIndex,
			getRaw: () => deps.getNode().raw,
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			isReading: () => isReadingMode(getPresentationMode),
			caretMemory,
			commandOf
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
