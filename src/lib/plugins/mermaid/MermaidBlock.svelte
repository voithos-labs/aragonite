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
		normalizeLineEndings,
		type ContainerBlockComponent,
		type NodeView
	} from '$lib/plugin';
	import { type MermaidMetadata } from './mermaid-kind';
	import { hasMermaidRenderer, renderMermaid, type MermaidRenderResult } from './mermaid-renderer';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// The whole-block focus surface in EVERY steady state: the rendered viewport,
	// or the error/loading/static card (`.mermaid-surface`, tabindex=0) — so a
	// broken diagram is still an arrow stop, a two-step-delete target, and a
	// recovery entry point, never a caret trap. Only edit mode has neither
	// element mounted: the textarea owns focus there.
	function focusSurfaceEl(): HTMLElement | null {
		return boxEl?.querySelector<HTMLElement>('.mermaid-viewport, .mermaid-surface') ?? null;
	}

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
		getBoxEl: () => boxEl,
		getFocusEl: focusSurfaceEl,
		// A minted command (mermaid.edit / mermaid.focus, incl. the Mod+M chord)
		// reaches this instance through ctx.hooks — read live per dispatch, so an
		// undo that replaces the node still hits the current handlers.
		commandHooks: () => ({ openEdit, openFocusView })
	});

	// A childless opaque container opts into editor-level whole-block focus: the
	// factory routes caret entry, focus-then-delete, Enter-below, arrow traversal,
	// and Alt-arrow reorder at the block level (ThematicBreak's model). The rest of
	// the surface re-exports the shim.
	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent;
	export const enterEdgeWidget = containerApi.enterEdgeWidget;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath;
	export const revealByPath = containerApi.revealByPath;
	// Childless opaque box: the overlays measure the whole block off this for a
	// search/decoration rect, since there are no child hosts to paint through.
	export const measurePartialRects = containerApi.measurePartialRects;
	// Completeness guard: `bind:this` reads each instance export individually, so the
	// block above cannot be collapsed — but this `satisfies` fails `npm run check` if a
	// new ContainerBlockComponent member is added and left un-forwarded above.
	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		getCursorPosition,
		focusByPath,
		focusAtColumn,
		isVerticallyTransparent,
		enterEdgeWidget,
		getBlockComponentByPath,
		revealByPath,
		measurePartialRects
	} satisfies ContainerBlockComponent);

	const code = $derived(getPluginMetadata<MermaidMetadata>(node)?.code ?? '');
	const displayCode = $derived(trimTrailingLineEnding(code));

	// ── Rendering ───────────────────────────────────────────────────────────────

	let rendered = $state<MermaidRenderResult | null>(null);
	$effect(() => {
		const current = code;
		if (!hasMermaidRenderer()) return;
		let stale = false;
		void renderMermaid(current).then(async (result) => {
			if (stale) return;
			// A result swap can replace the focused surface element (error card →
			// viewport once an edit fixes the code); hand focus to the new surface
			// so recovery never drops the user's focus to the page.
			const hadFocus =
				document.activeElement !== null && document.activeElement === focusSurfaceEl();
			rendered = result;
			if (hadFocus) {
				await tick();
				focusSurfaceEl()?.focus();
			}
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
			zoomBy(deltaY: number) {
				scale = Math.min(4, Math.max(0.25, scale * (deltaY < 0 ? 1.15 : 1 / 1.15)));
			},
			beginPan(e: PointerEvent) {
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				drag = { pointerId: e.pointerId, fromX: e.clientX, fromY: e.clientY, atX: x, atY: y };
			},
			movePan(e: PointerEvent) {
				if (!drag || e.pointerId !== drag.pointerId) return;
				x = drag.atX + (e.clientX - drag.fromX);
				y = drag.atY + (e.clientY - drag.fromY);
			},
			endPan(e: PointerEvent) {
				if (drag?.pointerId === e.pointerId) drag = null;
			}
		};
	}
	const view = createPanZoom();
	const overlayView = createPanZoom();

	// Pan and zoom are focus-gated so the in-document diagram never hijacks the
	// page: unfocused it is inert to wheel and drag (click-to-focus only), so a
	// bare wheel scrolls the page and a stray drag can't pan. Focused, Ctrl/Cmd+
	// wheel zooms and a drag pans. Block focus is any descendant focus (the
	// viewport or a toolbar button), matching the :focus-within styling.
	const isFocused = () => !!boxEl?.contains(document.activeElement);

	function onViewportWheel(e: WheelEvent): void {
		if (!isFocused() || !(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		e.stopPropagation();
		view.zoomBy(e.deltaY);
	}

	function onViewportPointerDown(e: PointerEvent): void {
		// Never leak upward into a cross-block selection; never preventDefault, so
		// the browser's focus-on-mousedown still lands (the first click focuses,
		// and only a drag on the now-focused block pans).
		e.stopPropagation();
		if (isFocused()) view.beginPan(e);
	}

	function onOverlayWheel(e: WheelEvent): void {
		// The focus modal is a dedicated zoom surface with nothing behind to
		// scroll, so a bare wheel zooms here — unlike the in-document view.
		e.preventDefault();
		e.stopPropagation();
		overlayView.zoomBy(e.deltaY);
	}

	// The error/loading/static card mirrors the viewport's click contract:
	// pointerdown never leaks into a cross-block drag (focus still lands via the
	// browser default), and dblclick opens the editor — the recovery path for a
	// broken diagram.
	function onSurfacePointerDown(e: PointerEvent): void {
		e.stopPropagation();
	}

	function onSurfaceDblClick(e: MouseEvent): void {
		e.stopPropagation();
		openEdit();
	}

	// ── Edit mode ───────────────────────────────────────────────────────────────

	let mode = $state<'render' | 'edit'>('render');
	let textareaEl = $state<HTMLTextAreaElement | undefined>();
	let draft = $state('');
	let editSeed = '';

	function refocusBlock(): void {
		void tick().then(() => focusSurfaceEl()?.focus());
	}

	function openEdit(): void {
		if (mode === 'edit') return;
		// Reading mode: the code edit commits bytes; the mode is read off the editor
		// root (the documented DOM-tier pattern) and the button is CSS-hidden too.
		if (boxEl?.closest('[data-presentation="reading"]')) return;
		editSeed = displayCode;
		draft = editSeed;
		mode = 'edit';
		void tick().then(() => textareaEl?.focus());
	}

	function cancelEdit(): void {
		mode = 'render';
		refocusBlock();
	}

	function commitEdit(refocus: boolean): void {
		if (mode !== 'edit') return;
		const value = draft;
		mode = 'render';
		// The textarea API value is LF-normalized, so compare the seed the same
		// way — an untouched CRLF block must not rewrite its bytes on blur.
		if (value === normalizeLineEndings(editSeed)) return;
		updateOwnMetadata({ code: value.length > 0 ? value + '\n' : '' });
		// Only a keyboard commit refocuses; a blur commit must not yank the
		// focus back from wherever the user clicked.
		if (refocus) refocusBlock();
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
		} else if (e.key === 'Tab') {
			// A code surface indents in place; it never tab-exits (Escape is the exit).
			// execCommand inserts through the input event, so `draft` binds and the
			// textarea's native undo stays whole — a raw draft splice would break both.
			e.preventDefault();
			document.execCommand('insertText', false, '\t');
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
		refocusBlock();
	}

	function onOverlayKeydown(e: KeyboardEvent): void {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFocusView();
		}
	}
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
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="mermaid-surface"
				tabindex="0"
				role="group"
				aria-label="Mermaid source (renderer not configured)"
				onpointerdown={onSurfacePointerDown}
				ondblclick={onSurfaceDblClick}
			>
				<pre class="mermaid-static">{displayCode}</pre>
				<div class="mermaid-note">Mermaid renderer not configured</div>
			</div>
		{:else if rendered?.error}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="mermaid-surface"
				tabindex="0"
				role="group"
				aria-label="Mermaid render error"
				onpointerdown={onSurfacePointerDown}
				ondblclick={onSurfaceDblClick}
			>
				<div class="mermaid-error">Mermaid error: {rendered.error}</div>
				<pre class="mermaid-static">{displayCode}</pre>
			</div>
		{:else if rendered?.svg}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="mermaid-viewport"
				tabindex="0"
				role="img"
				aria-label="Mermaid diagram"
				onwheel={onViewportWheel}
				onpointerdown={onViewportPointerDown}
				onpointermove={(e) => view.movePan(e)}
				onpointerup={(e) => view.endPan(e)}
				ondblclick={(e) => {
					e.stopPropagation();
					openEdit();
				}}
			>
				<div class="mermaid-canvas" style:transform={view.transform}>
					{@html rendered.svg}
				</div>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="mermaid-surface"
				tabindex="0"
				role="group"
				aria-label="Mermaid diagram loading"
				onpointerdown={onSurfacePointerDown}
				ondblclick={onSurfaceDblClick}
			>
				<div class="mermaid-loading">Rendering diagram…</div>
			</div>
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
				onwheel={onOverlayWheel}
				onpointerdown={(e) => {
					e.stopPropagation();
					overlayView.beginPan(e);
				}}
				onpointermove={(e) => overlayView.movePan(e)}
				onpointerup={(e) => overlayView.endPan(e)}
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
		transition:
			border-color 0.12s ease,
			background-color 0.12s ease;
	}

	/* Whole-block focus cue, matching CodeBlock's border shift — one gentle
	   treatment on the block root, no inner outline. Any descendant focus counts,
	   so the block reads active while editing or using its toolbar too. */
	.mermaid-block:focus-within {
		border-color: var(--color-accent, #567b67);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	/* A transient control cluster, floated top-right and revealed on hover/focus
	   so the diagram carries no chrome at rest (SearchBar's elevated-surface +
	   ghost-button convention). */
	.mermaid-toolbar {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 2;
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 6px;
		background: var(--color-bg-elevated, #2a2c33);
		border: 1px solid var(--color-border, #3d4047);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s ease;
	}

	.mermaid-block:hover .mermaid-toolbar,
	.mermaid-block:focus-within .mermaid-toolbar {
		opacity: 1;
		pointer-events: auto;
	}

	/* Reading mode drops the edit affordance; Focus/Reset are view-only and stay. */
	:global([data-presentation='reading']) .mermaid-toolbar :global([data-testid='mermaid-edit']) {
		display: none;
	}

	.mermaid-toolbar button,
	.mermaid-overlay-bar button {
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 11px;
		padding: 2px 8px;
		color: var(--color-text, #d6d9e0);
		background: transparent;
		border: 1px solid var(--color-border, #3d4047);
		border-radius: 3px;
		cursor: pointer;
	}

	.mermaid-toolbar button:hover,
	.mermaid-overlay-bar button:hover {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	.mermaid-viewport {
		overflow: hidden;
		cursor: pointer;
		outline: none;
		min-height: 40px;
		user-select: none;
	}

	/* The non-rendered states share the viewport's focus contract: no inner
	   outline — the block-level :focus-within border shift is the cue. */
	.mermaid-surface {
		outline: none;
	}

	/* Focused, a drag pans — hint it with the grab cursor. Unfocused the viewport
	   is click-to-focus only, so the default pointer stands. */
	.mermaid-viewport:focus {
		cursor: grab;
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
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border-radius: 4px;
		white-space: pre;
		overflow-x: auto;
	}

	.mermaid-note,
	.mermaid-error {
		padding: 4px 8px;
		font-size: 0.85em;
		color: var(--color-text-muted, #aaaaaa);
	}

	.mermaid-error {
		color: var(--color-danger, #e06c75);
	}

	.mermaid-loading {
		padding: 12px;
		font-size: 0.85em;
		color: var(--color-text-muted, #aaaaaa);
	}

	.mermaid-overlay {
		position: fixed;
		inset: 5vh 5vw;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-elevated, #2a2c33);
		border: 1px solid var(--color-border, #3d4047);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		color: var(--color-text, #d6d9e0);
		outline: none;
	}

	.mermaid-overlay-bar {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
		padding: 8px;
		border-bottom: 1px solid var(--color-border, #3d4047);
	}

	.mermaid-overlay-viewport {
		flex: 1;
		overflow: hidden;
		cursor: grab;
		user-select: none;
	}
</style>
