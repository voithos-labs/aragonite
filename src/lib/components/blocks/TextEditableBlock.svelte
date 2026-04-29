<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		CONTROLLER_KEY,
		PASTE_COORDINATOR_KEY,
		LIST_CONTEXT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		EDITOR_LIFETIME_KEY,
		RESOLVE_IMAGE_URL_KEY,
		WIDGET_SELECTION_KEY,
		type BlockEditActions,
		type BlockElLookup,
		type ContainerEditActions,
		type DocumentGetter,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent,
		type StickyColumnDirection,
		type AmbientPrefix,
		type ResolveImageUrl,
		type WidgetSelectionState
	} from '../../contracts';
	import type { UndoController } from '../../editor-actions/deps';
	import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import { parseInline, getContentRange, isProseKind } from '../../core/inline';
	import { trimTrailingLineEnding } from '../../core/lines';
	import {
		createRangeFromOffsets,
		getSelectionFocusOffset as getSelectionFocusOffsetHelper,
		hasSelection as hasSelectionHelper
	} from '../../cursor/cursor-utils';
	import { findOffsetNearestX } from '../../cursor/sticky-measure';
	import { toggleInlineFormat } from './text/format-toggle';
	import { cycleHeading, insertHardBreak, insertLiteralTab } from './text/text-keydown';
	import { createTextClipboard } from './text/text-clipboard';
	import { createTextRender } from './text/text-render';
	import { measurePartialRectsInContentEditable } from '../../cursor/overlay-rects';
	import {
		handleSharedKeydown,
		handleSharedBeforeInput,
		type SharedKeydownContext
	} from '../../selection/shared-keydown';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../selection/cross-block-dispatch';
	import { domToRawOffset, rawToDomOffset } from '../../ambient/ambient-offset';
	import { ambientSpanOf } from '../../ambient/ambient-dom';
	import { createAmbientCursorIO } from '../../ambient/ambient-cursor';

	let {
		node,
		index,
		myPath = [],
		blockClass = 'paragraph-block',
		ambientPrefix = ''
	}: {
		node: CstNode;
		index: number;
		myPath?: number[];
		blockClass?: string;
		ambientPrefix?: AmbientPrefix;
	} = $props();

	// Plain-string view of the prefix for length/equality/display use;
	// `buildAmbientSpan` consumes the union directly for DOM construction.
	const ambientPrefixText = $derived(
		typeof ambientPrefix === 'string' ? ambientPrefix : ambientPrefix.text
	);

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const pasteCoordinator = getContext<PasteCommitCoordinator>(PASTE_COORDINATOR_KEY);
	// Present when this paragraph sits inside a list item — used to skip
	// Tab handling in prose (the enclosing ListItemBlock owns Tab-as-indent).
	const listContext = getContext(LIST_CONTEXT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const editorLifetime = getContext<AbortSignal | undefined>(EDITOR_LIFETIME_KEY);
	const resolveImageUrl = getContext<ResolveImageUrl>(RESOLVE_IMAGE_URL_KEY);
	const widgetSelection = getContext<WidgetSelectionState>(WIDGET_SELECTION_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	// Cursor position captured before each edit (keydown fires before DOM changes)
	let preEditOffset = 0;

	const ambientLength = $derived(ambientPrefixText.length);

	const cursor = createAmbientCursorIO({
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength
	});

	const crossBlock = createCrossBlockHandlers({
		getEl: () => el ?? null,
		getMyPath: () => myPath,
		getIndex: () => index,
		selection,
		getDoc,
		getBlockElByPath,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		pasteCoordinator,
		getCursorOffset: () => cursor.getRaw(),
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		},
		afterRawMutated: (targetNode) => {
			if (isProseKind(targetNode.kind)) {
				const range = getContentRange(targetNode);
				targetNode.inlineContent = parseInline(targetNode.raw, range.start, range.end);
			}
		}
	});

	const clipboardHandlers = createTextClipboard({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get myPath() {
			return myPath;
		},
		cursor,
		crossBlock,
		selection,
		stickyColumn,
		blockEdit,
		pasteCoordinator,
		getDoc,
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => cursor.getRaw(),
		getFocusOffset: () => {
			if (!el) return null;
			const dom = getSelectionFocusOffsetHelper(el);
			return dom === null ? null : domToRawOffset(dom, ambientLength);
		},
		getTextLen: () => getDisplayText().length,
		getMyPath: () => myPath,
		getIndex: () => index,
		crossBlock,
		selection,
		stickyColumn,
		history,
		focus: focusActions,
		getDoc,
		getBlockElByPath
	};

	const textRender = createTextRender({
		get el() {
			return el ?? null;
		},
		get node() {
			return node;
		},
		get ambientPrefix() {
			return ambientPrefix;
		},
		get ambientPrefixText() {
			return ambientPrefixText;
		},
		getDisplayText: () => getDisplayText(),
		resolveImageUrl,
		get myPath() {
			return myPath;
		}
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		cursor.setRaw(offset);
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!el) return;
		el.focus();
		// minOffset = ambientLength keeps the scan out of the marker region.
		const domOffset = findOffsetNearestX(el, x, from, ambientLength);
		cursor.setRaw(domToRawOffset(domOffset, ambientLength));
	}

	export function getCursorOffset(): number | null {
		return cursor.getRaw();
	}

	export function getSelectedText(): string {
		if (!el) return '';
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return '';
		return sel.toString();
	}

	export function setSelection(start: number, end: number): void {
		if (!el) return;
		const range = createRangeFromOffsets(
			el,
			rawToDomOffset(start, ambientLength),
			rawToDomOffset(end, ambientLength)
		);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		const domStart = rawToDomOffset(startOffset, ambientLength);
		const domEnd = rawToDomOffset(endOffset, ambientLength);
		return measurePartialRectsInContentEditable(el, domStart, domEnd);
	}

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	// ── Content sync ──────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (import.meta.env.DEV && ambientPrefixText && !isProseKind(node.kind)) {
			console.warn(
				`[TextEditableBlock] ambientPrefix is prose-only; non-prose kind ${node.kind} received a non-empty ambient prefix. The ambient marker will not render correctly.`
			);
		}

		textRender.render({ forceRebuild: pendingCursorOffset !== null });

		if (pendingCursorOffset !== null) {
			cursor.setRaw(pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (composing || !el) return;
		const text = readRawText();
		const savedRawOffset = cursor.getRaw() ?? 0;
		// preEdit drives the undo snapshot anchor; postEdit drives focus when typing
		// (e.g. `# `) triggers a kind change and the block remounts.
		blockEdit.updateBlockContent(index, text + '\n', preEditOffset, savedRawOffset);
		pendingCursorOffset = savedRawOffset;
	}

	/**
	 * Read raw text by walking children and skipping the ambient span.
	 * Robust against Chromium inserting stray text nodes before or after
	 * the marker span (happens after Home/click or when typing into an
	 * empty-paragraph <br> fallback).
	 */
	function readRawText(): string {
		if (!el) return '';
		if (ambientLength === 0) return el.textContent ?? '';
		const ambient = ambientSpanOf(el);
		let out = '';
		for (const child of Array.from(el.childNodes)) {
			if (child === ambient) continue;
			out += child.textContent ?? '';
		}
		return out;
	}

	function onCompositionStart(): void {
		// Capture before crossBlock.handleCompositionStart() — sync delete moves the caret.
		preEditOffset = cursor.getRaw() ?? 0;
		crossBlock.handleCompositionStart();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;

		// Save cursor position before the browser modifies the DOM
		preEditOffset = cursor.getRaw() ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		// Intercept widget-relevant keys before the contenteditable consumes them as text input.
		const selectedWidget = widgetSelection.getSelected();
		if (selectedWidget !== null) {
			const widget = findImageNodeByStart(selectedWidget.sourceStart);
			const widgetIsHere =
				widget !== null && widgetSelection.isSelected(myPath, selectedWidget.sourceStart);
			if (widgetIsHere) {
				if (e.key === 'ArrowLeft') {
					e.preventDefault();
					cursor.setRaw(selectedWidget.sourceStart);
					widgetSelection.clear();
					return;
				}
				if (e.key === 'ArrowRight') {
					e.preventDefault();
					cursor.setRaw(widget.end);
					widgetSelection.clear();
					return;
				}
				if (e.key === 'Backspace' || e.key === 'Delete') {
					e.preventDefault();
					const newRaw = node.raw.slice(0, widget.start) + node.raw.slice(widget.end);
					blockEdit.updateBlockContent(index, newRaw, widget.end, widget.start);
					widgetSelection.clear();
					return;
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					cursor.setRaw(widget.end);
					widgetSelection.clear();
					return;
				}
				if (isTypingKey(e)) {
					e.preventDefault();
					const typed = e.key;
					const newRaw =
						node.raw.slice(0, widget.start) + typed + node.raw.slice(widget.end);
					blockEdit.updateBlockContent(
						index,
						newRaw,
						widget.end,
						widget.start + typed.length
					);
					widgetSelection.clear();
					return;
				}
				return;
			}
		}

		const cursorOff = cursor.getRaw();
		if (cursorOff !== null) {
			const widgetAt = imageAtCursor();
			if (widgetAt) {
				if (widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace')) {
					e.preventDefault();
					widgetSelection.select({ paragraphPath: myPath, sourceStart: widgetAt.start });
					return;
				}
				if (!widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete')) {
					e.preventDefault();
					widgetSelection.select({ paragraphPath: myPath, sourceStart: widgetAt.start });
					return;
				}
			}
		}

		// Home with an ambient marker: native Home lands at DOM 0 (before the
		// marker span). Skip that — the user wants raw offset 0, i.e. the
		// position immediately after the ambient span.
		if (e.key === 'Home' && !e.shiftKey && ambientLength > 0 && el) {
			e.preventDefault();
			cursor.setToAmbientBoundary();
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
			e.preventDefault();
			toggleFormat('strong');
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
			e.preventDefault();
			toggleFormat('emphasis');
			return;
		}

		// Ctrl+0..6: replace any existing `#` prefix so repeated shortcuts cycle heading levels.
		if ((e.ctrlKey || e.metaKey) && /^[0-6]$/.test(e.key) && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			const { newRaw, caretOffset } = cycleHeading(node.raw, parseInt(e.key, 10), preEditOffset);
			blockEdit.updateBlockContent(index, newRaw, preEditOffset, caretOffset);
			pendingCursorOffset = caretOffset;
			return;
		}

		// Shift+Enter — GFM hard line break (trailing backslash before the newline).
		if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			const { newRaw, caretOffset } = insertHardBreak(node.raw, cursor.getRaw() ?? 0);
			blockEdit.updateBlockContent(index, newRaw, preEditOffset);
			pendingCursorOffset = caretOffset;
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const offset = cursor.getRaw() ?? 0;
			blockEdit.splitBlock(index, offset);
			return;
		}

		// Insert a literal tab; the browser default would move focus out of the editor.
		// Skipped inside a list item — ListItemBlock owns Tab there.
		if (e.key === 'Tab' && !e.shiftKey && !listContext) {
			e.preventDefault();
			const { newRaw, caretOffset } = insertLiteralTab(node.raw, cursor.getRaw() ?? 0);
			blockEdit.updateBlockContent(index, newRaw, preEditOffset);
			pendingCursorOffset = caretOffset;
			return;
		}

		// Selections whose DOM range extends into the contenteditable="false"
		// ambient span block native Backspace/Delete silently — the browser
		// refuses to modify any range overlapping non-editable content, and
		// no beforeinput fires. Perform the delete via the CST path instead.
		if (
			(e.key === 'Backspace' || e.key === 'Delete') &&
			hasSelectionHelper() &&
			el &&
			ambientLength > 0
		) {
			const ambient = ambientSpanOf(el);
			const sel = window.getSelection();
			const touchesAmbient =
				!!ambient &&
				!!sel &&
				sel.rangeCount > 0 &&
				(ambient.contains(sel.anchorNode) || ambient.contains(sel.focusNode));
			if (touchesAmbient) {
				e.preventDefault();
				const range = cursor.getRawSelection();
				if (range && range.start < range.end) {
					const display = getDisplayText();
					const newDisplay = display.slice(0, range.start) + display.slice(range.end);
					blockEdit.updateBlockContent(index, newDisplay + '\n', range.start, range.start);
					pendingCursorOffset = range.start;
				}
				return;
			}
		}

		if (e.key === 'Backspace') {
			const offset = cursor.getRaw();
			if (offset === 0 && !hasSelectionHelper()) {
				e.preventDefault();
				blockEdit.mergeWithPrevious(index);
				return;
			}
		}

		if (e.key === 'Delete') {
			const offset = cursor.getRaw();
			const rawLen = getDisplayText().length;
			if (offset === rawLen && !hasSelectionHelper()) {
				e.preventDefault();
				blockEdit.mergeWithNext(index);
				return;
			}
		}
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		// Soft-keyboard/IME insertLineBreak slipped past onKeyDown — swallow; Shift+Enter there owns hard breaks.
		if (e.inputType === 'insertLineBreak') {
			e.preventDefault();
			return;
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	function onClick(): void {
		cursor.clampOutOfAmbient();
	}

	// ── Widget adjacency ───────────────────────────────────────────────

	function imageAtCursor(): { start: number; end: number; atRight: boolean } | null {
		const off = cursor.getRaw();
		if (off === null) return null;
		const inlines = node.inlineContent ?? [];
		for (const inline of inlines) {
			if (inline.kind !== 'image') continue;
			if (off === inline.start) return { start: inline.start, end: inline.end, atRight: false };
			if (off === inline.end) return { start: inline.start, end: inline.end, atRight: true };
		}
		return null;
	}

	function findImageNodeByStart(sourceStart: number): { start: number; end: number } | null {
		for (const inline of node.inlineContent ?? []) {
			if (inline.kind === 'image' && inline.start === sourceStart) {
				return { start: inline.start, end: inline.end };
			}
		}
		return null;
	}

	function isTypingKey(e: KeyboardEvent): boolean {
		if (e.ctrlKey || e.metaKey || e.altKey) return false;
		return e.key.length === 1;
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	function toggleFormat(format: 'strong' | 'emphasis'): void {
		if (!el) return;
		const offsets = cursor.getRawSelection();
		if (!offsets) return;

		const { newDisplay, newSelStart, newSelEnd } = toggleInlineFormat(
			getDisplayText(),
			offsets,
			format
		);

		blockEdit.updateBlockContent(index, newDisplay + '\n', newSelStart);

		tick().then(() => {
			setSelection(newSelStart, newSelEnd);
		});
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="text-editable-block {blockClass}"
	contenteditable="true"
	role="textbox"
	style:text-indent={ambientPrefixText ? `-${ambientLength}ch` : null}
	style:padding-left={ambientPrefixText ? `${ambientLength}ch` : null}
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	oncopy={clipboardHandlers.onCopy}
	oncut={clipboardHandlers.onCut}
	onpaste={clipboardHandlers.onPaste}
	onpointerdown={onPointerDown}
	onclick={onClick}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>

<style>
	.text-editable-block {
		outline: none;
		padding: 2px 0;
		white-space: pre-wrap;
		word-wrap: break-word;
		min-height: 1.4em;
		width: 100%;
	}

	.text-editable-block.paragraph-block:empty::before {
		content: 'Start typing...';
		color: var(--color-ui-dulled, #666);
		pointer-events: none;
	}

	.text-editable-block.heading-1 {
		font-size: 2em;
		font-weight: bold;
		line-height: 1.2;
	}
	.text-editable-block.heading-2 {
		font-size: 1.5em;
		font-weight: bold;
		line-height: 1.3;
	}
	.text-editable-block.heading-3 {
		font-size: 1.25em;
		font-weight: bold;
	}
	.text-editable-block.heading-4 {
		font-size: 1.1em;
		font-weight: bold;
	}
	.text-editable-block.heading-5 {
		font-size: 1em;
		font-weight: bold;
	}
	.text-editable-block.heading-6 {
		font-size: 0.9em;
		font-weight: bold;
	}

	.text-editable-block.raw-block {
		font-family: 'Fira Code', 'Consolas', monospace;
		font-size: 0.9em;
		opacity: 0.85;
	}

	.text-editable-block :global(.md-marker) {
		opacity: 0.4;
		font-weight: normal;
		font-style: normal;
	}

	.text-editable-block :global(.inline-code-content) {
		font-family: 'Fira Code', 'Consolas', monospace;
		font-size: 0.9em;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border-radius: 3px;
		padding: 1px 4px;
	}

	.text-editable-block :global(.md-autolink) {
		color: var(--color-accent, #4a9eff);
		text-decoration: underline;
	}
</style>
