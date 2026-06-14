<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions
	} from '../../action-contracts';
	import {
		type AmbientPrefix,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../block-component';
	import type { CstNode } from '../../core/nodes';
	import {
		BLOCK_COMPONENT_LOOKUP_KEY,
		BLOCK_EDIT_KEY,
		BLOCK_EL_LOOKUP_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		DOC_KEY,
		EDITOR_LIFETIME_KEY,
		EDITOR_ROOT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		IMAGE_LOAD_POLICY_KEY,
		LINK_REF_KEY,
		LIST_CONTEXT_KEY,
		PASTE_COORDINATOR_KEY,
		RESOLVE_IMAGE_URL_KEY,
		RESOLVE_LINK_URL_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		WIDGET_SELECTION_KEY,
		type BlockComponentLookup,
		type BlockElLookup,
		type DocumentGetter,
		type LinkReferenceResolverRef,
		type ResolveImageUrl,
		type ResolveLinkUrl,
		type WidgetSelectionState
	} from '../../editor-keys';
	import type { UndoController } from '../../editor-actions/deps';
	import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import { parseInline, getContentRange, isProseKind } from '../../core/inline';
	import type { LinkReferenceResolver } from '../../core/inline/link-reference-resolver';
	import { isLiveWidgetInline } from '../../core/inline/raw-html-widget';
	import { trimTrailingLineEnding } from '../../core/lines';
	import { hasSelection as hasSelectionHelper } from '../../cursor/cursor-utils';
	import { findOffsetNearestX } from '../../cursor/sticky-measure';
	import { toggleInlineFormat } from './text/format-toggle';
	import { cycleHeading, insertHardBreak, insertLiteralTab } from './text/text-keydown';
	import { createTextClipboard } from './text/text-clipboard';
	import { createTextRender } from './text/text-render';
	import { caretIsInTextContent } from './text/click-snap-guard';
	import {
		widgetAtCursor,
		findWidgetNodeByStart,
		findFirstEdgeWidget,
		findLastEdgeWidget,
		rawHasNoTextBefore,
		rawHasNoTextAfter
	} from './text/widget-adjacency';
	import { measurePartialRectsInContentEditable } from '../../cursor/overlay-rects';
	import {
		handleSharedKeydown,
		handleSharedBeforeInput,
		type SharedKeydownContext
	} from '../../selection/shared-keydown';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../selection/cross-block-dispatch';
	import {
		rawOffsetAtNode,
		rawTextOfNode,
		createRangeAtRawOffsets
	} from '../../cursor/widget-offset';
	import { ambientSpanOf } from '../../ambient/ambient-dom';
	import { createAmbientCursorIO } from '../../ambient/ambient-cursor';
	import { buildImageSourceBytes, type ImageFields } from '../image/image-source-bytes';
	import { eventToChord } from '../../schema/keybindings';
	import { dispatchKeyCommand, type CommandId } from '../../schema/commands';

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
	const getBlockComponentByPath = getContext<BlockComponentLookup>(BLOCK_COMPONENT_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const editorLifetime = getContext<AbortSignal | undefined>(EDITOR_LIFETIME_KEY);
	const resolveImageUrl = getContext<ResolveImageUrl>(RESOLVE_IMAGE_URL_KEY);
	const resolveLinkUrl = getContext<ResolveLinkUrl>(RESOLVE_LINK_URL_KEY);
	const imageLoadPolicy =
		getContext<() => import('../../core/inline-render').ImageLoadPolicy>(IMAGE_LOAD_POLICY_KEY);
	const widgetSelection = getContext<WidgetSelectionState>(WIDGET_SELECTION_KEY);
	const linkRef = getContext<LinkReferenceResolverRef | undefined>(LINK_REF_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	// Cursor position captured before each edit (keydown fires before DOM changes)
	let preEditOffset = 0;

	const ambientLength = $derived(ambientPrefixText.length);

	const cursor = createAmbientCursorIO({
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		getSnapTarget: () => lastSnapTargetOffset
	});

	const crossBlock = createCrossBlockHandlers({
		getEl: () => el ?? null,
		getMyPath: () => myPath,
		getIndex: () => index,
		selection,
		getDoc,
		getBlockElByPath,
		getBlockComponentByPath,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		history,
		pasteCoordinator,
		getCursorOffset: () => cursor.getRaw(),
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		},
		afterRawMutated: (targetNode) => {
			if (isProseKind(targetNode.kind)) {
				const range = getContentRange(targetNode);
				targetNode.inlineContent = parseInline(
					targetNode.raw,
					range.start,
					range.end,
					linkRef?.current
				);
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
		widgetSelection,
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => cursor.getRaw(),
		getFocusOffset: () => {
			if (!el) return null;
			const sel = window.getSelection();
			if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
			const content = rawOffsetAtNode(el, sel.focusNode, sel.focusOffset);
			return Math.max(0, content - ambientLength);
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
		getBlockElByPath,
		getBlockComponentByPath
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
		resolveLinkUrl,
		get imageLoadPolicy() {
			return imageLoadPolicy();
		},
		get myPath() {
			return myPath;
		},
		get linkResolver(): LinkReferenceResolver | undefined {
			return linkRef?.current;
		},
		get linkSignature(): string {
			return linkRef?.signature ?? '';
		}
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		cursor.setRaw(Math.max(0, offset));
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!el) return;
		el.focus();
		// minOffset = ambientLength keeps the scan out of the marker region.
		const contentOffset = findOffsetNearestX(el, x, from, ambientLength);
		cursor.setRaw(Math.max(0, contentOffset - ambientLength));
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
		const range = createRangeAtRawOffsets(el, ambientLength + start, ambientLength + end);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		return measurePartialRectsInContentEditable(
			el,
			ambientLength + startOffset,
			ambientLength + endOffset
		);
	}

	// True when the block's only inline content is image widgets — vertical
	// arrow traversal skips it because the widgets carry no column meaning.
	export function isVerticallyTransparent(): boolean {
		const inlines = node.inlineContent ?? [];
		if (inlines.length === 0) return false;
		for (const inline of inlines) {
			if (isLiveWidgetInline(inline, node.raw)) continue;
			if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
			return false;
		}
		return true;
	}

	export function selectEdgeWidget(side: 'start' | 'end'): boolean {
		const inlines = node.inlineContent ?? [];
		if (inlines.length === 0) return false;
		const target =
			side === 'start'
				? findFirstEdgeWidget(inlines, node.raw)
				: findLastEdgeWidget(inlines, node.raw);
		if (!target) return false;
		// Focus the contenteditable so subsequent key events route to this
		// block's keydown handler, where the widget-selected branch can run.
		el?.focus();
		// Cross-block entry: the caret arrived at the boundary the user was
		// stepping toward — start-side enters at target.start, end-side at
		// target.end. Anchors undo at the visual landing position.
		widgetSelection.select({
			paragraphPath: myPath,
			sourceStart: target.start,
			preSelectOffset: side === 'start' ? target.start : target.end
		});
		return true;
	}

	export function runCommand(id: CommandId, arg?: number): boolean {
		// Read the caret live: cross-block dispatch calls runCommand without an
		// onKeyDown to refresh preEditOffset, so it would be stale here.
		const offset = cursor.getRaw() ?? 0;
		switch (id) {
			case 'block.split':
				blockEdit.splitBlock(index, offset);
				return true;
			case 'block.hardBreak': {
				// GFM hard line break — trailing backslash before the newline.
				const { newRaw, caretOffset } = insertHardBreak(node.raw, offset);
				blockEdit.updateBlockContent(index, newRaw, offset);
				pendingCursorOffset = caretOffset;
				return true;
			}
			case 'block.insertTab': {
				// Inside a list item Tab is the list's indent — decline so it bubbles.
				if (listContext) return false;
				// Insert a literal tab; the browser default would move focus out of the editor.
				const { newRaw, caretOffset } = insertLiteralTab(node.raw, offset);
				blockEdit.updateBlockContent(index, newRaw, offset);
				pendingCursorOffset = caretOffset;
				return true;
			}
			case 'block.mergePrev':
				if (offset !== 0 || hasSelectionHelper()) return false;
				blockEdit.mergeWithPrevious(index);
				return true;
			case 'block.mergeNext':
				if (offset !== getDisplayText().length || hasSelectionHelper()) return false;
				blockEdit.mergeWithNext(index);
				return true;
			case 'format.toggleStrong':
				toggleFormat('strong');
				return true;
			case 'format.toggleEmphasis':
				toggleFormat('emphasis');
				return true;
			case 'heading.cycle': {
				// Replace any existing `#` prefix so repeated shortcuts cycle heading levels.
				const { newRaw, caretOffset } = cycleHeading(node.raw, arg ?? 0, offset);
				blockEdit.updateBlockContent(index, newRaw, offset, caretOffset);
				pendingCursorOffset = caretOffset;
				return true;
			}
			default:
				return false;
		}
	}

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		focusAtColumn,
		isVerticallyTransparent,
		selectEdgeWidget,
		runCommand
	} satisfies BlockComponent);

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

	// Asymmetric clearer: when the cursor moves to a position different from
	// the snap target, drop the synthetic indicator. Does NOT auto-set on
	// cursor reaching a boundary via non-click means — synthetic is
	// click-intent, only set by `snapClickToWidgetEdge`.
	$effect(() => {
		const root = el;
		if (!root) return;
		const handler = () => {
			if (lastSnapTargetOffset === null) return;
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return;
			const range = sel.getRangeAt(0);
			if (!root.contains(range.startContainer)) {
				lastSnapTargetOffset = null;
				return;
			}
			const content = rawOffsetAtNode(root, range.startContainer, range.startOffset);
			const off = Math.max(0, content - ambientLength);
			if (off !== lastSnapTargetOffset) {
				lastSnapTargetOffset = null;
			}
		};
		document.addEventListener('selectionchange', handler);
		return () => document.removeEventListener('selectionchange', handler);
	});

	$effect(() => {
		if (!el) return;
		for (const w of el.querySelectorAll('.md-snap-after, .md-snap-before')) {
			w.classList.remove('md-snap-after', 'md-snap-before');
		}
		if (lastSnapTargetOffset === null) return;
		const off = lastSnapTargetOffset;
		for (const inline of node.inlineContent ?? []) {
			if (!isLiveWidgetInline(inline, node.raw)) continue;
			if (inline.end !== off && inline.start !== off) continue;
			const widget = el.querySelector(`[data-inline-widget][data-source-start="${inline.start}"]`);
			if (widget) {
				widget.classList.add(inline.end === off ? 'md-snap-after' : 'md-snap-before');
			}
			return;
		}
	});

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		lastSnapTargetOffset = null;
		if (composing || !el) return;
		const text = readRawText();
		const savedRawOffset = cursor.getRaw() ?? 0;
		// preEdit drives the undo snapshot anchor; postEdit drives focus when typing
		// (e.g. `# `) triggers a kind change and the block remounts.
		blockEdit.updateBlockContent(index, text + '\n', preEditOffset, savedRawOffset);
		pendingCursorOffset = savedRawOffset;
	}

	// Walk children directly (rather than reading textContent) so stray text
	// nodes Chromium inserts around the marker span don't pollute the raw.
	function readRawText(): string {
		if (!el) return '';
		const ambient = ambientLength > 0 ? ambientSpanOf(el) : null;
		let out = '';
		for (const child of Array.from(el.childNodes)) {
			if (child === ambient) continue;
			out += rawTextOfNode(child, node.raw);
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

		preEditOffset = cursor.getRaw() ?? 0;

		// Widget-selected keys run before handleSharedKeydown: select() cleared the
		// native range, so getCursorOffset() reports 0 and would mis-trigger the
		// shared ArrowLeft boundary branch (moveFocus to a non-existent prior block).
		const selectedWidget = widgetSelection.getSelected();
		if (selectedWidget !== null) {
			const widget = findWidgetNodeByStart(
				selectedWidget.sourceStart,
				node.inlineContent,
				node.raw
			);
			const widgetIsHere =
				widget !== null && widgetSelection.isSelected(myPath, selectedWidget.sourceStart);
			if (widgetIsHere) {
				// Shift+Arrow runs before plain Arrow — `e.key === 'ArrowRight'` matches
				// both, so the shift check has to win or resize never fires.
				if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
					e.preventDefault();
					const inline = (node.inlineContent ?? []).find(
						(n) => n.kind === 'image' && n.start === widget.start
					);
					if (!inline || inline.kind !== 'image') return;

					const KEYBOARD_STEP = 20;
					const KEYBOARD_MIN_WIDTH = 32;
					const FALLBACK_DEFAULT_WIDTH = 400;

					const delta = e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP;
					const currentWidth = inline.width ?? FALLBACK_DEFAULT_WIDTH;
					const newWidth = Math.max(KEYBOARD_MIN_WIDTH, currentWidth + delta);

					const newFields: ImageFields = {
						alt: inline.alt ?? '',
						url: inline.url ?? '',
						...(inline.title !== undefined ? { title: inline.title } : {}),
						width: newWidth,
						...(inline.height !== undefined
							? { height: Math.round((newWidth / currentWidth) * inline.height) }
							: {})
					};
					const newBytes = buildImageSourceBytes(newFields);
					const newRaw = node.raw.slice(0, widget.start) + newBytes + node.raw.slice(widget.end);
					blockEdit.updateBlockContent(
						index,
						newRaw,
						selectedWidget.preSelectOffset,
						widget.start + newBytes.length
					);
					return;
				}
				if (e.key === 'ArrowLeft') {
					e.preventDefault();
					if (rawHasNoTextBefore(node.raw, widget.start)) {
						widgetSelection.clear();
						await focusActions.moveFocus(index - 1, 'end');
					} else {
						cursor.setRaw(widget.start);
						widgetSelection.clear();
					}
					return;
				}
				if (e.key === 'ArrowRight') {
					e.preventDefault();
					if (rawHasNoTextAfter(node.raw, widget.end)) {
						widgetSelection.clear();
						await focusActions.moveFocus(index + 1, 'start');
					} else {
						cursor.setRaw(widget.end);
						widgetSelection.clear();
					}
					return;
				}
				if (e.key === 'Backspace' || e.key === 'Delete') {
					e.preventDefault();
					const newRaw = node.raw.slice(0, widget.start) + node.raw.slice(widget.end);
					// Undo anchor at the pre-select caret position, not the far
					// widget boundary — Ctrl+Z restores the caret where the
					// user actually was when selection took over.
					blockEdit.updateBlockContent(index, newRaw, selectedWidget.preSelectOffset, widget.start);
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
					const newRaw = node.raw.slice(0, widget.start) + typed + node.raw.slice(widget.end);
					blockEdit.updateBlockContent(
						index,
						newRaw,
						selectedWidget.preSelectOffset,
						widget.start + typed.length
					);
					widgetSelection.clear();
					return;
				}
				return;
			}
		}

		// Shift+Arrow into a widget snaps focus to the far boundary atomically.
		// Native default with user-select:none on the widget collapses the
		// selection instead of stepping past it.
		if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && el) {
			const widgetExt = widgetExtensionTarget(e.key);
			if (widgetExt !== null) {
				e.preventDefault();
				extendSelectionToRaw(widgetExt);
				return;
			}
		}

		if (await handleSharedKeydown(e, sharedCtx)) return;

		// `caretInTextNode` is the load-bearing gate: Chromium inserts into
		// a text node natively, but drops printable keys at element-level
		// positions adjacent to a contenteditable=false widget.
		const effectiveOffset = cursor.getRaw();
		const caretInTextNode = (() => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return false;
			return sel.getRangeAt(0).startContainer.nodeType === Node.TEXT_NODE;
		})();

		if (effectiveOffset !== null) {
			const widgetAt = widgetAtCursor(effectiveOffset, node.inlineContent, node.raw);
			if (widgetAt) {
				if (!e.shiftKey && widgetAt.atRight && (e.key === 'ArrowLeft' || e.key === 'Backspace')) {
					e.preventDefault();
					lastSnapTargetOffset = null;
					widgetSelection.select({
						paragraphPath: myPath,
						sourceStart: widgetAt.start,
						preSelectOffset: widgetAt.end
					});
					return;
				}
				if (!e.shiftKey && !widgetAt.atRight && (e.key === 'ArrowRight' || e.key === 'Delete')) {
					e.preventDefault();
					lastSnapTargetOffset = null;
					widgetSelection.select({
						paragraphPath: myPath,
						sourceStart: widgetAt.start,
						preSelectOffset: widgetAt.start
					});
					return;
				}
				if (!caretInTextNode && isTypingKey(e)) {
					e.preventDefault();
					lastSnapTargetOffset = null;
					const typed = e.key;
					const newRaw =
						node.raw.slice(0, effectiveOffset) + typed + node.raw.slice(effectiveOffset);
					const postEdit = effectiveOffset + typed.length;
					blockEdit.updateBlockContent(index, newRaw, effectiveOffset, postEdit);
					// pendingCursorOffset re-anchors the caret after the rerender —
					// without it, the next keystroke teleports to div offset 0.
					pendingCursorOffset = postEdit;
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

		const chord = eventToChord(e);
		if (chord && dispatchKeyCommand(chord, { kind: node.kind, runCommand }, { history })) {
			e.preventDefault();
			return;
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

	// Click past a block-level widget drops the caret outside the contenteditable
	// (no text-node anchor); capture click X in pointerdown and snap to the
	// nearest widget edge in onClick.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;
	// Survives the click→keydown gap when Chromium clears the caret at
	// CE=false-adjacent positions. Reactive so the snap-caret overlay sees changes.
	let lastSnapTargetOffset = $state<number | null>(null);

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
		lastClickClientX = e.clientX;
		lastClickClientY = e.clientY;
		lastSnapTargetOffset = null;
	}

	function onBlur(e: FocusEvent): void {
		if (el && e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
		lastSnapTargetOffset = null;
	}

	function onClick(): void {
		const x = lastClickClientX;
		lastClickClientX = null;
		lastClickClientY = null;
		cursor.clampOutOfAmbient();
		snapClickToWidgetEdge(x);
	}

	function snapClickToWidgetEdge(clickX: number | null): void {
		lastSnapTargetOffset = null;
		if (!el || clickX === null) return;
		// Don't override a click that landed in a real text node — native
		// caret renders there and a synthetic overlay would compete.
		if (caretIsInTextContent(el, window.getSelection())) return;
		for (const inline of node.inlineContent ?? []) {
			if (!isLiveWidgetInline(inline, node.raw)) continue;
			const widget = el.querySelector(
				`[data-inline-widget][data-source-start="${inline.start}"]`
			) as HTMLElement | null;
			if (!widget) continue;
			const rect = widget.getBoundingClientRect();
			if (clickX > rect.right) {
				el.focus();
				cursor.setRaw(inline.end);
				// `setRaw`'s walker may have landed the caret in a trailing
				// text node — in that case native renders, no synthetic needed.
				if (!caretIsInTextContent(el, window.getSelection())) {
					lastSnapTargetOffset = inline.end;
				}
				return;
			}
			if (clickX < rect.left) {
				el.focus();
				cursor.setRaw(inline.start);
				if (!caretIsInTextContent(el, window.getSelection())) {
					lastSnapTargetOffset = inline.start;
				}
				return;
			}
		}
	}

	// ── Widget adjacency ───────────────────────────────────────────────

	function widgetExtensionTarget(key: 'ArrowRight' | 'ArrowLeft'): number | null {
		if (!el) return null;
		const sel = window.getSelection();
		if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
		const content = rawOffsetAtNode(el, sel.focusNode, sel.focusOffset);
		const focus = Math.max(0, content - ambientLength);
		for (const inline of node.inlineContent ?? []) {
			if (inline.kind !== 'image') continue;
			if (key === 'ArrowRight' && focus >= inline.start && focus < inline.end) {
				return inline.end;
			}
			if (key === 'ArrowLeft' && focus > inline.start && focus <= inline.end) {
				return inline.start;
			}
		}
		return null;
	}

	function extendSelectionToRaw(rawOffset: number): void {
		if (!el) return;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const target = ambientLength + rawOffset;
		const range = createRangeAtRawOffsets(el, target, target);
		if (!range) return;
		sel.extend(range.endContainer, range.endOffset);
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
	onblur={onBlur}
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
