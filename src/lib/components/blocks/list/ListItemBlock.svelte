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
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		LIST_CONTEXT_KEY,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { metadataOf } from '../../../core/nodes';
	import { isPreviewMode } from '../../../presentation-mode';
	import { displayLength } from '../../../core/lines';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { useMountGauge } from '../../../perf/use-mount-gauge.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts,
		type NodeScope
	} from '../../../editor-actions/nested/nested-actions';
	import {
		createContainerBlockComponent,
		type ContainerBlockComponent
	} from '../../../editor-actions/container-block-component';
	import { buildTaskItemAmbient } from './task-checkbox';
	import BlockList from '../../BlockList.svelte';
	import { publishRefSlot } from '../../../reactivity/publish-ref.svelte';
	import { eventToChord } from '../../../schema/keybindings';
	import { dispatchKindCommand } from '../../../schema/block-commands';
	import type { AnyCommandId } from '../../../schema/command-id';
	import BlockDragHandle from '../../BlockDragHandle.svelte';

	let {
		node,
		index,
		myPath = [],
		setRef,
		getRef
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const { stickyColumn, selection, registryView } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		blockDragHandles: getDragHandles,
		presentationMode: getPresentationMode
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);

	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);
	// $derived, not a mount-time snapshot: a runtime prop toggle must reach blocks
	// that window in and out after the change, not just those mounted at mount.
	const dragHandles = $derived(getDragHandles?.() ?? false);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');

	// Reading and preview CSS tell bullet/ordered/task markers apart (bullets
	// become rendered chrome, numbers stay visible) and the ambient span carries no
	// such class. Present in every marker-hiding mode; absent in source, so the
	// source-mode DOM stays byte-identical.
	const presentationMarkerKind = $derived.by(() => {
		if (presentationMode !== 'reading' && !isPreviewMode(presentationMode)) return undefined;
		const meta = metadataOf(node, 'listItem');
		if (meta?.taskItem) return 'task';
		return /^\d/.test(meta?.marker ?? '-') ? 'ordered' : 'bullet';
	});

	// Wrap getContainingItemIndex so a nested ListBlock inside this item sees
	// this item's index in the outer list — the coordinate promoteNestedItem needs.
	const wrappedListContext: ListContext = {
		...listContext,
		getContainingItemIndex: () => index
	};
	setContext(LIST_CONTEXT_KEY, wrappedListContext);

	const listState = createBlockListState(() => node);

	let boxEl: HTMLElement | undefined = $state();
	let contentEl: HTMLElement | undefined = $state();

	useMountGauge();

	function toggleTask(): void {
		// Reading mode keeps checkboxes visible but inert (CSS also drops their
		// pointer affordance); live task toggling is a deferred product question —
		// see docs/issues.md.
		if (readOnly) return;
		const meta = metadataOf(node, 'listItem');
		if (!meta?.taskItem) return;

		if (selection?.isCrossBlock) {
			selection.clear();
		}

		const nextChecked = !meta.taskChecked;
		const nextMarker = nextChecked ? '[x] ' : '[ ] ';
		parentBlockEdit.updateBlockMetadata(index, {
			taskChecked: nextChecked,
			taskMarker: nextMarker
		});
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

					// Enter-empty: first child is an empty paragraph. Deliberately shallower than
					// isItemUserEmpty — trailing structural children stay
					// until exitListAtItem relocates them.
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
				// mergeWithPrevious at innerIndex <= 0 is the factory default — no override needed.
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
		// .block-list is a direct child of .list-item-content, reached through contentEl.
		getListEl: () => contentEl?.querySelector(':scope > .block-list') ?? null,
		// An item is NOT wrapped in a BlockHost; its own .list-item-block box is what the
		// parent ListBlock's item-indexed sink expects (no competing leaf channel).
		getOwnEl: () => boxEl ?? null,
		provideLeafChannel: true
	});

	// ── BlockComponent interface ────────────────────────────────────────

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		},
		get node() {
			return node;
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow
	});
	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent;
	export const enterEdgeWidget = containerApi.enterEdgeWidget;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath;
	export const revealByPath = containerApi.revealByPath;
	// Completeness guard: `bind:this` reads each instance export individually, so a
	// new ContainerBlockComponent member left un-forwarded above fails `npm run check`
	// here rather than surfacing as a runtime hole (MermaidBlock's pattern).
	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		getCursorPosition,
		focusByPath,
		focusAtColumn,
		isVerticallyTransparent,
		enterEdgeWidget,
		getBlockComponentByPath,
		revealByPath
	} satisfies ContainerBlockComponent);

	$effect(() => {
		if (!setRef || !getRef) return;
		return publishRefSlot(index, containerApi, setRef, getRef);
	});

	// ── Commands ────────────────────────────────────────────────────────

	// Not on the BlockComponent surface (the published ref is containerApi, not
	// this instance); the bubble handler below closes over it directly.
	function runCommand(id: AnyCommandId): boolean {
		switch (id) {
			case 'list.indent':
				listContext.indentItem(index);
				return true;
			case 'list.unindent':
				listContext.unindentItem(index);
				return true;
			default:
				return false;
		}
	}

	// Tab/Shift+Tab bubble here from the inner paragraph, whose block.insertTab
	// declines (without preventDefault) when a listContext is present. Dispatch is
	// kind-only (dispatchKindCommand): the focused contenteditable's async handler
	// preventDefaults only after an await, so the event still bubbles here with
	// defaultPrevented false — a global tier would re-fire its undo/redo.
	function handleKeydown(e: KeyboardEvent): void {
		if (e.defaultPrevented) return;
		// Both bubbled commands (list.indent/unindent) are edits; this caller has
		// no pluginEditor lookup to hand the dispatcher's own gate, so it gates here.
		if (readOnly) return;
		const chord = eventToChord(e);
		if (!chord) return;
		if (dispatchKindCommand(chord, { kind: node.kind, runCommand }, keybindingOverrides())) {
			e.preventDefault();
		}
	}
