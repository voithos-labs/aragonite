<script lang="ts">
	import { getContext } from 'svelte';
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { CstNode } from '../core/nodes';
	import type { EditorEvents } from '../editor-events';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import MatchOverlay from './MatchOverlay.svelte';
	import BlockDragHandle from './BlockDragHandle.svelte';
	import TextEditableBlock from './blocks/text/TextEditableBlock.svelte';
	import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
	import { getBlockComponent } from '../schema/block-component-registry';
	import {
		BLOCK_DRAG_HANDLES_KEY,
		DOC_KEY,
		EDITOR_EVENTS_KEY,
		RECORD_BLOCK_HEIGHT_KEY,
		type BlockMeasureChannel,
		type DocumentGetter
	} from '../editor-keys';
	import { incMountedBlocks, decMountedBlocks, perfEnabled } from '../perf/instruments';
	import { publishRefSlot } from '../reactivity/publish-ref.svelte';
	import { devWarn } from '../dev-warn';

	let {
		node,
		index,
		id,
		parentPath = [],
		ambientPrefix = '',
		setRef,
		getRef,
		reorderable = false
	}: {
		node: CstNode;
		index: number;
		id: string;
		parentPath?: number[];
		ambientPrefix?: AmbientPrefix;
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
		reorderable?: boolean;
	} = $props();

	const editorEvents = getContext<EditorEvents | undefined>(EDITOR_EVENTS_KEY);
	const getDoc = getContext<DocumentGetter | undefined>(DOC_KEY);
	const getDragHandles = getContext<(() => boolean) | undefined>(BLOCK_DRAG_HANDLES_KEY);
	// $derived, not a mount-time snapshot: a runtime prop toggle must reach blocks
	// that window in and out after the change, not just those mounted at mount.
	const dragHandles = $derived(getDragHandles?.() ?? false);

	let myPath = $derived([...parentPath, index]);

	let isContainer = $derived(getBlockKindDescriptor(node.kind).isContainer);
	// A childless container (render-primary plugin block) mounts no child hosts,
	// so overlay painting can't be delegated downward — see SelectionOverlay.
	let hasChildHosts = $derived(isContainer && (node.children?.length ?? 0) > 0);

	let hostEl: HTMLElement | null = $state(null);
	let ref: BlockComponent | undefined = $state();

	let entry = $derived(getBlockComponent(node.kind));

	// A kind with no registered component falls back to a visible raw-editable
	// surface (below) rather than silently rendering nothing.
	$effect(() => {
		if (!entry) devWarn('block-host', 'no component for kind, rendering raw', node.kind);
	});

	$effect(() => {
		if (!setRef || !getRef) return;
		return publishRefSlot(index, ref, setRef, getRef);
	});

	const measureChannel = getContext<BlockMeasureChannel | undefined>(RECORD_BLOCK_HEIGHT_KEY);

	$effect(() => {
		if (perfEnabled()) incMountedBlocks();
		return () => {
			if (perfEnabled()) decMountedBlocks();
		};
	});

	// Enroll in the scope's batched measure pass instead of measuring inline — a
	// per-block read interleaved with a sibling's model write forces one reflow per
	// mounted block on a fling (VR-4). The scope reads every pending block then writes,
	// so the batch costs one reflow. Re-registers on path change (reorder re-binds the
	// write to the new index); jsdom reports 0 height, guarded inside the batch.
	$effect(() => {
		void myPath;
		if (!measureChannel) return;
		return measureChannel.register(myPath, index, id, () =>
			hostEl ? hostEl.getBoundingClientRect().height : 0
		);
	});

	// An edit grows/shrinks this one block; re-measure it directly (convergence-guarded,
	// so it can't spin the graph). Skip the MOUNT run: the batched pass above already owns
	// mount measurement, and a per-block read on a fling interleaved with a sibling's model
	// write is exactly the one-reflow-per-block thrash this design removes (VR-4). `firstRun`
	// resetting on remount is intended — a block re-entering the window is a fresh mount the
	// batch measures.
	let firstRun = true;
	$effect(() => {
		void node.raw;
		if (firstRun) {
			firstRun = false;
			return;
		}
		measureChannel?.measureNow(id);
	});

	// A block can grow AFTER mount without its `raw` changing — an image (or other async
	// content) decoding in. The `raw` effect above never sees it, and native overflow-anchor
	// is off, so the growth would slide the viewport. Observe the box and hand the scope the
	// observer-reported border-box height; it gates on the height it already recorded, so the
	// mount resize (and the cached-then-remounted case, where the grown size can arrive in
	// the very first callback) is handled without a `settled`-flag timing race, and the
	// no-op fling case does no DOM read. Genuine growth re-measures and anchor-corrects.
	$effect(() => {
		if (!hostEl || !measureChannel) return;
		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.borderBoxSize?.[0];
			const height = box ? box.blockSize : entries[0]?.contentRect.height;
			if (height != null) measureChannel.measureOnResize(id, height);
		});
		observer.observe(hostEl);
		return () => observer.disconnect();
	});
