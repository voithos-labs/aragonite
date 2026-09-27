<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import type { ListContext } from '../../../action-contracts';
	import type { BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		LIST_CONTEXT_KEY,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { metadataOf } from '../../../core/nodes';
	import { hidesMarkers } from '../../../presentation-mode';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { useMountGauge } from '../../../perf/use-mount-gauge.svelte';
	import { createContainerActions } from '../../../editor-actions/nested/container-actions';
	import { createListItemOverrides } from '../../../editor-actions/list-overrides';
	import {
		createContainerBlockComponent,
		dispatchContainerChord
	} from '../../../editor-actions/container-block-component';
	import { buildTaskItemAmbient } from './task-checkbox';
	import BlockList from '../../BlockList.svelte';
	import { publishRefSlot, type RefSlots } from '../../../reactivity/publish-ref.svelte';
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

	const { selection, decorations, events, commands } =
		getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { blockDragHandles: getDragHandles } = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);

	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);
	const {
		state: listState,
		parent: { blockEdit: parentBlockEdit },
		reading
	} = createContainerActions({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		// The enclosing list's context, not the wrapped one this item provides.
		overrides: ({ scope }) => createListItemOverrides({ scope, listContext })
	});

	// $derived, not a mount-time snapshot: a runtime prop toggle must reach blocks
	// that window in and out after the change, not just those mounted at mount.
	const dragHandles = $derived(getDragHandles?.() ?? false);
	// A reorder needs a sibling, so a lone item shows no handle; it stays a reorder host, which
	// costs nothing, since a dragged sibling never arrives.
	const showsHandle = $derived(showsListItemDragHandle(itemCount, dragHandles));
	const presentationMode = $derived(reading.mode());
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
		reading,
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

	// Not part of the BlockComponent interface, since the registered reference is
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

	// Tab, Shift+Tab and Mod+Enter bubble up from the inner paragraph. Only kind commands run here:
	// the paragraph has already dispatched the global ones, so undo would otherwise fire twice.
	function handleKeydown(e: KeyboardEvent): void {
		// A key a nested item declined is still that item's: the task toggle must not reach the
		// task it sits in.
		if (!(e.target instanceof Element) || e.target.closest('.list-item-block') !== boxEl) return;
		dispatchContainerChord(e, { kind: node.kind, runCommand }, commands);
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
	<!-- A list item is the reorder unit, so its inner BlockList keeps `reorderable={false}` and
		 the paragraph inside gets no handle; a lone item shows none either. -->
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
