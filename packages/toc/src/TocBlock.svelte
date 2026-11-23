<script lang="ts">
	// The outline's drawing: the document's headings until the caret comes in, then the editor's
	// element for its `[[toc]]` line. A click on an entry puts the caret in that heading.
	import type { TextDrawContext } from '@voithos-labs/aragonite/plugin';
	import { useDrawn, type SvelteBlockProps } from '@voithos-labs/aragonite/svelte';
	import { headingOf, outlineOf, type TocEntry } from './heading-outline';
	import { createNavigationQueue } from './navigation-queue';

	let { ctx, Slot }: SvelteBlockProps<never, TextDrawContext> = $props();

	// The editor's element for the line is the source surface only while it shows.
	$effect(() => {
		for (const name of ['toc-block-source', 'md-source-surface'])
			ctx.source.classList.toggle(name, ctx.focused);
		ctx.source.setAttribute('aria-label', 'TOC source');
	});

	const headings = $derived(outlineOf(ctx.depends));

	// `reveal` opens a collapsed container on the way and scrolls; `select` then puts the caret in
	// the heading, or focus in reading mode.
	const navigation = createNavigationQueue<TocEntry>({
		navigateTo: async (entry) => {
			const heading = headingOf(ctx.editor.doc, entry);
			if (!heading) return;
			await ctx.editor.view.reveal(heading);
			await ctx.editor.select(heading.from);
		}
	});

	// A press on an entry is the entry's, so it navigates instead of opening the source.
	useDrawn(() => ({
		keep: (event) => event.target instanceof Element && !!event.target.closest('.toc-block-item')
	}));
</script>

{#if !ctx.focused}
	<div class="toc-block-render" aria-label="Table of contents (click to edit)">
		<nav class="toc-block-nav" aria-label="Document headings">
			{#if headings.length === 0}
				<span class="toc-block-empty">No headings yet</span>
			{:else}
				<ol>
					{#each headings as heading (heading.id)}
						<!-- A real `<button>`, not a role-tagged `<li>`: native focus, tab order
						     and Enter/Space activation for free. -->
						<li>
							<button
								type="button"
								class="toc-block-item toc-block-level-{heading.level}"
								onclick={() => navigation.navigateTo(heading)}
							>
								{heading.label}
							</button>
						</li>
					{/each}
				</ol>
			{/if}
		</nav>
	</div>
{/if}
<Slot of="source" />

<style>
	/* Only the differences from the shared .md-source-surface (editor.css). */
	:global(.toc-block-source) {
		outline: none;
		padding: 8px 12px;
		white-space: pre;
	}

	.toc-block-render {
		display: block;
		padding: 4px 12px;
		cursor: text;
		border: 1px solid transparent;
		border-left: 3px solid var(--color-accent);
		border-radius: 4px;
	}

	.toc-block-render:hover {
		background: var(--color-bg-secondary);
	}

	.toc-block-nav ol {
		margin: 0;
		padding-left: 1.4em;
		list-style: none;
	}

	/* The browser's button styling is reset to a plain full-width row: the accent hover and
	   the focus ring are the only cues. */
	.toc-block-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0;
		border: none;
		background: none;
		font-family: inherit;
		font-size: 0.9em;
		line-height: 1.6;
		color: inherit;
		cursor: pointer;
		border-radius: var(--radius-ui, 3px);
	}

	.toc-block-item:hover {
		color: var(--color-accent);
		text-decoration: underline;
	}

	.toc-block-item:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	/* A flat `<ol>` keeps list semantics; the padding is what shows the hierarchy. */
	.toc-block-level-1 {
		padding-left: 0;
	}
	.toc-block-level-2 {
		padding-left: 1.1em;
	}
	.toc-block-level-3 {
		padding-left: 2.2em;
	}
	.toc-block-level-4 {
		padding-left: 3.3em;
	}
	.toc-block-level-5 {
		padding-left: 4.4em;
	}
	.toc-block-level-6 {
		padding-left: 5.5em;
	}

	.toc-block-empty {
		font-size: 0.9em;
		color: var(--color-text-muted);
	}

	/* The entry's own line box lands a pixel under the WCAG 2.5.8 minimum a thumb needs. */
	@media (pointer: coarse) {
		.toc-block-item {
			min-height: 24px;
		}
	}
</style>
