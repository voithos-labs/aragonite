<script lang="ts">
	// The rogue door's inert twin: identical marker-only chrome behind its own caret door, with
	// `contenteditable="false"` the whole difference. A surface that takes no keystroke traps no
	// caret, so G1.33 stands down on it however little it paints.
	import type { BlockComponent, NodeView } from '$lib/plugin';

	let { node }: { node: NodeView } = $props();

	let sourceEl: HTMLDivElement | undefined = $state();

	export const editable = true;
	export const focusable = true;

	export function parkCaret(_offset: number): void {
		sourceEl?.focus();
	}
	export function focus(offset: number): void {
		parkCaret(offset);
	}
	export function getCursorOffset(): number | null {
		return document.activeElement === sourceEl ? 0 : null;
	}

	void ({ editable, focusable, focus, parkCaret, getCursorOffset } satisfies BlockComponent);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div bind:this={sourceEl} contenteditable="false" tabindex="0" class="inert-door-block">
	<span class="md-marker">{node.raw}</span>
</div>
