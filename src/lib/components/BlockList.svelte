<script lang="ts">
	import { getContext } from 'svelte';
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { BlockEditActions, FocusActions } from '../action-contracts';
	import type { NodeView } from '../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		type EditorServices
	} from '../editor-keys';
	import type { WindowResult } from '../reactivity/block-window.svelte';
	import type { RefSlots } from '../reactivity/publish-ref.svelte';
	import { isProseKind } from '../core/inline';
	import { gapEligibleAmong } from '../selection/gap-caret';
	import { pathsEqual } from '../selection/path-math';
	import { sliceWindow } from '../reactivity/window-slice';
	import { useWindowFloor } from '../reactivity/use-window-floor.svelte';
	import BlockHost from './BlockHost.svelte';
	import GapCaret from './GapCaret.svelte';

	// `slots` comes from the owner, since a `bind:` array falls out of step when two effects
	// write it. `reorderable` means these children are what a drag reorders.
	let {
		children,
		blockIds,
		slots,
		parentPath = [],
		ambientPrefixForFirst = '',
		window: win = undefined,
		reorderable = false
	}: {
		children: readonly NodeView[];
		blockIds: string[];
		slots: RefSlots<BlockComponent>;
		parentPath?: number[];
		ambientPrefixForFirst?: AmbientPrefix;
		window?: WindowResult;
		reorderable?: boolean;
	} = $props();

	let active = $derived(win?.active ?? false);
	let bounds = $derived(sliceWindow(children.length, win));
	let start = $derived(bounds.start);
	let end = $derived(bounds.end);
	let slice = $derived(children.slice(start, end));

	let listEl: HTMLElement | undefined = $state();
	useWindowFloor(
		() => listEl,
		() => win
	);

	// Optional, like BlockHost's reads: a list mounted alone in a test has no editor context.
	const selection = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.selection;
	const focusActions = getContext<FocusActions | undefined>(FOCUS_KEY);
	const blockEdit = getContext<BlockEditActions | undefined>(BLOCK_EDIT_KEY);

	// Only a prose first child gets the container's marker prefix: one that counted it without
	// painting it would hold an offset with no bytes behind it.
	function ambientFor(node: NodeView): AmbientPrefix {
		return isProseKind(node.kind) ? ambientPrefixForFirst : '';
	}

	// The gap caret's index in this list, re-checked against the current children, since an
	// edit can change the kinds either side of a stored gap.
	let gapIndex = $derived.by(() => {
		const gap = selection?.gapCaret;
		if (!gap || !pathsEqual(gap.parentPath, parentPath)) return null;
		if (gap.index < start || gap.index > end) return null;
		return gapEligibleAmong(children, gap.index, parentPath.length > 0) ? gap.index : null;
	});
</script>

<!-- A nested reorderable list marks itself, so a drag inside it can show its bounds. -->
<div
	class="block-list"
	data-reorder-scope={reorderable && parentPath.length > 0 ? '' : undefined}
	bind:this={listEl}
>
	{#if active}
		<div class="vr-spacer" style="height: {win!.topSpacerPx}px"></div>
	{/if}
	{#each slice as node, localIndex (blockIds[start + localIndex])}
		{@const absoluteIndex = start + localIndex}
		<!-- Paths and structural edits key off the absolute index, never the loop index. -->
		{#if gapIndex === absoluteIndex}
			<GapCaret index={absoluteIndex} {focusActions} {blockEdit} />
		{/if}
		<BlockHost
			{node}
			index={absoluteIndex}
			id={blockIds[absoluteIndex]}
			{parentPath}
			ambientPrefix={absoluteIndex === 0 ? ambientFor(node) : ''}
			{slots}
			{reorderable}
		/>
	{/each}
	<!-- A gap caret at the end of the rendered range, which may be before an unmounted block. -->
	{#if gapIndex === end}
		<GapCaret index={end} {focusActions} {blockEdit} />
	{/if}
	{#if active}
		<div class="vr-spacer" style="height: {win!.bottomSpacerPx}px"></div>
	{/if}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
	.vr-spacer {
		flex: 0 0 auto;
	}
</style>
