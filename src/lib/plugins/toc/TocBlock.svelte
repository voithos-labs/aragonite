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

	// One in-flight `scrollTo` per block, later clicks superseding: the process-global
	// reveal anchor has no per-call ownership, so two overlapping `scrollTo`s from this
	// block would let the earlier call's terminal clear strand the later target
	// (m3-task-1-fix-review §F3). Awaiting each call to completion before issuing the
	// next means this block never has two in flight — the anchor cannot leak — while a
	// click mid-flight overwrites `pendingPath`, so the newest target always wins.
	let navigating = false;
	let pendingPath: number[] | null = null;

	async function navigateTo(path: number[]): Promise<void> {
		if (!rects) return; // bare harness with no rect surface: entries are inert
		pendingPath = path;
		if (navigating) return;
		navigating = true;
		try {
			while (pendingPath) {
				const target = pendingPath;
				pendingPath = null;
				await rects.scrollTo(target);
			}
		} finally {
			navigating = false;
		}
	}

	// Suppress the leaf's reveal-on-pointerdown so an entry click navigates instead of
	// folding the block open; the click then runs navigation. View-only in every mode.
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
	<div
		class="toc-block-render"
		role="button"
		tabindex="-1"
		aria-label="Table of contents (click to edit)"
		onpointerdown={leaf.onRenderPointerDown}
	>
		<nav class="toc-block-nav" aria-label="Document headings">
			{#if headings.length === 0}
				<span class="toc-block-empty">No headings yet</span>
			{:else}
				<ol>
					{#each headings as heading (heading.id)}
						<!-- Mouse nav on a list item, not a nested `<button>`: the reveal
						     container is `role="button"`, so an interactive child would nest
						     interactive content. Keyboard/SR navigation of entries is the
						     deferred stretch (fragment-link resolution). -->
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
						<li
							class="toc-block-item toc-block-level-{heading.level}"
							onpointerdown={onEntryPointerDown}
							onclick={() => navigateTo(heading.path)}
						>
							{heading.label}
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

	.toc-block-item {
		font-size: 0.9em;
		line-height: 1.6;
		cursor: pointer;
		border-radius: 3px;
	}

	.toc-block-item:hover {
		color: var(--color-accent, #567b67);
		text-decoration: underline;
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