</script>

<div
	class="list-item-block"
	class:reorder-host={dragHandles}
	data-task-checked={taskCheckedAttr}
	data-list-marker={presentationMarkerKind}
	bind:this={boxEl}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="list-item-content" onkeydown={handleKeydown} bind:this={contentEl}>
		<BlockList
			children={node.children ?? []}
			blockIds={listState.innerBlockIds}
			setRef={(i, r) => (listState.innerBlockRefs[i] = r)}
			getRef={(i) => listState.innerBlockRefs[i]}
			parentPath={myPath}
			window={windowing.window}
			ambientPrefixForFirst={buildTaskItemAmbient(metadataOf(node, 'listItem'), toggleTask)}
		/>
	</div>
	<!-- A list item IS a reorder unit; its inner content BlockList passes the
		 default reorderable={false}, so the paragraph inside gets no handle. -->
	{#if dragHandles}
		<BlockDragHandle />
	{/if}
</div>

<style>
	.list-item-block {
		position: relative;
		display: flex;
		align-items: flex-start;
	}

	/* Hover reveal is the shared global `.reorder-host` rule in BlockHost (the
	   `reorder-host` class above opts this item in); it reveals only the
	   innermost hovered unit, so a sub-item's hover never lights the parent. */

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

	/* :first-child scopes strikethrough to this item's own leading block;
	   :not(.list-block) avoids cascading into nested sub-lists, which carry
	   their own data-task-checked state per item. */
	.list-item-block[data-task-checked='true']
		> .list-item-content
		> :global(.block-list)
		> :global(.block-host:first-child)
		> :global(:not(.list-block)) {
		text-decoration: line-through;
		color: var(--syntax-task-done, rgba(128, 128, 128, 0.7));
	}
</style>
