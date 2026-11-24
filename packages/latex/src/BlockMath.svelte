<script module lang="ts">
	// The mount id and the render count are what a test reads: editing one equation must
	// leave every other block's pair of numbers unchanged.
	let nextMountId = 0;
</script>

<script lang="ts">
	// How a display formula lays out: the picture alone until the caret comes in, then its source
	// card and, in two of the three layouts, the live preview beside or below it.
	import { getContext } from 'svelte';
	import { trimWhitespace, type TextDrawContext } from '@voithos-labs/aragonite/plugin';
	import { useDrawn, type SvelteBlockProps } from '@voithos-labs/aragonite/svelte';
	import { MATH_EDITOR, type MathEditor } from './math-renders';
	import { glyphOffset } from './math-inline';
	import type { MathBlockLayout } from './math-layout';

	// The toggle cycles through these, and its label names the layout it switches to.
	const LAYOUT_NEXT: Record<MathBlockLayout, MathBlockLayout> = {
		split: 'stacked',
		stacked: 'source',
		source: 'split'
	};
	const LAYOUT_TITLE: Record<MathBlockLayout, string> = {
		split: 'Preview beside the source',
		stacked: 'Preview below the source',
		source: 'Source only'
	};

	let { block, ctx, Slot }: SvelteBlockProps<never, TextDrawContext> = $props();
	const { renders, layout: opening } = getContext<MathEditor>(MATH_EDITOR);

	// eslint-disable-next-line no-useless-assignment -- <script module> counter read by the next instance mount
	const mountId = nextMountId++;
	let renderCount = 0;
	let renderEl: HTMLDivElement | undefined = $state();

	// Per block and per session, starting from this editor's options.
	let layout = $state<MathBlockLayout>(opening);
	const revealed = $derived(ctx.focused);
	const previewOpen = $derived(layout !== 'source');
	// The formula as typed while the source is open, so the preview follows the keys.
	const formula = $derived(trimWhitespace(ctx.typed ?? block.body));
	const theme = $derived(ctx.theme);

	// The editor's element for the source wears the source card's look only while it shows, as
	// the card it replaces did.
	$effect(() => {
		const shown = revealed;
		ctx.source.classList.toggle('math-block-source', shown);
		ctx.source.classList.toggle('md-source-surface', shown);
		ctx.source.setAttribute('aria-label', 'Math source');
	});

	$effect(() => {
		if (!renderEl) return;
		renderEl.replaceChildren(renders.render(formula, true, theme).dom);
		// An empty equation renders nothing, which would leave an invisible block the user cannot
		// find to delete; it keeps the card's fill instead, like an empty code fence.
		renderEl.toggleAttribute('data-empty', formula === '');
		renderCount += 1;
		renderEl.dataset.renderCount = String(renderCount);
	});

	// The fence lines paint no glyphs, so a point the glyphs can't answer for goes to the body's end.
	useDrawn(() => ({
		caret: (point) => {
			const end = block.body.length;
			return (renderEl && glyphOffset(renderEl, point, { start: 0, end })) ?? end;
		}
	}));

	// A press on the preview's scrollbar while editing must not take focus from the source,
	// because losing focus closes the source.
	function keepSourceFocus(e: MouseEvent): void {
		if (revealed) e.preventDefault();
	}
</script>

<!-- Editing, the source and the preview are two cards, the toggle top-right of the one showing;
	the source's card stays mounted, so the editor's element is there when the caret comes in. -->
<div
	class="math-block"
	class:math-block-editing={revealed}
	class:math-block-split={revealed && layout === 'split'}
	class:math-block-stacked={revealed && layout === 'stacked'}
>
	<div class="math-block-card">
		<Slot of="source" />
		{#if revealed && layout !== 'split'}
			{@render layoutToggle()}
		{/if}
	</div>
	{#if !revealed || previewOpen}
		<div class="math-block-card">
			<div
				bind:this={renderEl}
				class="math-block-render"
				data-mount-id={mountId}
				role="button"
				tabindex="-1"
				aria-label="Math (click to edit)"
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
		data-corner-control
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

	/* The equation's cards keep a code block's distance from their neighbours (editor.css);
	   padding, not margin, because block heights are measured from the host's box. */
	:global(.block-host[data-block-kind='latex/block']) {
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
		background: var(--color-bg-secondary);
	}

	/* Only the differences from the shared .md-source-surface (editor.css), including dropping
	   its accent border: the card's own fill already shows that state. */
	.math-block :global(.math-block-source) {
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

	/* The fence lines, the `math` info string too, read at the formula's own weight and colour. */
	.math-block :global(.math-block-source .md-marker) {
		opacity: 1;
		color: inherit;
	}

	/* The card stretches the source so its box fills the column; without it a short formula's
	   editable box shrink-wraps and the caret only lands where the text is. */
	.math-block-editing .math-block-card :global(.math-block-source) {
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
	.math-block:not(.math-block-editing) .math-block-render:global([data-empty]) {
		background: var(--color-bg-secondary);
		/* Exactly the editing card's height (one source line at its size, plus its padding and
		   hairline border), so opening and closing an empty equation moves nothing. */
		min-height: calc(0.9em * 1.5 + 22px);
		box-sizing: border-box;
	}

	/* When not editing, the render is the whole block and a hover tint is its only cue; inside
	   a card the fill is already there, so the tint would double it. */
	.math-block:not(.math-block-editing) .math-block-render:hover {
		background: var(--color-bg-secondary);
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
		color: var(--color-ui-muted);
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
		background: var(--color-ui-faint);
		color: var(--color-text-secondary);
	}

	@media (prefers-reduced-motion: reduce) {
		.math-preview-toggle {
			transition: none;
		}
	}
</style>
