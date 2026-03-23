<script lang="ts">
	import { getContext } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type CstNode,
		type BlockComponent
	} from '../editor-types';

	let {
		node,
		index,
		blockClass = 'paragraph-block',
		splitOnEnter = true
	}: { node: CstNode; index: number; blockClass?: string; splitOnEnter?: boolean } = $props();

	const actions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	// Suppress reactive DOM updates while the user is typing
	let userIsTyping = false;
	// Cursor position captured before each edit (keydown fires before DOM changes)
	let preEditOffset = 0;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		setCursorOffset(offset);
	}

	export function getCursorOffset(): number | null {
		if (!el || document.activeElement !== el) return null;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		const preRange = document.createRange();
		preRange.selectNodeContents(el);
		preRange.setEnd(range.startContainer, range.startOffset);
		return preRange.toString().length;
	}

	export function getSelectedText(): string {
		if (!el) return '';
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return '';
		return sel.toString();
	}

	export function setSelection(start: number, end: number): void {
		if (!el) return;
		const range = createRangeFromOffsets(el, start, end);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	// ── Cursor utilities ────────────────────────────────────────────────

	function setCursorOffset(offset: number): void {
		if (!el) return;
		const range = createRangeFromOffsets(el, offset, offset);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function createRangeFromOffsets(
		container: HTMLElement,
		start: number,
		end: number
	): Range | null {
		const range = document.createRange();
		let charCount = 0;
		let startSet = false;

		function walk(node: Node): boolean {
			if (node.nodeType === Node.TEXT_NODE) {
				const len = node.textContent?.length ?? 0;
				if (!startSet && charCount + len >= start) {
					range.setStart(node, start - charCount);
					startSet = true;
				}
				if (startSet && charCount + len >= end) {
					range.setEnd(node, end - charCount);
					return true;
				}
				charCount += len;
			} else {
				for (const child of node.childNodes) {
					if (walk(child)) return true;
				}
			}
			return false;
		}

		walk(container);
		if (!startSet) {
			// Offset beyond content — put cursor at end
			range.selectNodeContents(container);
			range.collapse(false);
		}
		return range;
	}

	// ── Content sync ──────────────────────────────────────────────────────

	function getDisplayText(): string {
		let text = node.raw;
		if (text.endsWith('\r\n')) text = text.slice(0, -2);
		else if (text.endsWith('\n')) text = text.slice(0, -1);
		return text;
	}

	// Sync CST → DOM only when content changed externally (undo, split, merge).
	// During user typing, the DOM is already correct — skip to avoid
	// double characters and cursor jumps.
	$effect(() => {
		const display = getDisplayText();
		if (!el || userIsTyping) return;
		if (el.textContent !== display) {
			el.textContent = display;
		}
		// Ensure empty contenteditable always has a <br> so the browser
		// places a caret when clicked
		ensureBr();
	});

	function ensureBr(): void {
		if (!el) return;
		if (el.textContent === '' && !el.querySelector('br')) {
			el.appendChild(document.createElement('br'));
		}
	}

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		if (composing || !el) return;
		userIsTyping = true;
		const text = el.textContent ?? '';
		actions.updateBlockContent(index, text + '\n', preEditOffset);
		userIsTyping = false;
		ensureBr();
	}

	function onCompositionStart(): void {
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (composing) return;

		// Save cursor position before the browser modifies the DOM
		preEditOffset = getCursorOffset() ?? 0;

		// Ctrl+Z / Ctrl+Y — catch here because Ctrl+Y doesn't trigger
		// beforeinput historyRedo in Chromium/WebView2
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			actions.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			actions.requestRedo();
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const offset = getCursorOffset() ?? 0;
			if (splitOnEnter) {
				actions.splitBlock(index, offset);
			} else {
				const displayText = getDisplayText();
				const newDisplay = displayText.slice(0, offset) + '\n' + displayText.slice(offset);
				actions.updateBlockContent(index, newDisplay + '\n', preEditOffset);
				if (el) el.textContent = newDisplay;
				setCursorOffset(offset + 1);
			}
			return;
		}

		if (e.key === 'Backspace') {
			const offset = getCursorOffset();
			if (offset === 0 && !hasSelection()) {
				e.preventDefault();
				actions.mergeWithPrevious(index);
				return;
			}
		}

		// ArrowLeft/ArrowUp at offset 0 → move to end of previous block
		// Phase 1 simplification: ArrowUp uses offset-based detection instead of
		// visual-line geometry. Visual-line detection can be added in a later phase.
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && !e.shiftKey) {
			const offset = getCursorOffset();
			if (offset === 0) {
				e.preventDefault();
				actions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowRight/ArrowDown at end of content → move to start of next block
		if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && !e.shiftKey) {
			const textLen = (el?.textContent ?? '').length;
			const offset = getCursorOffset();
			if (offset === textLen) {
				e.preventDefault();
				actions.moveFocus(index + 1, 'start');
				return;
			}
		}
	}

	function onBeforeInput(e: InputEvent): void {
		if (e.inputType === 'historyUndo') {
			e.preventDefault();
			actions.requestUndo();
		} else if (e.inputType === 'historyRedo') {
			e.preventDefault();
			actions.requestRedo();
		}
	}

	function onCopy(e: ClipboardEvent): void {
		e.preventDefault();
		const text = getSelectedTextFromRaw();
		e.clipboardData?.setData('text/plain', text);
	}

	function onCut(e: ClipboardEvent): void {
		e.preventDefault();
		const selectedText = getSelectedTextFromRaw();
		if (!selectedText) return;
		e.clipboardData?.setData('text/plain', selectedText);

		// Delete selected range via CST: compute new raw without the selection
		const selOffsets = getSelectionOffsets();
		if (selOffsets) {
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
			actions.updateBlockContent(index, newDisplay + '\n');
			// Re-render the contenteditable from updated CST
			if (el) el.textContent = newDisplay;
			setCursorOffset(selOffsets.start);
		}
	}

	function onPaste(e: ClipboardEvent): void {
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		// Phase 1 simplification: all paste is inline within the current block.
		// Multi-block paste (splitting and inserting parsed blocks) is deferred
		// to a later phase. For now, insert the pasted text at the cursor position.
		const offset = getCursorOffset() ?? 0;
		const displayText = getDisplayText();
		const selOffsets = getSelectionOffsets();
		const start = selOffsets?.start ?? offset;
		const end = selOffsets?.end ?? offset;
		const newDisplay = displayText.slice(0, start) + text + displayText.slice(end);
		actions.updateBlockContent(index, newDisplay + '\n');
		if (el) el.textContent = newDisplay;
		setCursorOffset(start + text.length);
	}

	// ── Helpers ─────────────────────────────────────────────────────────

	function hasSelection(): boolean {
		const sel = window.getSelection();
		return Boolean(sel && !sel.isCollapsed);
	}

	function getSelectionOffsets(): { start: number; end: number } | null {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !el) return null;
		const range = sel.getRangeAt(0);
		const preRange = document.createRange();
		preRange.selectNodeContents(el);
		preRange.setEnd(range.startContainer, range.startOffset);
		const start = preRange.toString().length;
		const end = start + sel.toString().length;
		return { start, end };
	}

	function getSelectedTextFromRaw(): string {
		const offsets = getSelectionOffsets();
		if (!offsets) return '';
		return node.raw.slice(offsets.start, offsets.end);
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="text-editable-block {blockClass}"
	contenteditable="true"
	role="textbox"
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
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

	.text-editable-block.heading-1 { font-size: 2em; font-weight: bold; line-height: 1.2; }
	.text-editable-block.heading-2 { font-size: 1.5em; font-weight: bold; line-height: 1.3; }
	.text-editable-block.heading-3 { font-size: 1.25em; font-weight: bold; }
	.text-editable-block.heading-4 { font-size: 1.1em; font-weight: bold; }
	.text-editable-block.heading-5 { font-size: 1em; font-weight: bold; }
	.text-editable-block.heading-6 { font-size: 0.9em; font-weight: bold; }

	.text-editable-block.raw-block {
		font-family: 'Fira Code', 'Consolas', monospace;
		font-size: 0.9em;
		opacity: 0.85;
	}
</style>
