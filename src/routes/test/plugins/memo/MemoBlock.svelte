<script lang="ts">
	// Plain-mode editable leaf: a `%%`-prefixed memo that is always an editable
	// text surface. All editing behavior (caret, IME, per-keystroke commits,
	// undo batching, cross-block selection) lives in `createEditableLeaf`; this
	// component owns only the text-sync view.
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

	// Sync the CST text into the view (tracks node.raw through sourceText).
	$effect(() => {
		leaf.syncSource();
	});

	// Windowed out while focused: hand focus to the editor root so the next
	// keystroke routes through its document listener instead of <body>.
	$effect(() => {
		const view = el;
		return () => leaf.parkFocus(view ?? null);
	});

	// ── BlockComponent interface ────────────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = leaf.focus;
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
		focusAtColumn,
		getCursorOffset,
		getSelectedText,
		setSelection,
		measurePartialRects,
		runCommand
	} satisfies BlockComponent);
</script>

<!-- Plain mode keeps its source always mounted, so the component binds
	contenteditable off the leaf's mode read — the leaf-tier reference wiring. -->
<div
	bind:this={el}
	tabindex="0"
	class="memo-block"
	contenteditable={leaf.getPresentationMode() === 'reading' ? 'false' : 'true'}
	role="textbox"
	aria-label="Memo"
	spellcheck="false"
	oninput={leaf.onInput}
	onkeydown={leaf.handleKeydown}
	oncopy={leaf.onCopy}
	oncut={leaf.onCut}
	onpaste={leaf.onPaste}
	onpointerdown={leaf.onPointerDown}
	onfocusout={leaf.onFocusOut}
	oncompositionstart={leaf.onCompositionStart}
	oncompositionend={leaf.onCompositionEnd}
></div>

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
