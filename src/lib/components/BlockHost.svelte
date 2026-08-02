<script lang="ts">
	import { getContext } from 'svelte';
	import {
		resolveBlockSurface,
		type AmbientPrefix,
		type BlockComponent,
		type BlockComponentExports
	} from '../block-component';
	import type { NodeView } from '../core/node-views';
	import type { BlockDecoration } from '../decorations/types';
	import { mountDecorationWidget } from '../decorations/widget-dom';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import DecorationOverlay from './DecorationOverlay.svelte';
	import BlockDragHandle from './BlockDragHandle.svelte';
	import TextEditableBlock from './blocks/text/TextEditableBlock.svelte';
	import { defaultRegistryView } from '../schema/registry-view';
	import { FAILED_BLOCK_LABEL } from '../a11y-strings';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		RECORD_BLOCK_HEIGHT_KEY,
		type BlockMeasureChannel,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../editor-keys';
	import { useMountGauge } from '../perf/use-mount-gauge.svelte';
	import { publishRefSlot, type RefSlots } from '../reactivity/publish-ref.svelte';
	import { devWarn } from '../dev-warn';

	let {
		node,
		index,
		id,
		parentPath = [],
		ambientPrefix = '',
		slots,
		reorderable = false
	}: {
		node: NodeView;
		index: number;
		id: string;
		parentPath?: number[];
		ambientPrefix?: AmbientPrefix;
		slots?: RefSlots<BlockComponent>;
		reorderable?: boolean;
	} = $props();

	// Optional throughout: bare unit harnesses mount BlockHost without the editor
	// shell, so every read here (and both overlays') is written for absence.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const editorEvents = services?.events;
	const engine = services?.decorations;
	// Per-instance enablement reaches the render path through the view; bare mounts
	// read the global default.
	const registryView = services?.registryView ?? defaultRegistryView;
	const getDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.doc;
	// Stable object, so a plain read rather than a getter.
	const rects = services?.rects;
	const getDragHandles = getContext<EditorPolicies | undefined>(
		EDITOR_POLICIES_KEY
	)?.blockDragHandles;
	// $derived, not a mount-time snapshot: a runtime prop toggle must reach blocks
	// that window in after the change.
	const dragHandles = $derived(getDragHandles?.() ?? false);

	let myPath = $derived([...parentPath, index]);

	const NO_BLOCK_DECORATIONS: BlockDecoration[] = [];
	const blockDecs = $derived(
		engine ? engine.blockDecorationsForPath(myPath) : NO_BLOCK_DECORATIONS
	);

	let descriptor = $derived(registryView.descriptor(node.kind));
	let isContainer = $derived(descriptor.isContainer);
	// Who paints this block's rects, decided ONCE here and handed to both overlays —
	// duplicated, the two drift and a container paints over its own children. Delegation
	// needs children with hosts: a childless container and a grid have none.
	let delegatesPainting = $derived(
		isContainer && (node.children?.length ?? 0) > 0 && descriptor.containerContract !== 'grid'
	);

	let hostEl: HTMLElement | null = $state(null);
	// The one point that resolves a block's published surface (leaf exports vs
	// containerApi); every consumer of this host's ref reads what it returns.
	let instance: BlockComponentExports | undefined = $state();
	let ref: BlockComponent | undefined = $derived(resolveBlockSurface(instance));

	// Neither conjunct is redundant though both look it: the shim gives every container
	// `measurePartialRects`, so that term guards only a hand-rolled one omitting it, and
	// the delegation term guards a hand-rolled child-bearing non-grid container.
	let containerPaintsRects = $derived(
		isContainer && !delegatesPainting && !!ref?.measurePartialRects
	);

	let entry = $derived(registryView.component(node.kind));

	// A kind with no registered component falls back to the raw-editable surface below
	// rather than silently rendering nothing.
	$effect(() => {
		if (!entry) devWarn('block-host', 'no component for kind, rendering raw', node.kind);
	});

	// The error boundary sticks on its fallback until reset() runs, so restoring
	// DIFFERENT bytes retries the render while an unchanged raw can't loop.
	// Plain lets, not $state: the effect keys on node.raw alone and reads these live.
	let failedRaw: string | null = null;
	let retryFailedRender: (() => void) | null = null;

	function onRenderError(error: unknown, reset: () => void): void {
		failedRaw = node.raw;
		retryFailedRender = reset;
		editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } });
	}

	$effect(() => {
		const raw = node.raw;
		if (retryFailedRender && failedRaw !== null && raw !== failedRaw) {
			const retry = retryFailedRender;
			retryFailedRender = null;
			failedRaw = null;
			retry();
		}
	});

	$effect(() => {
		if (!slots) return;
		return publishRefSlot(slots, index, ref);
	});

	// No `focus` means neither sanctioned shape was published. `defineBlockComponent`
	// types this; the guard catches a registration that got in through a cast.
	$effect(() => {
		if (ref && typeof ref.focus !== 'function')
			devWarn('block-host', 'component published no BlockComponent surface', node.kind);
	});

	const measureChannel = getContext<BlockMeasureChannel | undefined>(RECORD_BLOCK_HEIGHT_KEY);

	useMountGauge();

	// Enroll in the scope's batched measure pass rather than measuring inline: a
	// per-block read interleaved with a sibling's model write costs one reflow per
	// mounted block on a fling (VR-4). Re-registers on path change.
	$effect(() => {
		void myPath;
		if (!measureChannel) return;
		return measureChannel.register(myPath, index, id, () =>
			hostEl ? hostEl.getBoundingClientRect().height : 0
		);
	});

	// An edit resizes this one block; re-measure it directly. Skip the MOUNT run — the
	// batched pass above owns mount measurement, and a per-block read on a fling is the
	// thrash it exists to remove (VR-4).
	let firstRun = true;
	$effect(() => {
		void node.raw;
		if (firstRun) {
			firstRun = false;
			return;
		}
		measureChannel?.measureNow(id);
	});

	// A block can grow after mount without its `raw` changing (async content decoding
	// in), which the effect above never sees, and overflow-anchor is off so the growth
	// would slide the viewport. The scope gates on the height it already recorded.
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

	// Set imperatively, not spread, so a source change or dispose removes exactly the
	// keys it applied and leaves the host's own attributes alone.
	$effect(() => {
		const decs = blockDecs;
		const el = hostEl;
		if (!el || decs.length === 0) return;
		const appliedKeys: string[] = [];
		for (const dec of decs) {
			for (const [key, value] of Object.entries(dec.attrs ?? {})) {
				el.setAttribute(key, value);
				appliedKeys.push(key);
			}
		}
		return () => {
			for (const key of appliedKeys) el.removeAttribute(key);
		};
	});

	// Badges prepend BEFORE the block component, so BLOCK_CONTENT_SELECTOR
	// (block-content-selector.ts) excludes `.decoration-badge` — keep it in step if
	// this wrapper class changes.
	$effect(() => {
		const decs = blockDecs;
		const el = hostEl;
		if (!el) return;
		const destroys: Array<() => void> = [];
		const badges = document.createDocumentFragment();
		for (const dec of decs) {
			if (!dec.badge) continue;
			const handle = mountDecorationWidget(dec.badge, dec, (error) =>
				editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } })
			);
			if (!handle) continue;
			const wrapper = document.createElement('div');
			wrapper.className = 'decoration-badge';
			wrapper.setAttribute('contenteditable', 'false');
			wrapper.appendChild(handle.el);
			badges.appendChild(wrapper);
			destroys.push(() => {
				handle.destroy();
				wrapper.remove();
			});
		}
		if (destroys.length === 0) return;
		el.insertBefore(badges, el.firstChild);
		return () => {
			for (const destroy of destroys) destroy();
		};
	});
