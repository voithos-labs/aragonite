/**
 * The container-authoring seam a plugin block component builds on. Collapses the
 * built-in container wiring — block-list state, nested actions + the five ancestor
 * contexts, container-exit override, nested windowing, and the `BlockComponent`
 * shim — into one factory, so a plugin never touches an editor context key or the
 * internal helpers. Mirrors `BlockquoteBlock`'s wiring exactly; the plugin supplies
 * only its own chrome around the returned `BlockList` props.
 *
 * Call synchronously during component init — `getContext` reads the ancestor
 * contexts and `useContainerWindowing` sets its own.
 */

import { getContext } from 'svelte';
import type { ComponentProps } from 'svelte';
import type BlockList from '../../components/BlockList.svelte';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	MoveFocusOptions
} from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import type { BlockComponent } from '../../block-component';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import { dispatchKindCommand, type KindCommandTarget } from '../../schema/block-commands';
import { eventToChord } from '../../schema/keybindings';
import { isReadingMode } from '../../presentation-mode';
import { devWarn } from '../../dev-warn';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices,
	type PluginEditorLookup
} from '../../editor-keys';
import { emitCommandError } from '../../editor-events';
import { pluginKindOwner } from '../../schema/plugin-install';
import { createBlockListState } from '../../reactivity/block-list-state.svelte';
import type { WindowResult } from '../../reactivity/block-window.svelte';
import { useContainerWindowing } from '../../reactivity/use-container-windowing.svelte';
import { createBlockquoteOverrides } from '../blockquote-overrides';
import {
	composeWholeBlockFocusSurface,
	createContainerBlockComponent,
	handleWholeBlockKeys,
	isEditableEventTarget,
	type ContainerBlockComponent
} from '../container-block-component';
import {
	createStandardNestedActions,
	setNestedActionsContexts,
	type NestedActionsOverrideFactory
} from '../nested/nested-actions';

/**
 * The frozen inputs the host component feeds in. A function-valued field is a
 * **live read**, re-evaluated on every use, so a parent structural op or undo
 * replacement is observed rather than snapshotted; a plain-valued field is static
 * configuration captured at the factory call. Passing a value where the contract
 * means "re-read live" no longer compiles — value-capture is unrepresentable here
 * (`docs/roadmap.md` freeze-surface liveness). `getBoxEl` returns the component's
 * chrome box — the element whose direct `.block-list` child the windowing lookups
 * walk (`:scope > .block-list`, so chrome siblings beside the list are fine; it need
 * not be the sole child).
 */
export interface ContainerBlockDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	getBoxEl(): HTMLElement | undefined;
	/**
	 * Opt into editor-level whole-block focus for an opaque, childless container
	 * (a render-primary plugin diagram): the getter returns the element that takes
	 * DOM focus (e.g. a `tabindex=0` viewport). When supplied, `containerApi.focus`
	 * lands here instead of walking absent children, `getCursorOffset` reads 0
	 * while it holds focus, and the factory keydown gains the ThematicBreak-style
	 * whole-block affordances (focus-then-delete, Enter-below, arrow traversal,
	 * Alt-arrow reorder). The kind must also declare `blockFocus: 'whole-block'`.
	 * Read live, never snapshotted. Supply a surface for EVERY steady state (error,
	 * loading, static fallback included) — a null degrades to focusing the box
	 * element with a dev warning, so the block stays keyboard-reachable rather
	 * than a caret trap; only a plugin editable holding focus keeps a null null.
	 */
	getFocusEl?: () => HTMLElement | null | undefined;
	/**
	 * Collapse clamp — while true only the chrome row (child 0) mounts; body
	 * children genuinely unmount. Optional: a container that declares
	 * `reservedChrome.isCollapsed` needs no dep — the factory derives the clamp
	 * from that one probe. Supply it only as an escape hatch (dev-warns when it
	 * disagrees with the declared probe). Read live so a toggle or its undo
	 * re-renders reactively.
	 */
	isCollapsed?: () => boolean;
	/**
	 * The mounted component's view-state hooks, handed to a minted block command as
	 * `ctx.hooks` — so a command opens the plugin's edit mode or focus overlay
	 * without a node-keyed side map. Read live at dispatch: return a getter over the
	 * component's own handlers, never a captured value. The platform treats it as
	 * `unknown`; the plugin casts it to its own type.
	 */
	commandHooks?: () => unknown;
}

/**
 * The `BlockList` props the host spreads onto its rendered `<BlockList>`. Authored
 * as the fixed public contract rather than derived from `BlockList`'s internal
 * props: an internal prop edit that breaks the container seam now fails
 * `npm run check` at the conformance check below, with this exported type as the
 * fixed point — it can no longer silently rewrite the public contract.
 */
export interface ContainerBlockListProps {
	children: readonly NodeView[];
	blockIds: string[];
	setRef: (i: number, r: BlockComponent | undefined) => void;
	getRef: (i: number) => BlockComponent | undefined;
	parentPath?: number[];
	window?: WindowResult;
	reorderable?: boolean;
}

