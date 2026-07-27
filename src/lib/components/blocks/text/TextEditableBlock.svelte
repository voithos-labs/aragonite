<script lang="ts">
	import { getContext, tick, untrack } from 'svelte';
	import type { BlockEditActions, FocusActions, HistoryActions } from '../../../action-contracts';
	import { type AmbientPrefix, type BlockComponent } from '../../../block-component';
	import type { DocumentView, NodeView } from '../../../core/node-views';
	import type { EditorRects } from '../../../editor-rects';
	import { emitCommandError } from '../../../editor-events';
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
	import { isProseKind } from '../../../core/inline';
	import { resolvedInlineContent } from '../../../core/inline/inline-cache';
	import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
	import { isInlineWidget } from '../../../core/inline/inline-widgets';
	import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
	import { hasSelection as hasSelectionHelper } from '../../../cursor/content-offsets';
	import { FALLBACK_CONTENT_WIDTH } from '../../../cursor/typography-estimates';
	import { toggleInlineFormat } from './format-toggle';
	import { cycleHeading, insertHardBreak, insertLiteralTab } from './text-keydown';
	import { createTextClipboard } from './text-clipboard';
	import { createTextRender } from './text-render';
	import { createWidgetInteraction } from './widget-interaction';
	import { createEdgePolicyDispatch } from './edge-policy-dispatch';
	import { createConstructReveal } from './construct-reveal';
	import { assertInvariant } from '../../../invariants/assert';
	import { widgetElByStart } from './widget-adjacency';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import { createEditableSurface, consumePendingRestore } from '../editable-surface';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import {
		domTextOffsetAtNode,
		rawTextOfNode,
		createRangeAtDomTextOffsets
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
		// Accepted for BlockComponentProps parity — BlockHost passes `document` to
		// every block uniformly; this surface reads the doc from the document facet,
		// so the prop stays unbound (binding it would shadow the global `document`).
		document?: DocumentView;
		// Accepted for BlockComponentProps parity; this surface navigates through the
		// editor, not the rect seam, so the prop stays unbound.
		rects?: EditorRects;
	} = $props();

	const ambientPrefixText = $derived(
		typeof ambientPrefix === 'string' ? ambientPrefix : ambientPrefix.text
	);

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	// Present when this paragraph sits inside a list item — used to skip
	// Tab handling in prose (the enclosing ListItemBlock owns Tab-as-indent).
	const listContext = getContext(LIST_CONTEXT_KEY);
	const {
		reorder,
		controller,
		pasteCoordinator,
		stickyColumn,
		selection,
		widgetSelection,
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
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	// The constant fallback keeps the zero-cost render path — an empty island set
	// never enters the render key.
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
	// Survives the click→keydown gap when Chromium clears the caret at
	// CE=false-adjacent positions. Reactive so the snap-caret overlay sees changes.
	let lastSnapTargetOffset = $state<number | null>(null);

	// One funnel for every pending-cursor write, tagged with its source so the
	// interaction trace names which gesture set the restore. The consume half lives
	// in the render effect (applied vs skipped-on-focus-loss).
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
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode: () => presentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		grammar: registryView.grammar,
		getFocusOffset: () => {
			if (!el) return null;
			const sel = window.getSelection();
			if (!sel || sel.focusNode === null || !el.contains(sel.focusNode)) return null;
			const content = domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
			return toClampedRawOffset(content, ambientLength);
		},
		getTextLen: () => liveDisplayLength(),
		readText: () => readRawText(),
		commitInput: (text, preEdit, saved) => {
			void blockEdit.updateBlockContent(index, text + trailingLineEnding(node.raw), preEdit, saved);
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

	// After widgetInteraction so the reveal-fold seam is available: a clipboard
	// mutation folds a live reveal before touching the CST.
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
		readRevealedText: () => readRawText(),
		get linkRef() {
			return linkRef;
		}
	});

	// preview-inline's marker reveal: caret-chain evaluation on selection cadence,
	// CSS class flips only — no keys intercepted, no bytes touched.
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

	// The one caret-edge dispatch: CST widget → decoration island → ambient overlap,
	// each resolved against its declarative edge policy. Replaces the three former
	// sibling seams; entry (reveal vs select) stays at widgetInteraction.enterWidget.
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
		isReading: () => readOnly
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
		getDocument: () => getDoc(),
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

	/** The display length the CARET walks — the DOM's while a reveal is open, since
	 *  the CST has not seen that edit. Measured against `node.raw` instead, an edited
	 *  reveal at the block's end traps the caret: the live end sits short of the stale
	 *  length, so no press reads as "at the boundary". Every caret-boundary test here
	 *  reads this, as the table cell's sibling context already does. */
	function liveDisplayLength(): number {
		return widgetInteraction.isRevealing() ? readRawText().length : getDisplayText().length;
	}

	/** One arm per command this block owns, split so the reveal fold can sit between
	 *  the halves: `applies` reads only the DOM and stays valid across a fold, every
	 *  `perform` reads `node.raw` and is valid only after one. `offset` and `selected`
	 *  are read once before any fold and closed over — the fold parks its own caret,
	 *  which would move them out from under the mutation. Null = not this block's. */
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
					// Inside a list item Tab is the list's indent — decline so it bubbles.
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
					applies: () => offset === 0 && !hasSelectionHelper(),
					perform: () => void blockEdit.mergeWithPrevious(index)
				};
			case 'block.mergeNext':
				return {
					applies: () => offset === liveDisplayLength() && !hasSelectionHelper(),
					perform: () => void blockEdit.mergeWithNext(index)
				};
			case 'format.toggleStrong':
				return always(() => toggleFormat('strong', selected));
			case 'format.toggleEmphasis':
				return always(() => toggleFormat('emphasis', selected));
			case 'heading.cycle':
				return always(() => {
					// `arg` arrives as untrusted `unknown` from the widened keybinding channel;
					// accept only an in-range level (0 strips to paragraph, 1–6 sets an ATX
					// level). A non-number or out-of-range value would coerce wrong or throw a
					// RangeError inside `#`.repeat, so fall back to the strip behavior.
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
		// Read the caret live: cross-block dispatch calls runCommand without an
		// onKeyDown to refresh preEditOffset, so it would be stale here.
		const offset = cursor.getRaw() ?? 0;
		const command = blockCommand(id, arg, offset, cursor.getRawSelection());
		if (!command || !command.applies()) return false;
		if (!widgetInteraction.isRevealing()) {
			performBlockCommand(id, command.perform);
			return true;
		}
		// A live reveal holds this block's bytes in ephemeral DOM the CST has never
		// seen, so every `perform` above would splice the pre-reveal source. Fold, let
		// the write settle, then act — the clipboard seam's discipline. The fold keeps
		// the caret where the user left it (not its usual trailing-edge landing): the
		// committed text IS the DOM text the offset was measured against, so it carries
		// over unchanged and the command acts where the user actually pressed.
		widgetInteraction.foldRevealBeforeMutation(offset);
		void tick().then(() => performBlockCommand(id, command.perform));
		return true;
	}

	// The seam's guard: no arm reached through here mutates while a reveal is open —
	// a fire means a `runCommand` branch that skipped the fold, and the bytes it is
	// about to splice are the pre-reveal ones. It guards the arms, NOT every entry
	// path: a caller that reaches `blockEdit` directly, bypassing runCommand, sees
	// neither the fold nor this. Adding an arm to `blockCommand`'s switch inherits
	// both by construction, which is the case worth making safe; the wider funnel is
	// ledgered in docs/issues.md.
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
		// carryCaret false on the edit path (a pending restore is armed): the consume
		// below overwrites the selection, so the render's own caret walk is dead work.
		textRender.render({
			forceRebuild: pendingCursorOffset !== null,
			carryCaret: pendingCursorOffset === null
		});
		if (perfEnabled()) recordBlockRender(performance.now() - t0, myPath);

		if (pendingCursorOffset !== null) {
			// Restore the caret only while this block still owns focus. A blur-commit
			// (revealed source persisted as focus leaves) also sets a pending offset;
			// without this guard the restore would yank the global selection back into
			// the just-blurred block. The clear runs regardless so a skipped restore is
			// dropped, never re-armed.
			const applied = consumePendingRestore(el ?? null, pendingCursorOffset, (offset) =>
				cursor.setRaw(asRawOffset(offset))
			);
			tracePendingCursorConsume(pendingCursorOffset, applied);
			pendingCursorOffset = null;
		}
		// A rebuild mints fresh spans with no reveal class; re-apply synchronously
		// (before paint) or typing inside a revealed construct folds for one frame
		// per keystroke. untracked: the caret chain must never join the effect's
		// dependencies (selection and the inline cache are non-reactive anyway).
		untrack(() => {
			if (!composing) constructReveal.update(true);
		});
		markKeystrokeSettle();
	});

	// Windowed out while focused: hand focus to the editor root so the next
	// keystroke routes through its document-level listener instead of falling to
	// <body>. See parkFocusOnEditorRoot.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
	});

	// Asymmetric clearer: when the caret lands anywhere other than the snap target,
	// drop the synthetic indicator. Never auto-sets on the caret reaching a boundary
	// by non-click means — synthetic is click-intent, armed only by snapClickToWidgetEdge.
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

	// One document selectionchange listener drives the block's whole selection cadence.
	// The snap clearer runs even during composition — an IME caret move still invalidates
	// a click-intent snap. The reveal machines are composition-gated (like onInput): a
	// mid-IME move must neither commit a revealed source edit nor flip preview-inline
	// marker visibility. Blur keeps owning the focus-leaving widget-source fold.
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
		// The synthetic caret stands in for a native one Chromium renders unreliably
		// beside a contenteditable=false island — but "unreliably" cuts both ways, and
		// when it does render the user sees two carets at one position. The block's own
		// caret goes dark for as long as the synthetic is up; there is no way to ask the
		// browser whether it painted, so mutual exclusion is the only guarantee available.
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

		// Synchronous construct-reveal backstop, before any default runs: rapid
		// arrows outrun the async selectionchange reveal (input events outrank
		// normal tasks), and a step computed against folded markers skips their
		// bytes. Never consumes the key.
		constructReveal.prepareForKeydown(e);

		// Revealed `$…$` source: Escape cancels back to rendered. Every other key edits
		// the source natively (onInput suppressed) or reaches the command seam below,
		// which folds the reveal before it mutates — Enter still splits the block.
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

		// Every caret-edge construct — CST widget, decoration island, ambient overlap —
		// intercepts a plain edge key through this one dispatch, keeping native
		// contenteditable from silently corrupting the atomic bytes each stands for.
		if (edgeDispatch.handleKeydown(e, cursor.getRaw())) return;

		// Home with an ambient marker: native Home lands at DOM 0 (before the
		// marker span). Skip that — the user wants raw offset 0, i.e. the
		// position immediately after the ambient span.
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

	function onClick(): void {
		const x = lastClickClientX;
		const y = lastClickClientY;
		lastClickClientX = null;
		lastClickClientY = null;
		cursor.clampOutOfAmbient();
		widgetInteraction.snapClickToWidgetEdge(x, y);
	}

	// ── Formatting shortcuts ────────────────────────────────────────────

	// `offsets` is the range the COMMAND read before it ran. A fold on the way in
	// commits the revealed source and parks a caret, which collapses the live
	// selection — so re-reading it here would find nothing to toggle and the user's
	// chord would vanish. The pre-fold range still addresses the committed text,
	// which is the DOM text it was measured against.
	function toggleFormat(
		format: 'strong' | 'emphasis',
		offsets: { start: number; end: number } | null
	): void {
		if (!el || !offsets) return;

		const { newDisplay, newSelStart, newSelEnd } = toggleInlineFormat(
			getDisplayText(),
			offsets,
			format
		);

		blockEdit.updateBlockContent(index, newDisplay + trailingLineEnding(node.raw), newSelStart);

		tick().then(() => {
			setSelection(newSelStart, newSelEnd);
		});
	}
</script>

<!-- Reading mode flips contenteditable off: the whole browser-edit-path class
	(beforeinput/input, IME, native paste/cut, drag-drop insertion) dies
	structurally. tabindex/role are independent, so focus + arrow traversal stay. -->
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
