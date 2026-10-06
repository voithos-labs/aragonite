<script lang="ts">
	import { getContext, tick } from 'svelte';
	import { type BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type CodeRunRequest,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { asRawOffset } from '../../../cursor/coordinate-spaces';
	import {
		CONTENT_EMPTY_ATTR,
		holdsOnlyMarkerChrome,
		selectRawRange,
		type RawRange
	} from '../../../cursor/widget-offset';
	import { createSurfaceBackend } from '../../../cursor/surface-backend';
	import { handleSharedKeydown } from '../../../selection/shared-keydown';
	import {
		createEditableSurface,
		createClipboardHandlers,
		consumePendingRestore,
		editableSurfaceAttributes
	} from '../editable-surface';
	import type { ClipboardCopy } from '../clipboard-step';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../surface-wiring.svelte';
	import { anchorTrailingNewline, plainTextOf } from '../plain-text-backend';
	import { renderCodeBlock, sliceFencedCode } from './code-renderer';
	import {
		getCloserFor,
		getLineLeadingWhitespace,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from './code-editing';
	import { shiftCodeLines } from './code-indent';
	import { computeCodeEnter } from './code-enter';
	import { computeAutoPair } from './code-beforeinput';
	import { fenceShapeOf, writeFenceInfo } from '../../../schema/fenced-code-raw';
	import { fenceLanguage } from '../../../core/parsers/fence-syntax';
	import { hidesMarkers, paintsFocusedMarkers } from '../../../presentation-mode';
	import CodeBlockRail from './CodeBlockRail.svelte';
	import { computeFenceExit, computeTypedFenceExit } from './code-fence-exit';
	import {
		classifyFenceBoundary,
		bodyWindow,
		clampCaretToBody,
		clampEnterOffsetToBody,
		clampRangeToBody,
		computeFenceRangedEdit,
		computeRangedEdit,
		crossesFenceBoundary,
		fenceEditSpan,
		isStructureOnlyRange,
		orderedRange
	} from './code-fence-boundary';
	import { metadataOf, type CstNode } from '../../../core/nodes';
	import { isBlankText, trimTrailingLineEnding } from '../../../core/lines';
	import type { WriteIntent } from '../surface-write';
	import type { ContentWrite } from '../../../action-contracts';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { nodeAt, emptyParagraph } from '../../../tree-operations';
	import { type CommandId } from '../../../schema/commands';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const wiring = wireSurfaceContexts();
	const {
		blockEdit,
		focusActions,
		controller,
		pasteCoordinator,
		caretMemory,
		selection,
		getDoc,
		getEditorRoot,
		activePlugins,
		events: editorEvents,
		reading
	} = wiring.deps;
	const { menuPresence, drafts } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { onPasteImage, onRunCode, codeMenuItems } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const presentationMode = $derived(reading.mode());
	const readOnly = $derived(presentationMode === 'reading');
	// A fence line takes edits where the mode paints it, as the focused block's markers; where it
	// is hidden, an edit that reaches it clamps to the body. A caret arriving lands in the body.
	const fenceLinesEditable = $derived(paintsFocusedMarkers(presentationMode));
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';

	const backend = createSurfaceBackend({ getEl: () => el ?? null });

	const editableSurface = createEditableSurface({
		...wiring.deps,
		getEl: () => el ?? null,
		backend,
		// A caret arriving from outside lands on the body in every mode, by a column or a placed
		// offset; only a click or an arrow inside the block reaches a fence line the mode paints.
		columnWindow: () => bodyWindow(node),
		clampLanding: (offset) => clampCaretToBody(node, offset),
		getNode: () => node,
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		requestCaret: (at) => {
			pendingCursorOffset = at;
		},
		getFocusOffset: backend.getFocusOffset,
		getTextLen: () => plainTextOf(el).length,
		readText: () => plainTextOf(el),
		handleKeydown: onKeyDown,
		handleBeforeInput: onBeforeInput
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

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

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	/** Writes edited display text; the surface's write records the undo caret, keeps the block's
	 *  line ending and puts the caret back at `caretAfter` as stored. */
	function writeCode(
		text: string,
		caretAfter: number,
		source: string,
		intent: WriteIntent = 'typed'
	): ContentWrite {
		return editableSurface.writeText({ text, caretAfter, intent, mode: 'authored', source });
	}

	/** Selects `range` after its write, moved by however far the fence rule moved its start. */
	function selectAfter(written: ContentWrite, range: RawRange): void {
		if (!written.admitted || !written.keepsCaret) return;
		const shift = written.caret - range.start;
		pendingSelection = { start: written.caret, end: range.end + shift };
	}

	/** An edit made on the way out of the block: the caret goes to the next block, not back here. */
	function writeExitEdit(text: string, caretAfter: number): void {
		void editableSurface.writeText({
			text,
			caretAfter,
			intent: 'typed',
			mode: 'authored',
			source: 'fence-exit',
			leavesCaret: true
		});
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node, activePlugins));
		anchorTrailingNewline(el);
		// The marker-hiding CSS and the caret traversal read this attribute; the side gutter does
		// not, since an empty fence gets one either way.
		el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
		lastRenderedRaw = node.raw;

		// Restore only while this block holds focus: an edit reparsing into several blocks moves
		// the caret to the split-off sibling. The pending fields clear either way.
		if (pendingSelection !== null) {
			consumePendingRestore(el, pendingSelection, (range) =>
				selectRawRange(el!, range.start, range.end)
			);
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			consumePendingRestore(el, pendingCursorOffset, (offset) =>
				backend.setRaw(asRawOffset(offset), { clamp: 'exact' })
			);
			pendingCursorOffset = null;
		}
	});

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

	// A commit can turn this block into another kind (a `math` info string makes a math fence),
	// and a step deferred past that commit then has no code block left to act on.
	const isStillCode = () => node.kind === 'fencedCode';

	// ── The side gutter ───────────────────────────────────────────────────────

	// The side gutter stands in for fence markers the mode does not draw, so source mode never gets
	// one. An empty fence gets it too, dimmed markers and all: the picker is how a language is set.
	const showRail = $derived(hidesMarkers(presentationMode));
	const infoString = $derived(metadataOf(node, 'fencedCode').info);

	/** The fence body alone, which is what a host runs or a copy writes, never the opener
	 *  and closer lines, which are this block's syntax rather than its content. */
	function bodyText(): string {
		return sliceFencedCode(node).body;
	}

	function runRequest(): CodeRunRequest {
		return {
			code: bodyText(),
			info: infoString,
			language: fenceLanguage(infoString),
			path: myPath
		};
	}

	/** Offers the language picker on the first focus of an empty fence with no language. Keyed on
	 *  focus, since a block an insert command creates mounts after that commit. */
	let autoOpenLanguage = $state(false);
	let languageOffered = false;
	function onSurfaceFocus(): void {
		if (languageOffered || readOnly || !showRail) return;
		languageOffered = true;
		// A caret that stepped into an existing fence is passing through, and a picker would trap
		// it; a click or an insert command records no arrival key, and that is the user authoring.
		const steppedIn = metadataOf(node, 'fencedCode').closed && caretMemory.side() !== null;
		const offerLanguage = infoString === '' && isBlankText(bodyText()) && !steppedIn;
		// Deferred past the commit's own caret placement, which focuses this block a second time
		// and would blur a picker opened on the first. A bare fence is completed before it opens.
		void tick().then(async () => {
			if (!isStillCode()) return;
			const completion = bareFenceCompletion();
			if (completion) await completeOnArrival(completion);
			if (offerLanguage) autoOpenLanguage = true;
		});
	}

	// No key brought the caret here, so the completion records it the way a command does.
	const completeOnArrival = editableSurface.command((completion: BareFenceCompletion) =>
		writeCode(completion.text, completion.caretAfter, 'complete-fence', 'repair')
	);

	interface BareFenceCompletion {
		text: string;
		caretAfter: number;
	}

	/** A fence with no body line has nowhere for a caret, so it is written as opener, one empty
	 *  body line and closer, with the caret on that line. Null when the fence has a body. */
	function bareFenceCompletion(): BareFenceCompletion | null {
		if (!el) return null;
		const meta = metadataOf(node, 'fencedCode');
		const slice = sliceFencedCode(node);
		const text = getDisplayText();
		const ending = editableSurface.lineEnding();
		if (!meta.closed) {
			if (!isBlankText(slice.body)) return null;
			const closer = meta.fenceMarker.repeat(meta.fenceLength);
			return { text: text + ending + ending + closer, caretAfter: text.length + ending.length };
		}
		if (slice.body !== '') return null;
		const openerLength = slice.openerLine.length;
		return {
			text: text.slice(0, openerLength) + ending + text.slice(openerLength),
			caretAfter: openerLength
		};
	}

	async function copyBody(): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(bodyText());
			return true;
		} catch {
			// A denied or absent clipboard is the host's business, not an editor error: the
			// affordance simply reports nothing copied.
			return false;
		}
	}

	// What the language chip writes: the opener's info string, through the surface's write so the
	// fence rule runs over it, kept apart so no typing on either side joins its undo entry.
	function commitLanguage(info: string): void {
		// Unchanged or refused bytes close the field without writing. The field starts from the
		// trimmed info, so comparing fence bytes alone would let a bare Enter respell padding.
		if (info === infoString) {
			returnCaretToBody();
			return;
		}
		const display = getDisplayText();
		const written = writeFenceInfo(display, info, fenceShapeOf(node));
		const bodyStart = clampCaretToBody(node, 0);
		if (written !== null && written !== display) {
			controller.isolateUndoEntry(
				() =>
					void editableSurface.writeText({
						text: written,
						caretAfter: bodyStart,
						intent: 'command',
						mode: 'authored',
						source: 'language',
						// The caret is in the language field, so undo returns it to the body start.
						sessionAnchor: bodyStart
					})
			);
		}
		returnCaretToBody();
	}

	/** Puts the caret at the body start after the side gutter closes; not `focus(0)`, which on an
	 *  unclosed fence sits before the backticks. */
	function returnCaretToBody(): void {
		// The caret goes through the pending field the render effect reads: a bare `focus()` after
		// a tick races the commit's re-render, which replaces every child and loses the caret.
		el?.focus({ preventScroll: true });
		void tick().then(() => {
			if (!isStillCode()) return;
			// Read the body after the commit lands: a new language lengthens the opener, so an
			// offset taken before the commit would put the caret inside the info string.
			const at = clampRangeToBody(node, { start: 0, end: 0 }).start;
			pendingCursorOffset = at;
			focus(at);
		});
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	const onCompositionEnd = editableSurface.onCompositionEnd;

	// An IME deletes the selection as it starts composing, and its `insertCompositionText` is not
	// cancelable, so with the fence lines hidden the block deletes the body part itself first.
	function onCompositionStart(): void {
		const sel = backend.getRawSelection();
		editableSurface.onCompositionStart();
		if (!sel || sel.start === sel.end || fenceLinesEditable) return;
		const edit = computeFenceRangedEdit(node, sel, '');
		const caret = edit ? edit.newCursor : clampCaretToBody(node, sel.start);
		// Synchronous, since the IME composes at wherever the caret is once this handler returns.
		if (edit) void writeCode(edit.newText, caret, 'composition-delete');
		else setSelection(caret, caret);
	}

	function onBeforeInput(e: InputEvent): void {
		if (guardFenceRangedEdit(e)) return;
		// Soft break: Shift+Enter, and mobile/IME insertLineBreak without a keydown.
		// Gated on !composing so an IME emitting it mid-composition does not sync.
		if (e.inputType === 'insertLineBreak' && !composing && el) {
			e.preventDefault();
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: enterSpliceSpan(currentRange()),
				mode: 'soft',
				ending: editableSurface.lineEnding()
			});
			void writeCode(result.newText, result.newCursor, 'soft-break');
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const rawSelection = backend.getRawSelection();
		// A wrap is the one range edit that reaches here; with the fence lines hidden it wraps the body.
		const selOffsets =
			rawSelection && !fenceLinesEditable ? fenceEditSpan(node, rawSelection) : rawSelection;
		const offset = selOffsets ? selOffsets.start : (backend.getRaw() ?? 0);

		const meta = metadataOf(node, 'fencedCode');
		const collapsed = !selOffsets || selOffsets.start === selOffsets.end;
		const typedExit = collapsed
			? computeTypedFenceExit({ text, offset, meta, typed: data })
			: { kind: 'none' as const };
		if (typedExit.kind === 'exitWithEdit') {
			e.preventDefault();
			writeExitEdit(typedExit.newText, offset);
			exitDownward();
			return;
		}

		// A marker run is syntax, not code: a backtick typed onto one widens the fence instead.
		if (collapsed && !isInBody(offset)) return;
		const result = computeAutoPair({
			text,
			selection: selOffsets ?? { start: offset, end: offset },
			typed: data,
			unclosedBacktickFence: meta.closed === false && meta.fenceMarker === '`'
		});
		if (!result) return;

		e.preventDefault();
		if (result.kind === 'skip') {
			backend.setRaw(asRawOffset(result.caretOffset), { clamp: 'exact' });
			return;
		}
		if (result.kind === 'wrap') {
			// Both endpoints sit inside the body, so whatever is inserted ahead of the
			// wrap's start moves its end by the same amount.
			const written = writeCode(result.newText, result.selection.start, 'auto-pair');
			selectAfter(written, result.selection);
		} else {
			void writeCode(result.newText, result.caretOffset, 'auto-pair');
		}
	}

	// ── Fence-crossing edits ──────────────────────────────────────────────────

	/** Where an Enter or soft break splices: a caret clamps out of the fence lines, and a
	 *  selection is replaced on its body span like every other ranged edit here. */
	function enterSpliceSpan(range: RawRange): RawRange {
		if (range.start !== range.end) return fenceEditSpan(node, range);
		const at = clampEnterOffsetToBody(node, range.start);
		return { start: at, end: at };
	}

	/** The one check for every browser edit that rewrites a range here. With the fence lines
	 *  hidden, one that crosses a fence line moves onto the body instead of splicing it away. */
	function guardFenceRangedEdit(e: InputEvent): boolean {
		if (composing || !el || fenceLinesEditable) return false;
		const range = pendingEditRange(e);
		if (!range) return false;
		if (wrapsBody(e, range)) return false;
		// Chromium's own replace of a range opening on a highlighted token also removes the hidden
		// opener, so the block writes every replacement, inside the body or not.
		if (!crossesFenceBoundary(node, range) && !replacesRange(e, range)) {
			return guardHiddenFenceDelete(e, range);
		}

		e.preventDefault();
		const insert = rangedEditInsertion(e, fenceEditSpan(node, range));
		if (insert === null) return true;
		const edit = computeFenceRangedEdit(node, range, insert);
		if (!edit) return true;
		void writeCode(edit.newText, edit.newCursor, 'fence-ranged-edit');
		return true;
	}

	/**
	 * A delete while the fence lines are hidden is applied here, clamped to the body: Chromium,
	 * deleting the last visible character of a line, also removes the unrendered fence line beside it.
	 */
	function guardHiddenFenceDelete(e: InputEvent, range: RawRange): boolean {
		if (!/^delete(?!By)/.test(e.inputType)) return false;
		e.preventDefault();
		const span = clampRangeToBody(node, range);
		if (span.end > span.start) {
			const text = getDisplayText();
			void writeCode(text.slice(0, span.start) + text.slice(span.end), span.start, 'fence-delete');
		}
		return true;
	}

	function isInBody(offset: number): boolean {
		const body = bodyWindow(node);
		return offset >= body.start && offset <= body.end;
	}

	function replacesRange(e: InputEvent, range: RawRange): boolean {
		const replacing = e.inputType === 'insertText' || e.inputType === 'insertReplacementText';
		return replacing && range.start !== range.end;
	}

	/** A bracket or quote typed over a range wraps it (the auto-pair path), unless the range
	 *  holds no body at all. */
	function wrapsBody(e: InputEvent, range: RawRange): boolean {
		if (e.inputType !== 'insertText' || e.data?.length !== 1 || range.start === range.end) {
			return false;
		}
		return getCloserFor(e.data) !== null && !isStructureOnlyRange(node, range);
	}

	/** `getTargetRanges()` wins, since a word delete at a collapsed caret reports the word; it is
	 *  feature-detected because jsdom lacks it. */
	function pendingEditRange(e: InputEvent): RawRange | null {
		const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
		if (targets.length > 0) return backend.rawRangeOf(targets[0]);
		const selected = backend.getRawSelection();
		if (selected) return selected;
		const caret = backend.getRaw();
		return caret === null ? null : { start: caret, end: caret };
	}

	/** The text an input type writes over its span, or null to refuse it. A `dataTransfer`
	 *  payload is refused, since it would skip the paste transforms (G4.11). */
	function rangedEditInsertion(e: InputEvent, span: RawRange): string | null {
		if (e.inputType.startsWith('delete')) return '';
		switch (e.inputType) {
			case 'insertText':
				return e.data ?? '';
			case 'insertLineBreak':
				return editableSurface.lineEnding();
			// The keydown path auto-indents (computeCodeEnter 'normal'), and a mobile or
			// IME insertParagraph is the same gesture arriving without a keydown.
			case 'insertParagraph':
				return (
					editableSurface.lineEnding() + getLineLeadingWhitespace(getDisplayText(), span.start)
				);
			default:
				return null;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;
		if (!el) return;

		if ((await handleSharedKeydown(e, sharedCtx)) || editableSurface.isDetached()) return;

		if (wiring.dispatchChord(e, { kind: node.kind, runCommand, getPath: () => myPath })) return;
	}

	// ── Commands ────────────────────────────────────────────────────────

	export const runCommand = editableSurface.command((id: CommandId): boolean => {
		switch (id) {
			case 'format.toggleStrong':
			case 'format.toggleEmphasis':
			case 'format.toggleStrikethrough':
			case 'format.toggleCode':
			case 'link.openCard':
				return true; // code blocks carry no inline constructs; swallow to stop the browser default
			case 'code.newline':
				return codeNewline();
			case 'code.indent':
				shiftSelection('indent');
				return true;
			case 'code.dedent':
				shiftSelection('dedent');
				return true;
			case 'code.backspace':
				return codeBackspace();
			case 'code.delete':
				return codeDelete();
			default:
				return false;
		}
	});

	function codeBackspace(): boolean {
		if (!el || backend.getRawSelection() !== null) return false;
		const offset = backend.getRaw() ?? 0;
		// Offset 0 always leaves the block; so does the body start, where a native Backspace would
		// delete the opener's terminating `\n`.
		if (
			offset === 0 ||
			classifyFenceBoundary({ node, offset, forward: false }).kind === 'exitPrev'
		) {
			// At the top of an empty fence the key can only mean the block, so it goes; a fence
			// with a body keeps the step-out, since one keypress must never take code with it.
			if (isBlankText(bodyText())) {
				void blockEdit.deleteBlock(index, 'Backspace');
				return true;
			}
			focusActions.moveFocus(index - 1, 'end');
			return true;
		}

		// Pair-delete: remove both halves so the auto-closed companion isn't stranded.
		// A caret inside a backtick fence run reads as a pair, so it declines there.
		const text = getDisplayText();
		const pairSpan = { start: offset - 1, end: offset + 1 };
		if (isBetweenEmptyPair(text, offset) && !crossesFenceBoundary(node, pairSpan)) {
			void writeCode(text.slice(0, offset - 1) + text.slice(offset + 1), offset - 1, 'pair-delete');
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || backend.getRawSelection() !== null) return false;
		const offset = backend.getRaw() ?? 0;
		if (classifyFenceBoundary({ node, offset, forward: true }).kind === 'exitNext') {
			// The root's forward asymmetry (past-end appends a paragraph) would strand a
			// spurious block here, so suppress the append; no-op at the true doc end.
			focusActions.moveFocus(index + 1, 'start', { append: false });
			return true;
		}
		return false;
	}

	// The browser's insertParagraph adds <div>/<br> elements that don't affect
	// textContent, so the CST never sees the edit; Enter goes through the CST instead.
	function codeNewline(): boolean {
		if (!el) return false;
		// Read live: a command dispatched from another block arrives with no input event here.
		const offset = backend.getRaw() ?? 0;
		const text = getDisplayText();
		const meta = metadataOf(node, 'fencedCode');

		// Source mode paints the markers and never completes a bare fence on focus, so Enter is
		// where it happens there; the marker-hiding modes did it as the caret arrived.
		const completion = bareFenceCompletion();
		if (completion) {
			void writeCode(completion.text, completion.caretAfter, 'complete-fence');
			if (infoString === '' && !readOnly && !languageOffered) {
				languageOffered = true;
				void tick().then(() => {
					autoOpenLanguage = true;
				});
			}
			return true;
		}

		const exit = computeFenceExit({ text, offset, meta });
		if (exit.kind === 'closeAndExit') {
			closeUnclosedFenceAndDescend(exit.newText, offset);
			return true;
		}
		if (exit.kind !== 'none') {
			if (exit.kind === 'exitWithEdit') writeExitEdit(exit.newText, offset);
			exitDownward();
			return true;
		}

		const span = enterSpliceSpan(currentRange());

		// Electric indent: between an empty bracket pair, expand into three lines with an
		// extra indent on the middle. Quote pairs stay inline; a selection is replaced.
		const ending = editableSurface.lineEnding();
		if (span.start === span.end && isBetweenEmptyBracketPair(text, span.start)) {
			const at = span.start;
			const indent = getLineLeadingWhitespace(text, at);
			const inner = indent + ELECTRIC_INDENT_UNIT;
			const newText = text.slice(0, at) + ending + inner + ending + indent + text.slice(at);
			void writeCode(newText, at + ending.length + inner.length, 'enter');
			return true;
		}

		const enter = computeCodeEnter({
			display: text,
			selection: span,
			mode: 'normal',
			ending
		});
		void writeCode(enter.newText, enter.newCursor, 'enter');
		return true;
	}

	// Leaving a closed fence with Enter stays inside the fence's own container (the next sibling,
	// or a new paragraph there), so a nested last child keeps the caret inside.
	function exitDownward(): void {
		const container = myPath.length > 1 ? nodeAt(getDoc(), myPath.slice(0, -1)) : null;
		const isNestedLastChild = !!container?.children && index === container.children.length - 1;
		if (isNestedLastChild) blockEdit.descendToBody(index);
		else focusActions.moveFocus(index + 1, 'start');
	}

	// Leaving an unclosed fence downward writes its closer, which stops a save and reload from
	// absorbing the blocks below into it. Closer and new paragraph land as one commit.
	function closeUnclosedFenceAndDescend(closedDisplay: string, caretBefore: number): void {
		const meta = metadataOf(node, 'fencedCode');
		const lineEnding = editableSurface.lineEnding();
		const closedFence: CstNode = {
			kind: 'fencedCode',
			leadingTrivia: '',
			raw: closedDisplay + lineEnding,
			metadata: { ...meta, closed: true }
		};
		// The blank separator line and the paragraph's own line are both pure line
		// ending, so both take the one the closer above got.
		const paragraphBelow = emptyParagraph(lineEnding, lineEnding);
		void blockEdit.replaceBlock(
			index,
			[closedFence, paragraphBelow],
			{ replacementIndex: 1, offset: 0 },
			{ snapshotOffset: caretBefore }
		);
	}

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		focusAtColumn,
		insertMarkdown,
		runCommand
	} satisfies BlockComponent);

	function currentRange(): { start: number; end: number } {
		if (!el) return { start: 0, end: 0 };
		const sel = backend.getRawSelection();
		if (sel) return sel;
		const cursor = backend.getRaw() ?? 0;
		return { start: cursor, end: cursor };
	}

	// `el` is checked only because `currentRange()` reads the DOM selection through it.
	function shiftSelection(direction: 'indent' | 'dedent'): void {
		if (!el) return;
		const result = shiftCodeLines(node, currentRange(), direction);
		if (!result) return;
		const written = writeCode(result.text, result.selection.start, 'indent');
		// Both endpoints sit inside the body, so an escalation inserting at the opener
		// run moves them by the same delta.
		if (result.selection.start !== result.selection.end) selectAfter(written, result.selection);
	}

	// ── Pointer + clipboard ─────────────────────────────────────────────

	function onPointerDown(e: PointerEvent): void {
		void crossBlock.handlePointerDown(e);
	}

	// Copy writes what the browser shows, which leaves out hidden fence lines; the removal clamps to
	// the body there, so a cut takes what its copy wrote.
	function copySelection(e: ClipboardEvent): ClipboardCopy<RawRange> {
		const range = el ? backend.getRawSelection() : null;
		if (!range) return null;
		e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
		return { held: range };
	}

	function removeSelection(range: RawRange): void {
		const edit = fenceLinesEditable
			? computeRangedEdit(getDisplayText(), range, '')
			: computeFenceRangedEdit(node, range, '');
		if (edit) void writeCode(edit.newText, edit.newCursor, 'cut', 'command');
	}

	const clipboard = createClipboardHandlers({
		caretMemory,
		selection,
		getDoc,
		crossBlock,
		isReadOnly: () => readOnly,
		caret: editableSurface.caret,
		events: editorEvents,
		onPasteImage,
		rangeArm: { copy: copySelection, remove: removeSelection },
		pasteTail: async (pastedText, { range }) => {
			if (!el) return;
			// Where the fence lines are hidden, paste refuses where typing refuses: a target confined
			// to fence structure has nothing to paste into. The tree-op owns the splice.
			const target = range ?? { start: 0, end: 0 };
			if (!fenceLinesEditable && isStructureOnlyRange(node, target)) return;
			const sel = fenceLinesEditable ? orderedRange(target) : fenceEditSpan(node, target);
			const result = await pasteDispatch(
				{
					pastedText,
					targetPath: myPath,
					offset: sel.start,
					preDelete: sel.start !== sel.end ? { start: sel.start, end: sel.end } : undefined,
					caretBefore: editableSurface.caret.getPreEditOffset()
				},
				{
					doc: getDoc(),
					blockEdit,
					controller: pasteCoordinator,
					reading,
					activePlugins
				}
			);

			if (result.inlineCaretOffset !== undefined) {
				pendingCursorOffset = result.inlineCaretOffset;
			}
		}
	});
	const { onCopy, onCut, onPaste } = clipboard;

	export function insertMarkdown(md: string): Promise<boolean> {
		return clipboard.insertMarkdown(md);
	}
