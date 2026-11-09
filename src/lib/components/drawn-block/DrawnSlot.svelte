<!--
  Where a `svelteBlock` component puts one of the editor's elements: the block's text, its children
  or its title row. The element stays the editor's; the slot only holds it.
-->
<script module lang="ts">
	export const SLOT_CONTEXT = Symbol('drawn-slot');
</script>

<script lang="ts">
	import { getContext } from 'svelte';
	import type { DrawContext } from '../../schema/drawing';

	let { of }: { of: 'source' | 'children' | 'title' } = $props();

	const ctx = getContext<(() => DrawContext) | undefined>(SLOT_CONTEXT);
	if (!ctx) throw new Error('<Slot> renders only inside a svelteBlock component');
	const element = $derived(
		(ctx() as unknown as Partial<Record<typeof of, HTMLElement | null>>)[of] ?? null
	);
</script>

{#if element}
	<div
		style="display: contents"
		{@attach (host) => {
			// A move would blur the text if it already sits here.
			if (element.parentNode !== host) host.append(element);
		}}
	></div>
{/if}
