<script lang="ts">
	import { getContext } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type CstNode,
		type BlockComponent
	} from '../editor-types';

	let { node, index }: { node: CstNode; index: number } = $props();

	const actions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	let el: HTMLDivElement | undefined = $state();

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = false;
	export const focusable = true;

	export function focus(_offset: number): void {
		el?.focus();
	}

	export function getCursorOffset(): number | null {
		if (!el || document.activeElement !== el) return null;
		return 0;
	}

	// ── Event Handlers ──────────────────────────────────────────────────

	function onKeyDown(e: KeyboardEvent): void {
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			actions.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			actions.requestRedo();
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			const displayLen = node.raw.endsWith('\r\n')
				? node.raw.length - 2
				: node.raw.endsWith('\n')
					? node.raw.length - 1
					: node.raw.length;
			actions.splitBlock(index, displayLen);
			return;
		}

		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			actions.deleteBlock(index);
			return;
		}

		if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault();
			actions.moveFocus(index - 1, 'end');
			return;
		}

		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault();
			actions.moveFocus(index + 1, 'start');
			return;
		}
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="thematic-break-block"
	role="separator"
	onkeydown={onKeyDown}
>
	<hr />
</div>

<style>
	.thematic-break-block {
		outline: none;
		padding: 8px 0;
	}

	.thematic-break-block:focus {
		outline: 2px solid var(--color-accent, #4a9eff);
		outline-offset: 2px;
		border-radius: 2px;
	}

	hr {
		border: none;
		border-top: 2px solid var(--color-ui-muted, #444);
		margin: 0;
	}
</style>
