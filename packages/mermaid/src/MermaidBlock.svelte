<script lang="ts">
	// A diagram drawn whole (`edit: 'box'`): its picture and a toolbar, or while editing a textarea
	// of its own. The box holds no draft: it writes the fence's body through `Draft.body` once, as
	// it closes or when the editor asks (`save`).
	import { getContext, tick } from 'svelte';
	import { imeOwnsKey, type BoxDrawContext, type BoxFocus } from '@voithos-labs/aragonite/plugin';
	import { useDrawn, type SvelteBlockProps } from '@voithos-labs/aragonite/svelte';
	import { DIAGRAMS, type MermaidRenders, type MermaidRenderResult } from './mermaid-renderer';
	import type { DiagramUi } from './mermaid-plugin';

	let { block, ctx }: SvelteBlockProps<never, BoxDrawContext> = $props();
	const renders = getContext<MermaidRenders>(DIAGRAMS);

	let boxEl: HTMLElement | undefined = $state();

	// Every state has something focusable, the edit textarea included, so a broken or empty
	// diagram is a stop for the arrow keys and a way back in rather than a caret trap.
	function focusSurfaceEl(): HTMLElement | null {
		return (
			boxEl?.querySelector<HTMLElement>('.mermaid-source, .mermaid-viewport, .mermaid-surface') ??
			null
		);
	}

	// The body as the fence holds it; a textarea breaks its lines with a bare LF.
	const displayCode = $derived(block.body.replace(/\r\n/g, '\n'));
	// What a host's renderer is handed: the body's lines with their endings, the last one's included.
	const code = $derived.by(() => {
		const after = block.text.slice(block.text.indexOf('\n') + 1 + block.body.length);
		const ending = after.startsWith('\r\n') ? '\r\n' : after.startsWith('\n') ? '\n' : '';
		return block.body === '' ? '' : block.body + ending;
	});

	// An empty diagram has no picture to draw and mermaid rejects it, so it opens straight into
	// the textarea; reading mode, which writes no bytes, gets a placeholder instead.
	const isEmpty = $derived(displayCode.trim() === '');
	const isReading = $derived(ctx.mode.name === 'reading');
	// Focus anywhere in the block, its whole-block focus included, which sits beside this drawing.
	const focused = $derived(ctx.focused);

	// ── Rendering ───────────────────────────────────────────────────────────────

	let rendered = $state<MermaidRenderResult | null>(null);
	$effect(() => {
		const current = code;
		// Mermaid writes colors into the SVG, so a new theme draws again.
		const theme = ctx.theme;
		if (isEmpty || !renders.configured) return;
		let stale = false;
		void renders.render(current, theme).then(async (result) => {
			if (stale) return;
			// A redraw replaces only the rendered element, so only focus inside it is handed back.
			const hadFocus = focusSurfaceEl()?.contains(document.activeElement) ?? false;
			rendered = result;
			if (hadFocus) {
				await tick();
				focusSurfaceEl()?.focus({ preventScroll: true });
			}
		});
		return () => {
			stale = true;
		};
	});

	const surfaceState = $derived(
		isEmpty
			? 'empty'
			: !renders.configured
				? 'no-renderer'
				: rendered?.error
					? 'error'
					: rendered?.svg
						? 'rendered'
						: 'loading'
	);

	const surfaceLabel = $derived(
		surfaceState === 'empty'
			? 'Empty diagram'
			: surfaceState === 'no-renderer'
				? 'Mermaid source (renderer not configured)'
				: surfaceState === 'error'
					? 'Mermaid render error'
					: 'Mermaid diagram loading'
	);

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

	// Armed by focus, so an unfocused diagram hijacks neither the page nor the editor's own drag.
	const gestureArmed = $derived(focused);

	// The presses the editor leaves to the diagram: its controls, its box, the focus view, and the
	// viewport's pan once focused. Nothing here stops one, which would hide it from the editor.
	function keepsPress(e: Event): boolean {
		if (e.type !== 'pointerdown' && e.type !== 'mousedown') return false;
		const at = e.target instanceof Element ? e.target : null;
		if (at?.closest('.mermaid-toolbar, .mermaid-source, .mermaid-overlay')) return true;
		return gestureArmed && !!at?.closest('.mermaid-viewport');
	}

	function onViewportWheel(e: WheelEvent): void {
		if (!gestureArmed || !(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		e.stopPropagation();
		view.zoomBy(e.deltaY);
	}

	function onViewportPointerDown(e: PointerEvent): void {
		if (gestureArmed) view.beginPan(e);
	}

	function onOverlayWheel(e: WheelEvent): void {
		// A zoom view of its own with nothing behind it to scroll, so unlike the in-document
		// view a plain wheel zooms.
		e.preventDefault();
		e.stopPropagation();
		overlayView.zoomBy(e.deltaY);
	}

	// The viewport and the cards answer clicks alike: a double click opens even a broken diagram,
	// and the focus a click gives goes on to the block's focus host, where typed characters arrive.
	function onSurfaceDblClick(e: MouseEvent): void {
		e.stopPropagation();
		openEdit();
	}

	// ── Edit mode ───────────────────────────────────────────────────────────────

	let editRequested = $state(false);
	let textareaEl = $state<HTMLTextAreaElement | undefined>();
	let boxText = $state('');
	let editSeed = '';
	// Typed in since it was seeded, so its own undo has something to take back.
	let typedIn = false;
	// The block's bytes the box was seeded from: a write to them under an open box re-seeds it.
	let seededFrom: string | null = null;

	const editing = $derived(editRequested || (isEmpty && !isReading));

	function seedBox(): void {
		seededFrom = block.text;
		editSeed = displayCode;
		boxText = editSeed;
		typedIn = false;
	}

	// The box seeds on each opening and again when its block's bytes change under it (a host's
	// write, an undo), so it never writes text seeded from bytes that are gone.
	$effect(() => {
		if (!editing) seededFrom = null;
		else if (block.text !== seededFrom) seedBox();
	});

	// The box follows its text: a textarea has no intrinsic content height, and the inline
	// height a native resize handle writes dies with the element on every exit from edit mode.
	$effect(() => {
		void boxText;
		const el = textareaEl;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
	});

	// An empty diagram keeps its box open, so the caret stays in the box.
	function refocusBlock(): void {
		void tick().then(() =>
			editing ? textareaEl?.focus({ preventScroll: true }) : ctx.focusWhole()
		);
	}

	function openEdit(): void {
		// Reading mode writes no bytes, and a code edit would; the button is CSS-hidden
		// there too, so this closes the command path.
		if (isReading) return;
		if (!editing) seedBox();
		arrivedAt = null;
		// Read before the swap: the card reaches its fitted height only after mounting, and a
		// scroll container at the document's end clamps against the short layout in between.
		const restoreScroll = ctx.keepScroll();
		editRequested = true;
		void restoreScroll().then(() => textareaEl?.focus({ preventScroll: true }));
	}

	function cancelEdit(): void {
		editRequested = false;
		// An empty diagram keeps its edit view, so the abandoned text goes with the request
		// that made it rather than surviving in a box that never closed.
		seedBox();
		refocusBlock();
	}

	// Only a keyboard commit puts the caret back on the block; a blur commit must not yank focus
	// back from wherever the user clicked.
	function commitEdit(refocus: boolean): void {
		if (!editing) return;
		const text = boxText;
		editRequested = false;
		if (text === editSeed) return;
		void ctx.editor.edit().body(block, text).commit();
		if (refocus) refocusBlock();
	}

	// The column an up or down arrow brought the caret in with, handed on as it leaves the same way.
	let arrivedAt: number | null = null;
	const intoBox: BoxFocus = {
		enter(at) {
			arrivedAt = 'x' in at ? at.x : null;
			textareaEl?.focus({ preventScroll: true });
			if ('offset' in at) textareaEl?.setSelectionRange(at.offset, at.offset);
		},
		offset: () =>
			textareaEl && document.activeElement === textareaEl ? textareaEl.selectionStart : null
	};

	// Logical lines, not visual: the newlines around a collapsed caret decide the first and last
	// line, and a wrapped row does not.
	function leaveAt(key: string): void | false {
		const el = textareaEl;
		if (!el || el.selectionStart !== el.selectionEnd) return false;
		const at = el.selectionStart;
		const column = arrivedAt ?? undefined;
		if (key === 'ArrowUp' && !el.value.slice(0, at).includes('\n')) ctx.leave('start', column);
		else if (key === 'ArrowDown' && !el.value.slice(at).includes('\n')) ctx.leave('end', column);
		else if (key === 'ArrowLeft' && at === 0) ctx.leave('start');
		else if (key === 'ArrowRight' && at === el.value.length) ctx.leave('end');
		else return false;
	}

	// Undo and redo, which the box hands the editor until it is typed in: an undo that reopened an
	// empty diagram's box leaves the caret inside, and the redo pressed next is the editor's.
	const handsOnHistory = (e: KeyboardEvent) =>
		!typedIn && (e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key);

	function onTextareaKeydown(e: KeyboardEvent): void {
		if (!imeOwnsKey(e) && handsOnHistory(e)) return;
		// The textarea owns every other key, its own undo once typed in; no other chord bubbles out.
		e.stopPropagation();
		if (imeOwnsKey(e)) return;
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			commitEdit(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		} else if (!(e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) && leaveAt(e.key) !== false) {
			// Focus leaves the box, so `focusout` writes the text: an arrow out is a blur.
			e.preventDefault();
		} else if (e.key === 'Tab') {
			// Escape is the exit, so Tab indents in place. execCommand inserts through the
			// input event, keeping the `boxText` binding and native undo whole.
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
		void tick().then(() => overlayEl?.focus({ preventScroll: true }));
	}

	function closeFocusView(): void {
		focusView = false;
		refocusBlock();
	}

	function onOverlayKeydown(e: KeyboardEvent): void {
		e.stopPropagation();
		if (imeOwnsKey(e)) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFocusView();
		}
	}

	// The editor placing a caret on the block closes the focus view, as Escape does.
	const outOfView: BoxFocus = { enter: closeFocusView, offset: () => null };

	const ui: DiagramUi = { openEdit, openFocusView };
	useDrawn<DiagramUi>(() => ({
		focus: focusView ? outOfView : editing ? intoBox : undefined,
		keep: keepsPress,
		save: () => commitEdit(false),
		controls: ui
	}));
</script>

<!-- The press handlers inside pan, or leave focus where it is; the buttons are the controls. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mermaid-block" bind:this={boxEl} data-diagram-focused={focused ? '' : undefined}>
	{#if editing}
		<textarea
			bind:this={textareaEl}
			bind:value={boxText}
			class="mermaid-source md-source-surface"
			data-testid="mermaid-source"
			spellcheck="false"
			aria-label="Mermaid source"
			onkeydown={onTextareaKeydown}
			oninput={() => (typedIn = true)}
			onfocusout={() => commitEdit(false)}></textarea>
	{:else}
		<!-- A press here is the diagram's (`keepsPress`) and leaves focus where it was; Edit and Focus
		     move it themselves. -->
		<div class="mermaid-toolbar" data-corner-control onpointerdown={(e) => e.preventDefault()}>
			<button type="button" data-testid="mermaid-edit" onclick={openEdit}>Edit</button>
			<button type="button" data-testid="mermaid-focus" onclick={openFocusView}>Focus</button>
			<button type="button" data-testid="mermaid-reset" onclick={() => view.reset()}>
				Reset view
			</button>
		</div>
		{#if surfaceState === 'rendered'}
			<!-- Focusable for a click, out of the tab order: the block's editing host is its stop. -->
			<div
				class="mermaid-viewport"
				tabindex="-1"
				role="img"
				aria-label="Mermaid diagram"
				onwheel={onViewportWheel}
				onpointerdown={onViewportPointerDown}
				onfocus={() => ctx.focusWhole()}
				onpointermove={(e) => view.movePan(e)}
				onpointerup={(e) => view.endPan(e)}
				ondblclick={onSurfaceDblClick}
			>
				<div class="mermaid-canvas" style:transform={view.transform}>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html rendered?.svg ?? ''}
				</div>
			</div>
		{:else}
			<!-- {#key} remounts once per state: a change of state replaces the element, and
			     its focus and blur timing with it. -->
			{#key surfaceState}
				<div
					class="mermaid-surface"
					tabindex="-1"
					role="group"
					aria-label={surfaceLabel}
					onfocus={() => ctx.focusWhole()}
					ondblclick={onSurfaceDblClick}
				>
					{#if surfaceState === 'empty'}
						<!-- Reading mode only: everywhere else an empty diagram opens its textarea. -->
						<div class="mermaid-empty">Empty diagram</div>
					{:else if surfaceState === 'no-renderer'}
						<pre class="mermaid-static">{displayCode}</pre>
						<div class="mermaid-note">Mermaid renderer not configured</div>
					{:else if surfaceState === 'error'}
						<div class="mermaid-error">Mermaid error: {rendered?.error}</div>
						<pre class="mermaid-static">{displayCode}</pre>
					{:else}
						<div class="mermaid-loading">Rendering diagram…</div>
					{/if}
				</div>
			{/key}
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
			<div class="mermaid-overlay-bar" onpointerdown={(e) => e.preventDefault()}>
				<button type="button" onclick={() => overlayView.reset()}>Reset view</button>
				<button type="button" data-testid="mermaid-overlay-close" onclick={closeFocusView}>
					Close
				</button>
			</div>
			<div
				class="mermaid-overlay-viewport"
				onwheel={onOverlayWheel}
				onpointerdown={(e) => overlayView.beginPan(e)}
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
		border: 1px solid var(--color-ui-muted);
		border-radius: 6px;
		margin: 6px 0;
		padding: 4px;
		transition:
			border-color 0.12s ease,
			background-color 0.12s ease;
	}

	/* Matches CodeBlock's border shift: one treatment on the block root, no inner outline, and
	   focus anywhere in the block counts, its whole-block focus beside the drawing included. */
	.mermaid-block[data-diagram-focused] {
		border-color: var(--color-accent);
		background: var(--color-bg-secondary);
	}

	/* Shown on hover or focus so the diagram has no buttons over it at rest, following
	   SearchBar's raised panel and plain buttons. */
	.mermaid-toolbar {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 2;
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 6px;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s ease;
	}

	.mermaid-block:hover .mermaid-toolbar,
	.mermaid-block[data-diagram-focused] .mermaid-toolbar {
		opacity: 1;
		pointer-events: auto;
	}

	/* Reading mode drops the edit button; Focus and Reset only change the view, so they stay. */
	:global([data-presentation='reading']) .mermaid-toolbar :global([data-testid='mermaid-edit']) {
		display: none;
	}

	.mermaid-toolbar button,
	.mermaid-overlay-bar button {
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 11px;
		padding: 2px 8px;
		color: var(--color-text-secondary);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-ui, 3px);
		cursor: pointer;
	}

	.mermaid-toolbar button:hover,
	.mermaid-overlay-bar button:hover {
		background: var(--color-bg-secondary);
	}

	.mermaid-viewport {
		overflow: hidden;
		cursor: pointer;
		outline: none;
		min-height: 40px;
		user-select: none;
	}

	/* No inner outline: the block-level border shift is the only cue. */
	.mermaid-surface {
		outline: none;
	}

	/* Only a focused block pans, so only then does the viewport show the grab cursor. */
	.mermaid-block[data-diagram-focused] .mermaid-viewport {
		cursor: grab;
	}

	.mermaid-canvas {
		transform-origin: center top;
		display: flex;
		justify-content: center;
	}

	/* Only the differences from the shared .md-source-surface (editor.css). Height is written by
	   the fit-to-content effect; `overflow-y: hidden` lets the box grow rather than scroll. */
	.mermaid-source {
		padding: 8px;
		overflow-y: hidden;
		resize: none;
	}

	.mermaid-static {
		margin: 4px 0;
		padding: 8px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		background: var(--color-bg-secondary);
		border-radius: 4px;
		white-space: pre;
		overflow-x: auto;
	}

	.mermaid-note,
	.mermaid-error {
		padding: 4px 8px;
		font-size: 0.85em;
		color: var(--color-text-muted);
	}

	.mermaid-error {
		color: var(--color-error);
	}

	.mermaid-loading,
	.mermaid-empty {
		padding: 12px;
		font-size: 0.85em;
		color: var(--color-text-muted);
	}

	.mermaid-overlay {
		position: fixed;
		inset: 5vh 5vw;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-surface, 8px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		color: var(--color-text-secondary);
		outline: none;
	}

	.mermaid-overlay-bar {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
		padding: 8px;
		border-bottom: 1px solid var(--color-border);
	}

	.mermaid-overlay-viewport {
		flex: 1;
		overflow: hidden;
		cursor: grab;
		user-select: none;
	}
</style>
