<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		LIST_CONTEXT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		type BlockEditActions,
		type BlockElLookup,
		type ContainerEditActions,
		type DocumentGetter,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../contracts';
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import { parseInline, getContentRange, isProseKind } from '../../core/inline';
	import { renderInlineNodes } from '../../core/inline-render';
	import { parse } from '../../core/parser';
	import type { InlineNode } from '../../core/nodes';
	import { trimTrailingLineEnding } from '../../core/lines';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../contenteditable/cursor-utils';
	import { findOffsetNearestX } from '../../contenteditable/sticky-measure';
	import { toggleInlineFormat } from '../../contenteditable/format-toggle';
	import { measurePartialRectsInContentEditable } from '../../contenteditable/selection-measure';
	import {
		handleSharedKeydown,
		type SharedKeydownContext
	} from '../../contenteditable/shared-keydown';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../selection/cross-block-dispatch';

	let {
		node,
		index,
		myPath = [],
		blockClass = 'paragraph-block',
		splitOnEnter = true
	}: {
		node: CstNode;
		index: number;
		myPath?: number[];
		blockClass?: string;
		splitOnEnter?: boolean;
	} = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
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
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	/** Last raw string the $effect rendered — prevents spurious rebuilds. */
	let lastRenderedRaw = '';
	// Cursor position captured before each edit (keydown fires before DOM changes)
	let preEditOffset = 0;

	const crossBlock = createCrossBlockHandlers({
		getEl: () => el ?? null,
		getMyPath: () => myPath,
		getIndex: () => index,
		selection,
		getDoc,
		getBlockElByPath,
		getEditorRoot,
		stickyColumn,
		containerEdit,
		blockEdit,
		getCursorOffset: () => getCursorOffsetHelper(el!) ?? null,
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

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => (el ? getCursorOffsetHelper(el) : null),
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

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		return measurePartialRectsInContentEditable(el, startOffset, endOffset);
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
			setCursorOffsetHelper(el, pendingCursorOffset);
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
		preEditOffset = getCursorOffsetHelper(el!) ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

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

		// Ctrl+1..6 — set heading level, or (Ctrl+0) convert back to paragraph.
		// Replaces any existing `#` prefix run so repeated shortcuts cycle levels.
		if ((e.ctrlKey || e.metaKey) && /^[0-6]$/.test(e.key) && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			const level = parseInt(e.key, 10);
			const displayText = getDisplayText();
			const stripped = displayText.replace(/^#{1,6}\s?/, '');
			const newDisplay = level === 0 ? stripped : '#'.repeat(level) + ' ' + stripped;
			const cursor = (level === 0 ? 0 : level + 1) + (preEditOffset ?? 0);
			blockEdit.updateBlockContent(index, newDisplay + '\n', cursor);
			pendingCursorOffset = cursor;
			return;
		}

		// Shift+Enter — GFM hard line break (trailing backslash before the newline).
		if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, offset) + '\\\n' + displayText.slice(offset);
			blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset);
			pendingCursorOffset = offset + 2;
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

		// Tab inserts a literal tab character at the cursor. Without this the
		// browser's default moves focus out of the editor entirely. Shift+Tab
		// stays as the browser default (reverse focus) since prose blocks have
		// no block-level indent semantics today. Inside a list item this is
		// skipped — the enclosing ListItemBlock handles Tab as indent/outdent.
		if (e.key === 'Tab' && !e.shiftKey && !listContext) {
			e.preventDefault();
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, offset) + '\t' + displayText.slice(offset);
			blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset);
			pendingCursorOffset = offset + 1;
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
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
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
			e.preventDefault();
			return;
		}
		if (await crossBlock.handleBeforeInput(e)) return;
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		const text = getSelectedTextFromRaw();
		e.clipboardData?.setData('text/plain', text);
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
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
			pendingCursorOffset = selOffsets.start;
		}
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (await crossBlock.handlePaste(e)) return;

		stickyColumn.reset();
		e.preventDefault();
		const pastedText = e.clipboardData?.getData('text/plain') ?? '';
		if (!pastedText) return;

		const offset = getCursorOffsetHelper(el!) ?? 0;
		const displayText = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el!);
		const start = selOffsets?.start ?? offset;
		const end = selOffsets?.end ?? offset;

		const effectiveDisplay = displayText.slice(0, start) + displayText.slice(end);
		const effectiveOffset = start;

		const parsed = parse(pastedText);

		if (parsed.children.length <= 1) {
			const newDisplay =
				effectiveDisplay.slice(0, effectiveOffset) +
				pastedText +
				effectiveDisplay.slice(effectiveOffset);
			blockEdit.updateBlockContent(index, newDisplay + '\n', effectiveOffset + pastedText.length);
			pendingCursorOffset = effectiveOffset + pastedText.length;
		} else {
			if (selOffsets) {
				blockEdit.updateBlockContent(index, effectiveDisplay + '\n', effectiveOffset);
			}
			blockEdit.insertParsedBlocks(index, effectiveOffset, parsed.children);
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	function toggleFormat(format: 'strong' | 'emphasis'): void {
		if (!el) return;
		const offsets = getSelectionOffsetsHelper(el);
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
