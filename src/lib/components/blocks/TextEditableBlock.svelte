<script lang="ts">
	import { getContext, tick } from 'svelte';
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
	import { parseInline, getContentRange, isProseKind } from '../../core/inline';
	import { renderInlineNodes, setCursorFromRawOffset } from '../../inline-renderer';
	import { parse } from '../../core/parser';
	import type { InlineNode } from '../../core/nodes';
	import { trimTrailingLineEnding } from '../../raw-text';
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

	let {
		node,
		index,
		blockClass = 'paragraph-block',
		splitOnEnter = true
	}: { node: CstNode; index: number; blockClass?: string; splitOnEnter?: boolean } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
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
	function buildInlineDOM(content: InlineNode[]): DocumentFragment {
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
		setCursorOffsetHelper(el, Math.max(0, offset));
	}

	/**
	 * Position the cursor at the offset nearest to editor-relative pixel X
	 * on this block's first or last visual line (depending on `from`).
	 * Implementation of the BlockComponent.focusAtColumn? contract.
	 */
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

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	// ── Content sync ──────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
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

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (composing || !el) return;
		const text = el.textContent ?? '';
		const savedOffset = getCursorOffsetHelper(el) ?? 0;
		blockEdit.updateBlockContent(index, text + '\n', savedOffset);

		// Signal the $effect to restore cursor after it rebuilds the DOM.
		// The $effect computes inline content locally — no refreshInlineContent needed.
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

	function onKeyDown(e: KeyboardEvent): void {
		if (composing) return;

		// Save cursor position before the browser modifies the DOM
		preEditOffset = getCursorOffsetHelper(el!) ?? 0;

		// ── Sticky column: capture on vertical arrows, reset on non-preserve keys ──
		// Horizontal arrows, Home, End, Escape, and typable characters all land in
		// the else branch and reset sticky — PRESERVE_KEYS_NON_ARROW's JSDoc lists
		// every key that intentionally does nothing to sticky state.
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			const x = getCurrentCursorEditorRelativeX(el!);
			if (x !== null) stickyColumn.capture(x);
			// Fall through to the existing vertical-arrow branches below
		} else if (!PRESERVE_KEYS_NON_ARROW.includes(e.key)) {
			stickyColumn.reset();
			// Fall through — we still handle the key normally
		}

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
			history.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			history.requestRedo();
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (splitOnEnter) {
				blockEdit.splitBlock(index, offset);
			} else {
				const displayText = getDisplayText();
				const newDisplay = displayText.slice(0, offset) + '\n' + displayText.slice(offset);
				blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset);
				// $effect handles inline re-render — no refreshInlineContent needed
				pendingCursorOffset = offset + 1;
			}
			return;
		}

		if (e.key === 'Backspace') {
			const offset = getCursorOffsetHelper(el!);
			if (offset === 0 && !hasSelectionHelper()) {
				e.preventDefault();
				blockEdit.mergeWithPrevious(index);
				return;
			}
		}

		if (e.key === 'Delete') {
			const offset = getCursorOffsetHelper(el!);
			const textLen = (el?.textContent ?? '').length;
			if (offset === textLen && !hasSelectionHelper()) {
				e.preventDefault();
				blockEdit.mergeWithNext(index);
				return;
			}
		}

		// ArrowUp — geometry-based: cross block boundary when cursor is on first visual line.
		if (e.key === 'ArrowUp' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (isAtFirstVisualLine(el!, offset)) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, { stickyColumnFrom: 'below' });
				return;
			}
		}

		// ArrowDown — geometry-based: cross block boundary when cursor is on last visual line.
		if (e.key === 'ArrowDown' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const textLen = (el?.textContent ?? '').length;
			if (isAtLastVisualLine(el!, offset, textLen)) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, { stickyColumnFrom: 'above' });
				return;
			}
		}

		// ArrowLeft at offset 0 → move to end of previous block
		if (e.key === 'ArrowLeft' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!);
			if (offset === 0) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowRight at end of content → move to start of next block
		if (e.key === 'ArrowRight' && !e.shiftKey) {
			const textLen = (el?.textContent ?? '').length;
			const offset = getCursorOffsetHelper(el!);
			if (offset === textLen) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}
	}

	function onBeforeInput(e: InputEvent): void {
		if (e.inputType === 'historyUndo') {
			e.preventDefault();
			history.requestUndo();
		} else if (e.inputType === 'historyRedo') {
			e.preventDefault();
			history.requestRedo();
		} else if (e.inputType === 'insertLineBreak') {
			// Shift+Enter: prevent browser from inserting \n into contenteditable.
			// A bare \n in textContent would cause onInput → updateBlockContent →
			// reparseAsNode to produce two blocks, silently dropping content after the \n.
			e.preventDefault();
		}
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		const text = getSelectedTextFromRaw();
		e.clipboardData?.setData('text/plain', text);
	}

	function onCut(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		const selectedText = getSelectedTextFromRaw();
		if (!selectedText) return;
		e.clipboardData?.setData('text/plain', selectedText);

		const selOffsets = getSelectionOffsetsHelper(el!);
		if (selOffsets) {
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
			blockEdit.updateBlockContent(index, newDisplay + '\n', selOffsets.start);
			// $effect handles inline re-render — no refreshInlineContent needed
			pendingCursorOffset = selOffsets.start;
		}
	}

	function onPaste(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		const offset = getCursorOffsetHelper(el!) ?? 0;
		const displayText = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el!);
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
			blockEdit.updateBlockContent(index, newDisplay + '\n', effectiveOffset + text.length);
			// $effect handles inline re-render — no refreshInlineContent needed
			pendingCursorOffset = effectiveOffset + text.length;
		} else {
			// Multi-block paste — splice parsed blocks into document.
			// First, update the block's raw to remove selected text so that
			// insertParsedBlocks (which reads currentNode.raw) sees the correct content.
			if (selOffsets) {
				blockEdit.updateBlockContent(index, effectiveDisplay + '\n', effectiveOffset);
			}
			blockEdit.insertParsedBlocks(index, effectiveOffset, parsed.children);
		}
	}

	function onPointerDown(_e: PointerEvent): void {
		stickyColumn.reset();
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	function toggleFormat(format: 'strong' | 'emphasis'): void {
		if (!el) return;

		const offsets = getSelectionOffsetsHelper(el);
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

		blockEdit.updateBlockContent(index, newDisplay + '\n', newSelStart);

		tick().then(() => {
			setSelection(newSelStart, newSelEnd);
		});
	}

	// ── Helpers ─────────────────────────────────────────────────────────

	function getSelectedTextFromRaw(): string {
		const offsets = getSelectionOffsetsHelper(el!);
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
	onpointerdown={onPointerDown}
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
