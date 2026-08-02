<script lang="ts">
	// Render-primary on the public seam: `createContainerBlock` supplies the metadata
	// commit and kind-command keydown, but the body renders the diagram, with no
	// BlockList. Editing swaps in a plugin-owned textarea whose draft commits through
	// the metadata seam as one undoable entry.
	import { tick } from 'svelte';
	import {
		createContainerBlock,
		getPluginMetadata,
		trimTrailingLineEnding,
		normalizeLineEndings,
		type NodeView
	} from '$lib/plugin';
	import { joinMermaidBody, type MermaidMetadata } from './mermaid-kind';
	import { hasMermaidRenderer, renderMermaid, type MermaidRenderResult } from './mermaid-renderer';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// Every steady state carries a focus surface — the edit textarea included, so a broken or
	// empty diagram is an arrow stop and a recovery entry point rather than a caret trap.
	function focusSurfaceEl(): HTMLElement | null {
		return (
			boxEl?.querySelector<HTMLElement>('.mermaid-source, .mermaid-viewport, .mermaid-surface') ??
			null
		);
	}

	const {
		containerApi,
		updateOwnMetadata,
		handleKeydown,
		moveFocusOut,
		getPresentationMode,
		getTheme
	} = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		getFocusEl: focusSurfaceEl,
		// Read live per dispatch, so an undo that replaces the node still reaches the
		// current handlers.
		commandHooks: () => ({ openEdit, openFocusView })
	});

	// The factory routes whole-block focus, delete, traversal and reorder, and carries
	// the `measurePartialRects` the overlays paint off: there are no child hosts here.
	export { containerApi };

	const code = $derived(getPluginMetadata<MermaidMetadata>(node)?.code ?? '');
	const displayCode = $derived(trimTrailingLineEnding(code));

	// An empty diagram has no picture to draw and nothing worth reporting — the engine
	// rejects empty input — so its natural view is the edit surface, and reading mode, which
	// writes no bytes, gets a placeholder.
	const isEmpty = $derived(displayCode.trim() === '');
	const isReading = $derived(getPresentationMode() === 'reading');

	// ── Rendering ───────────────────────────────────────────────────────────────

	let rendered = $state<MermaidRenderResult | null>(null);
	$effect(() => {
		const current = code;
		// Reading the theme here is what subscribes this effect to a flip, which has to
		// redraw because the engine writes colors into the SVG.
		const theme = getTheme();
		if (isEmpty || !hasMermaidRenderer()) return;
		let stale = false;
		void renderMermaid(current, theme).then(async (result) => {
			if (stale) return;
			// A result swap replaces the focused element (error card → viewport once an
			// edit fixes the code), so recovery must hand focus to the new surface.
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

	// Focus-gated so the in-document diagram never hijacks the page: unfocused, a bare
	// wheel scrolls and a stray drag cannot pan. Any descendant focus counts.
	const isFocused = () => !!boxEl?.contains(document.activeElement);

	function onViewportWheel(e: WheelEvent): void {
		if (!isFocused() || !(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		e.stopPropagation();
		view.zoomBy(e.deltaY);
	}

	function onViewportPointerDown(e: PointerEvent): void {
		// Never preventDefault, so the browser's focus-on-mousedown still lands: the
		// first click focuses, and only a drag on the now-focused block pans.
		e.stopPropagation();
		if (isFocused()) view.beginPan(e);
	}

	function onOverlayWheel(e: WheelEvent): void {
		// A dedicated zoom surface with nothing behind to scroll, so unlike the
		// in-document view a bare wheel zooms.
		e.preventDefault();
		e.stopPropagation();
		overlayView.zoomBy(e.deltaY);
	}

	// The non-rendered cards mirror the viewport's click contract, so dblclick stays the
	// recovery path out of a broken diagram.
	function onSurfacePointerDown(e: PointerEvent): void {
		e.stopPropagation();
	}

	function onSurfaceDblClick(e: MouseEvent): void {
		e.stopPropagation();
		openEdit();
	}

	// ── Edit mode ───────────────────────────────────────────────────────────────

	let editRequested = $state(false);
	let textareaEl = $state<HTMLTextAreaElement | undefined>();
	let draft = $state('');
	let editSeed = '';

	const editing = $derived(editRequested || (isEmpty && !isReading));

	function seedDraft(): void {
		editSeed = displayCode;
		draft = editSeed;
	}

	// The document can change under an open box (a host undo, a structural replace), and the
	// blur commit would then write a draft seeded from bytes that are gone.
	$effect(() => {
		if (!editing || displayCode === editSeed) return;
		seedDraft();
	});

	// The box follows its text: a textarea has no intrinsic content height, and the inline
	// height a native resize handle writes dies with the element on every exit from edit mode.
	$effect(() => {
		void draft;
		const el = textareaEl;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
	});

	function refocusBlock(): void {
		void tick().then(() => focusSurfaceEl()?.focus());
	}

	function openEdit(): void {
		// Reading mode writes no bytes, and a code edit would; the button is CSS-hidden
		// there too, so this closes the command path.
		if (isReading) return;
		if (!editing) seedDraft();
		editRequested = true;
		void tick().then(() => textareaEl?.focus());
	}

	function cancelEdit(): void {
		editRequested = false;
		// An empty diagram keeps its edit view, so the abandoned draft goes with the request
		// that made it rather than surviving in a box that never closed.
		seedDraft();
		refocusBlock();
	}

	function commitEdit(refocus: boolean): void {
		if (!editing) return;
		const value = draft;
		editRequested = false;
		// The textarea value is LF-normalized, so the seed must be compared the same way:
		// an untouched CRLF block must not rewrite its bytes on blur.
		if (value === normalizeLineEndings(editSeed)) return;
		const lineEnding = getPluginMetadata<MermaidMetadata>(node)?.openerLineEnding ?? '\n';
		updateOwnMetadata({ code: joinMermaidBody(value, lineEnding) });
		// Only a keyboard commit refocuses; a blur commit must not yank focus back from
		// wherever the user clicked.
		if (refocus) refocusBlock();
	}

	// Logical lines, not visual: the box carries no editor caret geometry, so the newlines
	// around a collapsed caret decide the first and last line, and a wrapped row does not.
	function atEditBoxEdge(key: string): boolean {
		const el = textareaEl;
		if (!el || el.selectionStart !== el.selectionEnd) return false;
		const at = el.selectionStart;
		if (key === 'ArrowUp') return !el.value.slice(0, at).includes('\n');
		if (key === 'ArrowDown') return !el.value.slice(at).includes('\n');
		if (key === 'ArrowLeft') return at === 0;
		if (key === 'ArrowRight') return at === el.value.length;
		return false;
	}

	function onTextareaKeydown(e: KeyboardEvent): void {
		// The textarea owns its keys while editing, native undo included; no chord may
		// bubble to the container keymap mid-edit.
		e.stopPropagation();
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			commitEdit(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		} else if (atEditBoxEdge(e.key) && moveFocusOut(e)) {
			// Focus leaves the box, so `focusout` commits the draft: the arrow exit forks
			// nothing off the blur path.
			e.preventDefault();
		} else if (e.key === 'Tab') {
			// Escape is the exit, so Tab indents in place. execCommand inserts through the
			// input event, keeping the `draft` binding and native undo whole.
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
	{#if editing}
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
		{#if isEmpty}
			<!-- Reading mode only: everywhere else an empty diagram renders its edit surface. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="mermaid-surface"
				tabindex="0"
				role="group"
				aria-label="Empty diagram"
				onpointerdown={onSurfacePointerDown}
				ondblclick={onSurfaceDblClick}
			>
				<div class="mermaid-empty">Empty diagram</div>
			</div>
		{:else if !hasMermaidRenderer()}
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
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
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
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
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

	/* Matches CodeBlock's border shift: one treatment on the block root, no inner
	   outline, and any descendant focus counts. */
	.mermaid-block:focus-within {
		border-color: var(--color-accent, #567b67);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
	}

	/* Revealed on hover/focus so the diagram carries no chrome at rest (SearchBar's
	   elevated-surface + ghost-button convention). */
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

	/* No inner outline: the block-level :focus-within border shift is the only cue. */
	.mermaid-surface {
		outline: none;
	}

	/* Only the focused viewport pans, so only it hints with the grab cursor. */
	.mermaid-viewport:focus {
		cursor: grab;
	}

	.mermaid-canvas {
		transform-origin: center top;
		display: flex;
		justify-content: center;
	}

	/* Height is written by the fit-to-content effect; `overflow-y: hidden` keeps the grow
	   visible instead of scrolled. */
	.mermaid-source {
		display: block;
		width: 100%;
		min-height: 1.4em;
		box-sizing: border-box;
		padding: 8px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-accent, #567b67);
		border-radius: 4px;
		color: inherit;
		overflow-y: hidden;
		resize: none;
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

	.mermaid-loading,
	.mermaid-empty {
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
