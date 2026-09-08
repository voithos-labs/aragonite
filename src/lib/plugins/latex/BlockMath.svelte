<script module lang="ts">
	// Mount id plus render count are the A2 acceptance oracle: editing one equation must
	// leave every untouched block's pair unchanged.
	let nextMountId = 0;
</script>

<script lang="ts">
	// Render-primary editable leaf: all editing behavior lives in `createEditableLeaf`,
	// so this component owns only the render↔source swap visuals.
	import { createEditableLeaf, type BlockComponent, type NodeView } from '$lib/plugin';
	// Plugin-local like the other labels here: bundled plugins import only the public barrel.
	const MATH_PREVIEW_HIDE = 'Hide the rendered preview';
	const MATH_PREVIEW_SHOW = 'Show the rendered preview';
	import { renderDisplayMath } from './math-renderer';
	import { mathDisplaySource } from './latex-kind';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	// eslint-disable-next-line no-useless-assignment -- <script module> counter read by the next instance mount
	const mountId = nextMountId++;
	let renderCount = 0;

	let sourceEl: HTMLDivElement | undefined = $state();
	let renderEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);
	// Per-instance and per-session: a reader who folds the preview away is asking about THIS
	// equation while they edit it, not setting a preference for the document.
	let previewOpen = $state(true);

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

	// Re-runs on every remount of the render div and on any source change; the
	// document-wide memo clones a cached node, so a repeat formula is cheap.
	$effect(() => {
		if (!renderEl) return;
		// Runs while REVEALED as well: the split keeps a live preview beside the source, so the
		// equation re-renders as it is typed rather than only when the source folds away.
		renderEl.replaceChildren(renderDisplayMath(mathDisplaySource(leaf.sourceText)).dom);
		renderCount += 1;
		renderEl.dataset.renderCount = String(renderCount);
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
	export const insertMarkdown = leaf.insertMarkdown;

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
		runCommand,
		insertMarkdown
	} satisfies BlockComponent);
</script>

<!-- Editing shows source AND render side by side rather than swapping one for the other: the
	swap re-flowed the whole document on every click, and a preview that only appears after you
	stop editing is the one you needed while typing. Each half is a card, and the eye sits in the
	top-right of whichever card is showing. -->
<div
	class="math-block"
	class:math-block-editing={revealed}
	class:math-block-split={revealed && previewOpen}
>
	{#if revealed}
		<div class="math-block-card">
			<div
				bind:this={sourceEl}
				{...leaf.surfaceProps}
				class="math-block-source md-source-surface"
				aria-label="Math source"
			></div>
			{#if !previewOpen}
				{@render previewToggle(true)}
			{/if}
		</div>
	{/if}
	{#if !revealed || previewOpen}
		<div class="math-block-card">
			<div
				bind:this={renderEl}
				class="math-block-render"
				data-mount-id={mountId}
				role="button"
				tabindex="-1"
				aria-label="Math (click to edit)"
				{...leaf.renderProps}
			></div>
			{#if revealed}
				{@render previewToggle(false)}
			{/if}
		</div>
	{/if}
</div>

{#snippet previewToggle(folded: boolean)}
	<button
		type="button"
		class="math-preview-toggle"
		aria-label={folded ? MATH_PREVIEW_SHOW : MATH_PREVIEW_HIDE}
		title={folded ? MATH_PREVIEW_SHOW : MATH_PREVIEW_HIDE}
		onmousedown={(e) => e.preventDefault()}
		onclick={() => (previewOpen = folded)}
	>
		<svg
			viewBox="0 0 24 24"
			width="13"
			height="13"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{#if folded}
				<path
					d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"
				/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path
					d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"
				/><path d="m2 2 20 20" />
			{:else}
				<path
					d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
				/><circle cx="12" cy="12" r="3" />
			{/if}
		</svg>
	</button>
{/snippet}

<style>
	/* At rest the render alone, laid out as a plain block so it centres exactly as it did
	   before any of this existed. Editing turns the block into two equal cards. */
	.math-block-split {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: stretch;
		gap: 6px;
	}

	/* Each half is its own card, and the containing block for its eye. */
	.math-block-card {
		position: relative;
		min-width: 0;
		border-radius: 8px;
	}

	/* Keyed on EDITING, not on the split: folding the preview away leaves one card, and a card
	   that lost its fill the moment it stood alone would read as having left edit mode. */
	.math-block-editing .math-block-card {
		display: flex;
		align-items: center;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	/* Deltas over the shared .md-source-surface (editor.css) — including its accent border,
	   which announced a state the card's own fill already carries. */
	.math-block-source {
		outline: none;
		padding: 10px 12px;
		/* WRAP, rather than scroll sideways. The card is half the block's width, so any real
		   formula overflows it, and a horizontal scrollbar hides the very text being edited.
		   `pre-wrap` keeps the author's own line breaks and wraps only what is too long;
		   LaTeX carries no indentation structure for wrapping to destroy. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		/* LEFT, like every other source surface. Centring gave each line a different starting
		   x, which is exactly what makes multi-line LaTeX unreadable; the RENDER is the half
		   that is genuinely centred, and the pairing is what Overleaf and friends do. */
		text-align: left;
		background: transparent;
		border-color: transparent;
		border-radius: 8px;
	}

	/* The card stretches the source so its box fills the column; without it a short formula's
	   surface shrink-wraps and the caret only lands where the text is. */
	.math-block-editing .math-block-card > .math-block-source {
		flex: 1;
		min-width: 0;
	}

	.math-block-render {
		display: block;
		width: 100%;
		padding: 10px 12px;
		text-align: center;
		cursor: text;
		border: 1px solid transparent;
		border-radius: 8px;
		overflow-x: auto;
	}

	/* At rest the render is the whole block and a hover tint is its only affordance; inside a
	   card the fill is already there, so the tint would double it. */
	.math-block:not(.math-block-split) .math-block-render:hover {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	.math-preview-toggle {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted, #8f8f89);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms ease-out;
	}

	/* Transient like every other affordance here: the pointer over the block, or the eye itself
	   holding focus. */
	.math-block:hover .math-preview-toggle,
	.math-preview-toggle:focus-visible {
		opacity: 1;
	}

	.math-preview-toggle:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
		color: var(--color-text-secondary, #cfcfca);
	}

	@media (prefers-reduced-motion: reduce) {
		.math-preview-toggle {
			transition: none;
		}
	}
</style>
