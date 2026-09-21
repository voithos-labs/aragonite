<script module lang="ts">
	// A widget is reused while its source is unchanged, so this id is what an end-to-end test
	// watches: stable across neighbouring keystrokes, new after a source edit.
	let nextMountId = 0;
</script>

<script lang="ts">
	import type { InlineWidgetComponentProps } from '$lib/plugin';
	import { renderInlineMath } from './math-renderer';

	// Read once at mount on purpose: the widget remounts on any source change, so the
	// `$`-stripped interior can never go stale.
	let { source }: InlineWidgetComponentProps = $props();
	// svelte-ignore state_referenced_locally
	const inner = source.slice(1, -1);
	// eslint-disable-next-line no-useless-assignment -- <script module> counter read by the next instance mount
	const mountId = nextMountId++;

	let el: HTMLSpanElement;

	// Inside a client $effect, so server rendering emits no widget DOM; the interior never
	// changes, so it runs once per instance.
	$effect(() => {
		el.replaceChildren(renderInlineMath(inner).dom);
	});
</script>

<span bind:this={el} class="math-inline-widget" data-mount-id={mountId}></span>
