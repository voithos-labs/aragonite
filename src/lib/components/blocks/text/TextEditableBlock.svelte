<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions
	} from '../../../action-contracts';
	import { type AmbientPrefix, type BlockComponent } from '../../../block-component';
	import type { CstNode, Document } from '../../../core/nodes';
	import { emitCommandError, type EditorEvents } from '../../../editor-events';
	import {
		BLOCK_EDIT_KEY,
		BLOCK_EL_LOOKUP_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		BROKEN_IMAGE_URLS_KEY,
		DECORATIONS_KEY,
		DOC_KEY,
		EDITOR_EVENTS_KEY,
		EDITOR_LIFETIME_KEY,
		EDITOR_ROOT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		IMAGE_LOAD_POLICY_KEY,
		KEYBINDING_OVERRIDES_KEY,
		LINK_REF_KEY,
		LIST_CONTEXT_KEY,
		PASTE_COORDINATOR_KEY,
		PLUGIN_EDITOR_KEY,
		REORDER_ACTION_KEY,
		RESOLVE_IMAGE_URL_KEY,
		RESOLVE_LINK_URL_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		WIDGET_SELECTION_KEY,
		type BlockElLookup,
		type DocumentGetter,
		type KeybindingOverridesGetter,
		type LinkReferenceResolverRef,
		type PluginEditorLookup,
		type ResolveImageUrl,
		type ResolveLinkUrl
	} from '../../../editor-keys';
	import type { ReorderAction } from '../../../editor-actions/reorder-action';
	import type { IndexedDecoration } from '../../../decorations/buckets';
	import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
	import type { DecorationEngine } from '../../../reactivity/decoration-state.svelte';
	import type { WidgetSelectionState } from '../../image/widget-selection-state.svelte';
	import type { UndoController } from '../../../editor-actions/deps';
	import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '../../../cursor/sticky-column';
	import { isProseKind } from '../../../core/inline';
	import { getInlineContent } from '../../../core/inline/inline-cache';
	import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
	import { isInlineWidget } from '../../../core/inline/inline-widgets';
	import { trimTrailingLineEnding } from '../../../core/lines';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import { toggleInlineFormat } from './format-toggle';
	import { cycleHeading, insertHardBreak, insertLiteralTab } from './text-keydown';
	import { createTextClipboard } from './text-clipboard';
	import { createTextRender } from './text-render';
	import { createWidgetInteraction } from './widget-interaction';
	import { createDecorationIslandKeys } from './decoration-island-keys';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import type { SelectionState } from '../../../selection/selection-state.svelte';
	import { createEditableSurface } from '../editable-surface';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import {
		rawOffsetAtNode,
		rawTextOfNode,
		createRangeAtRawOffsets
	} from '../../../cursor/widget-offset';
	import { ambientSpanOf } from '../../../ambient/ambient-dom';
	import { asRawOffset, toDomTextOffset } from '../../../cursor/coordinate-spaces';
	import { createAmbientCursorIO } from '../../../ambient/ambient-cursor';
	import { eventToChord } from '../../../schema/keybindings';
	import { type CommandId } from '../../../schema/commands';
	import { dispatchKeyCommand, type CommandErrorSink } from '../../../schema/block-commands';
	import {
		perfEnabled,
		recordBlockRender,
		markKeystrokeStart,
		markKeystrokeSettle
	} from '../../../perf/instruments';

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
		// Accepted for BlockComponentProps parity — BlockHost passes `document` to
		// every block uniformly; this surface reads the doc from DOC_KEY, so the prop
		// stays unbound (binding it would shadow the global `document` used below).
		document?: Document;
	} = $props();

	const ambientPrefixText = $derived(
		typeof ambientPrefix === 'string' ? ambientPrefix : ambientPrefix.text
	);

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const reorder = getContext<ReorderAction>(REORDER_ACTION_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const pasteCoordinator = getContext<PasteCommitCoordinator>(PASTE_COORDINATOR_KEY);
	// Present when this paragraph sits inside a list item — used to skip
	// Tab handling in prose (the enclosing ListItemBlock owns Tab-as-indent).
	const listContext = getContext(LIST_CONTEXT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const keybindingOverrides = getContext<KeybindingOverridesGetter>(KEYBINDING_OVERRIDES_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const editorLifetime = getContext<AbortSignal | undefined>(EDITOR_LIFETIME_KEY);
	const resolveImageUrl = getContext<ResolveImageUrl>(RESOLVE_IMAGE_URL_KEY);
	const resolveLinkUrl = getContext<ResolveLinkUrl>(RESOLVE_LINK_URL_KEY);
	const imageLoadPolicy =
		getContext<() => import('../../../core/inline-render').ImageLoadPolicy>(IMAGE_LOAD_POLICY_KEY);
	const brokenUrlCache = getContext<Set<string>>(BROKEN_IMAGE_URLS_KEY);
	const widgetSelection = getContext<WidgetSelectionState>(WIDGET_SELECTION_KEY);
	const editorEvents = getContext<EditorEvents | undefined>(EDITOR_EVENTS_KEY);
	const pluginEditor = getContext<PluginEditorLookup | undefined>(PLUGIN_EDITOR_KEY);
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	const linkRef = getContext<LinkReferenceResolverRef | undefined>(LINK_REF_KEY);
	// Absent in bare unit harnesses; the constant fallback keeps the zero-cost
	// render path (an empty island set never enters the render key).
	const decorationEngine = getContext<DecorationEngine | undefined>(DECORATIONS_KEY);
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	// True while an inline-widget's `$…$` source is revealed for editing: the edit
	// is ephemeral DOM, so onInput (and IME compositionend) skip the per-keystroke
	// CST commit — the block commits once on reveal exit.
	let revealing = $state(false);
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

	const editableSurface = createEditableSurface({
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		isInputSuppressed: () => revealing,
		backend: {
			getRaw: () => cursor.getRaw(),
			setRaw: (offset) => cursor.setRaw(offset),
			buildRange: (start, end) =>
				createRangeAtRawOffsets(
					el!,
					toDomTextOffset(start, ambientLength),
					toDomTextOffset(end, ambientLength)
				)
		},
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		getPreEditOffset: () => preEditOffset,
		setPreEditOffset: (offset) => {
			preEditOffset = offset;
		},
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		},
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		history,
		pluginEditor,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		getFocusOffset: () => {
			if (!el) return null;
			const sel = window.getSelection();
			if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
			const content = rawOffsetAtNode(el, sel.focusNode, sel.focusOffset);
			return Math.max(0, content - ambientLength);
		},
		getTextLen: () => getDisplayText().length,
		readText: () => readRawText(),
		commitInput: (text, preEdit, saved) =>
			blockEdit.updateBlockContent(index, text + '\n', preEdit, saved),
		inputPrelude: () => {
			markKeystrokeStart();
			lastSnapTargetOffset = null;
		}
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

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
		},
		get linkRef() {
			return linkRef;
		}
	});

	const widgetInteraction = createWidgetInteraction({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get myPath() {
			return myPath;
		},
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		getEditorContentWidth: () => getEditorRoot()?.clientWidth ?? 800,
		cursor,
		widgetSelection,
		blockEdit,
		focusActions,
		getSnapTarget: () => lastSnapTargetOffset,
		setSnapTarget: (offset) => {
			lastSnapTargetOffset = offset;
		},
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		},
		readRawText: () => readRawText(),
		setRevealing: (value) => {
			revealing = value;
		},
		isCrossBlock: () => selection.isCrossBlock,
		get linkRef() {
			return linkRef;
		}
	});

	const decorationIslandKeys = createDecorationIslandKeys({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		getEl: () => el ?? null,
		getRawSelection: () => cursor.getRawSelection(),
		blockEdit,
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

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
		get linkResolver(): LinkReferenceResolver | undefined {
			return linkRef?.current;
		},
		get linkSignature(): string {
			return linkRef?.signature ?? '';
		},
		get islands() {
			return decorationEngine ? decorationEngine.islandsForPath(myPath) : NO_ISLANDS;
		},
		brokenUrlCache,
		reportRenderError: (error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } })
	});

	// Destroy the block's pooled widget instances when it unmounts (windowed out or
	// document swap). Mirrors the parkFocus cleanup below: an effect cleanup fires on
	// teardown, the seam block unmount reliably reaches.
	$effect(() => () => textRender.dispose());

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = editableSurface.surface.focus;
	export const focusAtColumn = editableSurface.surface.focusAtColumn;
	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	export function isVerticallyTransparent(): boolean {
		return widgetInteraction.isVerticallyTransparent();
	}

	export function enterEdgeWidget(side: 'start' | 'end'): boolean {
		return widgetInteraction.enterEdgeWidget(side);
	}

	export function runCommand(id: CommandId, arg?: unknown): boolean {
		// Read the caret live: cross-block dispatch calls runCommand without an
		// onKeyDown to refresh preEditOffset, so it would be stale here.
		const offset = cursor.getRaw() ?? 0;
		switch (id) {
			case 'block.split':
				blockEdit.splitBlock(index, offset);
				return true;
			case 'chrome.descendToBody':
				blockEdit.descendToBody(index);
				return true;
			case 'block.hardBreak': {
				const { newRaw, caretOffset } = insertHardBreak(node.raw, offset);
				blockEdit.updateBlockContent(index, newRaw, offset);
				pendingCursorOffset = caretOffset;
				return true;
			}
			case 'block.insertTab': {
				// Inside a list item Tab is the list's indent — decline so it bubbles.
				if (listContext) return false;
				// A literal tab, because the browser default moves focus out of the editor.
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
				// `arg` arrives as untrusted `unknown` from the widened keybinding channel;
				// accept only an in-range level (0 strips to paragraph, 1–6 sets an ATX
				// level). A non-number or out-of-range value would coerce wrong or throw a
				// RangeError inside `#`.repeat, so fall back to the strip behavior.
				const level = typeof arg === 'number' && arg >= 0 && arg <= 6 ? arg : 0;
				const { newRaw, caretOffset } = cycleHeading(node.raw, level, offset);
				blockEdit.updateBlockContent(index, newRaw, offset, caretOffset);
				pendingCursorOffset = caretOffset;
				return true;
			}
			case 'block.moveUp':
				reorder.nudgeReorderUnit(myPath, -1);
				return true;
			case 'block.moveDown':
				reorder.nudgeReorderUnit(myPath, 1);
				return true;
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
		enterEdgeWidget,
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

		const t0 = perfEnabled() ? performance.now() : 0;
		textRender.render({ forceRebuild: pendingCursorOffset !== null });
		if (perfEnabled()) recordBlockRender(performance.now() - t0, myPath);

		if (pendingCursorOffset !== null) {
			// Restore the caret only while this block still owns focus. A blur-commit
			// (revealed source persisted as focus leaves) also sets a pending offset;
			// without this guard the restore would yank the global selection back into
			// the just-blurred block. Mirrors the activeElement guards in ambient-cursor.
			if (document.activeElement === el) cursor.setRaw(asRawOffset(pendingCursorOffset));
			pendingCursorOffset = null;
		}
		markKeystrokeSettle();
	});

	// Windowed out while focused: hand focus to the editor root so the next
	// keystroke routes through its document-level listener instead of falling to
	// <body>. See parkFocusOnEditorRoot.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
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
		for (const inline of getInlineContent(node, linkRef?.current, linkRef?.signature ?? '')) {
			if (!isInlineWidget(inline, node.raw)) continue;
			if (inline.end !== off && inline.start !== off) continue;
			const widget = el.querySelector(`[data-inline-widget][data-source-start="${inline.start}"]`);
			if (widget) {
				widget.classList.add(inline.end === off ? 'md-snap-after' : 'md-snap-before');
			}
			return;
		}
	});

	// ── Event Handlers ──────────────────────────────────────────────────

	const onInput = editableSurface.onInput;

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

	const onCompositionStart = editableSurface.onCompositionStart;
	const onCompositionEnd = editableSurface.onCompositionEnd;

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;

		preEditOffset = cursor.getRaw() ?? 0;

		// Revealed `$…$` source: Escape cancels back to rendered, Enter commits +
		// re-renders. Every other key edits the source natively (onInput suppressed).
		if (await widgetInteraction.handleRevealingKeydown(e)) return;

		// Widget-selected keys run before handleSharedKeydown: select() cleared the
		// native range, so getCursorOffset() reports 0 and would mis-trigger the
		// shared ArrowLeft boundary branch (moveFocus to a non-existent prior block).
		if (await widgetInteraction.handleSelectedWidgetKeydown(e)) return;

		// Shift+Arrow into a widget snaps focus to the far boundary atomically.
		// Native default with user-select:none on the widget collapses the
		// selection instead of stepping past it.
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		if (widgetInteraction.handleWidgetAtCursorKeydown(e, cursor.getRaw())) return;

		// Decoration islands are view-only ([data-decoration-island]) and invisible to
		// the CST-widget path above; this keeps an edge Backspace/Delete from letting
		// native contenteditable silently eat a replace island's hidden bytes.
		if (decorationIslandKeys.handleKeydown(e, cursor.getRaw())) return;

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
		if (
			chord &&
			dispatchKeyCommand(
				chord,
				{ kind: node.kind, runCommand },
				{ history, pluginEditor },
				keybindingOverrides(),
				onCommandError
			)
		) {
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
	// (no text-node anchor); capture the click point in pointerdown and snap to the
	// nearest widget edge in onClick. Y is load-bearing for the reveal hit-test — a
	// column-aligned click on another visual line must not reveal a widget.
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
		// A press on a reveal-source widget is an owned gesture: suppress the
		// browser's caret-placement default so the only selection writer between
		// here and the reveal's own placement is the reveal itself. Click still
		// fires; snapClickToWidgetEdge dispatches the reveal from it.
		if (widgetInteraction.isPointOnRevealWidget(e.clientX, e.clientY)) e.preventDefault();
	}

	function onBlur(e: FocusEvent): void {
		if (el && e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
		// Focus left the block with source still revealed — persist the edit before
		// the caret is gone.
		widgetInteraction.commitRevealOnBlur();
		lastSnapTargetOffset = null;
	}

	// While a widget's source is revealed, a caret/selection move that escapes it —
	// same-block clicks, arrow-exits — folds the reveal. Blur keeps owning the
	// focus-leaving fold; a mid-IME selection move must not commit, so composition
	// suppresses the fold like it suppresses onInput.
	$effect(() => {
		const root = el;
		if (!root) return;
		const handler = () => {
			if (composing) return;
			widgetInteraction.foldRevealIfSelectionEscaped();
		};
		document.addEventListener('selectionchange', handler);
		return () => document.removeEventListener('selectionchange', handler);
	});

	function onClick(): void {
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		cursor.clampOutOfAmbient();
		widgetInteraction.snapClickToWidgetEdge(x, y);
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
		color: var(--color-ui-dulled, #afb1b3);
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
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		opacity: 0.85;
	}

	.text-editable-block :global(.md-marker) {
		opacity: var(--syntax-marker-dim, 0.4);
		font-weight: normal;
		font-style: normal;
	}

	.text-editable-block :global(.inline-code-content) {
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border-radius: 3px;
		padding: 1px 4px;
	}

	.text-editable-block :global(.md-autolink) {
		color: var(--syntax-url, var(--color-accent, #567b67));
		text-decoration: underline;
	}
</style>
