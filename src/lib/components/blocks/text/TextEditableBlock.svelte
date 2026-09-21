<script lang="ts">
	import { getContext, tick, untrack } from 'svelte';
	import { CURSOR_START, type AmbientPrefix, type BlockComponent } from '../../../block-component';
	import type { DocumentView, NodeView } from '../../../core/node-views';
	import type { EditorRects } from '../../../editor-rects';
	import { enterLinkCardAtCaret, linkCardTargetAt } from '../../link-card/link-card-entry';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		LIST_CONTEXT_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import type { IndexedDecoration } from '../../../decorations/buckets';
	import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
	import { getContentRange, isProseKind } from '../../../core/inline';
	import { devWarn } from '../../../dev-warn';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
	import { isInlineWidget } from '../../../core/inline/inline-widgets';
	import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import { FALLBACK_CONTENT_WIDTH } from '../../../cursor/typography-estimates';
	import {
		createInlineFormatActiveMemo,
		toggleInlineFormat
	} from '../../../core/inline/format-toggle';
	import {
		inlineMarkForCommand,
		type InlineMarkKind
	} from '../../../schema/inline-construct-policy';
	import {
		cycleHeading,
		demoteEmptyAtxHeading,
		demoteToParagraph,
		insertHardBreak,
		insertLiteralTab,
		type TextEditResult
	} from './text-keydown';
	import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
	import { blockNodeAt } from '../../../tree-operations/node-primitives';
	import { createTextClipboard } from './text-clipboard';
	import { createTextRender } from './text-render';
	import { createWidgetInteraction } from './widget-interaction';
	import { createEdgePolicyDispatch, keepsBlockKind } from './edge-policy-dispatch';
	import { hidesStructuralSuffix } from './hidden-suffix';
	import { applyLiveRangeEdit, resolveSelectionEdit } from './live-selection-edit';
	import { applyDelimiterAutoPair } from './delimiter-autopair';
	import { createCompositionSeat } from './composition-seat';
	import { createConstructReveal } from './construct-reveal';
	import { assertInvariant } from '../../../assert';
	import { paintsFocusedMarkers } from '../../../presentation-mode';
	import { widgetElByStart } from './widget-adjacency';
	import {
		caretLandableBounds,
		handleSharedKeydown,
		handleSharedBeforeInput
	} from '../../../selection/shared-keydown';
	import {
		createEditableSurface,
		consumePendingRestore,
		withKeydownVerdict
	} from '../editable-surface';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../surface-wiring.svelte';
	import {
		domTextOffsetAtNode,
		landableStartAbutsIsland,
		rawTextOfNode,
		createRangeAtDomTextOffsets,
		revealsNoMarkers,
		screenVisibilityOf,
		selectionFocusWalkOffset
	} from '../../../cursor/widget-offset';
	import { ambientSpanOf } from '../../../ambient/ambient-dom';
	import {
		asRawOffset,
		toClampedRawOffset,
		toDomTextOffset
	} from '../../../cursor/coordinate-spaces';
	import { createAmbientCursorIO } from '../../../ambient/ambient-cursor';
	import { type CommandId } from '../../../schema/commands';
	import { reorderRunCommand } from '../../../editor-actions/reorder-action';
	import { planTypedCompletion } from '../../../editor-actions/enter-completion';
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
		ambientPrefix = '',
		rects
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		blockClass?: string;
		ambientPrefix?: AmbientPrefix;
		// Accepted so the props match `BlockComponentProps`: this block reads the document
		// from its own context, and binding here would shadow the global `document`.
		document?: DocumentView;
		// The block itself navigates through the editor; this is passed on to inline
		// widgets whose own gesture jumps elsewhere in the document.
		rects?: EditorRects;
	} = $props();

	const ambientPrefixText = $derived(
		typeof ambientPrefix === 'string' ? ambientPrefix : ambientPrefix.text
	);
	// The hanging indent is how wide the prefix draws: its text width by default, or what a
	// prefix that draws itself, such as the task checkbox, declares.
	const ambientIndent = $derived(
		(typeof ambientPrefix === 'string' ? undefined : ambientPrefix.indent) ??
			`${ambientPrefixText.length}ch`
	);

	const wiring = wireSurfaceContexts();
	const {
		blockEdit,
		focusActions,
		controller,
		pasteCoordinator,
		stickyColumn,
		edgeAffinity,
		selection,
		getDoc,
		getEditorRoot,
		grammar,
		activePlugins,
		events: editorEvents,
		linkRef
	} = wiring.deps;
	// Present inside a list item, whose ListItemBlock owns Tab-as-indent.
	const listContext = getContext(LIST_CONTEXT_KEY);
	const {
		reorder,
		pendingMarks,
		widgetSelection,
		linkCard,
		decorations: decorationEngine
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy,
		brokenImageUrls: brokenUrlCache,
		presentationMode: getPresentationMode,
		theme: getTheme,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const { contentVersion: getContentVersion } = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');

	/** What the link card is asked about here, the same shape a table cell passes: `range` is the
	 *  live selection both when the chord runs and when the pressed state is read. */
	const linkCardQuery = (contentEl: HTMLElement, range: { start: number; end: number } | null) => ({
		contentEl,
		block: node,
		path: myPath,
		linkRef,
		mode: presentationMode,
		selection: range,
		crossBlockRange: selection.isCrossBlock
	});
	const enterLinkCard = () => {
		if (el) {
			enterLinkCardAtCaret({
				...linkCardQuery(el, cursor.getRawSelection()),
				card: linkCard
			});
		}
	};
	// A shared constant keeps an empty decoration list out of the render key.
	const NO_ISLANDS: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] = [];
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	// A widget's shown source lives only in the DOM, so `onInput` and IME `compositionend`
	// skip the per-keystroke CST commit and the block commits once when it is hidden.
	let revealing = $state(false);
	/** Cursor offset to restore after the next $effect render. Null = don't touch cursor. */
	let pendingCursorOffset = $state<number | null>(null);
	// Captured before each edit; keydown fires before the DOM changes.
	let preEditOffset = 0;
	// Survives the click→keydown gap when Chromium clears the caret at CE=false-adjacent
	// positions. Reactive so the snap-caret overlay sees changes.
	let lastSnapTargetOffset = $state<number | null>(null);

	// The one place a pending cursor is written, tagged so the interaction trace names
	// which gesture set the restore; the render effect reads and clears it.
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
		...wiring.deps,
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
		getPresentationMode: () => presentationMode,
		getFocusOffset: () => (el ? selectionFocusWalkOffset(el, ambientLength) : null),
		getTextLen: () => liveDisplayLength(),
		readText: () => readRawText(),
		relocateComposedText: (after, composedAt) => compositionSeat.relocate(after, composedAt),
		commitInput: (text, preEdit, saved) => {
			const committed = text + trailingLineEnding(node.raw);
			void blockEdit.updateBlockContent(index, committed, preEdit, saved);
			// An enclosing container may rewrite these bytes on the way in, so the caret
			// restore reads the text actually stored, not the offset the keystroke produced.
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

	// After `widgetInteraction`, because a clipboard edit hides a shown source before it
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
		grammar,
		activePlugins,
		getDoc,
		widgetSelection,
		events: editorEvents,
		onPasteImage,
		setPendingCursor: (offset) => setPendingCursorOffset(offset, 'clipboard'),
		isReadOnly: () => readOnly,
		foldRevealBeforeMutation: () => widgetInteraction.foldRevealBeforeMutation(),
		isRevealing: () => widgetInteraction.isRevealing(),
		getPresentationMode: () => presentationMode,
		getAmbientPrefix: () => ambientPrefixText,
		readRevealedText: () => readRawText(),
		get linkRef() {
			return linkRef;
		}
	});

	// Showing markers in preview-inline mode: CSS classes only, no keys intercepted.
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
		get containerParent() {
			return blockNodeAt(getDoc(), myPath.slice(0, -1));
		},
		get linkRef() {
			return linkRef;
		},
		getEl: () => el ?? null,
		getAmbientLength: () => ambientLength,
		getAmbientPrefix: () => ambientPrefixText,
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
		noteOutside: edgeAffinity.noteExtreme,
		pendingMarks,
		installedAs: 'block'
	});

	// The same placement rules the keydown dispatch uses, for the one insertion it cannot reach.
	const compositionSeat = createCompositionSeat({
		getDisplayText: () => getDisplayText(),
		getInlines: () => resolvedInlineContent(node, linkRef),
		getAffinity: () => edgeAffinity.get(),
		getScreen: () => screenVisibilityOf(el ?? null),
		consumePendingMarks: () => pendingMarks.consume(),
		restorePendingMarks: (marks) => pendingMarks.restore(marks),
		getRawSelection: () => cursor.getRawSelection(),
		// The same join rules `handleLiveSelectionEdit` uses, in the displayed bytes this
		// returns (`commitInput` re-appends the trailing line ending).
		resolveRangeEdit: (range, typed) => {
			const edit = resolveSelectionEdit(
				node,
				range,
				typed,
				presentationMode,
				linkRef,
				ambientPrefixText
			);
			return edit && { raw: trimTrailingLineEnding(edit.raw), caret: edit.caret };
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
		get presentationMode() {
			return presentationMode;
		},
		getTheme,
		getDocument: () => getDoc(),
		getContentVersion,
		navigateTo: (path) => rects?.navigateTo(path) ?? Promise.resolve(false),
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
	export const insertMarkdown = clipboardHandlers.insertMarkdown;

	export function snapCaretToPoint(clientX: number, clientY: number): void {
		widgetInteraction.snapClickToWidgetEdge(clientX, clientY);
	}

	/** The length the caret counts against: the DOM's while a source is shown, since the CST
	 *  has not seen that edit. Against a stale `node.raw`, an edited source at the block's
	 *  end traps the caret, because no key reads as "at the boundary". */
	function liveDisplayLength(): number {
		return widgetInteraction.isRevealing() ? readRawText().length : getDisplayText().length;
	}

	/** The offsets a caret can reach here, read from the same place the arrow exits use: a mode
	 *  that draws no marker puts the block's own bytes out of reach, so every block-edge check
	 *  uses what the DOM allows rather than 0 and the length. */
	function caretBounds(): { start: number; end: number } {
		return el ? caretLandableBounds(sharedCtx, el) : { start: 0, end: liveDisplayLength() };
	}

	/** The structural bytes this key gives up before any merge: a declared kind's, in a mode
	 *  that draws none of them. Null everywhere else, and the merge below takes the key. */
	function demoteBeforeMerge(offset: number): TextEditResult | null {
		if (!el || !revealsNoMarkers(el)) return null;
		if (tryGetBlockKindDescriptor(node.kind)?.contentStartBackspace !== 'demote-first') return null;
		return demoteToParagraph(node.raw, getContentRange(node), offset);
	}

	/** One entry per command this block owns, split so hiding a shown source fits between the
	 *  halves: `applies` reads only the DOM and survives that, `perform` reads `node.raw` and is
	 *  valid only afterwards. `offset` and `selected` are closed over, since hiding moves them. */
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
					// At or before, not equal: a caret can still be placed at an offset the DOM
					// traversal moves forward, and a strict test would make the key do nothing.
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
					// A block whose own structure sits after its content cannot absorb the next one
					// without bringing that structure into view (live-mode.md § 4.5). The keydown
					// dispatch consumes that key; this is the same rule for callers that skip it.
					applies: () =>
						offset >= caretBounds().end &&
						!hasSelectionHelper() &&
						!hidesStructuralSuffix(el ?? null, node, liveDisplayLength()),
					perform: () => void blockEdit.mergeWithNext(index)
				};
			case 'link.openCard':
				// Consumed wherever the keymap binds it, whether or not a card opens:
				// `reservedChords()` reports Mod+K as the editor's, and handing the key back would
				// fire the browser default the host was told not to expect (Ctrl+K kills a line).
				return always(enterLinkCard);
			case 'heading.cycle':
				return {
					// A heading marks prose. The raw-editable kinds bind this keymap too, and there
					// an ATX prefix is content: it would destroy a link reference definition.
					applies: () => isProseKind(node.kind),
					perform: () => {
						// `arg` is untrusted `unknown` from the widened keybinding channel: an
						// out-of-range value would throw a RangeError inside `repeat`, so fall
						// back to the strip behavior.
						const level = typeof arg === 'number' && arg >= 0 && arg <= 6 ? arg : 0;
						const cycled = cycleHeading(node.raw, getContentRange(node), level, offset);
						if (!cycled) return;
						blockEdit.updateBlockContent(index, cycled.newRaw, offset, cycled.caretOffset);
						setPendingCursorOffset(cycled.caretOffset, 'heading-cycle');
					}
				};
			case 'block.moveUp':
			case 'block.moveDown':
				// Through `always`, not a bare call: every `perform` runs after a source is hidden.
				return always(() => void reorderRunCommand(id, reorder, () => myPath));
			default: {
				// The format chords come from the policy table, not from branches here: a construct
				// that declares a mark names the command that toggles it, so a new markable kind
				// costs one table entry and nothing else.
				const marked = inlineMarkForCommand(id);
				return marked === null
					? null
					: always(() => toggleFormat(marked.kind, selected ?? { start: offset, end: offset }));
			}
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
		// A shown source holds this block's bytes in the DOM only, so every `perform` would splice
		// the old source: hide it, wait for the write, then act. Hiding is handed the user's
		// offset, which is valid because the committed text is the DOM text it was measured on.
		const fold = widgetInteraction.foldRevealBeforeMutation(offset);
		void (fold?.settled ?? tick()).then(() => performBlockCommand(id, command.perform));
		return true;
	}

	// A toolbar asks once per button on every selection change, so the buttons share the parse.
	const formatActive = createInlineFormatActiveMemo();

	// Whether a button shows as pressed: the same displayed text, content and selection the
	// toggle itself uses, and for the card the same construct its own entry resolves.
	export function isCommandActive(id: CommandId): boolean {
		const marked = inlineMarkForCommand(id);
		if (!marked) {
			// The text block and the table cell both name this id, as their run branches do: a
			// registry for a single command would be premature.
			if (id !== 'link.openCard' || !el) return false;
			return linkCardTargetAt(linkCardQuery(el, cursor.getRawSelection())) !== null;
		}
		const caret = cursor.getRaw() ?? 0;
		const selection = cursor.getRawSelection() ?? { start: caret, end: caret };
		return formatActive(
			{ display: getDisplayText(), content: getContentRange(node), selection },
			marked.kind
		);
	}

	// Nothing reached through here writes while a source is shown (G1.26): a failure means a
	// `runCommand` branch that skipped hiding it. It covers the commands, not every entry path.
	// TODO(#35): hide a shown source at every entry path that writes, not just the commands.
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
		insertMarkdown,
		snapCaretToPoint,
		runCommand
	} satisfies BlockComponent);

	// ── Content sync ──────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (ambientPrefixText && !isProseKind(node.kind)) {
			devWarn(
				'TextEditableBlock',
				`ambientPrefix is prose-only; non-prose kind ${node.kind} received a non-empty ambient prefix, so the ambient marker will not render correctly`
			);
		}

		const t0 = perfEnabled() ? performance.now() : 0;
		// With a restore pending, the code below overwrites the selection, so the render's
		// own caret capture would be wasted.
		textRender.render({
			forceRebuild: pendingCursorOffset !== null,
			carryCaret: pendingCursorOffset === null
		});
		if (perfEnabled()) recordBlockRender(performance.now() - t0, myPath);

		if (pendingCursorOffset !== null) {
			// Only while this block still has focus: a commit on blur also sets a pending
			// offset, and restoring would pull the selection back into the blurred block.
			// The clear runs either way, so a skipped restore is dropped, not left pending.
			const applied = consumePendingRestore(el ?? null, pendingCursorOffset, (offset) => {
				if (!widgetInteraction.revealInterior(offset)) cursor.setRaw(asRawOffset(offset));
			});
			tracePendingCursorConsume(pendingCursorOffset, applied);
			pendingCursorOffset = null;
		}
		// A rebuild makes fresh spans with no marker class, so re-apply before paint, or typing
		// inside a construct whose markers are shown hides them for one frame per keystroke.
		// Untracked, because the caret's chain must never join this effect's dependencies.
		untrack(() => {
			if (!composing) constructReveal.update(true);
		});
		markKeystrokeSettle();
	});

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

	// This only clears. The editor's own caret indicator means "the click meant this", and
	// nothing but `snapClickToWidgetEdge` sets it, so a caret arriving another way never does.
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

	// One listener drives everything this block does on a selection change. The snap clearer
	// runs even during composition, since an IME caret move still invalidates a click-driven
	// snap, while the source-showing code is skipped during composition as `onInput` is.
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
		// The editor's own caret stands in for one Chromium draws unreliably beside a
		// contenteditable=false widget, and nothing can ask whether the browser drew it, so
		// hiding the browser's is the only guarantee available.
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

	// Read the children one by one rather than `textContent`, so stray text nodes Chromium
	// inserts around the marker span do not pollute the raw.
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

	// Captured before the shared handler: its cross-block half clears the arrival side, and the
	// first `input` during the composition resets that side to the typed one.
	function onCompositionStart(): void {
		compositionSeat.noteStart();
		editableSurface.onCompositionStart();
	}

	function onCompositionEnd(): void {
		editableSurface.onCompositionEnd();
		compositionSeat.noteEnd();
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || editableSurface.isDetached()) return;

		preEditOffset = cursor.getRaw() ?? 0;

		// Shows markers only, before any default runs: fast arrows outrun the async
		// `selectionchange` update, and a step against still-hidden markers skips their bytes.
		constructReveal.prepareForKeydown(e);

		// Escape cancels a shown source back to its rendered form; every other key edits the
		// source in the DOM or reaches the commands below, which hide it before writing.
		if ((await widgetInteraction.handleRevealingKeydown(e)) || editableSurface.isDetached()) return;

		// Before `handleSharedKeydown`: selecting cleared the browser range, so the shared
		// ArrowLeft boundary branch would read offset 0 and move focus to a block that
		// is not there.
		if ((await widgetInteraction.handleSelectedWidgetKeydown(e)) || editableSurface.isDetached())
			return;

		// The browser default, with `user-select: none` on the widget, collapses the selection
		// instead of stepping past it.
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		if ((await handleSharedKeydown(e, sharedCtx)) || editableSurface.isDetached()) return;

		// Every caret-edge construct goes through this one dispatch, keeping contenteditable
		// from corrupting the atomic bytes each stands for.
		if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;

		// The browser's Home lands at DOM offset 0, before the marker span, or past a leading
		// widget with no text node in front of it; the user wants the block's start. Written
		// through the start marker value rather than raw offset 0, so the clamp still applies.
		if (
			e.key === 'Home' &&
			!e.shiftKey &&
			el &&
			(ambientLength > 0 || landableStartAbutsIsland(el))
		) {
			e.preventDefault();
			focus(CURSOR_START);
			return;
		}

		if (wiring.dispatchChord(e, { kind: node.kind, runCommand })) return;
	}

	const onKeyDownTraced = withKeydownVerdict(onKeyDown);

	/**
	 * A browser range edit inside one block, in a mode that draws no delimiter: the browser would
	 * write the runs the range crossed literally, so the edit goes through the join rules instead.
	 * Refuses wherever those rules have nothing to clean, leaving the browser its grapheme and IME
	 * behavior.
	 */
	function handleLiveSelectionEdit(e: InputEvent): boolean {
		return applyLiveRangeEdit(
			e,
			node,
			cursor,
			presentationMode,
			linkRef,
			ambientPrefixText,
			widgetInteraction.isRevealing,
			(edit) => {
				void blockEdit.updateBlockContent(index, edit.raw, edit.range.start, edit.caret);
				setPendingCursorOffset(edit.caret, 'live-selection-edit');
			}
		);
	}

	// The write takes the same path as the range edit above, so the block repaints once with the
	// caret inside the pair. While a source is shown the caret counts into the DOM text instead.
	function handleDelimiterAutoPair(e: InputEvent): boolean {
		return applyDelimiterAutoPair(e, {
			text: () => (widgetInteraction.isRevealing() ? readRawText() : getDisplayText()),
			content: () => getContentRange(node),
			caret: () => cursor.getRaw(),
			hasSelection: () => cursor.getRawSelection() !== null,
			isRevealing: widgetInteraction.isRevealing,
			foldReveal: () => widgetInteraction.foldRevealBeforeMutation(),
			markersPaint: () => paintsFocusedMarkers(presentationMode),
			setCaret: (offset) => cursor.setRaw(asRawOffset(offset)),
			seatOutside: edgeAffinity.noteExtreme,
			completesLine: (caret) => planTypedCompletion(node, caret) !== null,
			keepsBlockKind: (text) => keepsBlockKind(node, text),
			write: (text, caretBefore, caretAfter) => {
				const raw = text + trailingLineEnding(node.raw);
				void blockEdit.updateBlockContent(index, raw, caretBefore, caretAfter);
				setPendingCursorOffset(caretAfter, 'delimiter-autopair');
			}
		});
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (handleLiveSelectionEdit(e)) return;
		if (handleDelimiterAutoPair(e)) return;
		// An `insertLineBreak` from a soft keyboard or IME got past `onKeyDown`: consume it, since
		// Shift+Enter is what makes a hard break.
		if (e.inputType === 'insertLineBreak') {
			e.preventDefault();
			return;
		}
	}

	// A click past a widget drops the caret outside the contenteditable with no text node to
	// anchor in, so `onClick` moves it to the nearest widget edge from this point. Y matters: a
	// click at the same column on another visual line must not open a source.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
		lastClickClientX = e.clientX;
		lastClickClientY = e.clientY;
		lastSnapTargetOffset = null;
		// A click on a widget that can show its source is this editor's gesture: cancelling the
		// browser's caret default leaves that code as the only writer of the selection.
		if (widgetInteraction.isPointOnRevealWidget(e.clientX, e.clientY)) e.preventDefault();
	}

	function onBlur(e: FocusEvent): void {
		if (el && e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
		// Save an edit to a shown source before the caret is gone.
		widgetInteraction.commitRevealOnBlur();
		lastSnapTargetOffset = null;
		demoteEmptyHeadingOnBlur();
	}

	function demoteEmptyHeadingOnBlur(): void {
		if (readOnly || node.kind !== 'heading' || editableSurface.isDetached()) return;
		const demoted = demoteEmptyAtxHeading(node.raw, getContentRange(node));
		if (demoted) void blockEdit.updateBlockContent(index, demoted.newRaw, 0);
	}

	function onClick(e: MouseEvent): void {
		// An inline widget's own handler runs first, and a jump it starts can unmount this
		// block before the click reaches it; nothing below applies to a block that is gone.
		if (!el) return;
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		cursor.clampOutOfAmbient();
		widgetInteraction.snapClickToWidgetEdge(x, y, {
			modified: e.ctrlKey || e.metaKey,
			clickCount: e.detail
		});
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	// `range` is what the command read before it ran, and must not be read again: hiding a shown
	// source on the way in places a caret that collapses the live selection, so the chord would
	// find nothing to toggle. A collapsed range is the caret case, not a refusal.
	function toggleFormat(format: InlineMarkKind, range: { start: number; end: number }): void {
		if (!el) return;

		// A block that draws no delimiter would keep the abandoned `****` as invisible bytes the
		// user can see the effect of but not explain, so the mark waits and the next insertion
		// carries it (live-mode.md § 4.3). The preview modes show the markers of the block the
		// caret is in, so there the pair is visible and the bytes are written.
		if (!paintsFocusedMarkers(presentationMode) && range.start === range.end) {
			// The insertion that spends the mark starts its own undo entry, so it is never
			// folded into the burst the chord interrupted.
			controller.flushDebouncedCheckpoint();
			pendingMarks.toggle(format);
			return;
		}

		const toggled = toggleInlineFormat(
			{ display: getDisplayText(), content: getContentRange(node), selection: range },
			format,
			presentationMode
		);
		if (!toggled) return;
		const { newDisplay, newSelStart, newSelEnd } = toggled;

		// A command is not typing: the toggle's bytes are their own undo step in every mode.
		controller.isolateUndoEntry(() =>
			blockEdit.updateBlockContent(index, newDisplay + trailingLineEnding(node.raw), newSelStart)
		);

		tick().then(() => {
			setSelection(newSelStart, newSelEnd);
		});
	}
</script>

<!-- Reading mode turns contenteditable off, which rules out every browser edit path at once.
	tabindex and role are separate, so focus and arrow traversal stay. -->
<div
	bind:this={el}
	tabindex="0"
	class="text-editable-block {blockClass}"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
	role="textbox"
	style:text-indent={ambientPrefixText ? `-${ambientIndent}` : null}
	style:padding-left={ambientPrefixText ? ambientIndent : null}
	oninput={onInput}
	onkeydown={onKeyDownTraced}
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
		font-family: var(--font-code, ui-monospace, monospace);
		font-size: 0.9em;
		opacity: 0.85;
	}

	.text-editable-block :global(.md-marker) {
		opacity: var(--syntax-marker-dim, 0.65);
		font-weight: normal;
		font-style: normal;
	}

	.text-editable-block :global(.inline-code-content) {
		font-family: var(--font-code, ui-monospace, monospace);
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
