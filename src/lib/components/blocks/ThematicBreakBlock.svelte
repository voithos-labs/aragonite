<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		type BlockEditActions,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent
	} from '../../contracts';
	import { displayLength } from '../../core/lines';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
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
	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

	// ── Event Handlers ──────────────────────────────────────────────────

	function onKeyDown(e: KeyboardEvent): void {
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			history.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			history.requestRedo();
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			blockEdit.splitBlock(index, displayLength(node.raw));
			return;
		}

		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			blockEdit.deleteBlock(index);
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusActions.moveFocus(index - 1, { stickyColumnFrom: 'below' });
			return;
		}

		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			focusActions.moveFocus(index - 1, 'end');
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusActions.moveFocus(index + 1, { stickyColumnFrom: 'above' });
			return;
		}

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			focusActions.moveFocus(index + 1, 'start');
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
