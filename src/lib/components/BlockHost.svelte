<script lang="ts">
	import { getContext } from 'svelte';
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { CstNode } from '../core/nodes';
	import type { EditorEvents } from '../editor-events';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import TextEditableBlock from './blocks/TextEditableBlock.svelte';
	import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
	import { getBlockComponent } from '../schema/block-component-registry';
	import {
		EDITOR_EVENTS_KEY,
		RECORD_BLOCK_HEIGHT_KEY,
		type RecordBlockHeight
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
		getRef
	}: {
		node: CstNode;
		index: number;
		id: string;
		parentPath?: number[];
		ambientPrefix?: AmbientPrefix;
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
	} = $props();

	const editorEvents = getContext<EditorEvents | undefined>(EDITOR_EVENTS_KEY);

	let myPath = $derived([...parentPath, index]);

	let isContainer = $derived(getBlockKindDescriptor(node.kind).isContainer);

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

	const recordBlockHeight = getContext<RecordBlockHeight | undefined>(RECORD_BLOCK_HEIGHT_KEY);

	$effect(() => {
		if (perfEnabled()) incMountedBlocks();
		return () => {
			if (perfEnabled()) decMountedBlocks();
		};
	});

	// Reports post-layout height up to the editor (oracle cache + live height
	// model). Re-runs on raw change since height grows with content; jsdom
	// reports 0, so the guard skips recording until a real browser layout exists.
	$effect(() => {
		void node.raw;
		if (!recordBlockHeight || !hostEl) return;
		const h = hostEl.getBoundingClientRect().height;
		if (h > 0) recordBlockHeight(myPath, id, h);
	});
</script>

<div
	class="block-host"
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
				bind:this={ref}
				{...entry.extraProps?.(node) ?? {}}
			/>
		{:else}
			<TextEditableBlock
				{node}
				{index}
				{myPath}
				{ambientPrefix}
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
	<SelectionOverlay path={myPath} blockRef={ref} blockEl={hostEl} {isContainer} />
</div>

<style>
	.block-host {
		position: relative;
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
		color: var(--color-text-secondary, #e6e5e5);
	}
	.failed-block-raw {
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
		font-family: var(--font-mono, monospace);
	}
</style>
