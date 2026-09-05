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

	// `slots` is owner-supplied: a `bind:` $bindable array desyncs from the owner's state
	// across cross-effect mutations. `reorderable` is true only when these children ARE
	// reorder units (document root, list, blockquote).
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

	// Read like BlockHost's, `| undefined` included: a bare-mounted list in a harness provides
	// none. The two action bundles are read HERE because they are scope-local — this list's own
	// position answers them, unlike the root facets GapCaret reads for itself.
	const selection = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.selection;
	const focusActions = getContext<FocusActions | undefined>(FOCUS_KEY);
	const blockEdit = getContext<BlockEditActions | undefined>(BLOCK_EDIT_KEY);

	// Only a surface that paints inline content paints one, so the prefix is withheld from a
	// first child that would ignore it — a code block, a nested list, a container. Withheld, not
	// handed over and dropped: a prefix a child does not paint but does count is an offset the
	// walk has no bytes for. Painting the marker for those shapes is open (GH #43).
	function ambientFor(node: NodeView): AmbientPrefix {
		return isProseKind(node.kind) ? ambientPrefixForFirst : '';
	}

	// The boundary index the live gap addresses in THIS scope, when the slice reaches it.
	// Eligibility is re-read against the children as they stand: the state cannot see an edit
	// that changed the kinds facing this boundary, and a caret must never paint where no
	// gesture could have parked one.
	let gapIndex = $derived.by(() => {
		const gap = selection?.gapCaret;
		if (!gap || !pathsEqual(gap.parentPath, parentPath)) return null;
		if (gap.index < start || gap.index > end) return null;
		return gapEligibleAmong(children, gap.index, parentPath.length > 0) ? gap.index : null;
	});
</script>

<div class="block-list">
	{#if active}
		<div class="vr-spacer" style="height: {win!.topSpacerPx}px"></div>
	{/if}
	{#each slice as node, localIndex (blockIds[start + localIndex])}
		{@const absoluteIndex = start + localIndex}
		<!-- ABSOLUTE-INDEX INVARIANT: index/id/key are `start + localIndex`, never the
		     local loop index — paths and structural ops key off it. -->
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
	<!-- The slice's trailing boundary: the scope end when the slice reaches it, and
	     otherwise the seam with the next windowed-out block. -->
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