</script>

<div
	class={[
		'block-host',
		{ 'reorder-host': reorderable && dragHandles },
		...blockDecs.flatMap((d) => d.class ?? [])
	]}
	data-block-path={JSON.stringify(myPath)}
	data-block-kind={node.kind}
	bind:this={hostEl}
>
	<svelte:boundary onerror={onRenderError}>
		{#if entry}
			{@const Comp = entry.component}
			<Comp
				{node}
				{index}
				{myPath}
				{ambientPrefix}
				document={getDoc?.()}
				{rects}
				bind:this={instance}
				{...entry.extraProps?.(node) ?? {}}
			/>
		{:else}
			<TextEditableBlock
				{node}
				{index}
				{myPath}
				{ambientPrefix}
				document={getDoc?.()}
				{rects}
				bind:this={instance}
				blockClass="raw-block"
			/>
		{/if}

		{#snippet failed()}
			<div class="failed-block" data-failed-block role="group" aria-label={FAILED_BLOCK_LABEL}>
				<span class="failed-block-notice">⚠ block failed to render</span>
				<pre class="failed-block-raw">{node.raw}</pre>
			</div>
		{/snippet}
	</svelte:boundary>
	<!-- hostEl is null until mount; safe because SelectionState is only populated by
		 user gesture, and the overlay's $effect guards on !blockEl. -->
	<SelectionOverlay
		path={myPath}
		blockRef={ref}
		blockEl={hostEl}
		{delegatesPainting}
		{containerPaintsRects}
	/>
	<DecorationOverlay
		path={myPath}
		blockRef={ref}
		blockEl={hostEl}
		{isContainer}
		{containerPaintsRects}
	/>
	<!-- Rendered LAST so the block-el lookup still resolves block content as its
		 first match. -->
	{#if reorderable && dragHandles}
		<BlockDragHandle />
	{/if}
</div>

<style>
	.block-host {
		position: relative;
	}

	/* Pure-CSS hover reveal: no per-block reactive state on a path whose cost scales
	   with mounted-component count. Global because reorder hosts nest; the `:not(:has(
	   ...))` reveals the innermost hovered handle, not a staircase of ancestors. */
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
