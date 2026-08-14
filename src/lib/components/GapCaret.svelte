<script lang="ts">
	/**
	 * The between-blocks caret's own surface: a zero-height proxy that takes DOM focus while the
	 * gap is live. It lives in the BlockList, outside every block's surface, so it contributes
	 * nothing to any block's textContent walk. Text and Enter mint a paragraph at the boundary;
	 * every other input is refused at `beforeinput`.
	 */
	import { getContext } from 'svelte';
	import type { BlockEditActions, FocusActions, HistoryActions } from '../action-contracts';
	import { GAP_CARET_LABEL } from '../a11y-strings';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		HISTORY_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../editor-keys';
	import { emitCommandError } from '../editor-events';
	import { runGlobalChord } from '../schema/commands';
	import { eventToChord } from '../schema/keybindings';
	import { isReadingMode } from '../presentation-mode';

	let {
		index,
		focusActions,
		blockEdit
	}: {
		index: number;
		focusActions: FocusActions | undefined;
		blockEdit: BlockEditActions | undefined;
	} = $props();

	// Root-provided facets, read here rather than threaded through BlockList: only the
	// scope-local action bundles depend on where this list sits.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const selection = services?.selection;
	const policies = getContext<EditorPolicies | undefined>(EDITOR_POLICIES_KEY);
	const editorDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY);
	const history = getContext<HistoryActions | undefined>(HISTORY_KEY);

	let proxyEl: HTMLElement | undefined = $state();
	let composing = false;

	const isReading = $derived(isReadingMode(policies?.presentationMode));

	// Rendering, not sequencing: the component exists only while it IS the live gap.
	// Focusing the contenteditable seats a caret in it (Chromium); no manual range needed.
	$effect(() => {
		if (!proxyEl) return;
		proxyEl.focus();
	});

	// The move that leaves must not be re-captured by the boundary it is leaving.
	const EXIT = { skipGapStop: true } as const;

	function leaveForward(): void {
		void focusActions?.moveFocus(index, 'start', EXIT);
	}

	function leaveBackward(): void {
		void focusActions?.moveFocus(index - 1, 'end', EXIT);
	}

	/** The mint's own `afterTick` focuses the new block, and that door ends the gap. */
	function mint(text: string): void {
		void blockEdit?.insertParagraph(index, text);
	}

	/**
	 * Undo/redo and plugin globals resolve HERE, at the target: no block holds focus, and the
	 * root's own arm answers only a caret with no focused element at all. Reading mode still
	 * consumes the chord, or the browser's native history runs on the proxy.
	 */
	function handleGlobalChord(
		event: KeyboardEvent,
		deps: { history: HistoryActions; doc: EditorDoc; events: EditorServices['events'] }
	): boolean {
		const chord = eventToChord(event);
		if (!chord) return false;
		const consumed = runGlobalChord(chord, policies?.keybindingOverrides(), {
			isReading,
			history: deps.history,
			pluginEditor: deps.doc.pluginEditor,
			onCommandError: (report) => emitCommandError(deps.events, report)
		});
		if (consumed) event.preventDefault();
		return consumed;
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (history && editorDoc && services) {
			if (handleGlobalChord(event, { history, doc: editorDoc, events: services.events })) return;
		}
		// Any other modified chord belongs to whatever the root or the host does with it.
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		switch (event.key) {
			case 'Enter':
				event.preventDefault();
				return mint('');
			// Shift+Arrow is deliberately the plain arrow here: a single block selected whole
			// is not a representable cross-block state (docs/design/editor.md § The gap caret).
			case 'ArrowDown':
			case 'ArrowRight':
			case 'Delete':
				event.preventDefault();
				return leaveForward();
			case 'ArrowUp':
			case 'ArrowLeft':
			case 'Backspace':
				event.preventDefault();
				return leaveBackward();
			case 'Escape':
				event.preventDefault();
				return index === 0 ? leaveForward() : leaveBackward();
		}
	}

	function onBeforeInput(event: InputEvent): void {
		// The browser owns the proxy between compositionstart and compositionend (the editor's
		// standing IME stance) — refusing here swallows the composition.
		if (composing) return;
		event.preventDefault();
		if (event.inputType === 'insertText' && event.data) mint(event.data);
	}

	function onCompositionEnd(): void {
		composing = false;
		const composed = proxyEl?.textContent ?? '';
		// The proxy is a caret host, never a surface a serializer reads: whatever the IME left
		// belongs to the minted paragraph, and the proxy goes back to empty either way.
		if (proxyEl) proxyEl.textContent = '';
		if (composed) mint(composed);
	}

	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		// A null relatedTarget is the window losing focus, which a native caret survives too.
		// Anything landing inside the editor claimed the caret through a door of its own.
		if (next === null) return;
		if (next instanceof Node && editorDoc?.editorRoot()?.contains(next)) return;
		selection?.clearGapCaret();
	}
</script>

<div class="gap-caret" data-gap-caret>
	<div class="gap-caret-line" aria-hidden="true"></div>
	<div
		bind:this={proxyEl}
		class="gap-caret-proxy"
		contenteditable={isReading ? 'false' : 'true'}
		role="textbox"
		tabindex="0"
		aria-label={GAP_CARET_LABEL}
		spellcheck="false"
		onkeydown={onKeyDown}
		onbeforeinput={onBeforeInput}
		oncompositionstart={() => (composing = true)}
		oncompositionend={onCompositionEnd}
		onfocusout={onFocusOut}
	></div>
</div>

<style>
	/* Out of flow entirely: the boundary it marks must keep the layout it had without it. */
	.gap-caret {
		position: relative;
		flex: 0 0 auto;
		height: 0;
		overflow: visible;
	}
	/* Centred on the boundary, so neither neighbour appears to own it. */
	.gap-caret-line {
		position: absolute;
		top: -1px;
		left: 0;
		right: 0;
		height: 2px;
		background-color: var(--color-text-secondary, #d6d9e0);
		border-radius: 1px;
		pointer-events: none;
		animation: gap-caret-blink 1s step-end infinite;
	}
	/**
	 * Absolutely positioned, so the zero-height wrapper keeps the boundary's layout, and a
	 * REAL box: Chromium fires no `beforeinput` on a zero-height editing host, which silently
	 * costs the proxy every keystroke. Click-through, or the band would steal edge clicks
	 * from both neighbours; the painted line is the caret, so this one never shows.
	 */
	.gap-caret-proxy {
		position: absolute;
		top: -0.6em;
		left: 0;
		right: 0;
		height: 1.2em;
		overflow: hidden;
		outline: none;
		pointer-events: none;
		caret-color: transparent;
	}

	@keyframes gap-caret-blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.gap-caret-line {
			animation: none;
		}
	}
</style>
