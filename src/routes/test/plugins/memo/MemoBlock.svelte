<script lang="ts">
	// Plain-mode editable leaf: every editing behavior lives in `createEditableLeaf`, and
	// spreading `leaf.surfaceProps` wires the whole source surface.
	import { createEditableLeaf, type BlockComponent, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let el: HTMLDivElement | undefined = $state();

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => el ?? null,
		mode: 'plain'
	});

	// ── BlockComponent interface ────────────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = leaf.focus;
	export const parkCaret = leaf.parkCaret;
	export const focusAtColumn = leaf.focusAtColumn;
	export const getCursorOffset = leaf.getCursorOffset;
	export const getSelectedText = leaf.getSelectedText;
	export const setSelection = leaf.setSelection;
	export const measurePartialRects = leaf.measurePartialRects;
	export const runCommand = leaf.runCommand;

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		focusAtColumn,
		getCursorOffset,
		getSelectedText,
		setSelection,
		measurePartialRects,
		runCommand
	} satisfies BlockComponent);
</script>

<!-- The leaf-tier reference wiring: one spread carries every handler, attribute, and
	attachment a plain leaf's always-mounted source needs. -->
<div bind:this={el} {...leaf.surfaceProps} class="memo-block" aria-label="Memo"></div>

<style>
	.memo-block {
		outline: none;
		width: 100%;
		box-sizing: border-box;
		padding: 2px 0 2px 10px;
		border-left: 3px solid var(--color-accent, #567b67);
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		white-space: pre-wrap;
		word-wrap: break-word;
		min-height: 1.4em;
	}
</style>
