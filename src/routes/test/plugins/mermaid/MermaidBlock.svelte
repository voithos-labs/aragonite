<script lang="ts">
	// Render-primary plugin block on the public seam: `createContainerBlock`
	// supplies the metadata commit (`updateOwnMetadata`) and the kind-command
	// keydown, but the body renders the diagram — no BlockList. Editing swaps in
	// a plugin-owned <textarea>; Ctrl+Enter or blur commits the draft through the
	// metadata seam as ONE undoable entry (rebuildMermaidRaw re-emits the fence).
	import { tick } from 'svelte';
	import {
		createContainerBlock,
		getPluginMetadata,
		trimTrailingLineEnding,
		type BlockComponent,
		type CstNode
	} from '$lib/plugin';
	import { bindMermaidUiHooks, type MermaidMetadata } from './mermaid-kind';
	import { hasMermaidRenderer, renderMermaid, type MermaidRenderResult } from './mermaid-renderer';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const { containerApi, updateOwnMetadata, handleKeydown } = createContainerBlock({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get path() {
			return myPath;
		},
		getBoxEl: () => boxEl
	});

	// The factory's focus surface walks into children and this container has
	// none, so every caret entry would dead-end on a no-op. Opting out of caret
	// traversal instead (focusable false) makes arrows glide past the block —
	// mouse and chords reach it. The rest of the surface re-exports the shim.
	export const editable = containerApi.editable;
	export const focusable = false;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent;
	export const selectEdgeWidget = containerApi.selectEdgeWidget;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath;
	export const revealByPath = containerApi.revealByPath;
	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

	const code = $derived(getPluginMetadata<MermaidMetadata>(node)?.code ?? '');
	const displayCode = $derived(trimTrailingLineEnding(code));

	// ── Rendering ───────────────────────────────────────────────────────────────

	let rendered = $state<MermaidRenderResult | null>(null);
	$effect(() => {
		const current = code;
		if (!hasMermaidRenderer()) return;
		let stale = false;
		void renderMermaid(current).then((result) => {
			if (!stale) rendered = result;
		});
		return () => {
			stale = true;
		};
	});

	// ── Pan / zoom ──────────────────────────────────────────────────────────────

	function createPanZoom() {
		let scale = $state(1);
		let x = $state(0);
		let y = $state(0);
		let drag: { pointerId: number; fromX: number; fromY: number; atX: number; atY: number } | null =
			null;
		return {
			get transform() {
				return `translate(${x}px, ${y}px) scale(${scale})`;
			},
			reset() {
				scale = 1;
				x = 0;
				y = 0;
			},
			onwheel(e: WheelEvent) {
				e.preventDefault();
				e.stopPropagation();
				scale = Math.min(4, Math.max(0.25, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
			},
			onpointerdown(e: PointerEvent) {
				// A pan drag must never leak upward and start a cross-block selection.
				e.stopPropagation();
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				drag = { pointerId: e.pointerId, fromX: e.clientX, fromY: e.clientY, atX: x, atY: y };
			},
			onpointermove(e: PointerEvent) {
				if (!drag || e.pointerId !== drag.pointerId) return;
				x = drag.atX + (e.clientX - drag.fromX);
				y = drag.atY + (e.clientY - drag.fromY);
			},
			onpointerup(e: PointerEvent) {
				if (drag?.pointerId === e.pointerId) drag = null;
			}
		};
	}
	const view = createPanZoom();
	const overlayView = createPanZoom();

	// ── Edit mode ───────────────────────────────────────────────────────────────

	let mode = $state<'render' | 'edit'>('render');
	let textareaEl = $state<HTMLTextAreaElement | undefined>();
	let draft = $state('');
	let editSeed = '';

	function refocusViewport(): void {
		void tick().then(() => boxEl?.querySelector<HTMLElement>('.mermaid-viewport')?.focus());
	}

	function openEdit(): void {
		if (mode === 'edit') return;
		editSeed = displayCode;
		draft = editSeed;
		mode = 'edit';
		void tick().then(() => textareaEl?.focus());
	}

	function cancelEdit(): void {
		mode = 'render';
		refocusViewport();
	}

	function commitEdit(refocus: boolean): void {
		if (mode !== 'edit') return;
		const value = draft;
		mode = 'render';
		// The textarea API value is LF-normalized, so compare the seed the same
		// way — an untouched CRLF block must not rewrite its bytes on blur.
		if (value === editSeed.replace(/\r\n/g, '\n')) return;
		updateOwnMetadata({ code: value.length > 0 ? value + '\n' : '' });
		// Only a keyboard commit refocuses; a blur commit must not yank the
		// focus back from wherever the user clicked.
		if (refocus) refocusViewport();
	}

	function onTextareaKeydown(e: KeyboardEvent): void {
		// The textarea owns its keys while editing (native undo included); no
		// chord may bubble to the container keymap mid-edit.
		e.stopPropagation();
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			commitEdit(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// ── Focus view ──────────────────────────────────────────────────────────────

	let focusView = $state(false);
	let overlayEl = $state<HTMLElement | undefined>();

	function openFocusView(): void {
		focusView = true;
		overlayView.reset();
		void tick().then(() => overlayEl?.focus());
	}

	function closeFocusView(): void {
		focusView = false;
		refocusViewport();
	}

	function onOverlayKeydown(e: KeyboardEvent): void {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFocusView();
		}
	}

	// Block commands (mermaid.edit / mermaid.focus, incl. the Mod+M chord) reach
	// this instance through the plugin's node → hooks bridge; re-binds when undo
	// replaces the node.
	$effect(() => bindMermaidUiHooks(node, { openEdit, openFocusView }));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mermaid-block" bind:this={boxEl} onkeydown={handleKeydown}>
	{#if mode === 'edit'}
		<textarea
			bind:this={textareaEl}
			bind:value={draft}
			class="mermaid-source"
			data-testid="mermaid-source"
			spellcheck="false"
			aria-label="Mermaid source"
			onkeydown={onTextareaKeydown}
			onfocusout={() => commitEdit(false)}
			onpointerdown={(e) => e.stopPropagation()}
		></textarea>
	{:else}
		<div class="mermaid-toolbar" onpointerdown={(e) => e.stopPropagation()}>
			<button type="button" data-testid="mermaid-edit" onclick={openEdit}>Edit</button>
			<button type="button" data-testid="mermaid-focus" onclick={openFocusView}>Focus</button>
			<button type="button" data-testid="mermaid-reset" onclick={() => view.reset()}>
				Reset view
			</button>
		</div>
		{#if !hasMermaidRenderer()}
			<pre class="mermaid-static">{displayCode}</pre>
			<div class="mermaid-note">Mermaid renderer not configured</div>
		{:else if rendered?.error}
			<div class="mermaid-error">Mermaid error: {rendered.error}</div>
			<pre class="mermaid-static">{displayCode}</pre>
		{:else if rendered?.svg}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="mermaid-viewport"
				tabindex="0"
				role="img"
				aria-label="Mermaid diagram"
				onwheel={view.onwheel}
				onpointerdown={view.onpointerdown}
				onpointermove={view.onpointermove}
				onpointerup={view.onpointerup}
			>
				<div class="mermaid-canvas" style:transform={view.transform}>
					{@html rendered.svg}
				</div>
			</div>
		{:else}
			<div class="mermaid-loading">Rendering diagram…</div>
		{/if}
	{/if}

	{#if focusView}
		<div
			class="mermaid-overlay"
			data-testid="mermaid-overlay"
			bind:this={overlayEl}
			tabindex="-1"
			role="dialog"
			aria-label="Diagram focus view"
			onkeydown={onOverlayKeydown}
		>
			<div class="mermaid-overlay-bar" onpointerdown={(e) => e.stopPropagation()}>
				<button type="button" onclick={() => overlayView.reset()}>Reset view</button>
				<button type="button" data-testid="mermaid-overlay-close" onclick={closeFocusView}>
					Close
				</button>
			</div>
			<div
				class="mermaid-overlay-viewport"
				onwheel={overlayView.onwheel}
				onpointerdown={overlayView.onpointerdown}
				onpointermove={overlayView.onpointermove}
				onpointerup={overlayView.onpointerup}
			>
				<div class="mermaid-canvas" style:transform={overlayView.transform}>
					{#if rendered?.svg}
						{@html rendered.svg}
					{:else}
						<pre class="mermaid-static">{displayCode}</pre>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.mermaid-block {
		position: relative;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		margin: 6px 0;
		padding: 4px;
	}

	.mermaid-toolbar {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.mermaid-toolbar button,
	.mermaid-overlay-bar button {
		font-size: 12px;
		padding: 2px 8px;
	}

	.mermaid-viewport {
		overflow: hidden;
		cursor: grab;
		outline: none;
		min-height: 40px;
	}

	.mermaid-viewport:focus {
		outline: 2px solid var(--color-accent, #567b67);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.mermaid-canvas {
		transform-origin: center top;
		display: flex;
		justify-content: center;
	}

	.mermaid-source {
		display: block;
		width: 100%;
		min-height: 6em;
		box-sizing: border-box;
		padding: 8px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-accent, #567b67);
		border-radius: 4px;
		color: inherit;
		resize: vertical;
	}

	.mermaid-static {
		margin: 4px 0;
		padding: 8px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.08));
		border-radius: 4px;
		white-space: pre;
		overflow-x: auto;
	}

	.mermaid-note,
	.mermaid-error {
		padding: 4px 8px;
		font-size: 0.85em;
		color: var(--color-text-secondary, #888);
	}

	.mermaid-error {
		color: var(--color-error, #b3554e);
	}

	.mermaid-loading {
		padding: 12px;
		font-size: 0.85em;
		color: var(--color-text-secondary, #888);
	}

	.mermaid-overlay {
		position: fixed;
		inset: 5vh 5vw;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-primary, #fff);
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
		outline: none;
	}

	.mermaid-overlay-bar {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
		padding: 8px;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
	}

	.mermaid-overlay-viewport {
		flex: 1;
		overflow: hidden;
		cursor: grab;
	}
</style>
