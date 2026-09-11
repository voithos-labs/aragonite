<script lang="ts">
	/**
	 * The row below the last block: a full-width strip that adds an empty paragraph at the end
	 * of the document and lands the caret in it, with a `+` in the left gutter that does the
	 * same — so there is always a way to write below whatever the last block is (a table, a
	 * fence, an equation), and a place to add the next block from.
	 */
	import type { BlockEditActions } from '../action-contracts';
	import { TAIL_ADD_BLOCK, TAIL_ADD_ROW } from '../a11y-strings';
	import MenuIcon from './menu/MenuIcon.svelte';

	let {
		blockEdit,
		childCount,
		readOnly,
		onPlus
	}: {
		blockEdit: BlockEditActions | undefined;
		childCount: number;
		readOnly: boolean;
		/** The `+`: the editor appends the paragraph and opens the block menu over it. */
		onPlus: (button: HTMLElement) => void;
	} = $props();

	// The mint's own focus lands the caret; the mousedown is swallowed so nothing else seats one.
	function append(): void {
		if (readOnly) return;
		void blockEdit?.insertParagraph(childCount, '');
	}
</script>

{#if !readOnly}
	<div class="editor-tail">
		<button
			type="button"
			class="editor-tail-plus"
			aria-label={TAIL_ADD_BLOCK}
			title={TAIL_ADD_BLOCK}
			onmousedown={(e) => e.preventDefault()}
			onclick={(e) => onPlus(e.currentTarget)}><MenuIcon name="plus" size={14} /></button
		>
		<button
			type="button"
			class="editor-tail-row"
			aria-label={TAIL_ADD_ROW}
			onmousedown={(e) => e.preventDefault()}
			onclick={append}
		></button>
	</div>
{/if}

<style>
	.editor-tail {
		position: relative;
		display: flex;
		align-items: center;
		height: 34px;
		margin-top: 2px;
	}
	.editor-tail-row {
		flex: 1;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: text;
	}
	.editor-tail-row:focus-visible {
		outline: 1px solid var(--color-border, #3e3e3b);
		outline-offset: -1px;
		border-radius: 4px;
	}
	/* In the editor's gutter, exactly where a block's drag handle sits (`BlockDragHandle`): the
	   root's 1rem padding holds a 0.85rem slot, and this is the handle of the imaginary last line. */
	.editor-tail-plus {
		position: absolute;
		left: -1rem;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: var(--color-ui-muted, #8f8f89);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms ease-out;
	}
	.editor-tail:hover .editor-tail-plus,
	.editor-tail-plus:focus-visible {
		opacity: 1;
	}
	.editor-tail-plus:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
		color: var(--color-text-primary, #e8e8e5);
	}
	@media (prefers-reduced-motion: reduce) {
		.editor-tail-plus {
			transition: none;
		}
	}
</style>
