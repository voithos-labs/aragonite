<script lang="ts">
	// A plugin leaf that places its own caret, with no `createEditableLeaf` and no
	// `createEditableSurface`, over a block whose every byte is a marker.
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

<div
	bind:this={sourceEl}
	contenteditable="true"
	role="textbox"
	tabindex="0"
	spellcheck="false"
	class="rogue-door-block"
>
	<span class="md-marker">{node.raw}</span>
</div>
