<script module lang="ts">
	// The mount id and the render count are what a test reads: editing one equation must
	// leave every other block's pair of numbers unchanged.
	let nextMountId = 0;
</script>

<script lang="ts">
	// A render-primary editable block: all editing behavior lives in `createEditableLeaf`, so
	// this component owns only how the render and the source are laid out.
	import { createEditableLeaf, type BlockComponent, type NodeView } from '$lib/plugin';
	// The layout toggle cycles through these, and its label names the layout it switches to.
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
	import { completeBareMathSource, mathBodySpan, renderMathSource } from './math-source';
	import { resolveDefaultLayout, type MathBlockLayout } from './math-layout';

	let {
		node,
		index,
		myPath = [],
		blockLayout = 'split'
	}: { node: NodeView; index: number; myPath?: number[]; blockLayout?: MathBlockLayout } = $props();

	// eslint-disable-next-line no-useless-assignment -- <script module> counter read by the next instance mount
	const mountId = nextMountId++;
	let renderCount = 0;

	let sourceEl: HTMLDivElement | undefined = $state();
	let renderEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);
	// The source being edited: a render-primary edit reaches the CST only on blur, so the live
	// preview reads the editable element, not the node. Null when no edit is in progress.
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

	// A press on the preview's scrollbar while editing must not take focus from the source,
	// because losing focus closes the source.
	function keepSourceFocus(e: MouseEvent): void {
		if (revealed) e.preventDefault();
	}

	// Per block and per session: a layout change is about this one equation, not a document
	// preference. The start comes from this editor's plugin options, else the factory default.
	// svelte-ignore state_referenced_locally
	let layout = $state<MathLayout>(resolveDefaultLayout(leaf.getOptions(), blockLayout));
	const previewOpen = $derived(layout !== 'source');

	// The browser's own edits (an IME composition committing) skip `onSourceEdit`, so the
	// highlighting is repainted here, after the leaf's handler has done its IME bookkeeping.
	function onSourceInput(e: Event): void {
		leaf.surfaceProps.oninput();
		if ((e as InputEvent).isComposing) return;
		leaf.repaintSource();
		draft = sourceEl?.textContent ?? null;
	}

	// ── View rendering ──────────────────────────────────────────────────────────

	// Re-runs on every remount of the render div and on any source change; the document-wide
	// cache clones a stored node, so a repeated formula is cheap.
	$effect(() => {
		if (!renderEl) return;
		// Runs while the source is showing too: the side-by-side layout keeps a live preview, so
		// the equation re-renders as it is typed rather than only when the source closes.
		const text = draft ?? leaf.sourceText;
		const source = mathDisplaySource(text);
		renderEl.replaceChildren(renderDisplayMath(source).dom);
		// Where a click on the glyphs puts the caret: `caretTargetAtPoint` on the kind descriptor
		// sees only the rendered element and has no other route to the bytes behind it.
		const body = mathBodySpan(text);
		renderEl.dataset.bodyStart = String(body.start);
		renderEl.dataset.bodyEnd = String(body.end);
		// An empty equation renders nothing, which would leave an invisible block the user cannot
		// find to delete; it keeps the card's fill instead, like an empty code fence.
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

<!-- While editing, the source and the live preview are two cards; the toggle sits in the
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
			<!-- The toggle always sits in the top-right card. Side by side that is the preview;
				stacked or source-only it is this card. -->
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
	/* When not editing, the render alone, laid out as a plain block so it centres. Editing
	   turns the block into two equal cards. */
	.math-block-split {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: stretch;
		gap: 6px;
	}

	/* Stacked: the source above its preview, each full width, for an equation too long for half. */
	.math-block-stacked {
		display: grid;
		grid-template-columns: 1fr;
		gap: 6px;
	}

	/* The equation's cards are boxes like a code block's, and keep the same distance from their
	   neighbours (editor.css, fencedCode). Padding, not margin: block heights are measured from
	   the host's box. Keyed on this component, so every math kind it renders gets it. */
	:global(.block-host):has(> .math-block) {
		padding-block: 6px;
	}

	/* Each half is its own card, and the positioning parent for its toggle button. */
	.math-block-card {
		position: relative;
		min-width: 0;
		border-radius: 8px;
	}

	/* Keyed on editing, not on the side-by-side layout: hiding the preview leaves one card, and
	   a card that lost its fill the moment it stood alone would look like editing had stopped. */
	.math-block-editing .math-block-card {
		display: flex;
		align-items: center;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	/* Only the differences from the shared .md-source-surface (editor.css), including dropping
	   its accent border: the card's own fill already shows that state. */
	.math-block-source {
		outline: none;
		padding: 10px 12px;
		/* Wraps rather than scrolling sideways, so the half-width card never hides the text
		   being edited; `pre-wrap` keeps the author's own line breaks. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		/* Left-aligned like every editable source area; only the render is centred. */
		text-align: left;
		background: transparent;
		border-color: transparent;
		border-radius: 8px;
	}

	/* The card stretches the source so its box fills the column; without it a short formula's
	   editable box shrink-wraps and the caret only lands where the text is. */
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

	/* Empty and not being edited: the fill stays, so there is a box to see and click into. */
	.math-block:not(.math-block-editing) .math-block-render[data-empty] {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		/* Exactly the editing card's height (one source line at its size, plus its padding and
		   hairline border), so opening and closing an empty equation moves nothing. */
		min-height: calc(0.9em * 1.5 + 22px);
		box-sizing: border-box;
	}

	/* When not editing, the render is the whole block and a hover tint is its only cue; inside
	   a card the fill is already there, so the tint would double it. */
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
		color: var(--color-ui-muted, #93938d);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms ease-out;
	}

	/* Shown only while it is wanted, like every other cue here: the pointer over the block, or
	   the button itself holding focus. */
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
