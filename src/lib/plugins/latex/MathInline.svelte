<script module lang="ts">
	// A per-instance mount id. The pool reuses an instance while its source is
	// unchanged and remounts when it changes, so this id is the observability hook the
	// e2e keys on: stable across keystrokes next to the widget, new after a source edit.
	let nextMountId = 0;
</script>

<script lang="ts">
	import type { InlineWidgetComponentProps } from '$lib/plugin';
	import { renderInlineMath } from './math-renderer';

	// Frozen-at-mount props: the pool remounts on any source change, so deriving the
	// `$`-stripped interior once can never go stale under the instance. Capturing the
	// initial value is the point, not a bug.
	let { source }: InlineWidgetComponentProps = $props();
	// svelte-ignore state_referenced_locally
	const inner = source.slice(1, -1);
	const mountId = nextMountId++;

	let el: HTMLSpanElement;

	// The renderer builds inside a client $effect — SSR renders no widget DOM. The
	// interior is frozen, so this runs once and the mount id stays put for the instance's life.
	$effect(() => {
		el.replaceChildren(renderInlineMath(inner).dom);
	});
</script>

<span bind:this={el} class="math-inline-widget" data-mount-id={mountId}></span>
