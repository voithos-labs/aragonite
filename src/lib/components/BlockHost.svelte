<script lang="ts">
	import { getContext } from 'svelte';
	import {
		resolveBlockSurface,
		type AmbientPrefix,
		type BlockComponent,
		type BlockComponentExports
	} from '../block-component';
	import type { NodeView } from '../core/node-views';
	import { useBlockDecorations } from '../decorations/use-block-decorations.svelte';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import DecorationOverlay from './DecorationOverlay.svelte';
	import BlockDragHandle from './BlockDragHandle.svelte';
	import { showsDragHandle } from './drag-handle';
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
	import { observeResize } from '../cursor/observe-resize';
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

	// Optional throughout: unit tests mount BlockHost without the editor shell, so
	// every read here, and in both overlays, is written for absence.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const editorEvents = services?.events;
	const engine = services?.decorations;
	// Per-instance enablement reaches the render path through the view; bare mounts
	// read the global default.
	const registryView = services?.registryView ?? defaultRegistryView;
	const editorDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY);
	const getDoc = editorDoc?.doc;
	// Stable object, so a plain read rather than a getter.
	const rects = services?.rects;
	const policies = getContext<EditorPolicies | undefined>(EDITOR_POLICIES_KEY);
	const getDragHandles = policies?.blockDragHandles;
	// $derived, not a mount-time snapshot: a prop toggle at runtime must reach blocks
	// that mount after the change.
	const dragHandles = $derived(getDragHandles?.() ?? false);
	// The drag-handle prop already accounts for reading mode, but an image's handle does not
	// wait for that prop, so reading mode is checked here too.
	const isReading = $derived(policies?.presentationMode?.() === 'reading');
	// A bare mount has no editor reading: every installed plugin's syntax, no link definitions.
	const inlineReading = editorDoc?.reading ?? {
		grammar: registryView.grammar,
		resolver: undefined,
		resolverSignature: ''
	};
	// A block with no drag handle (a paragraph) can still be dropped next to and moved by key.
	const showsHandle = $derived(
		reorderable && !isReading && showsDragHandle(node, dragHandles, inlineReading)
	);

	let myPath = $derived([...parentPath, index]);

	let descriptor = $derived(registryView.descriptor(node.kind));
	let isContainer = $derived(descriptor.isContainer);
	// Who measures this block's rectangles, decided once here and handed to both overlays:
	// duplicated, the two drift and a container measures over its own children. Handing it to
	// the children needs children with hosts, which a childless container and a grid lack.
	let delegatesPainting = $derived(
		isContainer && (node.children?.length ?? 0) > 0 && descriptor.containerContract !== 'grid'
	);

	let hostEl: HTMLElement | null = $state(null);
	// The one place a block's published interface is resolved (a block's own exports, or
	// `containerApi`); everything that reads this host's ref gets what it returns.
	let instance: BlockComponentExports | undefined = $state();
	let ref: BlockComponent | undefined = $derived(resolveBlockSurface(instance));

	// Neither half is redundant though both look it: the shared container wrapper gives every
	// container `measurePartialRects`, so that test only catches a hand-written one without it,
	// and the other catches a hand-written container that has children and is not a grid.
	let containerPaintsRects = $derived(
		isContainer && !delegatesPainting && !!ref?.measurePartialRects
	);

	let entry = $derived(registryView.component(node.kind));

	// A kind with no registered component falls back to the plain editable block below
	// rather than silently rendering nothing.
	$effect(() => {
		if (!entry) devWarn('block-host', 'no component for kind, rendering raw', node.kind);
	});

	// The error boundary stays on its fallback until reset() runs, so restoring different
	// bytes retries the render while unchanged bytes cannot loop.
	// Plain `let`s, not $state: the effect keys on node.raw alone and reads these live.
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
		return publishRefSlot(slots, index, ref, hostEl);
	});

	// No `focus` means neither allowed shape was published. `defineBlockComponent`
	// types this; the check catches a registration that got in through a cast.
	$effect(() => {
		if (ref && typeof ref.focus !== 'function')
			devWarn('block-host', 'component published no BlockComponent surface', node.kind);
	});

	const measureChannel = getContext<BlockMeasureChannel | undefined>(RECORD_BLOCK_HEIGHT_KEY);

	useMountGauge();

	// Join the list's batched measure pass rather than measuring inline: a per-block
	// read between a sibling's height write costs one reflow per mounted block on a
	// fast scroll (VR-4). Re-registers on path change.
	$effect(() => {
		void myPath;
		if (!measureChannel) return;
		return measureChannel.register(myPath, index, id, () =>
			hostEl ? hostEl.getBoundingClientRect().height : 0
		);
	});

	// An edit resizes this one block, so re-measure it directly. Skip the first run: the
	// batched pass above owns measurement at mount, and a per-block read during a fast
	// scroll is the thrashing it exists to remove (VR-4).
	let firstRun = true;
	$effect(() => {
		void node.raw;
		if (firstRun) {
			firstRun = false;
			return;
		}
		measureChannel?.measureNow(id);
	});

	// A block can grow after mount without its `raw` changing (an image finishing its
	// decode), which the effect above never sees, and `overflow-anchor` is off so the
	// growth would slide the viewport. The list compares against the height it applied.
	$effect(() => {
		if (!hostEl || !measureChannel) return;
		return observeResize(hostEl, (entries) => {
			const box = entries[0]?.borderBoxSize?.[0];
			const height = box ? box.blockSize : entries[0]?.contentRect.height;
			if (height != null) measureChannel.measureOnResize(id, height);
		});
	});

	const kindCue = services?.kindCue;
	// The label stays until its own fade ends; a nested host's fade bubbles here, so the target
	// has to be this host.
	function endKindCue(event: AnimationEvent): void {
		if (event.target === hostEl && event.animationName === 'kind-cue-fade')
			kindCue?.dismiss(myPath);
	}

	const blockDecorations = useBlockDecorations({
		getPath: () => myPath,
		getEl: () => hostEl,
		engine,
		onRenderError: (error) => editorEvents?.emit('error', error)
	});
</script>

<div
	class={[
		'block-host',
		{ 'reorder-host': reorderable && dragHandles, 'handle-host': showsHandle },
		...blockDecorations.classes
	]}
	data-block-path={JSON.stringify(myPath)}
	data-block-kind={node.kind}
	data-kind-cue={kindCue?.labelAt(myPath)}
	onanimationend={endKindCue}
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
	<!-- hostEl is null until mount; safe because SelectionState is filled only by a
		 user gesture, and the overlay's $effect checks for a missing blockEl. -->
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
	<!-- Rendered last so the block-element lookup still finds block content as its
		 first match. -->
	{#if showsHandle}
		<BlockDragHandle />
	{/if}
</div>

<style>
	.block-host {
		position: relative;
	}

	/* Shown on hover by CSS alone: no per-block reactive state on a path whose cost grows with
	   the number of mounted components. Global because handle hosts nest; the `:not(:has(...))`
	   shows the innermost hovered handle, not a staircase of ancestors. A block with no handle
	   (a paragraph in a quote) is no host, so hovering it shows its container's. */
	:global(.handle-host:hover:not(:has(.handle-host:hover)) > .block-drag-handle),
	:global(.block-drag-handle:hover) {
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