</script>

<!-- The textbox role arrives through the spread, where the compiler cannot see it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={el}
	tabindex="0"
	class="code-block"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
	{...editableSurfaceAttributes(node, null)}
	spellcheck="false"
	oninput={onInput}
	onfocus={onSurfaceFocus}
	onkeydown={editableSurface.onKeyDown}
	onbeforeinput={editableSurface.onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>
<!-- Beside the editable element, never inside it: the render effect replaces that element's
	children on every commit, and the offset traversal would count the gutter's text. -->
{#if showRail}
	<CodeBlockRail
		info={infoString}
		activation={activePlugins}
		editable={!readOnly}
		autoOpen={autoOpenLanguage}
		onCommit={commitLanguage}
		onCancel={(returnCaret) => returnCaret && returnCaretToBody()}
		onRun={onRunCode ? () => onRunCode(runRequest()) : undefined}
		onCopy={copyBody}
		menuItems={codeMenuItems ? () => codeMenuItems(runRequest()) : undefined}
		{menuPresence}
		{drafts}
	/>
{/if}

<style>
	/* A recessed slab rather than an outlined field: the fill carries the block and the
	   border only closes its edge, so a page of prose reads code as a surface it sits on. */
	.code-block {
		width: 100%;
		outline: none;
		padding: 14px 16px;
		font-family: var(--font-code, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.55;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid transparent;
		border-radius: var(--radius-surface, 8px);
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		tab-size: 4;
		box-sizing: border-box;
		min-height: 1.4em;
		transition: border-color 120ms ease-out;
	}

	/* The caret is the primary focus signal inside the box; the border only warms, so a
	   click into code does not flash a heavy ring across the page. */
	/* Focus lives in the gutter's search field while the picker is open, outside this element,
	   so the block would otherwise drop its focused look mid-interaction. */
	.code-block:focus,
	.code-block:has(~ :global(.code-rail-open)) {
		border-color: var(--color-border, #3d4047);
	}

	@media (prefers-reduced-motion: reduce) {
		.code-block {
			transition: none;
		}
	}

	.code-block :global(.md-marker) {
		opacity: var(--syntax-marker-dim, 0.65);
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #567b67);
		opacity: 0.7;
	}
</style>
