<script module lang="ts">
	// Per-instance mount id (stable across the instance's whole life) plus a
	// per-render counter: the A2 acceptance oracle. Editing one equation must
	// re-render only that one — untouched blocks keep both their mount id (no
	// remount) and their render count (no redundant KaTeX work).
	let nextMountId = 0;
</script>

<script lang="ts">
	// Render-primary block math: a `$$…$$` leaf showing its injected-renderer display
	// output by default, revealing the raw source in a contenteditable on focus/click,
	// re-rendering on blur. All editing behavior (caret, IME, undo, cross-block
	// selection, commit) lives in `createEditableLeaf`; this component owns the
	// render↔source swap visuals — the engine is injected through the `math-renderer` seam.
	import { createEditableLeaf, type BlockComponent, type NodeView } from '$lib/plugin';
	import { renderDisplayMath } from './math-renderer';
	import { mathDisplaySource } from './latex-kind';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	// eslint-disable-next-line no-useless-assignment -- <script module> counter read by the next instance mount
	const mountId = nextMountId++;
	let renderCount = 0;

	let sourceEl: HTMLDivElement | undefined = $state();
	let renderEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		isRevealed: () => revealed,
		setRevealed: (value) => {
			revealed = value;
		}
	});

	// ── View rendering ──────────────────────────────────────────────────────────

	// Rendered view: display render of the current source. Re-run on every mount of
	// the render div (revealed → false recreates it) and on any source change; the
	// document-wide memo clones a cached node, so re-rendering the same formula is cheap.
	// `mathDisplaySource` strips the `$$` or ```math wrapper the source carries.
	$effect(() => {
		if (revealed || !renderEl) return;
		renderEl.replaceChildren(renderDisplayMath(mathDisplaySource(leaf.sourceText)).dom);
		renderCount += 1;
		renderEl.dataset.renderCount = String(renderCount);
	});

	// The source view (populate-once-per-reveal as a single text node) and the
	// focus-park on window-out ride `leaf.surfaceProps`; the component owns only
	// the render↔source swap visuals above.

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

{#if revealed}
	<div
		bind:this={sourceEl}
		{...leaf.surfaceProps}
		class="math-block-source"
		aria-label="Math source"
	></div>
{:else}
	<div
		bind:this={renderEl}
		class="math-block-render"
		data-mount-id={mountId}
		role="button"
		tabindex="-1"
		aria-label="Math (click to edit)"
		onpointerdown={leaf.onRenderPointerDown}
	></div>
{/if}

<style>
	.math-block-source {
		display: block;
		width: 100%;
		outline: none;
		padding: 12px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-accent, #567b67);
		border-radius: 4px;
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		box-sizing: border-box;
		min-height: 1.4em;
	}

	.math-block-render {
		display: block;
		padding: 8px 12px;
		text-align: center;
		cursor: text;
		border: 1px solid transparent;
		border-radius: 4px;
		overflow-x: auto;
	}

	.math-block-render:hover {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}
</style>
