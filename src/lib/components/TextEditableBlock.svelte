<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type CstNode,
		type BlockComponent
	} from '../editor-types';
	import { parseInline, getContentRange, isProseKind } from '../core/inline-parser';
	import { renderInlineNodes, setCursorFromRawOffset } from '../inline-renderer';
	import { parse } from '../core/parser';

	let {
		node,
		index,
		blockClass = 'paragraph-block',
		splitOnEnter = true
	}: { node: CstNode; index: number; blockClass?: string; splitOnEnter?: boolean } = $props();

	const actions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	/** Last raw string the $effect rendered — prevents spurious rebuilds. */
	let lastRenderedRaw = '';
	// Cursor position captured before each edit (keydown fires before DOM changes)
	let preEditOffset = 0;

	function refreshInlineContent(): void {
		if (!isProseKind(node.kind)) return;
		const range = getContentRange(node);
		node.inlineContent = parseInline(node.raw, range.start, range.end);
	}

	/**
	 * Get the block-level marker prefix that is NOT covered by inline content.
	 * For headings this is "# " / "## " etc. For paragraphs it's empty.
	 * This prefix must be rendered as a dimmed span before inline content
	 * so that el.textContent matches getDisplayText().
	 */
	function getBlockMarkerPrefix(): string {
		if (!isProseKind(node.kind)) return '';
		const range = getContentRange(node);
		return node.raw.slice(0, range.start);
	}

	/**
	 * Build the DOM fragment for inline content, including the block-level marker.
	 * Takes content as parameter to avoid reading node.inlineContent (which would
	 * require mutating the node prop and trigger Svelte 5 ownership cascades).
	 */
	function buildInlineDOM(content: import('../core/nodes').InlineNode[]): DocumentFragment {
		const frag = document.createDocumentFragment();
		const prefix = getBlockMarkerPrefix();
		if (prefix) {
			const span = document.createElement('span');
			span.className = 'md-marker';
			span.textContent = prefix;
			frag.appendChild(span);
		}
		frag.appendChild(renderInlineNodes(content, node.raw));
		return frag;
	}

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		// FOCUS_LAST_START (-1) cascades through containers; at the leaf level it means offset 0
		setCursorOffset(Math.max(0, offset));
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
	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

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

	$effect(() => {
		if (!el) return;

		if (isProseKind(node.kind)) {
			// Guard: skip rebuild if raw hasn't changed (spurious re-run).
			// This also covers kind changes — updateNodeContent always sets
			// node.raw when kind changes, so raw change implies kind change.
			if (node.raw === lastRenderedRaw && pendingCursorOffset === null) return;

			// Compute inline content locally — do NOT write to node.inlineContent.
			// Mutating the node prop triggers Svelte 5's ownership system, which causes
			// a reactivity cascade that corrupts keyed {#each} index assignments after
			// structural operations like splitBlock.
			const range = getContentRange(node);
			const content = parseInline(node.raw, range.start, range.end);
			el.replaceChildren(buildInlineDOM(content));
			lastRenderedRaw = node.raw;
		} else {
			const display = getDisplayText();
			if (el.textContent !== display) {
				el.textContent = display;
				lastRenderedRaw = node.raw;
			}
		}

		ensureBr();

		// Restore cursor if a handler requested it
		if (pendingCursorOffset !== null) {
			setCursorFromRawOffset(el, pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	function ensureBr(): void {
		if (!el) return;
		if (el.textContent === '' && !el.querySelector('br')) {
			el.appendChild(document.createElement('br'));
		}
	}

	// ── Visual-line detection ───────────────────────────────────────────

	/**
	 * Get the vertical position (top) of the cursor.
	 * For collapsed ranges, getClientRects() may return an empty list or
	 * zero-height rects. We try getClientRects first, then getBoundingClientRect,
	 * and return null if neither produces a usable value.
	 */
	function getRangeTop(range: Range): number | null {
		const rects = range.getClientRects();
		if (rects.length > 0 && rects[0].height > 0) return rects[0].top;
		const br = range.getBoundingClientRect();
		if (br.height > 0) return br.top;
		return null;
	}

	/**
	 * Get the vertical position of a non-collapsed range around a character.
	 * Non-collapsed ranges reliably return rects, unlike collapsed ones.
	 */
	function getCharRangeTop(container: Node, offset: number, atEnd: boolean): number | null {
		if (!el) return null;
		try {
			const range = document.createRange();
			if (atEnd) {
				// Range covering the last character
				range.setStart(container, Math.max(0, offset - 1));
				range.setEnd(container, offset);
			} else {
				// Range covering the first character
				range.setStart(container, offset);
				range.setEnd(container, offset + 1);
			}
			const rects = range.getClientRects();
			if (rects.length > 0 && rects[0].height > 0) return rects[0].top;
			const br = range.getBoundingClientRect();
			if (br.height > 0) return br.top;
		} catch {
			// offset out of bounds — ignore
		}
		return null;
	}

	function isAtFirstVisualLine(): boolean {
		if (!el) return true;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return true;
		if ((el.textContent ?? '').length === 0) return true;

		const cursorRange = sel.getRangeAt(0);
		let cursorTop = getRangeTop(cursorRange);

		// For collapsed cursor, try measuring the character at cursor position
		if (cursorTop === null && cursorRange.collapsed) {
			const offset = getCursorOffset() ?? 0;
			// If at offset 0, we're definitely at first visual line
			if (offset === 0) return true;
			// Otherwise fall back to offset check
			return false;
		}
		if (cursorTop === null) return true;

		// Get vertical position of the start of the element.
		// Use a non-collapsed range around the first character for reliability.
		const firstChild = el.firstChild;
		if (!firstChild) return true;
		let startTop: number | null = null;
		if (firstChild.nodeType === Node.TEXT_NODE && (firstChild.textContent?.length ?? 0) > 0) {
			startTop = getCharRangeTop(firstChild, 0, false);
		} else {
			const startRange = document.createRange();
			startRange.selectNodeContents(el);
			startRange.collapse(true);
			startTop = getRangeTop(startRange);
		}
		if (startTop === null) {
			// Can't determine geometry — fall back to offset-based
			return (getCursorOffset() ?? 0) === 0;
		}

		const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
		return Math.abs(cursorTop - startTop) < lineHeight * 0.8;
	}

	function isAtLastVisualLine(): boolean {
		if (!el) return true;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return true;
		const textLen = (el.textContent ?? '').length;
		if (textLen === 0) return true;

		const cursorRange = sel.getRangeAt(0);
		let cursorTop = getRangeTop(cursorRange);

		// For collapsed cursor at end of text, we're at last visual line
		if (cursorTop === null && cursorRange.collapsed) {
			const offset = getCursorOffset() ?? 0;
			if (offset === textLen) return true;
			return false;
		}
		if (cursorTop === null) return true;

		// Get vertical position of the end of the element.
		// Use a non-collapsed range around the last character for reliability.
		const lastChild = el.lastChild;
		if (!lastChild) return true;
		let endTop: number | null = null;
		if (lastChild.nodeType === Node.TEXT_NODE && (lastChild.textContent?.length ?? 0) > 0) {
			const len = lastChild.textContent!.length;
			endTop = getCharRangeTop(lastChild, len, true);
		} else {
			const endRange = document.createRange();
			endRange.selectNodeContents(el);
			endRange.collapse(false);
			endTop = getRangeTop(endRange);
		}
		if (endTop === null) {
			return (getCursorOffset() ?? 0) === textLen;
		}

		const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
		return Math.abs(cursorTop - endTop) < lineHeight * 0.8;
	}

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		if (composing || !el) return;
		const text = el.textContent ?? '';
		const savedOffset = getCursorOffset() ?? 0;
		actions.updateBlockContent(index, text + '\n', savedOffset);

		// Signal the $effect to restore cursor after it rebuilds the DOM.
		// The $effect computes inline content locally — no refreshInlineContent needed.
		pendingCursorOffset = savedOffset;
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

		// Ctrl+B / Ctrl+I — toggle bold / italic formatting on selection
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
				// $effect handles inline re-render — no refreshInlineContent needed
				pendingCursorOffset = offset + 1;
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

		if (e.key === 'Delete') {
			const offset = getCursorOffset();
			const textLen = (el?.textContent ?? '').length;
			if (offset === textLen && !hasSelection()) {
				e.preventDefault();
				actions.mergeWithNext(index);
				return;
			}
		}

		// ArrowUp — geometry-based: cross block boundary when cursor is on first visual line.
		if (e.key === 'ArrowUp' && !e.shiftKey) {
			if (isAtFirstVisualLine()) {
				e.preventDefault();
				actions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowDown — geometry-based: cross block boundary when cursor is on last visual line.
		if (e.key === 'ArrowDown' && !e.shiftKey) {
			if (isAtLastVisualLine()) {
				e.preventDefault();
				actions.moveFocus(index + 1, 'start');
				return;
			}
		}

		// ArrowLeft at offset 0 → move to end of previous block
		if (e.key === 'ArrowLeft' && !e.shiftKey) {
			const offset = getCursorOffset();
			if (offset === 0) {
				e.preventDefault();
				actions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowRight at end of content → move to start of next block
		if (e.key === 'ArrowRight' && !e.shiftKey) {
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
		} else if (e.inputType === 'insertLineBreak') {
			// Shift+Enter: prevent browser from inserting \n into contenteditable.
			// A bare \n in textContent would cause onInput → updateBlockContent →
			// reparseAsNode to produce two blocks, silently dropping content after the \n.
			e.preventDefault();
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

		const selOffsets = getSelectionOffsets();
		if (selOffsets) {
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
			actions.updateBlockContent(index, newDisplay + '\n', selOffsets.start);
			// $effect handles inline re-render — no refreshInlineContent needed
			pendingCursorOffset = selOffsets.start;
		}
	}

	function onPaste(e: ClipboardEvent): void {
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		const offset = getCursorOffset() ?? 0;
		const displayText = getDisplayText();
		const selOffsets = getSelectionOffsets();
		const start = selOffsets?.start ?? offset;
		const end = selOffsets?.end ?? offset;

		// Delete selected text first if there's a selection
		const effectiveDisplay = displayText.slice(0, start) + displayText.slice(end);
		const effectiveOffset = start;

		// Parse the pasted text to check if it produces multiple blocks
		const parsed = parse(text);

		if (parsed.children.length <= 1) {
			// Single block or empty — inline paste (existing behavior)
			const newDisplay = effectiveDisplay.slice(0, effectiveOffset) + text + effectiveDisplay.slice(effectiveOffset);
			actions.updateBlockContent(index, newDisplay + '\n', effectiveOffset + text.length);
			// $effect handles inline re-render — no refreshInlineContent needed
			pendingCursorOffset = effectiveOffset + text.length;
		} else {
			// Multi-block paste — splice parsed blocks into document.
			// First, update the block's raw to remove selected text so that
			// insertParsedBlocks (which reads currentNode.raw) sees the correct content.
			if (selOffsets) {
				actions.updateBlockContent(index, effectiveDisplay + '\n', effectiveOffset);
			}
			actions.insertParsedBlocks(index, effectiveOffset, parsed.children);
		}
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	function toggleFormat(format: 'strong' | 'emphasis'): void {
		if (!el) return;

		const offsets = getSelectionOffsets();
		if (!offsets) return;

		const displayText = getDisplayText();
		const markers = format === 'strong' ? '**' : '*';
		const mLen = markers.length;

		const selectedSlice = displayText.slice(offsets.start, offsets.end);

		// Check if selection is already wrapped with markers
		const isFormatted =
			selectedSlice.startsWith(markers) &&
			selectedSlice.endsWith(markers) &&
			selectedSlice.length > mLen * 2;

		let newDisplay: string;
		let newSelStart: number;
		let newSelEnd: number;

		if (isFormatted) {
			// Remove markers
			const unwrapped = selectedSlice.slice(mLen, -mLen);
			newDisplay =
				displayText.slice(0, offsets.start) + unwrapped + displayText.slice(offsets.end);
			newSelStart = offsets.start;
			newSelEnd = offsets.start + unwrapped.length;
		} else {
			// Add markers
			newDisplay =
				displayText.slice(0, offsets.start) +
				markers +
				selectedSlice +
				markers +
				displayText.slice(offsets.end);
			newSelStart = offsets.start;
			newSelEnd = offsets.start + selectedSlice.length + mLen * 2;
		}

		actions.updateBlockContent(index, newDisplay + '\n', newSelStart);

		tick().then(() => {
			setSelection(newSelStart, newSelEnd);
		});
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
