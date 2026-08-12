<script lang="ts">
	// Render-primary editable leaf: all editing behavior lives in `createEditableLeaf`,
	// so this component owns only the list↔source swap and navigation.
	import {
		createEditableLeaf,
		type BlockComponent,
		type DocumentView,
		type EditorRects,
		type NodeView
	} from '$lib/plugin';
	import { collectHeadings } from './heading-outline';
	import { createNavigationQueue } from './navigation-queue';

	let {
		node,
		index,
		myPath = [],
		document,
		rects,
		maxDepth = 6
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		document?: DocumentView;
		rects?: EditorRects;
		maxDepth?: number;
	} = $props();

	let sourceEl: HTMLDivElement | undefined = $state();
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

	// The walk reads heading bytes through the prop, subscribing to the CST's $state proxy, so
	// an edit above re-runs it; it stays uncached to keep the derived reactive-safe.
	const headings = $derived(collectHeadings(document, maxDepth));

	// Serialized per block (see `navigation-queue.ts` for why). `navigateTo` lands the caret as
	// well as scrolling, so focus never stays where the editor's chords cannot reach it.
	const navigation = createNavigationQueue({
		navigateTo: (path) => rects?.navigateTo(path) ?? Promise.resolve()
	});

	// Suppresses the leaf's reveal-on-pointerdown so an entry activation navigates
	// instead of folding the block open. View-only, so it works in reading mode too.
	function onEntryPointerDown(e: PointerEvent): void {
		e.stopPropagation();
	}

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

{#if revealed}
	<div
		bind:this={sourceEl}
		{...leaf.surfaceProps}
		class="toc-block-source"
		aria-label="TOC source"
	></div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="toc-block-render"
		aria-label="Table of contents (click to edit)"
		onpointerdown={leaf.onRenderPointerDown}
	>
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
								onpointerdown={onEntryPointerDown}
								onclick={() => navigation.navigateTo(heading.path)}
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

<style>
	.toc-block-source {
		display: block;
		width: 100%;
		outline: none;
		padding: 8px 12px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-accent, #567b67);
		border-radius: 4px;
		color: inherit;
		white-space: pre;
		box-sizing: border-box;
		min-height: 1.4em;
	}

	.toc-block-render {
		display: block;
		padding: 4px 12px;
		cursor: text;
		border: 1px solid transparent;
		border-left: 3px solid var(--color-accent, #567b67);
		border-radius: 4px;
	}

	.toc-block-render:hover {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	.toc-block-nav ol {
		margin: 0;
		padding-left: 1.4em;
		list-style: none;
	}

	/* Native button chrome reset to a plain full-row entry: the accent hover and focus
	   ring are the only affordances. */
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
		color: var(--color-accent, #567b67);
		text-decoration: underline;
	}

	.toc-block-item:focus-visible {
		outline: 2px solid var(--color-accent, #567b67);
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
		color: var(--color-text-muted, #aaaaaa);
	}
</style>
