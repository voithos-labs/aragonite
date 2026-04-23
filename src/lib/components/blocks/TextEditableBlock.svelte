<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		CONTROLLER_KEY,
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
	import type { UndoController } from '../../editor-actions/deps';
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import { parseInline, getContentRange, isProseKind } from '../../core/inline';
	import { renderInlineNodes } from '../../core/inline-render';
	import { pasteDispatch } from '../../tree-operations/paste/dispatch';
	import type { InlineNode } from '../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../core/lines';
	import {
		createRangeFromOffsets,
		getSelectionFocusOffset as getSelectionFocusOffsetHelper,
		hasSelection as hasSelectionHelper
	} from '../../contenteditable/cursor-utils';
	import { findOffsetNearestX } from '../../contenteditable/sticky-measure';
	import { toggleInlineFormat } from '../../contenteditable/format-toggle';
	import { measurePartialRectsInContentEditable } from '../../contenteditable/selection-measure';
	import {
		handleSharedKeydown,
		handleSharedBeforeInput,
		type SharedKeydownContext
	} from '../../selection/shared-keydown';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../selection/cross-block-dispatch';
	import { collectCrossBlockText } from '../../selection/clipboard-text';
	import { domToRawOffset, rawToDomOffset } from '../../contenteditable/ambient-offset';
	import { ambientSpanOf } from '../../contenteditable/ambient-dom';
	import { createAmbientCursorIO } from '../../contenteditable/ambient-cursor';

	let {
		node,
		index,
		myPath = [],
		blockClass = 'paragraph-block',
		splitOnEnter = true,
		ambientPrefix = ''
	}: {
		node: CstNode;
		index: number;
		myPath?: number[];
		blockClass?: string;
		splitOnEnter?: boolean;
		ambientPrefix?: string;
	} = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
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
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	/** Last (ambientPrefix, raw) pair the $effect rendered — prevents spurious rebuilds. */
	let lastRenderedKey = '';
	// Cursor position captured before each edit (keydown fires before DOM changes)
	let preEditOffset = 0;

	const ambientLength = $derived(ambientPrefix.length);

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

	// Heading/etc. own-marker prefix slice. Rendered as a dimmed span before inline
	// content so el.textContent === ambientPrefix + getDisplayText() holds.
	function getBlockMarkerPrefix(): string {
		if (!isProseKind(node.kind)) return '';
		const range = getContentRange(node);
		return node.raw.slice(0, range.start);
	}

	/**
	 * Build the DOM fragment for inline content, prepending the ambient marker
	 * (container-owned, contenteditable="false" island) and the block-own marker.
	 * Takes content as parameter to avoid reading node.inlineContent (which would
	 * require mutating the node prop and trigger Svelte 5 ownership cascades).
	 */
	function buildInlineDOM(content: InlineNode[]): DocumentFragment {
		const frag = document.createDocumentFragment();
		if (ambientPrefix) {
			const ambientSpan = document.createElement('span');
			ambientSpan.className = 'md-marker';
			ambientSpan.setAttribute('contenteditable', 'false');
			ambientSpan.textContent = ambientPrefix;
			frag.appendChild(ambientSpan);
		}
		const blockOwnPrefix = getBlockMarkerPrefix();
		if (blockOwnPrefix) {
			const span = document.createElement('span');
			span.className = 'md-marker';
			span.textContent = blockOwnPrefix;
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
		if (!el) return;

		if (import.meta.env.DEV && ambientPrefix && !isProseKind(node.kind)) {
			console.warn(
				`[TextEditableBlock] ambientPrefix is prose-only; non-prose kind ${node.kind} received a non-empty ambient prefix. The ambient marker will not render correctly.`
			);
		}

		const renderKey = `${ambientPrefix}\0${node.raw}`;

		if (isProseKind(node.kind)) {
			if (renderKey === lastRenderedKey && pendingCursorOffset === null) return;

			// Compute locally — writing to `node.inlineContent` breaks keyed {#each} after structural ops.
			// See `docs/design/editor/editor.md` § Reactive State Plumbing.
			const range = getContentRange(node);
			const content = parseInline(node.raw, range.start, range.end);
			el.replaceChildren(buildInlineDOM(content));
			lastRenderedKey = renderKey;
		} else {
			const display = getDisplayText();
			if (el.textContent !== display) {
				el.textContent = display;
				lastRenderedKey = renderKey;
			}
		}

		ensureBr();

		if (pendingCursorOffset !== null) {
			cursor.setRaw(pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	function ensureBr(): void {
		if (!el) return;
		const display = getDisplayText();
		if (display === '' && !el.querySelector('br')) {
			el.appendChild(document.createElement('br'));
		}
	}

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
			const level = parseInt(e.key, 10);
			const displayText = getDisplayText();
			const oldPrefixMatch = displayText.match(/^#{1,6}\s?/);
			const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;
			const stripped = displayText.slice(oldPrefixLen);
			const newPrefix = level === 0 ? '' : '#'.repeat(level) + ' ';
			const newDisplay = newPrefix + stripped;
			const cursor = newPrefix.length + Math.max(0, (preEditOffset ?? 0) - oldPrefixLen);
			blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset, cursor);
			pendingCursorOffset = cursor;
			return;
		}

		// Shift+Enter — GFM hard line break (trailing backslash before the newline).
		if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			const offset = cursor.getRaw() ?? 0;
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, offset) + '\\\n' + displayText.slice(offset);
			blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset);
			pendingCursorOffset = offset + 2;
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const offset = cursor.getRaw() ?? 0;
			if (splitOnEnter) {
				blockEdit.splitBlock(index, offset);
			} else {
				const displayText = getDisplayText();
				const newDisplay = displayText.slice(0, offset) + '\n' + displayText.slice(offset);
				blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset);
				pendingCursorOffset = offset + 1;
			}
			return;
		}

		// Insert a literal tab; the browser default would move focus out of the editor.
		// Skipped inside a list item — ListItemBlock owns Tab there.
		if (e.key === 'Tab' && !e.shiftKey && !listContext) {
			e.preventDefault();
			const offset = cursor.getRaw() ?? 0;
			const displayText = getDisplayText();
			const newDisplay = displayText.slice(0, offset) + '\t' + displayText.slice(offset);
			blockEdit.updateBlockContent(index, newDisplay + '\n', preEditOffset);
			pendingCursorOffset = offset + 1;
			return;
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

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		// Sync write via e.clipboardData — navigator.clipboard.writeText is async/permission-gated
		// and unreliable in Tauri's wry webview.
		if (selection.isCrossBlock && selection.anchor && selection.focus) {
			e.clipboardData?.setData(
				'text/plain',
				collectCrossBlockText(getDoc(), selection.anchor, selection.focus)
			);
			return;
		}
		e.clipboardData?.setData('text/plain', getSelectedTextFromRaw());
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();

		// Sync clipboard write, then async delete — clipboard is populated even if the delete is interrupted.
		if (selection.isCrossBlock && selection.anchor && selection.focus) {
			e.clipboardData?.setData(
				'text/plain',
				collectCrossBlockText(getDoc(), selection.anchor, selection.focus)
			);
			await crossBlock.performCrossBlockDeleteFromEvent();
			return;
		}

		const selectedText = getSelectedTextFromRaw();
		if (!selectedText) return;
		e.clipboardData?.setData('text/plain', selectedText);

		const selOffsets = cursor.getRawSelection();
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
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;

		const offset = cursor.getRaw() ?? 0;
		const selOffsets = cursor.getRawSelection();

		const result = await pasteDispatch(
			{
				pastedText,
				targetPath: myPath,
				offset: selOffsets ? selOffsets.start : offset,
				preDelete: selOffsets ? { start: selOffsets.start, end: selOffsets.end } : undefined
			},
			{
				doc: getDoc(),
				blockEdit,
				controller
			}
		);

		// Land caret set and raw mutation in one reactive flush so the re-rendered block positions correctly.
		if (result.inlineCaretOffset !== undefined) {
			pendingCursorOffset = result.inlineCaretOffset;
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	function onClick(): void {
		cursor.clampOutOfAmbient();
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

	// ── Helpers ─────────────────────────────────────────────────────────

	function getSelectedTextFromRaw(): string {
		const offsets = cursor.getRawSelection();
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
	style:text-indent={ambientPrefix ? `-${ambientLength}ch` : null}
	style:padding-left={ambientPrefix ? `${ambientLength}ch` : null}
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
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
