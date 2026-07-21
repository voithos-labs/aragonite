<script lang="ts">
	// Render-primary table of contents: the folded view is a `<nav>` list of the
	// document's headings, read straight off `props.document`; a click reveals the
	// raw `[[toc]]` source in a contenteditable, and blur folds back. All editing
	// behavior (caret, IME, undo, cross-block selection, commit) lives in
	// `createEditableLeaf`; this component owns only the list↔source swap visuals.
	//
	// The heading list is the whole point of the dogfood: it exercises the
	// `BlockComponentProps.document` delivery, deep-reactive so a heading edit above
	// updates the list, and reaching a nested block through editor context.
	import {
		createEditableLeaf,
		getContentRange,
		type BlockComponent,
		type DocumentView,
		type NodeView
	} from '$lib/plugin';

	let {
		node,
		index,
		myPath = [],
		document
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		document?: DocumentView;
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

	interface TocEntry {
		id: string;
		text: string;
	}

	// Live-derived from the document prop: reading each heading's `raw` through the
	// prop subscribes to the CST's $state proxy, so an edit to a heading above
	// re-runs this and updates the list. `getContentRange` drops the markers
	// (`#` prefix for ATX, the underline line for setext).
	const headings = $derived.by<TocEntry[]>(() => {
		const entries: TocEntry[] = [];
		const children = document?.children ?? [];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child.kind !== 'heading' && child.kind !== 'setextHeading') continue;
			const range = getContentRange(child);
			entries.push({ id: `${i}:${child.raw}`, text: child.raw.slice(range.start, range.end) });
		}
		return entries;
	});

	// The source view (populate-once-per-reveal as a single text node) and the
	// focus-park on window-out ride `leaf.surfaceProps`; the component owns only
	// the list↔source swap visuals.

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
						<li class="toc-block-item">{heading.text}</li>
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
	}

	.toc-block-item {
		font-size: 0.9em;
		line-height: 1.6;
	}

	.toc-block-empty {
		font-size: 0.9em;
		color: var(--color-text-muted, #aaaaaa);
	}
</style>
