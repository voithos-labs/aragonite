<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		STICKY_COLUMN_KEY,
		type BlockEditActions,
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
	import {
		isAtFirstVisualLine,
		isAtLastVisualLine
	} from '../../text-surface/visual-lines';
	import {
		getCurrentCursorEditorRelativeX,
		findOffsetNearestX
	} from '../../text-surface/sticky-measure';
	import { renderCodeBlock } from '../../code-surface/code-renderer';
	import { trimTrailingLineEnding } from '../../raw-text';

	let { node, index }: { node: CstNode; index: number } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
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

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null) return;

		el.replaceChildren(renderCodeBlock(node));
		lastRenderedRaw = node.raw;

		if (pendingCursorOffset !== null) {
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
		} else if (e.inputType === 'historyRedo') {
			e.preventDefault();
			history.requestRedo();
		} else if (e.inputType === 'insertLineBreak') {
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
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (composing) return;

		preEditOffset = getCursorOffsetHelper(el!) ?? 0;

		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			const x = getCurrentCursorEditorRelativeX(el!);
			if (x !== null) stickyColumn.capture(x);
		} else if (!PRESERVE_KEYS_NON_ARROW.includes(e.key)) {
			stickyColumn.reset();
		}

		if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')) {
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
		}

		// Enter without Shift: if the last line is already empty, exit the code block.
		if (e.key === 'Enter' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const text = getDisplayText();
			if (offset === text.length && text.endsWith('\n')) {
				e.preventDefault();
				blockEdit.updateBlockContent(index, text.slice(0, -1) + '\n', preEditOffset);
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}

		if (e.key === 'ArrowUp' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (isAtFirstVisualLine(el!, offset)) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, { stickyColumnFrom: 'below' });
				return;
			}
		}

		if (e.key === 'ArrowDown' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const textLen = (el?.textContent ?? '').length;
			if (isAtLastVisualLine(el!, offset, textLen)) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, { stickyColumnFrom: 'above' });
				return;
			}
		}

		if (e.key === 'ArrowLeft' && !e.shiftKey && el) {
			const offset = getCursorOffsetHelper(el);
			if (offset === 0) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		if (e.key === 'ArrowRight' && !e.shiftKey && el) {
			const textLen = (el.textContent ?? '').length;
			const offset = getCursorOffsetHelper(el);
			if (offset === textLen) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}
	}

	function onPointerDown(_e: PointerEvent): void {
		stickyColumn.reset();
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
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		const display = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el!);
		const cursorOffset = getCursorOffsetHelper(el!) ?? 0;
		const start = selOffsets?.start ?? cursorOffset;
		const end = selOffsets?.end ?? cursorOffset;

		const newDisplay = display.slice(0, start) + text + display.slice(end);
		const newCursor = start + text.length;
		blockEdit.updateBlockContent(index, newDisplay + '\n', newCursor);
		pendingCursorOffset = newCursor;
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
