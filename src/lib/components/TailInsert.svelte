<script lang="ts">
	/**
	 * The row below the last block: a full-width, invisible strip that adds an empty paragraph at
	 * the end of the document and puts the caret in it, so there is always a way to write below
	 * whatever the last block is (a table, a fence, an equation). A drag that starts on it is the
	 * editor's own drag-select, like one from any margin (`editor-root-gestures.ts`).
	 */
	import type { BlockEditActions } from '../action-contracts';
	import { TAIL_ADD_ROW } from '../a11y-strings';

	let {
		blockEdit,
		childCount,
		readOnly
	}: {
		blockEdit: BlockEditActions | undefined;
		childCount: number;
		readOnly: boolean;
	} = $props();

	// `insertParagraph` focuses the new block, which places the caret; the mousedown is
	// swallowed so nothing else places one.
	function append(): void {
		if (readOnly) return;
		void blockEdit?.insertParagraph(childCount, '');
	}
</script>

{#if !readOnly}
	<div class="editor-tail">
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
</style>