// BlockList must accept everything the contract promises (contract ⊆ component)…
type _BlockListAccepts =
	ContainerBlockListProps extends Pick<
		ComponentProps<typeof BlockList>,
		keyof ContainerBlockListProps
	>
		? true
		: never;
// …and the component's props for those keys must still satisfy the contract (component ⊆ contract).
type _ContractCovers =
	Pick<
		ComponentProps<typeof BlockList>,
		keyof ContainerBlockListProps
	> extends ContainerBlockListProps
		? true
		: never;
const _conforms: [_BlockListAccepts, _ContractCovers] = [true, true];

// `ContainerBlockComponent` is defined at the shim (`container-block-component`),
// which now types every container member as required, and re-exported here so the
// plugin barrel surfaces it from the container seam.
export type { ContainerBlockComponent };

export interface ContainerBlock {
	/** Spread onto `<BlockList {...blockListProps} />` inside the chrome box. */
	blockListProps: ContainerBlockListProps;
	/** The `BlockComponent` surface the host re-exports for BlockHost. */
	containerApi: ContainerBlockComponent;
	/**
	 * Commit a shallow metadata patch on THIS container node as one undoable
	 * entry, round-tripping through the kind's `rebuildRaw`. `afterTick` runs
	 * once the commit's DOM has settled — a collapse toggle moves the orphaned
	 * body caret to the chrome row here (the clamp kills the window pin).
	 */
	updateOwnMetadata(patch: Record<string, unknown>, afterTick?: () => void): void | Promise<void>;
	/**
	 * Attach to the container's chrome box. A chord that bubbles from an inner
	 * leaf (declined there without `preventDefault`) resolves against this kind's
	 * keymap and runs its registered command, consuming the key on a hit. Kind-only
	 * — the global tier stays with the focused leaf, so a bubbled undo/redo never
	 * double-fires (mirrors `ListItemBlock`'s bubble handler).
	 */
	handleKeydown(e: KeyboardEvent): void;
}

/**
 * Collapse-ness has ONE definition: the descriptor's `reservedChrome.isCollapsed`
 * probe. The window/focus clamp derives from it, so a container that declares the
 * probe needn't also thread a dep. An explicit dep stays an escape hatch; in dev
 * it's cross-checked against the probe so a half-collapsed hybrid (model says
 * collapsed, view stays open, or vice versa) is loud, not silent.
 */
export function composeCollapseProbe(
	explicit: (() => boolean) | undefined,
	getNode: () => NodeView
): () => boolean {
	if (!explicit) return () => isCollapsedContainer(getNode());
	return () => {
		const value = explicit();
		if (import.meta.env.DEV && value !== isCollapsedContainer(getNode())) {
			devWarn(
				'plugin-container',
				`isCollapsed dep disagrees with the declared reservedChrome.isCollapsed probe for kind "${getNode().kind}"`
			);
		}
		return value;
	};
}

/**
 * M3 collapse gate for a chrome leaf's Enter → `descendToBody`. While the
 * container is collapsed its body children are unmounted, so descending would
 * mint an invisible body paragraph (the existing-body branch already no-ops on
 * the unmounted ref). Consume the key and change nothing; delegate otherwise.
 */
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
 * I-1 collapse gate for the interior `moveFocus`. While collapsed only the
 * chrome row (child 0) is mounted, so a move targeting a body index dead-ends
 * on the unmounted ref inside `dispatchMoveFocus` (its in-range branch finds no
 * focusable block and returns). Route body targets past the container instead —
 * the same exit an open container's past-end move takes. Upward moves and the
 * chrome row itself keep the inner dispatch.
 */
export function gateMoveFocusOnCollapse(
	isCollapsed: (() => boolean) | undefined,
	moveWithin: FocusActions['moveFocus'],
	parentFocus: FocusActions,
	getIndex: () => number
): FocusActions['moveFocus'] {
	return async (innerIndex, position, options?: MoveFocusOptions) => {
		if (innerIndex >= 1 && isCollapsed?.()) {
			// Omit the options arg when unset so the common path stays a two-arg
			// call, mirroring dispatchMoveFocus's own upward delegation.
			if (options) await parentFocus.moveFocus(getIndex() + 1, position, options);
			else await parentFocus.moveFocus(getIndex() + 1, position);
			return;
		}
		await moveWithin(innerIndex, position, options);
	};
}

