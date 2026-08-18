<script module lang="ts">
	// Mount id plus render count are the A2 acceptance oracle: editing one equation must
	// leave every untouched block's pair unchanged.
	let nextMountId = 0;
</script>

<script lang="ts">
	// Render-primary editable leaf: all editing behavior lives in `createEditableLeaf`,
	// so this component owns only the render↔source swap visuals.
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

	// Re-runs on every remount of the render div and on any source change; the
	// document-wide memo clones a cached node, so a repeat formula is cheap.
	$effect(() => {
		if (revealed || !renderEl) return;
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

{#if revealed}
	<div
		bind:this={sourceEl}
		{...leaf.surfaceProps}
		class="math-block-source md-source-surface"
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
		{...leaf.renderProps}
	></div>
{/if}

<style>
	/* Deltas over the shared .md-source-surface (editor.css). */
	.math-block-source {
		outline: none;
		padding: 12px;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
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
