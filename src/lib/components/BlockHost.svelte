<script lang="ts">
	import { getContext } from 'svelte';
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { NodeView } from '../core/node-views';
	import type { BlockDecoration } from '../decorations/types';
	import { mountDecorationWidget } from '../decorations/widget-dom';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import DecorationOverlay from './DecorationOverlay.svelte';
	import BlockDragHandle from './BlockDragHandle.svelte';
	import TextEditableBlock from './blocks/text/TextEditableBlock.svelte';
	import { defaultRegistryView } from '../schema/registry-view';
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
		node: NodeView;
		index: number;
		id: string;
		parentPath?: number[];
		ambientPrefix?: AmbientPrefix;
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
		reorderable?: boolean;
	} = $props();

	// Absent in bare unit harnesses that mount BlockHost without the editor shell.
	// The optional reads below (and the two overlays') are what keep THIS component
	// from throwing there; the leaf it mounts is a separate question, and today every
	// one of them destructures the action and facet contexts as required. So a
	// shell-less mount reaches the render boundary, not a rendered block — bare
	// mounting is a property of the host, not yet of the subtree.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const editorEvents = services?.events;
	const engine = services?.decorations;
	// The instance's registry view resolves component + descriptor, so per-instance
	// enablement reaches the render path. Bare mounts (unit harnesses, conformance
	// kit) get no provider and read the global default — behavior-preserving.
	const registryView = services?.registryView ?? defaultRegistryView;
	const getDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.doc;
	// The instance's rect surface, delivered to the block as a prop. Stable object,
	// so a plain read (not a getter); bare mounts without the shell get undefined.
	const rects = services?.rects;
	const getDragHandles = getContext<EditorPolicies | undefined>(
		EDITOR_POLICIES_KEY
	)?.blockDragHandles;
	// $derived, not a mount-time snapshot: a runtime prop toggle must reach blocks
	// that window in and out after the change, not just those mounted at mount.
	const dragHandles = $derived(getDragHandles?.() ?? false);

	let myPath = $derived([...parentPath, index]);

	const NO_BLOCK_DECORATIONS: BlockDecoration[] = [];
	const blockDecs = $derived(
		engine ? engine.blockDecorationsForPath(myPath) : NO_BLOCK_DECORATIONS
	);

	let isContainer = $derived(registryView.descriptor(node.kind).isContainer);
	// A childless container (render-primary plugin block) mounts no child hosts,
	// so overlay painting can't be delegated downward — see SelectionOverlay.
	let hasChildHosts = $derived(isContainer && (node.children?.length ?? 0) > 0);

	let hostEl: HTMLElement | null = $state(null);
	let ref: BlockComponent | undefined = $state();

	let entry = $derived(registryView.component(node.kind));

	// A kind with no registered component falls back to a visible raw-editable
	// surface (below) rather than silently rendering nothing.
	$effect(() => {
		if (!entry) devWarn('block-host', 'no component for kind, rendering raw', node.kind);
	});

	// A component that throws leaves <svelte:boundary> on the fallback for the life of
	// this mounted host — it never re-renders its content until reset() runs. When
	// undo/redo restores DIFFERENT bytes to this same instance (windowing would remount
	// and heal it; a small doc never windows it out), retry the render. A re-throw
	// safely re-enters the fallback — onerror recaptures the fresh reset and failing
	// raw — and an unchanged raw never resets, so a genuinely broken block can't loop.
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
		if (!setRef || !getRef) return;
		return publishRefSlot(index, ref, setRef, getRef);
	});

	const measureChannel = getContext<BlockMeasureChannel | undefined>(RECORD_BLOCK_HEIGHT_KEY);

	useMountGauge();

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

	// Decoration attrs are set imperatively (not spread) so a source change or
	// dispose removes exactly the keys it applied, leaving the host's own
	// attributes untouched.
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

	// Badges prepend BEFORE the block component; the first-non-overlay-child lookups
	// (Editor.getBlockElByPath and the e2e helpers) exclude `.decoration-badge` via
	// BLOCK_CONTENT_SELECTOR (block-content-selector.ts) — keep that constant in step
	// if this wrapper class ever changes.
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
				{rects}
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
	<DecorationOverlay path={myPath} blockRef={ref} blockEl={hostEl} {isContainer} {hasChildHosts} />
	<!-- Rendered LAST so the block-el lookup (`:scope >` excluding overlays and
		 decoration badges) still resolves the block content as its first match. -->
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
