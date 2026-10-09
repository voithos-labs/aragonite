<script lang="ts">
	import { getContext, onDestroy, tick, untrack } from 'svelte';
	import { CURSOR_START, type AmbientPrefix, type BlockComponent } from '../../../block-component';
	import { readBlocks } from '../../../core/parser';
	import { ambientHoldsTaskBox } from '../list/task-checkbox';
	import type { DocumentView, NodeView } from '../../../core/node-views';
	import type { EditorRects } from '../../../editor-rects';
	import { editTargetAt, enterLinkCardAtCaret } from '../../link-card/link-card-entry';
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
	import {
		getContentRange,
		isProseKind,
		sameLineSuffix,
		structuralSuffix
	} from '../../../core/inline';
	import { devWarn } from '../../../dev-warn';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import { trimTrailingLineEnding } from '../../../core/lines';
	import { caretIsInTextContent, seatIsInTextContent } from './click-snap-guard';
	import { caretSeatInElement } from '../../../caret/point-offset';
	import { widgetEdgeBox } from '../../../caret/drawn-caret-measure';
	import type { WidgetEdgeBox } from '../../../caret/drawn-caret-target';
	import { FALLBACK_CONTENT_WIDTH } from '../../../windowing/typography-estimates';
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
	import { createEdgePolicyDispatch } from './edge-policy-dispatch';
	import { createEdgeStep } from './edge-step';
	import { applyTypedInput, createTypedPlacement } from './edge-seat';
	import { handlePendingBreakKey, type PendingBreakKeyDeps } from './pending-break-keys';
	import { handleHomeKey, type HomeKeyDeps } from './home-key';
	import { keepsKindAt } from '../../../core/inline/live-edit/read-back';
	import { storedAsAt } from '../../../tree-operations/stored-as';
	import { applyLiveRangeEdit } from './live-selection-edit';
	import { replaceRangeInLeaf } from '../../../tree-operations/leaf-range';
	import { applyDelimiterAutoPair } from './delimiter-autopair';
	import { createCompositionSeat } from './composition-seat';
	import { createConstructReveal } from './construct-reveal';
	import { assertInvariant } from '../../../assert';
	import { widgetElByStart, widgetsIn } from './widget-adjacency';
	import { caretLandableBounds, handleSharedKeydown } from '../../../selection/shared-keydown';
	import { createEditableSurface, consumePendingRestore } from '../editable-surface';
	import { rangeWrite, withOwnEnding } from '../surface-write';
	import type { ContentWrite } from '../../../action-contracts';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../surface-wiring.svelte';
	import {
		rawOffsetAt,
		rawTextOfContent,
		revealsNoMarkers,
		rawSelectionFocus,
		caretOnPendingBreakLine
	} from '../../../caret/widget-offset';
	import { asRawOffset } from '../../../caret/coordinate-spaces';
	import { createSurfaceBackend } from '../../../caret/surface-backend';
	import { type CommandId } from '../../../schema/commands';
	import type { CommandRun } from '../../../schema/block-commands';
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
		// Passed on to inline widgets whose own gesture jumps elsewhere in the document.
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
		caretMemory,
		caretWriter,
		selection,
		getDoc,
		getEditorRoot,
		activePlugins,
		events: editorEvents,
		reading
	} = wiring.deps;
	const { grammar } = reading;
	// Made per gesture, never derived: a derived value would subscribe the block to the tree.
	const storedAs = () => storedAsAt(getDoc(), myPath, reading);
	// Present inside a list item, whose ListItemBlock owns Tab-as-indent.
	const listContext = getContext(LIST_CONTEXT_KEY);
	const {
		autoPairs,
		linkCard,
		inlineMenuCombobox,
		decorations: decorationEngine,
		drafts,
		drawnCaret
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const ownPairs = autoPairs.forBlock();

	const {
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy,
		brokenImageUrls: brokenUrlCache,
		theme: getTheme,
		onPasteImage,
		activationClick
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const { contentVersion: getContentVersion } = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const readOnly = $derived(reading.mode() === 'reading');
	const combobox = $derived(inlineMenuCombobox(myPath));

	/** What the link card is asked about here, the same shape a table cell passes: `range` is the
	 *  live selection both when the chord runs and when the pressed state is read. */
	const linkCardQuery = (contentEl: HTMLElement, range: { start: number; end: number } | null) => ({
		contentEl,
		block: node,
		path: myPath,
		reading,
		selection: range,
		crossBlockRange: selection.isCrossBlock
	});
	const enterLinkCard = () => {
		if (el) {
			enterLinkCardAtCaret({
				...linkCardQuery(el, cursor.getRawSelection()),
				card: linkCard,
				enterWidget: widgetInteraction.enterWidget
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
	// The drawn caret holds the widget edge a click meant under this block's own key, which survives
	// the click-to-keydown gap where Chromium clears the caret beside a non-editable widget.
	const widgetEdgeOwner = {};
	const holdWidgetEdge = (offset: number | null) =>
		drawnCaret.armWidgetEdge(widgetEdgeOwner, offset);
	// Beside a non-editable widget Chromium paints a taller caret while the button is down, so the
	// drawn caret hides it from the pointer-down rather than from the click.
	let downBesideWidget = false;
	let pressPending = false;

	function markDownBesideWidget(down: boolean): void {
		if (down === downBesideWidget) return;
		downBesideWidget = down;
		drawnCaret.request();
	}

	// The one place a pending cursor is written, tagged so the interaction trace names
	// which gesture set the restore; the render effect reads and clears it.
	function setPendingCursorOffset(offset: number | null, source: string): void {
		tracePendingCursorSet(source, offset);
		pendingCursorOffset = offset;
	}

	const cursor = createSurfaceBackend({
		getEl: () => el ?? null,
		caretWriter,
		getSnapTarget: () => drawnCaret.widgetEdgeFor(widgetEdgeOwner)
	});

	const edgeStep = createEdgeStep({
		getEl: () => el ?? null,
		getRaw: () => node.raw,
		getInlines: () => resolvedInlineContent(node, reading),
		// On the line a pending break opened, the caret is at no construct's edge.
		getCaret: () =>
			pendingBreak.at() !== null || cursor.getRawSelection() ? null : cursor.getRaw(),
		isReading: () => readOnly,
		reading,
		caretMemory,
		heldSpace: () => editableSurface.heldSpace
	});
	const typedPlacement = createTypedPlacement({
		getEl: () => el ?? null,
		getNode: () => node,
		reading,
		caretMemory,
		heldSpace: () => editableSurface.heldSpace
	});
	// Set on the block's first focus: until then a render has no shown marker or ring to re-apply.
	let caretHasEntered = false;

	// The same placement rules the keydown dispatch uses, for the one insertion it cannot reach.
	const compositionSeat = createCompositionSeat({
		getDisplayText: () => getDisplayText(),
		getInlines: () => resolvedInlineContent(node, reading),
		reading,
		consumePendingMarks: caretMemory.pendingMarks.consume,
		restorePendingMarks: caretMemory.pendingMarks.restore,
		getRawSelection: () => cursor.getRawSelection(),
		// The in-leaf range replace `handleLiveSelectionEdit` uses, as the displayed text the
		// composition commit writes.
		resolveRangeEdit: (range, typed) => {
			const edit = replaceRangeInLeaf(node, range, typed, storedAs());
			if (edit.matchesBrowserEdit) return null;
			const { text, caretAfter } = rangeWrite(edit);
			return { raw: text, caret: caretAfter };
		}
	});

	const editableSurface = createEditableSurface({
		...wiring.deps,
		getEl: () => el ?? null,
		isInputSuppressed: () => revealing,
		backend: cursor,
		getNode: () => node,
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		requestCaret: (at, { source }) => setPendingCursorOffset(at, source),
		ownPairs,
		getFocusOffset: () => (el ? rawSelectionFocus(el) : null),
		getTextLen: () => caretReach(),
		stepEdge: edgeStep.step,
		readText: () => readRawText(),
		compositionSeat,
		placeInsertion: typedPlacement.insertion,
		inputPrelude: () => {
			markKeystrokeStart();
			holdWidgetEdge(null);
		},
		widgetEdge: {
			owner: widgetEdgeOwner,
			box: (offset) => widgetEdgeBoxAt(offset),
			pressed: () => downBesideWidget
		},
		handleKeydown: onKeyDown,
		handleBeforeInput: onBeforeInput,
		// After a shown source is written: until then the selected text lives in the DOM only.
		removeSelection: (range) =>
			new Promise<ContentWrite>((written) =>
				afterSourceCommit(() =>
					written(
						writeText({
							...rangeWrite(replaceRangeInLeaf(node, range, '', storedAs())),
							intent: 'command',
							mode: 'authored',
							source: 'selection-removal'
						})
					)
				)
			)
	});
	const { writeText, pendingBreak } = editableSurface;
	export const afterSelectionRemoved = editableSurface.afterSelectionRemoved;

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	const widgetInteraction = createWidgetInteraction({
		storedAs,
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
		getEditorContentWidth: () => getEditorRoot()?.clientWidth ?? FALLBACK_CONTENT_WIDTH,
		cursor,
		selection,
		caretWriter,
		blockEdit,
		writeText,
		focusActions,
		setSnapTarget: holdWidgetEdge,
		setPendingCursor: (offset) => setPendingCursorOffset(offset, 'widget'),
		readRawText: () => readRawText(),
		setRevealing: (value) => {
			revealing = value;
		},
		isCrossBlock: () => selection.isCrossBlock,
		drafts,
		activationClick,
		get reading() {
			return reading;
		}
	});
	onDestroy(widgetInteraction.dispose);

	// After `widgetInteraction`, because a clipboard edit hides a shown source before it
	// touches the CST.
	const clipboardHandlers = createTextClipboard({
		storedAs,
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
		caretMemory,
		blockEdit,
		pasteCoordinator,
		activePlugins,
		getDoc,
		events: editorEvents,
		onPasteImage,
		setPendingCursor: (offset) => setPendingCursorOffset(offset, 'clipboard'),
		isReadOnly: () => readOnly,
		foldRevealBeforeMutation: () => widgetInteraction.foldRevealBeforeMutation(),
		isRevealing: () => widgetInteraction.isRevealing(),
		readRevealedText: () => readRawText(),
		get reading() {
			return reading;
		}
	});

	// Showing markers in preview-inline mode: CSS classes only, no keys intercepted.
	const constructReveal = createConstructReveal({
		get node() {
			return node;
		},
		get reading() {
			return reading;
		},
		getEl: () => el ?? null,
		isCrossBlock: () => selection.isCrossBlock
	});

	// Every caret-edge key goes through this one dispatch (G4.12); entering a widget stays in
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
		get reading() {
			return reading;
		},
		getEl: () => el ?? null,
		storedAs,
		hasIslands: () =>
			decorationEngine ? decorationEngine.islandsForPath(myPath).length > 0 : false,
		getRawSelection: () => cursor.getRawSelection(),
		writeText,
		completeMarker: () => void blockEdit.completeMarker(index),
		setSnapTarget: holdWidgetEdge,
		isRevealing: () => widgetInteraction.isRevealing(),
		enterWidget: (widget, fromTrailingEdge) =>
			widgetInteraction.enterWidget(widget, fromTrailingEdge),
		isReading: () => readOnly,
		pendingMarks: caretMemory.pendingMarks,
		caretWriter
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
		pendingBreakLines: () => pendingBreak.lines(),
		resolveImageUrl,
		resolveLinkUrl,
		get imageLoadPolicy() {
			return imageLoadPolicy();
		},
		reading,
		getTheme,
		getDocument: () => getDoc(),
		getContentVersion,
		navigateTo: (path) => rects?.navigateTo(path) ?? Promise.resolve(false),
		activationClick,
		get islands() {
			return decorationEngine ? decorationEngine.islandsForPath(myPath) : NO_ISLANDS;
		},
		brokenUrlCache,
		reportRenderError: (error) =>
			editorEvents?.emit('error', { origin: 'render', error, context: { path: myPath } }),
		caretWriter
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
	export const typeText = editableSurface.surface.typeText;

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

	/** The length the caret counts against: the DOM's while a source is shown, since the CST has
	 *  not seen that edit. */
	function caretReach(): number {
		if (widgetInteraction.isRevealing()) return readRawText().length;
		return getDisplayText().length;
	}

	/** The offsets a caret can reach here, as the arrow exits read them: a mode that draws no marker
	 *  puts the block's own marker bytes out of reach, so 0 and the length are wrong there. */
	function caretBounds(): { start: number; end: number } {
		return el ? caretLandableBounds(sharedCtx, el) : { start: 0, end: caretReach() };
	}

	/** The structural bytes this key gives up before any merge: a declared kind's, in a mode
	 *  that draws none of them. Null everywhere else, and the merge below takes the key. */
	function demoteBeforeMerge(offset: number): TextEditResult | null {
		if (!el || !revealsNoMarkers(el)) return null;
		if (tryGetBlockKindDescriptor(node.kind)?.contentStartBackspace !== 'demote-first') return null;
		return demoteToParagraph(node.raw, getContentRange(node), offset);
	}

	/** At the end of the text's line the break waits for the next insertion to write it; anywhere
	 *  else it writes its bytes now. */
	function writeHardBreak(offset: number): void {
		const content = getContentRange(node);
		const lineEnd = content.end + sameLineSuffix(node).length;
		const ending = editableSurface.lineEnding();
		// A caret in front of a hidden closer at the end is at the end too: nothing paints past it.
		const textEnd = Math.min(content.end, caretBounds().end);
		if (offset >= textEnd && offset <= lineEnd) {
			// Asked of the write gate, so no line opens where its insertion would be refused.
			if (!controller.admitsGesture('hardBreak')) return;
			// The insertion that writes the break starts its own undo entry.
			controller.flushDebouncedCheckpoint();
			pendingBreak.open({ textEnd: content.end, lineEnd, ending });
			setPendingCursorOffset(lineEnd, 'hard-break');
			return;
		}
		const { newRaw, caretOffset } = insertHardBreak(node.raw, offset, ending, content);
		const write = blockEdit.updateBlockContent(index, newRaw, 'authored', offset, caretOffset);
		if (write.admitted) setPendingCursorOffset(write.caret, 'hard-break');
	}

	type SplitCommand = { applies: () => boolean; perform: () => void };

	/** Split so hiding a shown source fits between the halves: `applies` reads only the DOM, and
	 *  `perform` reads `node.raw`, valid only after the source is hidden. */
	function blockCommand(
		id: CommandId,
		arg: unknown,
		offset: number,
		selected: { start: number; end: number } | null,
		run: CommandRun
	): SplitCommand | null {
		const always = (perform: () => void) => ({ applies: () => true, perform });
		switch (id) {
			case 'block.split':
				return always(() => blockEdit.splitBlock(index, offset, run));
			case 'chrome.descendToBody':
				return always(() => blockEdit.descendToBody(index));
			case 'block.hardBreak':
				return always(() => writeHardBreak(offset));
			case 'block.insertTab':
				return {
					// Inside a list item Tab is the list's indent, so decline and let it bubble.
					applies: () => !listContext,
					// A literal tab, because the browser default moves focus out of the editor.
					// The key types its own character, so its write is typing's.
					perform: () => {
						const tabbed = insertLiteralTab(getDisplayText(), offset);
						void writeText({ ...tabbed, intent: 'typed', mode: 'authored', source: 'insert-tab' });
					}
				};
			case 'block.mergePrev':
				return {
					// At or before, not equal: a caret can still be placed at an offset the DOM
					// traversal moves forward, and a strict test would make the key do nothing.
					applies: () => offset <= caretBounds().start && cursor.getRawSelection() === null,
					perform: () => {
						const demoted = demoteBeforeMerge(offset);
						if (!demoted) return void blockEdit.mergeWithPrevious(index);
						const write = blockEdit.updateBlockContent(
							index,
							demoted.newRaw,
							'literal',
							offset,
							demoted.caretOffset
						);
						if (write.admitted) setPendingCursorOffset(write.caret, 'demote');
					}
				};
			case 'block.mergeNext':
				return {
					applies: () => offset >= caretBounds().end && cursor.getRawSelection() === null,
					perform: () => void blockEdit.mergeWithNext(index)
				};
			case 'link.openCard':
				// Consumed whether or not a card opens: `reservedChords()` reports Mod+K as the editor's,
				// and the browser default (Ctrl+K kills a line) would surprise the host.
				return always(enterLinkCard);
			case 'heading.cycle':
				return {
					// A heading marks prose. The raw-editable kinds bind this keymap too, and there
					// an ATX prefix is content: it would destroy a link reference definition.
					applies: () => isProseKind(node.kind),
					perform: () => {
						// `arg` comes untrusted from the keybinding channel, and an out-of-range level
						// would throw inside `repeat`, so it falls back to stripping the heading.
						const level = typeof arg === 'number' && arg >= 0 && arg <= 6 ? arg : 0;
						const cycled = cycleHeading(node.raw, getContentRange(node), level, offset);
						if (!cycled) return;
						// Text after a task box is the to-do's own text, so a written `# ` would stay
						// text there; replacing the block makes the heading and gives the box up.
						if (ambientHoldsTaskBox(ambientPrefix)) {
							const heading = readBlocks(cycled.newRaw, { grammar, scope: 'fragment' }).children;
							const focus = { replacementIndex: 0, offset: cycled.caretOffset };
							void blockEdit.replaceBlock(index, heading, focus, { snapshotOffset: offset });
							return;
						}
						const write = blockEdit.updateBlockContent(
							index,
							cycled.newRaw,
							'literal',
							offset,
							cycled.caretOffset
						);
						if (write.admitted) setPendingCursorOffset(write.caret, 'heading-cycle');
					}
				};
			default: {
				// The format chords come from the policy table: a construct that declares a mark names
				// the command that toggles it, so a new markable kind needs no branch here.
				const marked = inlineMarkForCommand(id);
				return marked === null
					? null
					: always(() => toggleFormat(marked.kind, selected ?? { start: offset, end: offset }));
			}
		}
	}

	export const runCommand = editableSurface.command(
		(id: CommandId, arg?: unknown, run: CommandRun = { afterRemoval: false }): boolean => {
			// Read live: a command dispatched from another block arrives with no input event here.
			const offset = cursor.getRaw() ?? 0;
			const command = blockCommand(id, arg, offset, cursor.getRawSelection(), run);
			if (!command || !command.applies()) return false;
			afterSourceCommit(() => performBlockCommand(id, command.perform), offset);
			return true;
		}
	);

	// A shown source holds this block's edit in the DOM only, so a command waits for it to be
	// written; the user's offset stays valid, since the written text is the DOM text.
	export function afterSourceCommit(run: () => void, offset = cursor.getRaw() ?? 0): void {
		if (!widgetInteraction.isRevealing()) return run();
		const fold = widgetInteraction.foldRevealBeforeMutation(offset);
		void (fold?.settled ?? tick()).then(run);
	}

	// A toolbar asks once per button on every selection change, so the buttons share the parse.
	const formatActive = createInlineFormatActiveMemo();

	// Whether a button shows as pressed: the same displayed text, content and selection the
	// toggle itself uses, and for the card the same construct its own entry resolves.
	export function isCommandActive(id: CommandId): boolean {
		const marked = inlineMarkForCommand(id);
		if (!marked) {
			// The link card is the one pressed state no mark policy answers.
			if (id !== 'link.openCard' || !el) return false;
			return editTargetAt(linkCardQuery(el, cursor.getRawSelection())) !== null;
		}
		const caret = cursor.getRaw() ?? 0;
		const selection = cursor.getRawSelection() ?? { start: caret, end: caret };
		return formatActive(
			{ display: getDisplayText(), content: getContentRange(node), selection, reading },
			marked.kind
		);
	}

	// A command never writes while a source is shown, so a failure means a `runCommand` branch
	// skipped hiding it (G1.26). TODO: hide a shown source at the other entry paths that write.
	function performBlockCommand(id: CommandId, perform: () => void): void {
		assertInvariant('reveal-transition', () =>
			widgetInteraction.isRevealing()
				? { code: 'command-during-reveal', message: `${id} mutated the block with a reveal open` }
				: null
		);
		// A command is not typing: its bytes are their own undo step, so one Ctrl+Z undoes the
		// command alone rather than the burst of typing around it.
		controller.isolateUndoEntry(perform);
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
		runCommand,
		afterSourceCommit,
		afterSelectionRemoved
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
			// Restored only while this block has focus: a commit on blur also sets a pending offset,
			// and restoring it would pull the selection back. Cleared either way.
			const applied = consumePendingRestore(el ?? null, pendingCursorOffset, (offset) => {
				if (!widgetInteraction.revealInterior(offset))
					cursor.setRaw(asRawOffset(offset), { clamp: 'exact' });
			});
			tracePendingCursorConsume(pendingCursorOffset, applied);
			pendingCursorOffset = null;
		}
		// A rebuild makes spans with no marker class, so the shown markers are re-applied before paint.
		// Untracked, so the caret's reads never join this effect's dependencies.
		untrack(() => {
			// Both read the selection, which forces a layout: never in a block the caret has not
			// been in, since a fling mounts many.
			if (composing || !caretHasEntered) return;
			constructReveal.update(true);
			edgeStep.refresh();
		});
		markKeystrokeSettle();
	});

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

	// Only clears: the widget edge means "the click meant this", and only `snapClickToWidgetEdge`
	// sets it.
	function clearSnapTargetIfMoved(root: HTMLElement): void {
		const held = drawnCaret.widgetEdgeFor(widgetEdgeOwner);
		if (held === null) return;
		const sel = window.getSelection();
		// With no range there is nothing to compare the edge against, and this function only clears:
		// the gestures that move the caret elsewhere clear it through their own handlers.
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		if (!root.contains(range.startContainer)) {
			holdWidgetEdge(null);
			return;
		}
		if (rawOffsetAt(root, range.startContainer, range.startOffset) !== held) holdWidgetEdge(null);
	}

	/** The drawn caret's bar beside the widget that starts or ends at `offset`. */
	function widgetEdgeBoxAt(offset: number): WidgetEdgeBox | null {
		if (!el) return null;
		for (const inline of widgetsIn(node, reading)) {
			if (inline.end !== offset && inline.start !== offset) continue;
			const widget = widgetElByStart(el, inline.start);
			return widget && widgetEdgeBox(widget, inline.end === offset ? 'after' : 'before');
		}
		return null;
	}

	/** Whether the press left the browser's caret at an element-level offset in this block, the
	 *  position Chromium paints at the line box's height rather than at the text's. */
	function notePressSeat(root: HTMLElement): void {
		if (!pressPending) return;
		const sel = window.getSelection();
		markDownBesideWidget(
			!!sel &&
				sel.isCollapsed &&
				sel.rangeCount > 0 &&
				root.contains(sel.getRangeAt(0).startContainer) &&
				!caretIsInTextContent(root, sel)
		);
	}

	function endPress(): void {
		pressPending = false;
		markDownBesideWidget(false);
	}

	// The widget edge is cleared even during composition, since an IME caret move invalidates it;
	// the source and marker updates skip composition as `onInput` does.
	$effect(() => {
		const root = el;
		if (!root) return;
		const handler = () => {
			clearSnapTargetIfMoved(root);
			notePressSeat(root);
			if (composing) return;
			// The line goes once the caret leaves it, whatever moved the caret.
			if (pendingBreak.at() !== null && !caretOnPendingBreakLine(root)) pendingBreak.end();
			widgetInteraction.foldRevealIfSelectionEscaped();
			constructReveal.update();
			edgeStep.sync();
		};
		document.addEventListener('selectionchange', handler);
		return () => document.removeEventListener('selectionchange', handler);
	});

	// ── Event Handlers ──────────────────────────────────────────────────

	const onInput = editableSurface.onInput;

	function readRawText(): string {
		return el ? rawTextOfContent(el, node.raw, structuralSuffix(node)) : '';
	}

	// Built once, not per keydown: every typed character passes both key handlers.
	const pendingBreakKeyDeps: PendingBreakKeyDeps = {
		pendingBreak,
		getCaret: () => (cursor.getRawSelection() ? null : cursor.getRaw()),
		getDisplayText,
		hasPendingMarks: () => caretMemory.pendingMarks.get() !== null,
		opensBreak: (ev) => wiring.resolveChord(ev, node.kind) === 'block.hardBreak',
		writeText,
		requestCaret: (at) => setPendingCursorOffset(at, 'pending-break')
	};
	const homeKeyDeps: HomeKeyDeps = {
		getEl: () => el ?? null,
		caretBounds,
		getFocusOffset: () => cursor.getFocusOffset(),
		// Not offset 0: the start value is the one a caret placement clamps past hidden markers.
		focusContentStart: () => focus(CURSOR_START),
		caretWriter
	};

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || editableSurface.isDetached()) return;

		// Ahead of the shared keymap, which takes ArrowLeft at the text's start to the block above.
		if (handlePendingBreakKey(e, pendingBreakKeyDeps)) return;

		// Shows markers only, before any default runs: fast arrows outrun the async
		// `selectionchange` update, and a step against still-hidden markers skips their bytes.
		constructReveal.prepareForKeydown(e);

		// Escape cancels a shown source back to its rendered form; every other key edits the
		// source in the DOM or reaches the commands below, which hide it before writing.
		if ((await widgetInteraction.handleRevealingKeydown(e)) || editableSurface.isDetached()) return;

		// Before `handleSharedKeydown`: selecting cleared the browser range, so the shared
		// ArrowLeft branch would read offset 0.
		if ((await widgetInteraction.handleSelectedWidgetKeydown(e)) || editableSurface.isDetached())
			return;

		// The browser default, with `user-select: none` on the widget, collapses the selection
		// instead of stepping past it.
		if (widgetInteraction.handleShiftArrowIntoWidget(e)) return;

		if ((await handleSharedKeydown(e, sharedCtx)) || editableSurface.isDetached()) return;

		// Every caret-edge construct goes through this one dispatch, keeping contenteditable
		// from corrupting the atomic bytes each stands for.
		if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;

		if (handleHomeKey(e, homeKeyDeps)) return;

		const target = {
			kind: node.kind,
			runCommand,
			getPath: () => myPath,
			afterSourceCommit,
			afterSelectionRemoved
		};
		if (wiring.dispatchChord(e, target)) return;
	}

	/** A range edit in a mode that draws no delimiter goes through the join rules, since the browser
	 *  would leave the crossed markers behind. Elsewhere the browser keeps its own edit. */
	function handleLiveSelectionEdit(e: InputEvent): boolean {
		return applyLiveRangeEdit(
			e,
			node,
			cursor,
			storedAs(),
			widgetInteraction.isRevealing,
			(edit) =>
				void writeText({
					...rangeWrite(edit),
					intent: 'typed',
					mode: 'authored',
					source: 'live-selection-edit'
				})
		);
	}

	// The write takes the same path as the range edit above, so the block repaints once with the
	// caret inside the pair. While a source is shown the caret counts into the DOM text instead.
	function handleDelimiterAutoPair(e: InputEvent): boolean {
		return applyDelimiterAutoPair(e, {
			text: () => (widgetInteraction.isRevealing() ? readRawText() : getDisplayText()),
			content: () => getContentRange(node),
			caret: () => cursor.getRaw(),
			placeTyped: typedPlacement.offsetFor,
			hasSelection: () => cursor.getRawSelection() !== null,
			isRevealing: widgetInteraction.isRevealing,
			foldReveal: () => widgetInteraction.foldRevealBeforeMutation(),
			setCaret: (offset) => cursor.setRaw(asRawOffset(offset), { clamp: 'exact' }),
			seatOutside: caretMemory.noteExtreme,
			hiddenRunAt: edgeStep.hiddenRunAt,
			completesLine: (caret) =>
				planTypedCompletion(node, caret, grammar, editableSurface.lineEnding()) !== null,
			// Each auto-pair caller asks this itself until the caret-edge key table gives it one caller.
			keepsKind: (line) => keepsKindAt(node, line, storedAs()),
			reading,
			ownPairs,
			write: (text, caretAfter) =>
				void writeText({
					text,
					caretAfter,
					intent: 'typed',
					mode: 'authored',
					source: 'delimiter-autopair',
					inPlace: true
				})
		});
	}

	function onBeforeInput(e: InputEvent): void {
		const typedSteps = { autoPair: handleDelimiterAutoPair, rangeEdit: handleLiveSelectionEdit };
		if (applyTypedInput(e, typedSteps)) return;
		// An `insertLineBreak` from a soft keyboard or IME got past `onKeyDown`: consume it, since
		// Shift+Enter is what makes a hard break.
		if (e.inputType === 'insertLineBreak') {
			e.preventDefault();
			return;
		}
	}

	// `onClick` snaps from the press point to the nearest widget edge. Y is kept too: a click at
	// the same column on another visual line must not open a source.
	let lastClickClientX: number | null = null;
	let lastClickClientY: number | null = null;

	/** The browser starts no drag from a non-editable inline widget, so the editor paints the range
	 *  itself from the widget's edge on the press's side. */
	function islandPress(e: PointerEvent): { paintSameBlock: boolean; anchorOffset?: number } {
		if (!el || e.button !== 0 || e.shiftKey) return { paintSameBlock: false };
		const anchorOffset = widgetInteraction.islandDragAnchor(e.clientX, e.clientY);
		if (anchorOffset === null) return { paintSameBlock: false };
		return { paintSameBlock: true, anchorOffset };
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e, islandPress(e))) return;
		lastClickClientX = e.clientX;
		lastClickClientY = e.clientY;
		holdWidgetEdge(null);
		// Only a primary press ends in a click; a context-menu press would keep the caret hidden.
		pressPending = e.button === 0;
		// Read now, not at the `selectionchange` that follows: that event can arrive after a frame
		// has already painted the native caret. Level with a line, where a padding press lands.
		const seat = pressPending && el ? caretSeatInElement(el, e.clientX, e.clientY) : null;
		markDownBesideWidget(
			!!seat && !!el && el.contains(seat.node) && !seatIsInTextContent(el, seat.node)
		);
		// A click on a widget that can show its source is this editor's gesture: cancelling the
		// browser's caret default leaves that code as the only writer of the selection.
		if (widgetInteraction.isPointOnRevealWidget(e.clientX, e.clientY)) e.preventDefault();
	}

	function onBlur(e: FocusEvent): void {
		if (el && e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
		// Save an edit to a shown source before the caret is gone.
		widgetInteraction.commitRevealOnBlur();
		pendingBreak.end();
		holdWidgetEdge(null);
		endPress();
		demoteEmptyHeadingOnBlur();
		syncCaretChrome();
	}

	/** The shown backticks and the edge ring follow focus as well as the caret: a click out of the
	 *  window keeps the selection but fires no `selectionchange`. */
	function syncCaretChrome(): void {
		constructReveal.update();
		edgeStep.sync();
	}

	function onFocus(): void {
		caretHasEntered = true;
		syncCaretChrome();
	}

	function demoteEmptyHeadingOnBlur(): void {
		if (readOnly || node.kind !== 'heading' || editableSurface.isDetached()) return;
		const demoted = demoteEmptyAtxHeading(node.raw, getContentRange(node));
		if (!demoted) return;
		void writeText({
			text: trimTrailingLineEnding(demoted.newRaw),
			caretAfter: demoted.caretOffset,
			intent: 'repair',
			mode: 'literal',
			source: 'demote-on-blur'
		});
	}

	function onClick(e: MouseEvent): void {
		// An inline widget's own handler runs first, and a jump it starts can unmount this
		// block before the click reaches it; nothing below applies to a block that is gone.
		if (!el) return;
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		cursor.clampOutOfMarkerPrefix();
		widgetInteraction.snapClickToWidgetEdge(x, y, {
			click: e,
			clickCount: e.detail,
			// A release that travelled ends a drag rather than a click: showing the source there
			// would unmount the widget the drag just painted a range across.
			moved:
				x !== null && y !== null && (Math.abs(e.clientX - x) > 3 || Math.abs(e.clientY - y) > 3)
		});
		// The click has decided: from here the widget edge hides the browser's caret, or nothing does.
		endPress();
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	// `range` was read before the command ran and must not be read again: hiding a shown source
	// collapses the live selection.
	function toggleFormat(format: InlineMarkKind, range: { start: number; end: number }): void {
		if (!el) return;

		// Where the markers stay hidden, an empty `****` would be invisible bytes, so the mark waits
		// for the next insertion (`docs/design/live-mode.md` § 4.3).
		if (reading.hidesDelimitersAtCaret() && range.start === range.end) {
			// The insertion that spends the mark starts its own undo entry, so it is never
			// merged into the burst the chord interrupted.
			controller.flushDebouncedCheckpoint();
			caretMemory.pendingMarks.toggle(format);
			return;
		}

		const toggled = toggleInlineFormat(
			{
				display: getDisplayText(),
				content: getContentRange(node),
				selection: range,
				reading
			},
			format
		);
		if (!toggled) return;
		const { newDisplay, newSelStart, newSelEnd } = toggled;

		const write = blockEdit.updateBlockContent(
			index,
			withOwnEnding(node, newDisplay),
			'literal',
			range.start,
			newSelStart
		);
		if (!write.admitted) return;

		tick().then(() => {
			setSelection(write.caret, write.storedOffset(newSelEnd));
		});
	}
</script>

<!-- Reading mode turns contenteditable off, ruling out every browser edit; tabindex keeps focus
	and arrow traversal. Both roles the spread sets are interactive, which the compiler cannot see. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={el}
	tabindex="0"
	class="text-editable-block {blockClass}"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
	{...editableSurface.attributes(combobox)}
	style:text-indent={ambientPrefixText ? `calc(-1 * ${ambientIndent})` : null}
	style:padding-left={ambientPrefixText ? ambientIndent : null}
	oninput={onInput}
	onkeydown={editableSurface.onKeyDown}
	onkeyup={edgeStep.afterKey}
	onbeforeinput={editableSurface.onBeforeInput}
	oncopy={clipboardHandlers.onCopy}
	oncut={clipboardHandlers.onCut}
	onpaste={clipboardHandlers.onPaste}
	onpointerdown={onPointerDown}
	onclick={onClick}
	onblur={onBlur}
	onfocus={onFocus}
	oncompositionstart={editableSurface.onCompositionStart}
	oncompositionend={editableSurface.onCompositionEnd}
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

	.text-editable-block :global(.md-autolink) {
		color: var(--syntax-url, var(--color-accent, #567b67));
		text-decoration: underline;
	}
</style>
