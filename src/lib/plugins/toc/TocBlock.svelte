<script lang="ts">
	// Render-primary table of contents: the folded view is a `<nav>` outline of the
	// document's headings — indented by level, labels projected to clean text, each
	// entry a click-to-navigate target. A click on the block's non-entry area reveals
	// the raw `[[toc]]` source in a contenteditable; blur folds back. All editing
	// behavior (caret, IME, undo, cross-block selection, commit) lives in
	// `createEditableLeaf`; this component owns the list↔source swap and navigation.
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

	// Live-derived from the document prop: the walk reads each heading's bytes through
	// the prop, subscribing to the CST's $state proxy, so an edit above re-runs it. The
	// projection is synchronous and uncached, so the derived stays reactive-safe.
	const headings = $derived(collectHeadings(document, maxDepth));

	// Serialize navigation per block (see `navigation-queue.ts` for why). `navigateTo`
	// lands the caret at the heading as well as scrolling to it, so the entry button
	// does not keep focus where the editor's own chords cannot reach it. No rect
	// surface (a bare harness) → it resolves immediately, so entries are inert.
	const navigation = createNavigationQueue({
		navigateTo: (path) => rects?.navigateTo(path) ?? Promise.resolve()
	});

	// Suppress the leaf's reveal-on-pointerdown so an entry activation navigates instead
	// of folding the block open; a `<button>` entry then navigates on click AND on
	// Enter/Space (native activation). View-only in every mode, so it works in reading.
	function onEntryPointerDown(e: PointerEvent): void {
		e.stopPropagation();
	}

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
						<!-- A real `<button>`, not a role-tagged `<li>`: native focus, tab order,
						     and Enter/Space activation, valid now the container carries no
						     `role="button"`. Its pointerdown is suppressed so the click
						     navigates instead of revealing the block's raw source. -->
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

	/* Reset the native button chrome to a plain, full-row text entry — the accent
	   hover and focus ring are the only affordances. */
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
		border-radius: 3px;
	}

	.toc-block-item:hover {
		color: var(--color-accent, #567b67);
		text-decoration: underline;
	}

	.toc-block-item:focus-visible {
		outline: 2px solid var(--color-accent, #567b67);
		outline-offset: 1px;
	}

	/* Indent by heading level — a flat `<ol>` keeps list semantics while the padding
	   makes the hierarchy visible. */
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
