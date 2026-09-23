<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		ListContext
	} from '../../../action-contracts';
	import type { BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		LIST_CONTEXT_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { metadataOf } from '../../../core/nodes';
	import { hidesMarkers } from '../../../presentation-mode';
	import { displayLength } from '../../../core/lines';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { useMountGauge } from '../../../perf/use-mount-gauge.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts,
		type NodeScope
	} from '../../../editor-actions/nested/nested-actions';
	import { createContainerBlockComponent } from '../../../editor-actions/container-block-component';
	import { buildTaskItemAmbient } from './task-checkbox';
	import BlockList from '../../BlockList.svelte';
	import { publishRefSlot, type RefSlots } from '../../../reactivity/publish-ref.svelte';
	import { eventToChord } from '../../../schema/keybindings';
	import { dispatchKindCommand } from '../../../schema/block-commands';
	import type { AnyCommandId } from '../../../schema/command-id';
	import BlockDragHandle from '../../BlockDragHandle.svelte';
	import SelectionOverlay from '../../SelectionOverlay.svelte';
	import { showsListItemDragHandle } from '../../drag-handle';
	import { useBlockDecorations } from '../../../decorations/use-block-decorations.svelte';

	let {
		node,
		index,
		myPath = [],
		itemCount,
		slots
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		/** How many items the enclosing list holds; a lone item has no sibling to reorder past. */
		itemCount: number;
		slots?: RefSlots<BlockComponent>;
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const { stickyColumn, selection, registryView, decorations, events } =
		getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		blockDragHandles: getDragHandles,
		presentationMode: getPresentationMode
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const linkRef = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.linkRef;

	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);
	// $derived, not a mount-time snapshot: a runtime prop toggle must reach blocks
	// that window in and out after the change, not just those mounted at mount.
	const dragHandles = $derived(getDragHandles?.() ?? false);
	// The drag handle is the only way to reorder with a pointer, and a reorder needs a sibling:
	// a lone item still counts as one (a dragged sibling never arrives, and the class costs
	// nothing) and simply shows nothing to grab.
	const showsHandle = $derived(showsListItemDragHandle(itemCount, dragHandles));
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');

	// The marker-hiding CSS tells a bullet from a number from a checkbox through this attribute,
	// since the marker span carries no such class. Absent in source, so that DOM is unchanged.
	const presentationMarkerKind = $derived.by(() => {
		if (!hidesMarkers(presentationMode)) return undefined;
		const meta = metadataOf(node, 'listItem');
		if (meta?.taskItem) return 'task';
		return /^\d/.test(meta?.marker ?? '-') ? 'ordered' : 'bullet';
	});

	// Wrap `getContainingItemIndex` so a nested ListBlock inside this item sees this
	// item's index in the outer list, which is what `promoteNestedItem` needs.
	const wrappedListContext: ListContext = {
		...listContext,
		getContainingItemIndex: () => index
	};
	setContext(LIST_CONTEXT_KEY, wrappedListContext);

	const listState = createBlockListState(() => node);

	let boxEl: HTMLElement | undefined = $state();
	let contentEl: HTMLElement | undefined = $state();

	useMountGauge();

	// The item renders no block host, so its own box carries the decorations addressed to it.
	const blockDecorations = useBlockDecorations({
		getPath: () => myPath,
		getEl: () => boxEl ?? null,
		engine: decorations,
		onRenderError: (error) => events.emit('error', error)
	});

	// False on a plain item, so the chord that asked falls through.
	function toggleTask(): boolean {
		// Reading mode keeps checkboxes visible but inert: a toggle rewrites the
		// document, and reading mode writes no bytes.
		if (readOnly) return false;
		const meta = metadataOf(node, 'listItem');
		if (!meta?.taskItem) return false;

		if (selection?.isCrossBlock) {
			selection.clear();
		}

		const nextChecked = !meta.taskChecked;
		const nextMarker = nextChecked ? '[x] ' : '[ ] ';
		parentBlockEdit.updateBlockMetadata(index, {
			taskChecked: nextChecked,
			taskMarker: nextMarker
		});
		return true;
	}

	const taskCheckedAttr = $derived.by(() => {
		const meta = metadataOf(node, 'listItem');
		if (!meta?.taskItem) return undefined;
		return meta.taskChecked ? 'true' : 'false';
	});

	const scope: NodeScope = {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		get path() {
			return myPath;
		}
	};

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
		() => ({
			blockEdit: {
				splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
					if (!node.children) return;

					// Enter on an empty item. Deliberately looser than `isItemUserEmpty`:
					// trailing structural children stay until `exitListAtItem` moves them.
					const firstChild = node.children[0];
					const isEmptyItem = firstChild?.kind === 'paragraph' && firstChild.raw.trim() === '';
					if (isEmptyItem) {
						await listContext.exitListAtItem(index);
						return;
					}

					const lastChild = node.children[node.children.length - 1];
					const isAtEnd =
						innerIndex === node.children.length - 1 && offset >= displayLength(lastChild.raw);

					if (isAtEnd) {
						await listContext.insertItemAfter(index);
						return;
					}

					await listContext.splitItemAtOffset(index, innerIndex, offset);
				}
				// `mergeWithPrevious` at an inner index of 0 or less is the default already.
			}
		})
	);

	setNestedActionsContexts(bundle);

	// ── Virtual rendering (nested windowing) ────────────────────────────

	const windowing = useContainerWindowing({
		getIndex: () => index,
		getParentPath: () => myPath,
		getChildren: () => node.children ?? [],
		getChildIds: () => listState.innerBlockIds,
		// .block-list is a direct child of .list-item-content, reached through `contentEl`.
		getListEl: () => contentEl?.querySelector(':scope > .block-list') ?? null,
		// An item is not wrapped in a BlockHost: its own .list-item-block box is what the
		// parent ListBlock measures by item index, so nothing else reports a height.
		getOwnEl: () => boxEl ?? null,
		provideLeafChannel: true
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const containerApi = createContainerBlockComponent({
		selection,
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		refSlots: listState.refSlots,
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		},
		get node() {
			return node;
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow
	});

	$effect(() => {
		if (!slots) return;
		return publishRefSlot(slots, index, containerApi, boxEl);
	});

	// ── Commands ────────────────────────────────────────────────────────

	// Not part of the BlockComponent interface, since the published reference is
	// `containerApi` rather than this instance; the handler below closes over it.
	function runCommand(id: AnyCommandId): boolean {
		switch (id) {
			case 'list.indent':
				listContext.indentItem(index);
				return true;
			case 'list.unindent':
				listContext.unindentItem(index);
				return true;
			case 'list.toggleTask':
				return toggleTask();
			default:
				return false;
		}
	}

	// Tab, Shift+Tab and Mod+Enter bubble here from the inner paragraph, which binds none of them
	// or declines without calling `preventDefault`. Only kind commands are dispatched: the contenteditable's
	// async handler prevents the default only after an await, so resolving global commands here
	// would fire undo or redo a second time.
	function handleKeydown(e: KeyboardEvent): void {
		if (e.defaultPrevented) return;
		// A key a nested item declined is still that item's: the task toggle must not reach the
		// task it sits in.
		if (!(e.target instanceof Element) || e.target.closest('.list-item-block') !== boxEl) return;
		const chord = eventToChord(e);
		if (!chord) return;
		if (
			dispatchKindCommand(
				chord,
				{ kind: node.kind, runCommand },
				{
					getPresentationMode,
					isCrossBlockRange: () => selection?.isCrossBlock ?? false,
					// A key bubbling to a container carries no range command: the block below owns
					// the format ids.
					crossBlockCommands: undefined
				},
				keybindingOverrides()
			)
		) {
			e.preventDefault();
		}
	}
</script>

<!-- No `data-block-path` on the item box: a lookup by that attribute treats the match as a
	 block host, and the item renders none. -->
<div
	class={[
		'list-item-block',
		{ 'reorder-host': dragHandles, 'handle-host': showsHandle },
		...blockDecorations.classes
	]}
	data-task-checked={taskCheckedAttr}
	data-list-marker={presentationMarkerKind}
	bind:this={boxEl}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="list-item-content" onkeydown={handleKeydown} bind:this={contentEl}>
		<BlockList
			children={node.children ?? []}
			blockIds={listState.innerBlockIds}
			slots={listState.refSlots}
			parentPath={myPath}
			window={windowing.window}
			ambientPrefixForFirst={buildTaskItemAmbient(metadataOf(node, 'listItem'), toggleTask)}
		/>
	</div>
	<!-- The item paints its own selection box: it renders no BlockHost, so a range that
		 holds it whole has nothing else to draw one over its marker and its content. -->
	<SelectionOverlay path={myPath} delegatesPainting />
	<!-- A list item is a reorder unit; its inner content BlockList passes the
		 default reorderable={false}, so the paragraph inside gets no handle. A lone item
		 renders none either: its drag is list-scoped and there is no sibling to pass. -->
	{#if showsHandle}
		<BlockDragHandle />
	{/if}
</div>

<style>
	.list-item-block {
		position: relative;
		display: flex;
		align-items: flex-start;
	}

	/* Showing it on hover is the shared `.handle-host` rule in BlockHost; it shows
	   only the innermost hovered unit, so a sub-item's hover never lights the parent. */

	.list-item-content {
		flex: 1;
		min-width: 0;
	}

	.list-item-content :global(.list-block) {
		padding-left: 1em;
	}

	:global(.task-checkbox) {
		cursor: pointer;
		border-radius: 2px;
		transition: background-color 60ms ease-out;
	}

	:global(.task-checkbox:hover) {
		background-color: var(--md-marker-hover-bg, rgba(128, 128, 128, 0.15));
	}

	/* :first-child scopes strikethrough to this item's own leading block; :not(.list-block)
	   avoids cascading into nested sub-lists, which carry their own state per item. */
	.list-item-block[data-task-checked='true']
		> .list-item-content
		> :global(.block-list)
		> :global(.block-host:first-child)
		> :global(:not(.list-block)) {
		color: var(--syntax-task-done, #8f8f89);
	}
</style>
