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
	import { isGridDescriptor } from '../schema/block-kind-descriptor';
	import { FAILED_BLOCK_LABEL } from '../a11y-strings';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../editor-keys';
	import { useMountGauge } from '../perf/use-mount-gauge.svelte';
	import { useMeasuredChild } from '../reactivity/use-measured-child.svelte';
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

	// The services and document contexts are optional here and in both overlays, for a partial
	// test mount; the policies carry the editor's own getters, so a mount always has them.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const editorEvents = services?.events;
	const engine = services?.decorations;
	// A bare mount reads the global registry view.
	const registryView = services?.registryView ?? defaultRegistryView;
	const editorDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY);
	const getDoc = editorDoc?.doc;
	// Stable object, so a plain read rather than a getter.
	const rects = services?.rects;
	const policies = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	// $derived, so a runtime toggle reaches blocks that mount after it.
	const dragHandles = $derived(policies.blockDragHandles());
	// Checked here too, because an image's handle does not go through the drag-handle prop.
	const isReading = $derived(policies.presentationMode() === 'reading');
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
	// Decided once for both overlays: a container with children (not a grid) leaves painting its
	// rectangles to the children's own hosts.
	let delegatesPainting = $derived(
		isContainer && (node.children?.length ?? 0) > 0 && !isGridDescriptor(descriptor)
	);

	let hostEl: HTMLElement | null = $state(null);
	// The one place a block's published interface is resolved; every reader of the ref gets it.
	let instance: BlockComponentExports | undefined = $state();
	let ref: BlockComponent | undefined = $derived(resolveBlockSurface(instance));

	// Both halves count: a hand-written container can lack `measurePartialRects`, or have children
	// and not be a grid.
	let containerPaintsRects = $derived(
		isContainer && !delegatesPainting && !!ref?.measurePartialRects
	);

	let entry = $derived(registryView.component(node.kind));

	// A kind with no registered component falls back to the plain editable block below
	// rather than silently rendering nothing.
	$effect(() => {
		if (!entry) devWarn('block-host', 'no component for kind, rendering raw', node.kind);
	});

	// The error boundary retries only when the bytes change, so a failing render cannot loop.
	// Plain `let`s, so the effect keys on `node.raw` alone.
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

	// `defineBlockComponent` types this; the check catches a registration cast past it.
	$effect(() => {
		if (ref && typeof ref.focus !== 'function')
			devWarn('block-host', 'component published no BlockComponent surface', node.kind);
	});

	useMountGauge();

	useMeasuredChild({
		getId: () => id,
		getPath: () => myPath,
		getEl: () => hostEl,
		getRaw: () => node.raw
	});

	const kindCue = services?.kindCue;
	// A nested host's fade bubbles here, so only this host's own animation ends the cue.
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
	<!-- hostEl is null until mount; the overlay checks for a missing blockEl. -->
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
	<!-- Last, so the block-element lookup finds the block content first. -->
	{#if showsHandle}
		<BlockDragHandle />
	{/if}
</div>

<style>
	.block-host {
		position: relative;
	}

	/* Hover by CSS alone, so no reactive state per block; the `:not(:has(...))` shows only the
	   innermost hovered host's handle. */
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
