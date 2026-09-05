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
		demoteToParagraph,
		insertHardBreak,
		insertLiteralTab,
		type TextEditResult
	} from './text-keydown';
	import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
	import { blockNodeAt } from '../../../tree-operations/node-ops';
	import { createTextClipboard } from './text-clipboard';
	import { createTextRender } from './text-render';
	import { createWidgetInteraction } from './widget-interaction';
	import { createEdgePolicyDispatch } from './edge-policy-dispatch';
	import { hidesStructuralSuffix } from './hidden-suffix';
	import { applyLiveRangeEdit, resolveSelectionEdit } from './live-selection-edit';
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
	import { createEditableSurface, consumePendingRestore } from '../editable-surface';
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
		// Accepted for BlockComponentProps parity: this surface reads the doc from the
		// document facet, and binding would shadow the global `document`.
		document?: DocumentView;
		// The surface itself navigates through the editor; this is forwarded to inline
		// widgets whose own gesture jumps elsewhere in the document.
		rects?: EditorRects;
	} = $props();

	const ambientPrefixText = $derived(
		typeof ambientPrefix === 'string' ? ambientPrefix : ambientPrefix.text
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

	/** The card's query for this surface, the cell's shape: `range` is the live selection at both
	 *  the chord's arm and the pressed read, since prose owns no wrap policy of its own. */
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
		pendingMarks,
		installedAs: 'block'
	});

	// The same seat the keydown dispatch takes, for the one insertion a keydown cannot reach.
	const compositionSeat = createCompositionSeat({
		getDisplayText: () => getDisplayText(),
		getInlines: () => resolvedInlineContent(node, linkRef),
		getAffinity: () => edgeAffinity.get(),
		getScreen: () => screenVisibilityOf(el ?? null),
		consumePendingMarks: () => pendingMarks.consume(),
		restorePendingMarks: (marks) => pendingMarks.restore(marks),
		getRawSelection: () => cursor.getRawSelection(),
		// The same join seam `handleLiveSelectionEdit` takes, in the display bytes the seat's
		// contract returns (commitInput re-appends the trailing line ending).
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
					// without surfacing it (live-mode.md § 4.5). The keydown dispatch consumes that press; this is
					// the same rule for the callers that never pass through it.
					applies: () =>
						offset >= caretBounds().end &&
						!hasSelectionHelper() &&
						!hidesStructuralSuffix(el ?? null, node, liveDisplayLength()),
					perform: () => void blockEdit.mergeWithNext(index)
				};
			case 'link.openCard':
				// Consumed wherever the keymap binds it, entry or not: `reservedChords()` reports
				// Mod+K as the editor's, and handing an unentered press back fires the browser
				// default the host was told not to expect (Ctrl+K kills to end of line here).
				return always(enterLinkCard);
			case 'heading.cycle':
				return {
					// A heading marks PROSE. The raw-editable kinds bind this keymap too, and there
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
				// Through `always`, not a bare opener line: every perform here rides the reveal fold.
				return always(() => void reorderRunCommand(id, reorder, () => myPath));
			default: {
				// The format chords are rows, not arms: a construct that declares a mark names the
				// command that toggles it, so a new markable kind costs a row here and nothing else.
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
		// A live reveal holds this block's bytes in ephemeral DOM, so every `perform` would
		// splice the pre-reveal source: fold, settle, then act. The fold is handed the user's
		// offset, valid because the committed text IS the DOM text it was measured against.
		const fold = widgetInteraction.foldRevealBeforeMutation(offset);
		void (fold?.settled ?? tick()).then(() => performBlockCommand(id, command.perform));
		return true;
	}

	// A toolbar asks once per button on every selection change, so the buttons share the parse.
	const formatActive = createInlineFormatActiveMemo();

	// The pressed-state read: the same display, content and selection the toggle itself takes,
	// and for the card the same construct its own entry resolves.
	export function isCommandActive(id: CommandId): boolean {
		const marked = inlineMarkForCommand(id);
		if (!marked) {
			// Both surfaces spell the id, as their run arms do: a registry for one command is premature.
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

	// No arm reached through here mutates while a reveal is open (G1.26): a fire means a
	// `runCommand` branch that skipped the fold. It guards the arms, not every entry path.
	// TODO(#35): funnel the fold at every mutation entry path, not just the command arms.
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

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

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
		if (composing || editableSurface.isDetached()) return;

		preEditOffset = cursor.getRaw() ?? 0;

		// Reveal-only backstop, before any default runs: rapid arrows outrun the async
		// selectionchange reveal, and a step against folded markers skips their bytes.
		constructReveal.prepareForKeydown(e);

		// Escape cancels a revealed source back to rendered; every other key edits the
		// source natively or reaches the command seam below, which folds before mutating.
		if ((await widgetInteraction.handleRevealingKeydown(e)) || editableSurface.isDetached()) return;

		// Before handleSharedKeydown: selecting cleared the native range, so the shared
		// ArrowLeft boundary branch would read offset 0 and move focus to a block that
		// isn't there.
		if ((await widgetInteraction.handleSelectedWidgetKeydown(e)) || editableSurface.isDetached())
			return;

		// The native default, with user-select:none on the widget, collapses the selection
		// instead of stepping past it.
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		if ((await handleSharedKeydown(e, sharedCtx)) || editableSurface.isDetached()) return;

		// Every caret-edge construct routes through this one dispatch, keeping native
		// contenteditable from corrupting the atomic bytes each stands for.
		if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;

		// Native Home lands at DOM 0, before the marker span — or past a leading island no text
		// node fronts; the user wants the block's start. Through the sentinel door,
		// not a raw-0 DOM write: the landable clamp applies.
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

	/**
	 * A native ranged edit inside ONE block, in a mode that paints no delimiter: the engine would
	 * write the runs the range crossed literally, so the edit goes through the join seam instead.
	 * Declines wherever that seam has nothing to clean, leaving the engine its grapheme and IME
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

	function onClick(e: MouseEvent): void {
		// An inline widget's own handler runs first, and a jump it starts can unmount this
		// surface before the click reaches it; nothing below addresses a block that is gone.
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

	// `range` is what the COMMAND read before it ran, and must not be re-read: a fold on
	// the way in parks a caret that collapses the live selection, so the chord would find
	// nothing to toggle. A collapsed range is the caret contract, not a bail.
	function toggleFormat(format: InlineMarkKind, range: { start: number; end: number }): void {
		if (!el) return;

		// A surface painting no delimiter would hold the byte-pair strategy's abandoned `****` as
		// invisible garbage the user can see the effect of but not explain: pend the mark and let
		// the next insertion carry it instead (live-mode.md § 4.3). The preview rungs reveal the
		// block the caret is in, so they show the pair and take the byte path.
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
