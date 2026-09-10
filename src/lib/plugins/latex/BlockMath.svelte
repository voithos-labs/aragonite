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
	// The three ways the source and its preview can share the block while editing (see
	// `math-layout.ts`); the host's plugin options pick the starting one. The toggle cycles
	// them and names the NEXT layout.
	type MathLayout = MathBlockLayout;
	const LAYOUT_NEXT: Record<MathLayout, MathLayout> = {
		split: 'stacked',
		stacked: 'source',
		source: 'split'
	};
	const LAYOUT_TITLE: Record<MathLayout, string> = {
		split: 'Preview beside the source',
		stacked: 'Preview below the source',
		source: 'Source only'
	};
	import { renderDisplayMath } from './math-renderer';
	import { mathDisplaySource } from './latex-kind';
	import { completeBareMathSource, renderMathSource } from './math-source';
	import { resolveDefaultLayout, type MathBlockLayout } from './math-layout';

	let {
		node,
		index,
		myPath = [],
		blockLayout = 'split'
	}: { node: NodeView; index: number; myPath?: number[]; blockLayout?: MathBlockLayout } =
		$props();

	// eslint-disable-next-line no-useless-assignment -- <script module> counter read by the next instance mount
	const mountId = nextMountId++;
	let renderCount = 0;

	let sourceEl: HTMLDivElement | undefined = $state();
	let renderEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);
	// The in-flight source while revealed: a render-primary edit reaches the CST only on blur,
	// so the live preview reads the surface, not the node. Null when nothing is in flight.
	let draft = $state<string | null>(null);

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		isRevealed: () => revealed,
		setRevealed: (value) => {
			revealed = value;
			draft = null;
		},
		renderSource: renderMathSource,
		completeBareSource: completeBareMathSource,
		onSourceEdit: (text) => {
			draft = text;
		}
	});

	// While editing, the preview is a sibling of the surface that holds focus: its scrollbar (a
	// wide equation overflows the half-width card) must not take that focus, since losing it is
	// what folds the editor. Same device as the eye button; a fold click is a click while folded.
	function keepSourceFocus(e: MouseEvent): void {
		if (revealed) e.preventDefault();
	}

	// Per-instance and per-session: a reader who changes the layout is asking about THIS equation
	// while they edit it, not setting a preference for the document. The starting layout is the
	// host's: this editor's plugin options, else the factory's default.
	// svelte-ignore state_referenced_locally
	let layout = $state<MathLayout>(resolveDefaultLayout(leaf.getOptions(), blockLayout));
	const previewOpen = $derived(layout !== 'source');

	// The edits the leaf applies itself report through `onSourceEdit`; this is the native path
	// (a composition's commit), where the highlight goes stale until repainted. The leaf's own
	// handler runs first so the IME bookkeeping it owns is untouched.
	function onSourceInput(e: Event): void {
		leaf.surfaceProps.oninput();
		if ((e as InputEvent).isComposing) return;
		leaf.repaintSource();
		draft = sourceEl?.textContent ?? null;
	}

	// ── View rendering ──────────────────────────────────────────────────────────

	// Re-runs on every remount of the render div and on any source change; the
	// document-wide memo clones a cached node, so a repeat formula is cheap.
	$effect(() => {
		if (!renderEl) return;
		// Runs while REVEALED as well: the split keeps a live preview beside the source, so the
		// equation re-renders as it is typed rather than only when the source folds away.
		const source = mathDisplaySource(draft ?? leaf.sourceText);
		renderEl.replaceChildren(renderDisplayMath(source).dom);
		// An equation with nothing in it renders nothing, which folded would be an invisible block
		// the user cannot find to delete; it keeps the card's fill instead, like an empty fence.
		renderEl.toggleAttribute('data-empty', source.trim() === '');
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
	class:math-block-split={revealed && layout === 'split'}
	class:math-block-stacked={revealed && layout === 'stacked'}
>
	{#if revealed}
		<div class="math-block-card">
			<div
				bind:this={sourceEl}
				{...leaf.surfaceProps}
				oninput={onSourceInput}
				class="math-block-source md-source-surface"
				aria-label="Math source"
			></div>
			<!-- The toggle keeps one seat: the top-right card. Side by side that is the preview; stacked
				and source-only it is this card. -->
			{#if layout !== 'split'}
				{@render layoutToggle()}
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
				onmousedown={keepSourceFocus}
			></div>
			{#if revealed && layout === 'split'}
				{@render layoutToggle()}
			{/if}
		</div>
	{/if}
</div>

{#snippet layoutToggle()}
	{@const next = LAYOUT_NEXT[layout]}
	<button
		type="button"
		class="math-preview-toggle"
		aria-label={LAYOUT_TITLE[next]}
		title={LAYOUT_TITLE[next]}
		onmousedown={(e) => e.preventDefault()}
		onclick={() => (layout = next)}
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
			{#if layout === 'split'}
				<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M12 3v18" />
			{:else if layout === 'stacked'}
				<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 12h18" />
			{:else}
				<path
					d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"
				/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path
					d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"
				/><path d="m2 2 20 20" />
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

	/* Stacked: the source over its preview, each the block's full width — for the equation too
	   long to read at half width. Not the default: it grows the block and reshuffles the page. */
	.math-block-stacked {
		display: grid;
		grid-template-columns: 1fr;
		gap: 6px;
	}

	/* The equation's cards are boxes like a code block's, and take the same stand-off from their
	   neighbours (editor.css, fencedCode). Padding, not margin: the height model measures the
	   host's box. */
	:global(.block-host[data-block-kind='mathBlock']) {
		padding-block: 6px;
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

	/* Folded and empty: the fill stays, so there is a box to see and click into. */
	.math-block:not(.math-block-editing) .math-block-render[data-empty] {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		/* The editing card's height exactly — one source line at its size, plus its padding and
		   hairline — so folding and unfolding an empty equation moves nothing. */
		min-height: calc(0.9em * 1.5 + 22px);
		box-sizing: border-box;
	}

	/* At rest the render is the whole block and a hover tint is its only affordance; inside a
	   card the fill is already there, so the tint would double it. */
	.math-block:not(.math-block-editing) .math-block-render:hover {
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
