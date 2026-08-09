<script lang="ts">
	import { DEV } from 'esm-env';
	import { getContext, tick, untrack } from 'svelte';
	import type { BlockEditActions, FocusActions, HistoryActions } from '../../../action-contracts';
	import { type AmbientPrefix, type BlockComponent } from '../../../block-component';
	import type { DocumentView, NodeView } from '../../../core/node-views';
	import type { EditorRects } from '../../../editor-rects';
	import { emitCommandError } from '../../../editor-events';
	import { enterLinkCardAtCaret } from '../../link-card/link-card-entry';
	import {
		BLOCK_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		LIST_CONTEXT_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import type { IndexedDecoration } from '../../../decorations/buckets';
	import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
	import { getContentRange, isProseKind } from '../../../core/inline';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
	import { isInlineWidget } from '../../../core/inline/inline-widgets';
	import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import { FALLBACK_CONTENT_WIDTH } from '../../../cursor/typography-estimates';
	import { toggleInlineFormat } from './format-toggle';
	import type { InlineMarkKind } from '../../../cursor/pending-marks';
	import {
		cycleHeading,
		demoteToParagraph,
		insertHardBreak,
		insertLiteralTab,
		type TextEditResult
	} from './text-keydown';
	import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
	import { createTextClipboard } from './text-clipboard';
	import { createTextRender } from './text-render';
	import { createWidgetInteraction } from './widget-interaction';
	import { createEdgePolicyDispatch } from './edge-policy-dispatch';
	import { hidesStructuralSuffix } from './hidden-suffix';
	import { resolveSelectionEdit } from './live-selection-edit';
	import { createCompositionSeat } from './composition-seat';
	import { createConstructReveal } from './construct-reveal';
	import { assertInvariant } from '../../../invariants/assert';
	import { widgetElByStart } from './widget-adjacency';
	import {
		caretLandableBounds,
		handleSharedKeydown,
		handleSharedBeforeInput
	} from '../../../selection/shared-keydown';
	import { createEditableSurface, consumePendingRestore } from '../editable-surface';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import {
		domTextOffsetAtNode,
		rawTextOfNode,
		createRangeAtDomTextOffsets,
		revealsNoMarkers
	} from '../../../cursor/widget-offset';
	import { ambientSpanOf } from '../../../ambient/ambient-dom';
	import {
		asRawOffset,
		toClampedRawOffset,
		toDomTextOffset
	} from '../../../cursor/coordinate-spaces';
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
	import {
		tracePendingCursorSet,
		tracePendingCursorConsume
	} from '../../../debug/interaction-trace';

	let {
		node,
		index,
		myPath = [],
		blockClass = 'paragraph-block',
		ambientPrefix = ''
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		blockClass?: string;
		ambientPrefix?: AmbientPrefix;
		// Accepted for BlockComponentProps parity: this surface reads the doc from the
		// document facet, and binding would shadow the global `document`.
		document?: DocumentView;
		// Accepted for BlockComponentProps parity; this surface navigates through the
		// editor, not the rect seam.
		rects?: EditorRects;
	} = $props();

	const ambientPrefixText = $derived(
		typeof ambientPrefix === 'string' ? ambientPrefix : ambientPrefix.text
	);

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	// Present inside a list item, whose ListItemBlock owns Tab-as-indent.
	const listContext = getContext(LIST_CONTEXT_KEY);
	const {
		reorder,
		controller,
		pasteCoordinator,
		stickyColumn,
		edgeAffinity,
		pendingMarks,
		selection,
		widgetSelection,
		linkCard,
		registryView,
		events: editorEvents,
		decorations: decorationEngine
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy,
		brokenImageUrls: brokenUrlCache,
		presentationMode: getPresentationMode,
		theme: getTheme,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		contentVersion: getContentVersion,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);

	const linkCardQuery = () => ({
		contentEl: el!,
		block: node,
		path: myPath,
		linkRef,
		card: linkCard,
		mode: presentationMode
	});
	const enterLinkCard = () => {
		if (el) enterLinkCardAtCaret(linkCardQuery());
	};
	// A constant fallback keeps an empty island set out of the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	// A revealed widget source is ephemeral DOM, so onInput and IME compositionend skip
	// the per-keystroke CST commit and the block commits once on reveal exit.
	let revealing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	// Captured before each edit; keydown fires before the DOM changes.
	let preEditOffset = 0;
	// Survives the click→keydown gap when Chromium clears the caret at CE=false-adjacent
	// positions. Reactive so the snap-caret overlay sees changes.
	let lastSnapTargetOffset = $state<number | null>(null);

	// One funnel for every pending-cursor write, tagged so the interaction trace names
	// which gesture set the restore; the render effect owns the consume half.
	function setPendingCursorOffset(offset: number | null, source: string): void {
		tracePendingCursorSet(source, offset);
		pendingCursorOffset = offset;
	}

	const ambientLength = $derived(ambientPrefixText.length);

	const cursor = createAmbientCursorIO({
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		getSnapTarget: () => lastSnapTargetOffset
	});

	const editableSurface = createEditableSurface({
		linkRef,
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		isInputSuppressed: () => revealing,
		backend: {
			getRaw: () => cursor.getRaw(),
			setRaw: (offset) => cursor.setRaw(offset),
			buildRange: (start, end) =>
				createRangeAtDomTextOffsets(
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
		setPendingCursor: (offset) => setPendingCursorOffset(offset, 'surface'),
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		getEditorRoot,
		getScrollHost,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode: () => presentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		grammar: registryView.grammar,
		events: editorEvents,
		getFocusOffset: () => {
			if (!el) return null;
			const sel = window.getSelection();
			if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
			const content = domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
			return toClampedRawOffset(content, ambientLength);
		},
		getTextLen: () => liveDisplayLength(),
		readText: () => readRawText(),
		relocateComposedText: (after, composedAt) => compositionSeat.relocate(after, composedAt),
		commitInput: (text, preEdit, saved) => {
			const committed = text + trailingLineEnding(node.raw);
			void blockEdit.updateBlockContent(index, committed, preEdit, saved);
			// An enclosing container may rewrite these bytes on the way in, so the caret
			// restore reads the image of the write, not the offset the keystroke produced.
			return blockEdit.mapCommittedOffset?.(committed, saved);
		},
		inputPrelude: () => {
			markKeystrokeStart();
			lastSnapTargetOffset = null;
		}
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

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
		getEditorContentWidth: () => getEditorRoot()?.clientWidth ?? FALLBACK_CONTENT_WIDTH,
		cursor,
		widgetSelection,
		blockEdit,
		focusActions,
		setSnapTarget: (offset) => {
			lastSnapTargetOffset = offset;
		},
		setPendingCursor: (offset) => setPendingCursorOffset(offset, 'widget'),
		readRawText: () => readRawText(),
		setRevealing: (value) => {
			revealing = value;
		},
		isCrossBlock: () => selection.isCrossBlock,
		getPresentationMode: () => presentationMode,
		get linkRef() {
			return linkRef;
		}
	});

	// After widgetInteraction, whose fold seam a clipboard mutation runs before it
	// touches the CST.
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
		caret: editableSurface.caret,
		crossBlock,
		selection,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		pasteCoordinator,
		getDoc,
		widgetSelection,
		events: editorEvents,
		onPasteImage,
		setPendingCursor: (offset) => setPendingCursorOffset(offset, 'clipboard'),
		isReadOnly: () => readOnly,
		foldRevealBeforeMutation: () => widgetInteraction.foldRevealBeforeMutation(),
		isRevealing: () => widgetInteraction.isRevealing(),
		getPresentationMode: () => presentationMode,
		readRevealedText: () => readRawText(),
		get linkRef() {
			return linkRef;
		}
	});

	// preview-inline's marker reveal: CSS class flips only, no keys intercepted.
	const constructReveal = createConstructReveal({
		get node() {
			return node;
		},
		get linkRef() {
			return linkRef;
		},
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		getPresentationMode: () => presentationMode,
		isCrossBlock: () => selection.isCrossBlock
	});

	// The one caret-edge dispatch (G4.12); entry execution stays at
	// `widgetInteraction.enterWidget`.
	const edgeDispatch = createEdgePolicyDispatch({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get linkRef() {
			return linkRef;
		},
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		hasIslands: () =>
			decorationEngine ? decorationEngine.islandsForPath(myPath).length > 0 : false,
		getRawSelection: () => cursor.getRawSelection(),
		blockEdit,
		setPendingCursor: (offset, source) => setPendingCursorOffset(offset, source),
		setSnapTarget: (offset) => {
			lastSnapTargetOffset = offset;
		},
		isRevealing: () => widgetInteraction.isRevealing(),
		enterWidget: (widget, fromTrailingEdge) =>
			widgetInteraction.enterWidget(widget, fromTrailingEdge),
		isReading: () => readOnly,
		getEdgeAffinity: () => edgeAffinity.get(),
		pendingMarks
	});

	// The same seat the keydown dispatch takes, for the one insertion a keydown cannot reach.
	const compositionSeat = createCompositionSeat({
		getDisplayText: () => getDisplayText(),
		getInlines: () => resolvedInlineContent(node, linkRef),
		getAffinity: () => edgeAffinity.get(),
		consumePendingMarks: () => pendingMarks.consume()
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
		get presentationMode() {
			return presentationMode;
		},
		getTheme,
		getDocument: () => getDoc(),
		getContentVersion,
		get linkResolver(): LinkReferenceResolver | undefined {
			return linkRef?.current;
		},
		get linkStamp(): string {
			return String(linkRef?.epoch ?? 0);
		},
		get islands() {
			return decorationEngine ? decorationEngine.islandsForPath(myPath) : NO_ISLANDS;
		},
		brokenUrlCache,
		reportRenderError: (error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } })
	});

	$effect(() => () => textRender.dispose());

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = editableSurface.surface.focus;
	export const parkCaret = editableSurface.surface.parkCaret;
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

	export const claimRootClipboard = clipboardHandlers.claimRootClipboard;

	export function snapCaretToPoint(clientX: number, clientY: number): void {
		widgetInteraction.snapClickToWidgetEdge(clientX, clientY);
	}

	/** The display length the CARET walks — the DOM's while a reveal is open, since the
	 *  CST hasn't seen that edit. Against a stale `node.raw`, an edited reveal at the
	 *  block's end traps the caret: no press reads as "at the boundary". */
	function liveDisplayLength(): number {
		return widgetInteraction.isRevealing() ? readRawText().length : getDisplayText().length;
	}

	/** The offsets a caret can reach here, from the one home the arrow exits already read: a mode
	 *  that paints no marker puts the block's own bytes out of reach, so every block-edge gate
	 *  moves in to what the DOM can land rather than testing 0 / length. */
	function caretBounds(): { start: number; end: number } {
		return el ? caretLandableBounds(sharedCtx, el) : { start: 0, end: liveDisplayLength() };
	}

	/** The structural bytes this press gives up before any merge — a declared kind's, in a mode
	 *  that paints none of them. Null everywhere else, and the cascade takes the press. */
	function demoteBeforeMerge(offset: number): TextEditResult | null {
		if (!el || !revealsNoMarkers(el)) return null;
		if (tryGetBlockKindDescriptor(node.kind)?.contentStartBackspace !== 'demote-first') return null;
		return demoteToParagraph(node.raw, getContentRange(node), offset);
	}

	/** One arm per command this block owns, split so the reveal fold sits between the
	 *  halves: `applies` reads only the DOM and survives a fold, `perform` reads `node.raw`
	 *  and is valid only after one. `offset`/`selected` are closed over: the fold moves them. */
	function blockCommand(
		id: CommandId,
		arg: unknown,
		offset: number,
		selected: { start: number; end: number } | null
	): { applies: () => boolean; perform: () => void } | null {
		const always = (perform: () => void) => ({ applies: () => true, perform });
		switch (id) {
			case 'block.split':
				return always(() => blockEdit.splitBlock(index, offset));
			case 'chrome.descendToBody':
				return always(() => blockEdit.descendToBody(index));
			case 'block.hardBreak':
				return always(() => {
					const { newRaw, caretOffset } = insertHardBreak(node.raw, offset);
					blockEdit.updateBlockContent(index, newRaw, offset);
					setPendingCursorOffset(caretOffset, 'hard-break');
				});
			case 'block.insertTab':
				return {
					// Inside a list item Tab is the list's indent, so decline and let it bubble.
					applies: () => !listContext,
					// A literal tab, because the browser default moves focus out of the editor.
					perform: () => {
						const { newRaw, caretOffset } = insertLiteralTab(node.raw, offset);
						blockEdit.updateBlockContent(index, newRaw, offset);
						setPendingCursorOffset(caretOffset, 'insert-tab');
					}
				};
			case 'block.mergePrev':
				return {
					// At-or-before, not equal: a caret door can still park on an offset the walk
					// canonicalizes forward, and a strict test would make the press a dead key there.
					applies: () => offset <= caretBounds().start && !hasSelectionHelper(),
					perform: () => {
						const demoted = demoteBeforeMerge(offset);
						if (!demoted) return void blockEdit.mergeWithPrevious(index);
						// A command is not typing: the demote is its own undo step, so one Ctrl+Z puts
						// the heading back whole rather than unwinding the burst around it.
						controller.isolateUndoEntry(() =>
							blockEdit.updateBlockContent(index, demoted.newRaw, offset, demoted.caretOffset)
						);
						setPendingCursorOffset(demoted.caretOffset, 'demote');
					}
				};
			case 'block.mergeNext':
				return {
					// A block whose own structure sits AFTER its content cannot absorb the next one
					// without surfacing it (§ 4.5). The keydown dispatch consumes that press; this is
					// the same rule for the callers that never pass through it.
					applies: () =>
						offset >= caretBounds().end &&
						!hasSelectionHelper() &&
						!hidesStructuralSuffix(el ?? null, node, liveDisplayLength()),
					perform: () => void blockEdit.mergeWithNext(index)
				};
			case 'format.toggleStrong':
				return always(() => toggleFormat('strong', selected ?? { start: offset, end: offset }));
			case 'format.toggleEmphasis':
				return always(() => toggleFormat('emphasis', selected ?? { start: offset, end: offset }));
			case 'format.toggleStrikethrough':
				return always(() =>
					toggleFormat('strikethrough', selected ?? { start: offset, end: offset })
				);
			case 'format.toggleCode':
				return always(() => toggleFormat('inlineCode', selected ?? { start: offset, end: offset }));
			case 'link.openCard':
				// Consumed wherever the keymap binds it, entry or not: `reservedChords()` reports
				// Mod+K as the editor's, and handing an unentered press back fires the browser
				// default the host was told not to expect (Ctrl+K kills to end of line here).
				return always(enterLinkCard);
			case 'heading.cycle':
				return always(() => {
					// `arg` is untrusted `unknown` from the widened keybinding channel: an
					// out-of-range value would throw a RangeError inside `repeat`, so fall
					// back to the strip behavior.
					const level = typeof arg === 'number' && arg >= 0 && arg <= 6 ? arg : 0;
					const { newRaw, caretOffset } = cycleHeading(node.raw, level, offset);
					blockEdit.updateBlockContent(index, newRaw, offset, caretOffset);
					setPendingCursorOffset(caretOffset, 'heading-cycle');
				});
			case 'block.moveUp':
				return always(() => reorder.nudgeReorderUnit(myPath, -1));
			case 'block.moveDown':
				return always(() => reorder.nudgeReorderUnit(myPath, 1));
			default:
				return null;
		}
	}

	export function runCommand(id: CommandId, arg?: unknown): boolean {
		// Read live: cross-block dispatch arrives with no preceding onKeyDown, so
		// `preEditOffset` would be stale here.
		const offset = cursor.getRaw() ?? 0;
		const command = blockCommand(id, arg, offset, cursor.getRawSelection());
		if (!command || !command.applies()) return false;
		if (!widgetInteraction.isRevealing()) {
			performBlockCommand(id, command.perform);
			return true;
		}
		// A live reveal holds this block's bytes in ephemeral DOM, so every `perform` would
		// splice the pre-reveal source: fold, settle, then act. The fold is handed the user's
		// offset, valid because the committed text IS the DOM text it was measured against.
		const fold = widgetInteraction.foldRevealBeforeMutation(offset);
		void (fold?.settled ?? tick()).then(() => performBlockCommand(id, command.perform));
		return true;
	}

	// No arm reached through here mutates while a reveal is open (G1.26): a fire means a
	// `runCommand` branch that skipped the fold. It guards the arms, not every entry path
	// — a caller reaching `blockEdit` directly sees neither the fold nor this (issue #35).
	function performBlockCommand(id: CommandId, perform: () => void): void {
		assertInvariant('reveal-transition', () =>
			widgetInteraction.isRevealing()
				? { code: 'command-during-reveal', message: `${id} mutated the block with a reveal open` }
				: null
		);
		perform();
	}

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		focusAtColumn,
		isVerticallyTransparent,
		enterEdgeWidget,
		claimRootClipboard,
		snapCaretToPoint,
		runCommand
	} satisfies BlockComponent);

	// ── Content sync ──────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (DEV && ambientPrefixText && !isProseKind(node.kind)) {
			console.warn(
				`[TextEditableBlock] ambientPrefix is prose-only; non-prose kind ${node.kind} received a non-empty ambient prefix. The ambient marker will not render correctly.`
			);
		}

		const t0 = perfEnabled() ? performance.now() : 0;
		// With a pending restore armed, the consume below overwrites the selection, so the
		// render's own caret walk would be dead work.
		textRender.render({
			forceRebuild: pendingCursorOffset !== null,
			carryCaret: pendingCursorOffset === null
		});
		if (perfEnabled()) recordBlockRender(performance.now() - t0, myPath);

		if (pendingCursorOffset !== null) {
			// Only while this block still owns focus: a blur-commit also arms a pending
			// offset, and restoring would yank the selection back into the blurred block.
			// The clear runs regardless, so a skipped restore is dropped, never re-armed.
			const applied = consumePendingRestore(el ?? null, pendingCursorOffset, (offset) =>
				cursor.setRaw(asRawOffset(offset))
			);
			tracePendingCursorConsume(pendingCursorOffset, applied);
			pendingCursorOffset = null;
		}
		// A rebuild mints fresh spans with no reveal class, so re-apply before paint or
		// typing inside a revealed construct folds for one frame per keystroke. Untracked,
		// because the caret chain must never join this effect's dependencies.
		untrack(() => {
			if (!composing) constructReveal.update(true);
		});
		markKeystrokeSettle();
	});

	// Windowed out while focused: hand focus to the editor root so the next keystroke
	// routes through its document-level listener instead of falling to `<body>`.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
	});

	// Asymmetric: clears only. The synthetic indicator is click-intent, armed nowhere but
	// `snapClickToWidgetEdge`, so a caret reaching a boundary by other means never sets it.
	function clearSnapTargetIfMoved(root: HTMLElement): void {
		if (lastSnapTargetOffset === null) return;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		if (!root.contains(range.startContainer)) {
			lastSnapTargetOffset = null;
			return;
		}
		const content = domTextOffsetAtNode(root, range.startContainer, range.startOffset);
		const off = toClampedRawOffset(content, ambientLength);
		if (off !== lastSnapTargetOffset) lastSnapTargetOffset = null;
	}

	// One listener drives the block's whole selection cadence. The snap clearer runs even
	// during composition — an IME caret move still invalidates a click-intent snap — while
	// the reveal machines are composition-gated like onInput.
	$effect(() => {
		const root = el;
		if (!root) return;
		const handler = () => {
			clearSnapTargetIfMoved(root);
			if (composing) return;
			widgetInteraction.foldRevealIfSelectionEscaped();
			constructReveal.update();
		};
		document.addEventListener('selectionchange', handler);
		return () => document.removeEventListener('selectionchange', handler);
	});

	$effect(() => {
		if (!el) return;
		for (const w of el.querySelectorAll('.md-snap-after, .md-snap-before')) {
			w.classList.remove('md-snap-after', 'md-snap-before');
		}
		// The synthetic caret stands in for one Chromium renders unreliably beside a
		// contenteditable=false island, and "unreliably" cuts both ways — nothing can ask
		// whether it painted, so darkening the native one is the only guarantee available.
		el.classList.remove('md-snap-caret-active');
		if (lastSnapTargetOffset === null) return;
		const off = lastSnapTargetOffset;
		for (const inline of resolvedInlineContent(node, linkRef)) {
			if (!isInlineWidget(inline, node.raw)) continue;
			if (inline.end !== off && inline.start !== off) continue;
			const widget = widgetElByStart(el, inline.start);
			if (widget) {
				widget.classList.add(inline.end === off ? 'md-snap-after' : 'md-snap-before');
				el.classList.add('md-snap-caret-active');
			}
			return;
		}
	});

	// ── Event Handlers ──────────────────────────────────────────────────

	const onInput = editableSurface.onInput;

	// Walk children rather than reading textContent, so stray text nodes Chromium inserts
	// around the marker span don't pollute the raw.
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

	// Captured before the surface's own handler: its cross-block half clears the affinity, and
	// the first mid-composition `input` re-arms it to the typed side.
	function onCompositionStart(): void {
		compositionSeat.noteStart();
		editableSurface.onCompositionStart();
	}

	function onCompositionEnd(): void {
		editableSurface.onCompositionEnd();
		compositionSeat.noteEnd();
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;

		preEditOffset = cursor.getRaw() ?? 0;

		// Reveal-only backstop, before any default runs: rapid arrows outrun the async
		// selectionchange reveal, and a step against folded markers skips their bytes.
		constructReveal.prepareForKeydown(e);

		// Escape cancels a revealed source back to rendered; every other key edits the
		// source natively or reaches the command seam below, which folds before mutating.
		if (await widgetInteraction.handleRevealingKeydown(e)) return;

		// Before handleSharedKeydown: selecting cleared the native range, so the shared
		// ArrowLeft boundary branch would read offset 0 and move focus to a block that
		// isn't there.
		if (await widgetInteraction.handleSelectedWidgetKeydown(e)) return;

		// The native default, with user-select:none on the widget, collapses the selection
		// instead of stepping past it.
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		// Every caret-edge construct routes through this one dispatch, keeping native
		// contenteditable from corrupting the atomic bytes each stands for.
		if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;

		// Native Home lands at DOM 0, before the marker span; the user wants raw offset 0,
		// immediately after the ambient span.
		if (e.key === 'Home' && !e.shiftKey && ambientLength > 0 && el) {
			e.preventDefault();
			cursor.setToAmbientBoundary();
			return;
		}

		const chord = eventToChord(e);
		if (
			chord &&
			dispatchKeyCommand(
				chord,
				{ kind: node.kind, runCommand },
				{ history, pluginEditor, getPresentationMode: () => presentationMode },
				keybindingOverrides(),
				onCommandError
			)
		) {
			e.preventDefault();
			return;
		}
	}

	/** The native inputs that replace a live selection with something else — the one destructive
	 *  family that reaches the bytes with no seam offsets of its own (report C § 5). */
	const SELECTION_REPLACING_INPUTS = new Set([
		'insertText',
		'deleteContentBackward',
		'deleteContentForward'
	]);

	/**
	 * A selection edit inside ONE block, in a mode that paints no delimiter: the engine would write
	 * the runs the range crossed literally, so the edit goes through the join seam instead. Declines
	 * wherever that seam has nothing to clean, leaving the engine its grapheme and IME behavior.
	 */
	function handleLiveSelectionEdit(e: InputEvent): boolean {
		if (presentationMode !== 'live' || widgetInteraction.isRevealing()) return false;
		if (!SELECTION_REPLACING_INPUTS.has(e.inputType)) return false;
		const range = cursor.getRawSelection();
		if (!range) return false;
		const typed = e.inputType === 'insertText' ? (e.data ?? '') : '';
		const edit = resolveSelectionEdit(node, range, typed, presentationMode, linkRef);
		if (!edit) return false;
		e.preventDefault();
		void blockEdit.updateBlockContent(index, edit.raw, range.start, edit.caret);
		setPendingCursorOffset(edit.caret, 'live-selection-edit');
		return true;
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (handleLiveSelectionEdit(e)) return;
		// Soft-keyboard/IME insertLineBreak slipped past onKeyDown — swallow; Shift+Enter there owns hard breaks.
		if (e.inputType === 'insertLineBreak') {
			e.preventDefault();
			return;
		}
	}

	// A click past a widget drops the caret outside the contenteditable, with no text-node
	// anchor, so onClick snaps to the nearest widget edge from this point. Y is
	// load-bearing: a column-aligned click on another visual line must not reveal.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
		lastClickClientX = e.clientX;
		lastClickClientY = e.clientY;
		lastSnapTargetOffset = null;
		// A press on a reveal-source widget is an owned gesture: suppressing the browser's
		// caret default leaves the reveal as the only selection writer until it places.
		if (widgetInteraction.isPointOnRevealWidget(e.clientX, e.clientY)) e.preventDefault();
	}

	function onBlur(e: FocusEvent): void {
		if (el && e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
		// Persist a revealed source edit before the caret is gone.
		widgetInteraction.commitRevealOnBlur();
		lastSnapTargetOffset = null;
	}

	function onClick(): void {
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		cursor.clampOutOfAmbient();
		widgetInteraction.snapClickToWidgetEdge(x, y);
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	// `range` is what the COMMAND read before it ran, and must not be re-read: a fold on
	// the way in parks a caret that collapses the live selection, so the chord would find
	// nothing to toggle. A collapsed range is the caret contract, not a bail.
	function toggleFormat(format: InlineMarkKind, range: { start: number; end: number }): void {
		if (!el) return;

		// Live paints no delimiter, so the byte-pair strategy's abandoned `****` would be
		// invisible garbage the user can see the effect of but not explain: pend the mark and
		// let the next insertion carry it instead (§ 4.3). Every other mode shows the pair.
		if (presentationMode === 'live' && range.start === range.end) {
			// The insertion that spends the mark starts its own undo entry, so it is never
			// folded into the burst the chord interrupted.
			controller.flushDebouncedCheckpoint();
			pendingMarks.toggle(format);
			return;
		}

		const { newDisplay, newSelStart, newSelEnd } = toggleInlineFormat(
			{ display: getDisplayText(), content: getContentRange(node), selection: range },
			format
		);

		// A command is not typing: the toggle's bytes are their own undo step in every mode.
		controller.isolateUndoEntry(() =>
			blockEdit.updateBlockContent(index, newDisplay + trailingLineEnding(node.raw), newSelStart)
		);

		tick().then(() => {
			setSelection(newSelStart, newSelEnd);
		});
	}
</script>

<!-- Reading mode flips contenteditable off, killing the whole browser-edit-path class
	structurally. tabindex/role are independent, so focus and arrow traversal stay. -->
<div
	bind:this={el}
	tabindex="0"
	class="text-editable-block {blockClass}"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
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
		opacity: var(--syntax-marker-dim, 0.65);
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