</script>

<div
	class="block-host"
	class:reorder-host={reorderable && dragHandles}
	data-block-path={JSON.stringify(myPath)}
	data-block-kind={node.kind}
	bind:this={hostEl}
>
	<svelte:boundary
		onerror={(error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } })}
	>
		{#if entry}
			{@const Comp = entry.component}
			<Comp
				{node}
				{index}
				{myPath}
				{ambientPrefix}
				document={getDoc?.()}
				bind:this={ref}
				{...entry.extraProps?.(node) ?? {}}
			/>
		{:else}
			<TextEditableBlock
				{node}
				{index}
				{myPath}
				{ambientPrefix}
				document={getDoc?.()}
				bind:this={ref}
				blockClass="raw-block"
			/>
		{/if}

		{#snippet failed()}
			<div class="failed-block" data-failed-block role="group" aria-label="Block failed to render">
				<span class="failed-block-notice">⚠ block failed to render</span>
				<pre class="failed-block-raw">{node.raw}</pre>
			</div>
		{/snippet}
	</svelte:boundary>
	<!-- hostEl is null until mount; safe because SelectionState is only
		 populated by user gesture, never synchronously during structural
		 mount. The overlay's $effect guards on !blockEl. -->
	<SelectionOverlay path={myPath} blockRef={ref} blockEl={hostEl} {isContainer} {hasChildHosts} />
	<MatchOverlay path={myPath} blockRef={ref} blockEl={hostEl} {isContainer} />
	<!-- Rendered LAST so `:scope > :not(.selection-overlay)` (block-el lookup,
		 caret placement) still resolves the block content as its first match. -->
	{#if reorderable && dragHandles}
		<BlockDragHandle />
	{/if}
</div>

<style>
	.block-host {
		position: relative;
	}

	/* Pure-CSS hover reveal: no per-block reactive state on a path whose cost
	   scales with mounted-component count. Global (not scoped) because
	   reorder hosts nest across components (blockquote > child, list item >
	   sub-item). `.reorder-host` marks any host that renders a handle (BlockHost
	   when reorderable, plus ListItemBlock); `:not(:has(.reorder-host:hover))`
	   reveals only the INNERMOST hovered unit's handle, so a deep hover shows one
	   handle, not a staircase of ancestor handles. */
	:global(.reorder-host:hover:not(:has(.reorder-host:hover)) > .block-drag-handle) {
		opacity: 1;
		pointer-events: auto;
	}

	.failed-block {
		border: 1px dashed var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		opacity: 0.8;
	}
	.failed-block-notice {
		display: block;
		font-size: 0.85em;
		color: var(--color-text-muted, #aaa);
	}
	.failed-block-raw {
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
		font-family: var(--font-editor, ui-monospace, monospace);
	}
</style>
