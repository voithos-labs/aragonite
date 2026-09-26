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
	import BlockHost from './BlockHost.svelte';
	import GapCaret from './GapCaret.svelte';

	// `slots` is supplied by the owner: a `bind:` $bindable array falls out of step with the
	// owner's state when two effects write it. `reorderable` is true only when these children
	// are themselves the things that reorder: the document root, or a container whose kind
	// declares `reorderChildren`.
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

	// Read like BlockHost's, `| undefined` included: a list mounted alone in a test provides
	// none. The two action bundles are read here because they depend on where this list sits,
	// unlike the root-wide ones GapCaret reads for itself.
	const selection = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.selection;
	const focusActions = getContext<FocusActions | undefined>(FOCUS_KEY);
	const blockEdit = getContext<BlockEditActions | undefined>(BLOCK_EDIT_KEY);

	// Only a block that paints inline content paints the container's marker prefix, so it is
	// withheld from a first child that would ignore it: a code block, a nested list, a
	// container. Withheld rather than handed over and dropped, because a prefix a child counts
	// but does not paint is an offset with no bytes behind it. Painting it there is open (#43).
	function ambientFor(node: NodeView): AmbientPrefix {
		return isProseKind(node.kind) ? ambientPrefixForFirst : '';
	}

	// The boundary this list's live gap caret sits at, when the rendered range reaches it.
	// Whether a gap is allowed is re-read against the children as they stand: the stored state
	// cannot see an edit that changed the kinds either side, and a caret must never paint
	// where no gesture could have put one.
	let gapIndex = $derived.by(() => {
		const gap = selection?.gapCaret;
		if (!gap || !pathsEqual(gap.parentPath, parentPath)) return null;
		if (gap.index < start || gap.index > end) return null;
		return gapEligibleAmong(children, gap.index, parentPath.length > 0) ? gap.index : null;
	});
</script>

<!-- A nested list whose children reorder marks itself, so a drag inside it can show where
     it is confined to; the document root needs no such cue. -->
<div class="block-list" data-reorder-scope={reorderable && parentPath.length > 0 ? '' : undefined}>
	{#if active}
		<div class="vr-spacer" style="height: {win!.topSpacerPx}px"></div>
	{/if}
	{#each slice as node, localIndex (blockIds[start + localIndex])}
		{@const absoluteIndex = start + localIndex}
		<!-- index, id and key are `start + localIndex`, never the local loop index:
		     paths and structural edits all key off the absolute index. -->
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
	<!-- The end of the rendered range: the end of this list when the range reaches it,
	     and otherwise the join with the next block that is not mounted. -->
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