/**
 * The kind-command target a plugin container bubbles into `dispatchKindCommand`.
 * `runCommand` is inert — a plugin container owns no built-in kind commands, so a
 * chord resolves only through a registered command, whose context routes
 * `updateMetadata` back to this container's own metadata commit and carries the
 * component's `commandHooks`. `kind`, the context `node`, `hooks`, and `editor` are
 * read through `deps`' thunks at dispatch, so a node swap or hook rebind is observed
 * live. `pluginEditor` resolves the per-plugin EditorContext by the kind's recorded
 * owner; a kind with no owner gets the base per-instance context (the `?? ''` arm).
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
				updateOwnMetadata(patch);
			},
			hooks: deps.commandHooks?.(),
			editor: pluginEditor?.(pluginKindOwner(deps.getNode().kind) ?? '')
		})
	};
}

export function createContainerBlock(deps: ContainerBlockDeps): ContainerBlock {
	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const {
		controller,
		stickyColumn,
		reorder,
		events: editorEvents,
		registryView
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { keybindingOverrides, presentationMode: getPresentationMode } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const pluginEditor = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.pluginEditor;

	const listState = createBlockListState(deps.getNode);

	const collapsed = composeCollapseProbe(deps.isCollapsed, deps.getNode);

	const blockquoteOverrides = createBlockquoteOverrides({
		get index() {
			return deps.getIndex();
		},
		get node() {
			return deps.getNode();
		},
		get path() {
			return deps.getPath();
		},
		state: listState,
		parentBlockEdit,
		parentFocus,
		controller
	});

	// Compose the collapse gates onto the blockquote exit override: a collapsed
	// container's chrome Enter must not mint an invisible body (M3), and its
	// chrome ArrowDown/ArrowRight must exit past the unmounted body (I-1). All
	// override the same `defaults`, so the blockquote's `splitBlock` and the two
	// gates coexist. For a non-collapsing container the gates are inert.
	const overrideFactory: NestedActionsOverrideFactory = (defaults) => {
		const base = blockquoteOverrides(defaults);
		return {
			...base,
			blockEdit: {
				...base.blockEdit,
				descendToBody: gateDescendOnCollapse(collapsed, defaults.blockEdit.descendToBody)
			},
			focus: {
				moveFocus: gateMoveFocusOnCollapse(
					collapsed,
					defaults.focus.moveFocus,
					parentFocus,
					deps.getIndex
				)
			}
		};
	};

	const bundle = createStandardNestedActions(
		listState,
		{
			get index() {
				return deps.getIndex();
			},
			get node() {
				return deps.getNode();
			},
			get path() {
				return deps.getPath();
			},
			stickyColumn,
			grammar: registryView.grammar,
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

	// One composed surface feeds the shim AND the keydown gate below, so a
	// fallback-focused box passes the same containment check the affordances use.
	const wholeBlockSurface = deps.getFocusEl
		? composeWholeBlockFocusSurface(
				deps.getFocusEl,
				() => deps.getBoxEl(),
				() => deps.getNode().kind
			)
		: undefined;

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return deps.getNode().children?.length ?? 0;
		},
		get node() {
			return deps.getNode();
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow,
		isCollapsed: collapsed,
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
		setRef: (i, r) => (listState.innerBlockRefs[i] = r),
		getRef: (i) => listState.innerBlockRefs[i],
		get parentPath() {
			return deps.getPath();
		},
		get window() {
			return windowing.window;
		},
		// Opaque containers are a reorder boundary (resolveReorderUnit declines inside
		// them), so a handle on a chrome or body row would be a dead affordance. The
		// container itself stays reorderable through its parent's BlockList.
		reorderable: false
	};

	const updateOwnMetadata: ContainerBlock['updateOwnMetadata'] = (patch, afterTick) =>
		parentBlockEdit.updateBlockMetadata(deps.getIndex(), patch, { afterTick });

	const kindTarget = buildContainerKindTarget(deps, updateOwnMetadata, pluginEditor);

	const handleKeydown = (e: KeyboardEvent): void => {
		if (e.defaultPrevented) return;
		const chord = eventToChord(e);
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

	// The whole-block-focus affordances for a viewport-focused container, dispatched
	// from the wrapper's bubble phase so a viewport-focused key reaches them. Gated
	// three ways so a child-bearing container or a plugin's own editing surface is
	// never touched:
	//   1. the kind opted in (getFocusEl supplied),
	//   2. the whole-block focus element actually holds focus — excludes a focused
	//      toolbar button (a sibling of the focus element), which would otherwise
	//      double-fire its click and an Enter split, and
	//   3. the event did not originate in an editable surface (belt-and-suspenders
	//      for a plugin that mounts a textarea/contenteditable inside the block).
	function handleWholeBlockKeydown(e: KeyboardEvent): void {
		if (!wholeBlockSurface) return;
		const focusEl = wholeBlockSurface();
		if (!focusEl || !focusEl.contains(document.activeElement)) return;
		if (isEditableEventTarget(e.target)) return;

		// A whole-block surface is tabindex-focusable independent of contenteditable,
		// so this path is live in reading mode: arrows stay, edits gate.
		const reading = isReadingMode(getPresentationMode);

		// Alt-arrow reorder is this container's own: its runCommand is inert (a plugin
		// container owns no built-in kind command), so unlike ThematicBreak — which
		// routes reorder through the kind keymap — it can't come from dispatchKindCommand
		// and is handled inline here. The congruent Enter/Backspace/Delete/arrow tail is
		// the shared handleWholeBlockKeys.
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
			isReading: () => reading
		});
	}

	return { blockListProps, containerApi, updateOwnMetadata, handleKeydown };
}
