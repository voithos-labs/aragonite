<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		type BlockEditActions,
		type BlockElLookup,
		type DocumentGetter,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../editor-types';
	import { PRESERVE_KEYS_NON_ARROW, type StickyColumnState } from '../../sticky-column';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../text-surface/cursor-utils';
	import { isAtFirstVisualLine, isAtLastVisualLine } from '../../text-surface/visual-lines';
	import {
		getCurrentCursorEditorRelativeX,
		findOffsetNearestX
	} from '../../text-surface/sticky-measure';
	import { measurePartialRectsInContentEditable } from '../../text-surface/selection-measure';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import {
		collapseCrossBlock,
		extendFocusToNextBlock,
		extendFocusToPreviousBlock,
		extendFocusToDocEdge,
		selectWholeDocument,
		handleShiftClick,
		scrollFocusBlockIntoView
	} from '../../selection/keydown-dispatch';
	import { findBlockPathForElement } from '../../selection/path-lookup';
	import { clearNativeSelection, offsetFromViewportPoint } from '../../selection/native-bridge';
	import { installDragListener } from '../../selection/drag-pointer';
	import { renderCodeBlock } from '../../code-surface/code-renderer';
	import {
		getLineLeadingWhitespace,
		getCloserFor,
		shouldAutoClose,
		shouldSkipClose,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from '../../code-surface/code-editing';
	import { indentLines, dedentLines, type IndentResult } from '../../code-surface/code-indent';
	import { computeCodePaste } from '../../code-surface/code-paste';
	import type { FencedCodeMetadata } from '../../core/nodes';
	import { trimTrailingLineEnding } from '../../raw-text';

	const ELECTRIC_INDENT_UNIT = '\t';

	let {
		node,
		index,
		myPath = []
	}: { node: CstNode; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		setCursorOffsetHelper(el, Math.max(0, offset));
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!el) return;
		el.focus();
		const targetOffset = findOffsetNearestX(el, x, from);
		setCursorOffsetHelper(el, targetOffset);
	}

	export function getCursorOffset(): number | null {
		if (!el) return null;
		return getCursorOffsetHelper(el);
	}

	export function getSelectedText(): string {
		return window.getSelection()?.toString() ?? '';
	}

	export function setSelection(start: number, end: number): void {
		if (!el) return;
		const range = createRangeFromOffsets(el, start, end);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		return measurePartialRectsInContentEditable(el, startOffset, endOffset);
	}

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node));
		lastRenderedRaw = node.raw;

		if (pendingSelection !== null) {
			const range = createRangeFromOffsets(el, pendingSelection.start, pendingSelection.end);
			if (range) {
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			setCursorOffsetHelper(el, pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	// ── Event handlers ────────────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (composing || !el) return;
		const text = el.textContent ?? '';
		const savedOffset = getCursorOffsetHelper(el) ?? 0;
		blockEdit.updateBlockContent(index, text + '\n', preEditOffset);
		pendingCursorOffset = savedOffset;
	}

	function onCompositionStart(): void {
		stickyColumn.reset();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	function onBeforeInput(e: InputEvent): void {
		if (e.inputType === 'historyUndo') {
			e.preventDefault();
			history.requestUndo();
			return;
		}
		if (e.inputType === 'historyRedo') {
			e.preventDefault();
			history.requestRedo();
			return;
		}
		if (e.inputType === 'insertLineBreak') {
			// Shift+Enter: insert a literal \n text node rather than letting the
			// browser produce a <br> or <div>. A text node keeps el.textContent
			// well-formed so onInput → updateBlockContent sees a flat string.
			e.preventDefault();
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || !el) return;
			const range = sel.getRangeAt(0);
			range.deleteContents();
			const newline = document.createTextNode('\n');
			range.insertNode(newline);
			range.setStartAfter(newline);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
			onInput();
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el);
		const offset = getCursorOffsetHelper(el) ?? 0;

		const closer = getCloserFor(data);

		// Wrap a non-empty selection in a typed opener's pair. The selection
		// is preserved inside the pair so the user can keep typing to replace
		// the wrapped content.
		if (selOffsets && closer !== null) {
			e.preventDefault();
			const wrapped =
				text.slice(0, selOffsets.start) +
				data +
				text.slice(selOffsets.start, selOffsets.end) +
				closer +
				text.slice(selOffsets.end);
			blockEdit.updateBlockContent(index, wrapped + '\n', preEditOffset);
			pendingSelection = { start: selOffsets.start + 1, end: selOffsets.end + 1 };
			return;
		}

		if (selOffsets) return; // Non-opener input with a selection — let the browser handle it.

		// Skip-over: typed closer already sits at the cursor. Move past it
		// without inserting a duplicate — the CST does not change, so we
		// bypass the render cycle and just advance the caret.
		if (shouldSkipClose(text, offset, data)) {
			e.preventDefault();
			setCursorOffsetHelper(el, offset + 1);
			return;
		}

		// Auto-pair: typed opener with a collapsed cursor inserts the closer too.
		if (closer !== null && shouldAutoClose(text, offset, data)) {
			e.preventDefault();
			const newText = text.slice(0, offset) + data + closer + text.slice(offset);
			blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
			pendingCursorOffset = offset + 1;
			return;
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (composing) return;

		preEditOffset = getCursorOffsetHelper(el!) ?? 0;

		// Reset Ctrl+A doubling counter on any non-Ctrl+A keystroke. Bare
		// modifier keys (Control, Shift, Alt, Meta) don't reset — pressing
		// Control before 'a' is part of the Ctrl+A chord, not a separate action.
		const isCtrlA = (e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey;
		const isBareModifier = e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta';
		if (!isCtrlA && !isBareModifier) {
			selection.resetSelectAllCount();
		}

		// Cross-block dispatch: extend/collapse/select-all while cross-block.
		if (selection.isCrossBlock) {
			if (handleCrossBlockKeydown(e)) return;
		}

		// Single-block entry points: Ctrl+Shift+Home/End, double Ctrl+A.
		if (handleCrossBlockEntryKeydown(e)) return;

		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			const x = getCurrentCursorEditorRelativeX(el!);
			if (x !== null) stickyColumn.capture(x);
		} else if (!PRESERVE_KEYS_NON_ARROW.includes(e.key)) {
			stickyColumn.reset();
		}

		if (
			(e.ctrlKey || e.metaKey) &&
			(e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')
		) {
			e.preventDefault();
			return;
		}

		// Ctrl+Z / Ctrl+Y — catch here because Ctrl+Y doesn't fire beforeinput
		// historyRedo in Chromium/WebView2.
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			history.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			history.requestRedo();
			return;
		}

		if (e.key === 'Backspace') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (offset === 0 && !hasSelectionHelper()) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}

			// Pair-delete: cursor sitting between a matching empty pair removes
			// both halves so the auto-closed companion does not get stranded.
			if (!hasSelectionHelper()) {
				const text = getDisplayText();
				if (isBetweenEmptyPair(text, offset)) {
					e.preventDefault();
					const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
					blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
					pendingCursorOffset = offset - 1;
					return;
				}
			}
		}

		// Plain Enter: always handle manually. The browser's default `insertParagraph`
		// adds <div>/<br> elements that contribute zero characters to textContent,
		// which leaves the CST unchanged and the $effect wipes the browser's insertion
		// on re-render — making Enter appear to do nothing.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const text = getDisplayText();
			const meta = node.metadata as FencedCodeMetadata;

			if (meta.closed) {
				const fenceChars = meta.fenceMarker.repeat(meta.fenceLength);

				// Cursor past the closer (e.g. from Ctrl+End) → exit immediately.
				if (offset === text.length) {
					focusActions.moveFocus(index + 1, 'start');
					return;
				}

				// Cursor on an empty body line immediately before the closer → exit,
				// stripping the empty line so the block doesn't gain a trailing blank.
				const onEmptyLineBeforeCloser =
					offset >= 1 &&
					text[offset - 1] === '\n' &&
					text[offset] === '\n' &&
					text.slice(offset + 1, offset + 1 + fenceChars.length) === fenceChars;
				if (onEmptyLineBeforeCloser) {
					const newText = text.slice(0, offset) + text.slice(offset + 1);
					blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
					focusActions.moveFocus(index + 1, 'start');
					return;
				}
			} else {
				// Unclosed fence: exit when cursor is at the end of content AND the
				// content already ends with a blank line (the earlier Enter added it).
				if (offset === text.length && text.endsWith('\n')) {
					blockEdit.updateBlockContent(index, text.slice(0, -1) + '\n', preEditOffset);
					focusActions.moveFocus(index + 1, 'start');
					return;
				}
			}

			// Default: insert a newline at the cursor, copying the current line's
			// leading whitespace. When the cursor sits between an empty bracket
			// pair, expand into three lines with one extra indent level on the
			// middle line — the "electric indent" pattern every modern code
			// editor ships. Quote pairs stay inline.
			const indent = getLineLeadingWhitespace(text, offset);

			if (isBetweenEmptyBracketPair(text, offset)) {
				const inner = indent + ELECTRIC_INDENT_UNIT;
				const newText = text.slice(0, offset) + '\n' + inner + '\n' + indent + text.slice(offset);
				blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
				pendingCursorOffset = offset + 1 + inner.length;
				return;
			}

			const newText = text.slice(0, offset) + '\n' + indent + text.slice(offset);
			blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
			pendingCursorOffset = offset + 1 + indent.length;
			return;
		}

		if (e.key === 'ArrowUp') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (isAtFirstVisualLine(el!, offset)) {
				if (e.shiftKey && offset === 0) {
					e.preventDefault();
					extendFocusToPreviousBlock(selection, getDoc(), el!, myPath);
					scrollFocusBlockIntoView(selection, getBlockElByPath);
					return;
				}
				if (!e.shiftKey) {
					e.preventDefault();
					focusActions.moveFocus(index - 1, { stickyColumnFrom: 'below' });
					return;
				}
			}
		}

		if (e.key === 'ArrowDown') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const textLen = (el?.textContent ?? '').length;
			if (isAtLastVisualLine(el!, offset, textLen)) {
				if (e.shiftKey && offset === textLen) {
					e.preventDefault();
					extendFocusToNextBlock(selection, getDoc(), el!, myPath);
					scrollFocusBlockIntoView(selection, getBlockElByPath);
					return;
				}
				if (!e.shiftKey) {
					e.preventDefault();
					focusActions.moveFocus(index + 1, { stickyColumnFrom: 'above' });
					return;
				}
			}
		}

		if (e.key === 'ArrowLeft' && el) {
			const offset = getCursorOffsetHelper(el);
			if (offset === 0) {
				if (e.shiftKey) {
					e.preventDefault();
					extendFocusToPreviousBlock(selection, getDoc(), el, myPath);
					scrollFocusBlockIntoView(selection, getBlockElByPath);
					return;
				}
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		if (e.key === 'ArrowRight' && el) {
			const textLen = (el.textContent ?? '').length;
			const offset = getCursorOffsetHelper(el);
			if (offset === textLen) {
				if (e.shiftKey) {
					e.preventDefault();
					extendFocusToNextBlock(selection, getDoc(), el, myPath);
					scrollFocusBlockIntoView(selection, getBlockElByPath);
					return;
				}
				e.preventDefault();
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}

		if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				dedentSelection();
			} else {
				indentSelection();
			}
			return;
		}
	}

	// ── Cross-block dispatch helpers ────────────────────────────────────

	/**
	 * Handle a keystroke while cross-block mode is active. Mirrors the
	 * TextEditableBlock implementation — the handlers live in block
	 * components (not Editor.svelte) so each block's existing arrow-key
	 * geometry stays colocated with the shift-aware branch.
	 */
	function handleCrossBlockKeydown(e: KeyboardEvent): boolean {
		if (!el) return false;
		const doc = getDoc();

		if (e.ctrlKey && e.shiftKey && e.key === 'End') {
			e.preventDefault();
			extendFocusToDocEdge(selection, doc, el, myPath, 'end');
			scrollFocusBlockIntoView(selection, getBlockElByPath);
			return true;
		}
		if (e.ctrlKey && e.shiftKey && e.key === 'Home') {
			e.preventDefault();
			extendFocusToDocEdge(selection, doc, el, myPath, 'start');
			scrollFocusBlockIntoView(selection, getBlockElByPath);
			return true;
		}

		if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
			e.preventDefault();
			const focusPath = selection.focus?.path ?? myPath;
			extendFocusToNextBlock(selection, doc, el, focusPath);
			scrollFocusBlockIntoView(selection, getBlockElByPath);
			return true;
		}
		if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
			e.preventDefault();
			const focusPath = selection.focus?.path ?? myPath;
			extendFocusToPreviousBlock(selection, doc, el, focusPath);
			scrollFocusBlockIntoView(selection, getBlockElByPath);
			return true;
		}

		if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
			e.preventDefault();
			collapseCrossBlock(selection, 'start', getBlockElByPath);
			return true;
		}
		if (!e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
			e.preventDefault();
			collapseCrossBlock(selection, 'end', getBlockElByPath);
			return true;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
			e.preventDefault();
			selectWholeDocument(selection, doc);
			return true;
		}

		return false;
	}

	/**
	 * Handle single-block-to-cross-block entry points that don't need a
	 * boundary geometry check: Ctrl+Shift+Home/End and the first or second
	 * press of Ctrl+A. Shift+Arrow at the block boundary is handled inline
	 * in the existing arrow-key branches below.
	 */
	function handleCrossBlockEntryKeydown(e: KeyboardEvent): boolean {
		if (!el) return false;

		if (e.ctrlKey && e.shiftKey && e.key === 'End') {
			e.preventDefault();
			extendFocusToDocEdge(selection, getDoc(), el, myPath, 'end');
			scrollFocusBlockIntoView(selection, getBlockElByPath);
			return true;
		}
		if (e.ctrlKey && e.shiftKey && e.key === 'Home') {
			e.preventDefault();
			extendFocusToDocEdge(selection, getDoc(), el, myPath, 'start');
			scrollFocusBlockIntoView(selection, getBlockElByPath);
			return true;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
			e.preventDefault();
			selection.incrementSelectAllCount();
			if (selection.selectAllCount === 1) {
				const range = document.createRange();
				range.selectNodeContents(el);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
				return true;
			}
			selectWholeDocument(selection, getDoc());
			return true;
		}

		return false;
	}

	/** Collapse the contenteditable's current selection to a `{start,end}` range. */
	function currentRange(): { start: number; end: number } {
		const sel = getSelectionOffsetsHelper(el!);
		if (sel) return sel;
		const cursor = getCursorOffsetHelper(el!) ?? 0;
		return { start: cursor, end: cursor };
	}

	/** Flush an IndentResult through the CST + cursor-restore pipeline. */
	function applyIndentResult(result: IndentResult): void {
		blockEdit.updateBlockContent(index, result.text + '\n', result.selection.start);
		if (result.selection.start === result.selection.end) {
			pendingCursorOffset = result.selection.start;
		} else {
			pendingSelection = result.selection;
		}
	}

	function indentSelection(): void {
		if (!el) return;
		applyIndentResult(indentLines(el.textContent ?? '', currentRange()));
	}

	function dedentSelection(): void {
		if (!el) return;
		const text = el.textContent ?? '';
		const result = dedentLines(text, currentRange());
		if (result.text === text) return; // no-op: nothing to dedent
		applyIndentResult(result);
	}

	function onPointerDown(e: PointerEvent): void {
		stickyColumn.reset();
		selection.resetSelectAllCount();

		if (e.shiftKey && el) {
			const prevActive = document.activeElement;
			const prevFocusEl =
				prevActive instanceof HTMLElement && prevActive !== el
					? (prevActive.closest('[contenteditable]') as HTMLElement | null)
					: null;
			const prevFocusPath = findBlockPathForElement(prevActive);
			const handled = handleShiftClick(
				selection,
				el,
				myPath,
				e.clientX,
				e.clientY,
				prevFocusEl,
				prevFocusPath
			);
			if (handled) {
				e.preventDefault();
				return;
			}
		}

		if (selection.isCrossBlock && !e.shiftKey) {
			selection.clear();
			clearNativeSelection();
		}

		// Install drag listener for potential cross-block drag selection.
		if (!e.shiftKey && el) {
			const root = getEditorRoot();
			if (!root) return;
			const offset = offsetFromViewportPoint(el, e.clientX, e.clientY);
			if (offset === null) return;
			installDragListener(
				{ editorRoot: root, scrollContainer: root, selection, getBlockElByPath },
				{ path: myPath.slice(), offset }
			);
		}
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
	}

	function onCut(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		const selected = window.getSelection()?.toString() ?? '';
		e.clipboardData?.setData('text/plain', selected);

		const selOffsets = getSelectionOffsetsHelper(el!);
		if (selOffsets) {
			const display = getDisplayText();
			const newDisplay = display.slice(0, selOffsets.start) + display.slice(selOffsets.end);
			blockEdit.updateBlockContent(index, newDisplay + '\n', selOffsets.start);
			pendingCursorOffset = selOffsets.start;
		}
	}

	function onPaste(e: ClipboardEvent): void {
		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const pasted = e.clipboardData?.getData('text/plain') ?? '';
		if (!pasted) return;

		const meta = node.metadata as FencedCodeMetadata;
		const result = computeCodePaste({
			display: el.textContent ?? '',
			selection: currentRange(),
			pasted,
			fenceMarker: meta.fenceMarker,
			fenceLength: meta.fenceLength,
			closed: meta.closed
		});

		blockEdit.updateBlockContent(index, result.text + '\n', result.cursor);
		pendingCursorOffset = result.cursor;
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="code-block"
	contenteditable="true"
	role="textbox"
	spellcheck="false"
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>

<style>
	.code-block {
		width: 100%;
		outline: none;
		padding: 12px;
		font-family: 'Fira Code', 'Consolas', monospace;
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-ui-muted, rgba(128, 128, 128, 0.25));
		border-radius: 4px;
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		tab-size: 4;
		box-sizing: border-box;
		min-height: 1.4em;
	}

	.code-block:focus {
		border-color: var(--color-accent, #4a9eff);
	}

	.code-block :global(.md-marker) {
		opacity: 0.4;
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #4a9eff);
		opacity: 0.7;
	}
</style>
