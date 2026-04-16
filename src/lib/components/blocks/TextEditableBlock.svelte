<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
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
	} from '../../editor-types';
	import { PRESERVE_KEYS_NON_ARROW, type StickyColumnState } from '../../sticky-column';
	import { parseInline, getContentRange, isProseKind } from '../../core/inline';
	import { renderInlineNodes } from '../../inline-renderer';
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
	import { measurePartialRectsInContentEditable } from '../../text-surface/selection-measure';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import {
		collapseCrossBlock,
		extendFocusToNextBlock,
		extendFocusToPreviousBlock,
		extendFocusToDocEdge,
		selectWholeDocument,
		handleShiftClick,
		scrollFocusBlockIntoView,
		collectCrossBlockText,
		performCrossBlockDelete,
		performCrossBlockDeleteSync,
		type CrossBlockMutationContext
	} from '../../selection/keydown-dispatch';
	import { findBlockPathForElement, nodeAt } from '../../selection/path-lookup';
	import { clearNativeSelection, offsetFromViewportPoint } from '../../selection/native-bridge';
	import { installDragListener } from '../../selection/drag-pointer';

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

	const crossBlockCtx: CrossBlockMutationContext = {
		selection,
		getDoc,
		getBlockElByPath,
		pushUndoSnapshot: () => containerEdit.beginContainerEdit(index, getCursorOffsetHelper(el!) ?? 0),
		notifyDocMutated: () => containerEdit.endContainerEdit()
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
		stickyColumn.reset();
		if (selection.isCrossBlock) {
			performCrossBlockDeleteSync(crossBlockCtx);
		}
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

		// Reset Ctrl+A doubling counter on any non-Ctrl+A keystroke. Bare
		// modifier keys (Control, Shift, Alt, Meta) don't reset — pressing
		// Control before 'a' is part of the Ctrl+A chord, not a separate action.
		const isCtrlA = (e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey;
		const isBareModifier = e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' ||
			e.key === 'Meta' || e.key === 'AltGraph' || e.key === 'CapsLock';
		if (!isCtrlA && !isBareModifier) {
			selection.resetSelectAllCount();
		}

		// Cross-block dispatch: while cross-block mode is active, the
		// collapse/extend/select-all branches run first and short-circuit the
		// rest of the single-block handler.
		if (selection.isCrossBlock) {
			if (await handleCrossBlockKeydown(e)) return;
		}

		// Single-block entry points: Ctrl+Shift+Home/End, double Ctrl+A.
		// Shift+Arrow entry is handled inline in the existing arrow branches
		// below so the boundary geometry check stays colocated with unshifted
		// navigation.
		if (handleCrossBlockEntryKeydown(e)) return;

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
		if (e.key === 'ArrowUp') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (isAtFirstVisualLine(el!, offset)) {
				// Shift+ArrowUp: native first extends to start of block content.
				// Only cross the block boundary when the selection can't grow
				// further within this block (cursor/anchor already at offset 0).
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

		// ArrowDown — geometry-based: cross block boundary when cursor is on last visual line.
		if (e.key === 'ArrowDown') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const textLen = (el?.textContent ?? '').length;
			if (isAtLastVisualLine(el!, offset, textLen)) {
				// Shift+ArrowDown: native first extends to end of block content.
				// Only cross the block boundary when the cursor/anchor is already
				// at the end, so native extension has nowhere left to go.
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

		// ArrowLeft at offset 0 → move to end of previous block
		if (e.key === 'ArrowLeft') {
			const offset = getCursorOffsetHelper(el!);
			if (offset === 0) {
				if (e.shiftKey) {
					e.preventDefault();
					extendFocusToPreviousBlock(selection, getDoc(), el!, myPath);
					scrollFocusBlockIntoView(selection, getBlockElByPath);
					return;
				}
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowRight at end of content → move to start of next block
		if (e.key === 'ArrowRight') {
			const textLen = (el?.textContent ?? '').length;
			const offset = getCursorOffsetHelper(el!);
			if (offset === textLen) {
				if (e.shiftKey) {
					e.preventDefault();
					extendFocusToNextBlock(selection, getDoc(), el!, myPath);
					scrollFocusBlockIntoView(selection, getBlockElByPath);
					return;
				}
				e.preventDefault();
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}
	}

	// ── Cross-block dispatch helpers ────────────────────────────────────

	/**
	 * Handle a keystroke while cross-block mode is active. Shift+Arrow
	 * extends focus via path arithmetic on `selection.focus`, not on the
	 * block's own path, so an extended selection can keep growing past the
	 * block that first captured the anchor. Unshifted arrow collapses back
	 * to single-block mode.
	 */
	async function handleCrossBlockKeydown(e: KeyboardEvent): Promise<boolean> {
		if (!el) return false;
		const doc = getDoc();

		// Cross-block Copy — handle at keydown level because the browser
		// suppresses `copy` events when the native selection is cleared.
		if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
			e.preventDefault();
			const text = collectCrossBlockText(doc, selection.anchor!, selection.focus!);
			await navigator.clipboard.writeText(text);
			return true;
		}

		// Cross-block Cut — same browser limitation as Copy.
		if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !e.shiftKey) {
			e.preventDefault();
			const text = collectCrossBlockText(doc, selection.anchor!, selection.focus!);
			await navigator.clipboard.writeText(text);
			await performCrossBlockDelete(crossBlockCtx, () => tick());
			return true;
		}

		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			await performCrossBlockDelete(crossBlockCtx, async () => { await tick(); });
			return true;
		}

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

		// Ctrl+A while already cross-block: select the whole document.
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
		// Cross-block type-replace: delete the range, then insert the typed char.
		// performCrossBlockDelete already pushed the undo snapshot (with the
		// cross-block selection), so we mutate raw directly and notify — no
		// second undo push — so undo reverts both delete and insert in one step.
		if (selection.isCrossBlock && e.inputType === 'insertText') {
			e.preventDefault();
			const typed = e.data ?? '';
			const caret = await performCrossBlockDelete(crossBlockCtx, () => tick());
			if (!caret || !typed) return;
			const targetNode = nodeAt(getDoc(), caret.path) as CstNode | null;
			if (!targetNode || !('raw' in targetNode)) return;
			const raw = targetNode.raw;
			targetNode.raw = raw.slice(0, caret.offset) + typed + raw.slice(caret.offset);
			if (isProseKind(targetNode.kind)) {
				const range = getContentRange(targetNode);
				targetNode.inlineContent = parseInline(targetNode.raw, range.start, range.end);
			}
			containerEdit.endContainerEdit();
			pendingCursorOffset = caret.offset + typed.length;
			return;
		}
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
		stickyColumn.reset();
		e.preventDefault();
		const pastedText = e.clipboardData?.getData('text/plain') ?? '';
		if (!pastedText) return;

		if (selection.isCrossBlock) {
			const caret = await performCrossBlockDelete(crossBlockCtx, () => tick());
			if (!caret) return;
			const targetNode = nodeAt(getDoc(), caret.path) as CstNode | null;
			if (!targetNode || !('raw' in targetNode)) return;
			const targetDisplay = trimTrailingLineEnding(targetNode.raw);
			const parsed = parse(pastedText);

			if (parsed.children.length <= 1) {
				const newDisplay = targetDisplay.slice(0, caret.offset) + pastedText + targetDisplay.slice(caret.offset);
				blockEdit.updateBlockContent(caret.path[caret.path.length - 1], newDisplay + '\n', caret.offset + pastedText.length);
				pendingCursorOffset = caret.offset + pastedText.length;
			} else {
				const targetIndex = caret.path[caret.path.length - 1];
				blockEdit.insertParsedBlocks(targetIndex, caret.offset, parsed.children);
			}
			return;
		}

		const offset = getCursorOffsetHelper(el!) ?? 0;
		const displayText = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el!);
		const start = selOffsets?.start ?? offset;
		const end = selOffsets?.end ?? offset;

		const effectiveDisplay = displayText.slice(0, start) + displayText.slice(end);
		const effectiveOffset = start;

		const parsed = parse(pastedText);

		if (parsed.children.length <= 1) {
			const newDisplay = effectiveDisplay.slice(0, effectiveOffset) + pastedText + effectiveDisplay.slice(effectiveOffset);
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
		stickyColumn.reset();
		selection.resetSelectAllCount();

		if (e.shiftKey && el) {
			// Shift+click: extend any live cross-block selection to this point,
			// or enter cross-block mode with the previously focused block's
			// caret as the anchor. Same-block shift+click falls through to the
			// browser's native range extension.
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

		// Collapse a live cross-block selection back to single-block at the
		// click point — any unshifted pointerdown should exit cross-block
		// mode, matching the "click anywhere collapses" requirement.
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
				{ editorRoot: root, scrollContainer: root, selection },
				{ path: myPath.slice(), offset }
			);
		}
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
