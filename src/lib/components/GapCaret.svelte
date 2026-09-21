<script lang="ts">
	/**
	 * The between-blocks caret: a zero-height stand-in element that takes DOM focus while the
	 * gap is live. It lives in the BlockList, outside every block, so it adds nothing to any
	 * block's text content. Text and Enter create a paragraph at the boundary; every other
	 * input is refused at `beforeinput`.
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

	// Provided by the root and read here rather than passed through BlockList: only the
	// two action bundles above depend on where this list sits.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const selection = services?.selection;
	const policies = getContext<EditorPolicies | undefined>(EDITOR_POLICIES_KEY);
	const editorDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY);
	const history = getContext<HistoryActions | undefined>(HISTORY_KEY);

	let proxyEl: HTMLElement | undefined = $state();
	let composing = false;

	const isReading = $derived(isReadingMode(policies?.presentationMode));

	// Not a timing trick: the component exists only while it is the live gap. Focusing
	// the contenteditable puts a caret in it (Chromium); no manual range needed.
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

	/** `insertParagraph`'s own `afterTick` focuses the new block, and that focus ends the gap. */
	function mint(text: string): void {
		void blockEdit?.insertParagraph(index, text);
	}

	/**
	 * Undo, redo and plugin-global chords are handled here, where the key landed: no block holds
	 * focus, and the root's own handler answers only a caret with no focused element at all.
	 * Reading mode still takes the chord, or the browser's own undo would run on this element.
	 */
	function handleGlobalChord(
		event: KeyboardEvent,
		deps: {
			history: HistoryActions;
			doc: EditorDoc;
			events: EditorServices['events'];
			activation: EditorServices['activePlugins'];
		}
	): boolean {
		const chord = eventToChord(event);
		if (!chord) return false;
		const consumed = runGlobalChord(chord, policies?.keybindingOverrides(), {
			isReading,
			history: deps.history,
			pluginEditor: deps.doc.pluginEditor,
			activation: deps.activation,
			onCommandError: (report) => emitCommandError(deps.events, report)
		});
		if (consumed) event.preventDefault();
		return consumed;
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (history && editorDoc && services) {
			const deps = {
				history,
				doc: editorDoc,
				events: services.events,
				activation: services.activePlugins
			};
			if (handleGlobalChord(event, deps)) return;
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
		// The browser owns this element between compositionstart and compositionend, as it does
		// everywhere in the editor: refusing here would swallow the composition.
		if (composing) return;
		event.preventDefault();
		if (event.inputType === 'insertText' && event.data) mint(event.data);
	}

	function onCompositionEnd(): void {
		composing = false;
		const composed = proxyEl?.textContent ?? '';
		// This element only holds a caret; nothing serializes it. Whatever the IME left belongs
		// to the new paragraph, and the element goes back to empty either way.
		if (proxyEl) proxyEl.textContent = '';
		if (composed) mint(composed);
	}

	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		// A null relatedTarget is the window losing focus, which a native caret survives too.
		// Anything focused inside the editor took the caret by its own route.
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
	 * Absolutely positioned, so the zero-height wrapper keeps the boundary's layout, and given
	 * a real box: Chromium fires no `beforeinput` on a zero-height editing host, which would
	 * silently cost this element every keystroke. Click-through, or the strip would steal edge
	 * clicks from both neighbours; the painted line is the caret, so this one never shows.
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
