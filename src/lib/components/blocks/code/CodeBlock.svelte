<script lang="ts">
	import { getContext, tick } from 'svelte';
	import { type BlockComponent, type StickyColumnDirection } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type CodeRunRequest,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { asDomTextOffset, asRawOffset } from '../../../cursor/coordinate-spaces';
	import { CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome } from '../../../cursor/widget-offset';
	import {
		createRangeFromOffsets,
		setCursorOffset,
		getRangeOffsets,
		getSelectionOffsets,
		hasSelection
	} from '../../../cursor/content-offsets';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import {
		createEditableSurface,
		createClipboardHandlers,
		consumePendingRestore,
		withKeydownVerdict
	} from '../editable-surface';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../surface-wiring.svelte';
	import { createContentOffsetBackend, anchorTrailingNewline } from '../plain-text-backend';
	import { renderCodeBlock, sliceFencedCode } from './code-renderer';
	import {
		getLineLeadingWhitespace,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from './code-editing';
	import { indentLines, dedentLines, type IndentResult } from './code-indent';
	import { computeCodeEnter } from './code-enter';
	import { computeAutoPair } from './code-beforeinput';
	import {
		fenceShapeOf,
		reconcileFenceWrite,
		writeFenceInfo
	} from '../../../schema/fenced-code-raw';
	import { hidesMarkers } from '../../../presentation-mode';
	import CodeBlockRail from './CodeBlockRail.svelte';
	import { computeFenceExit } from './code-fence-exit';
	import {
		classifyFenceBoundary,
		clampCaretToBody,
		clampEnterOffsetToBody,
		clampRangeToBody,
		computeFenceRangedEdit,
		crossesFenceBoundary,
		fenceEditSpan,
		isStructureOnlyRange,
		type CodeRange
	} from './code-fence-boundary';
	import { metadataOf, type CstNode } from '../../../core/nodes';
	import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { nodeAt, emptyParagraph } from '../../../tree-operations';
	import { type CommandId } from '../../../schema/commands';
	import { reorderRunCommand } from '../../../editor-actions/reorder-action';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

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
		events: editorEvents
	} = wiring.deps;
	const { reorder } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		presentationMode: getPresentationMode,
		onPasteImage,
		onRunCode,
		codeMenuItems
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

	const { backend, getFocusOffset, getTextLen, readText } = createContentOffsetBackend(
		() => el ?? null
	);

	const editableSurface = createEditableSurface({
		...wiring.deps,
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		backend,
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
		getPresentationMode,
		getFocusOffset,
		getTextLen,
		readText,
		// Hands back the caret the RECONCILED bytes want: the write seam can grow the
		// fence or drop a character, either of which moves the caret off the DOM's.
		commitInput: (text, preEdit, savedOffset) => commitDisplay(text, preEdit, savedOffset)
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	// Every caret-landing door clamps onto editable content: a caret on a fence line
	// takes keystrokes the fence guard refuses, and a PARKED caret there is as dead as
	// a placed one, so both verbs clamp.
	export function focus(offset: number): void {
		editableSurface.surface.focus(clampCaretToBody(node, offset));
	}

	export function parkCaret(offset: number): void {
		editableSurface.surface.parkCaret(clampCaretToBody(node, offset));
	}

	// The column walk resolves against pixels, so it can only be corrected after the
	// fact: re-seat when it lands on a fence line, leave it alone when it doesn't.
	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		editableSurface.surface.focusAtColumn(x, from);
		const landed = backend.getRaw();
		if (landed === null) return;
		const seated = clampCaretToBody(node, landed);
		if (seated !== landed) backend.setRaw(asRawOffset(seated));
	}

	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	/**
	 * The block's ONE display-commit door: no gesture calls `updateBlockContent` directly (pinned
	 * by `lint/code-commit-funnel`). The write seam sits inside rather than at each caller, so
	 * every gesture gets fence reconciliation by construction.
	 */
	function commitDisplay(display: string, undoAnchor: number, caret: number): number {
		const written = reconcileFenceWrite({
			display,
			caret,
			fence: fenceShapeOf(node),
			mode: 'authored'
		});
		void blockEdit.updateBlockContent(
			index,
			written.display + trailingLineEnding(node.raw),
			undoAnchor
		);
		return written.caret;
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node));
		anchorTrailingNewline(el);
		// The walk container's own stamp, and the only surviving consumer of the emptiness
		// read: both the marker-hiding CSS and the caret walk key off this attribute. The
		// rail no longer gates on it — a content-empty fence gets one either way.
		el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
		lastRenderedRaw = node.raw;

		// Restore only while this block still holds focus: an edit reparsing to multiple
		// blocks moves the caret to the split-off sibling, and a blur would otherwise yank
		// the global selection back. The pending fields clear regardless, never re-armed.
		if (pendingSelection !== null) {
			consumePendingRestore(el, pendingSelection, (range) => {
				const domRange = createRangeFromOffsets(
					el!,
					asDomTextOffset(range.start),
					asDomTextOffset(range.end)
				);
				if (!domRange) return;
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(domRange);
			});
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			consumePendingRestore(el, pendingCursorOffset, (offset) =>
				setCursorOffset(el!, asDomTextOffset(offset))
			);
			pendingCursorOffset = null;
		}
	});

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

	// ── The rail ──────────────────────────────────────────────────────────────

	// The rail stands in for fence chrome the mode paints nothing for: never in source, which
	// paints its own always. A content-empty block DOES paint dimmed markers of its own and
	// still gets the rail — the picker is the authoring path now, and a fence with no language
	// is exactly where it is wanted. The two overlapping is the same accepted redundancy as a
	// focused preview block showing fence and rail together.
	const showRail = $derived(hidesMarkers(presentationMode));
	const infoString = $derived(metadataOf(node, 'fencedCode').info);

	/** The fence body alone, which is what a host executes or a copy writes — never the
	 *  opener and closer lines, which are this block's syntax rather than its content. */
	function bodyText(): string {
		return sliceFencedCode(node).body;
	}

	function runRequest(): CodeRunRequest {
		return { code: bodyText(), info: infoString, path: myPath };
	}

	/**
	 * A fence with no language and no body, the moment it takes focus. Gated on FIRST focus
	 * per mount, not on the creating edit: a block made by an insert command mounts AFTER the
	 * commit that made it and never hears that edit, so the caret arriving is the only signal
	 * every creation path shares. Loading a document focuses nothing and opens no pickers.
	 */
	let autoOpenLanguage = $state(false);
	let languageOffered = false;
	function onSurfaceFocus(): void {
		if (languageOffered || readOnly || !showRail) return;
		languageOffered = true;
		// A caret that STEPPED into an existing fence is passing through, and a picker taking
		// focus there traps the walk. A typed opener is still open, and a click or an insert
		// command seats the caret with no arrival key noted: those are the authoring moments.
		const steppedIn = metadataOf(node, 'fencedCode').closed && edgeAffinity.get() !== null;
		const offerLanguage = infoString === '' && bodyText().trim() === '' && !steppedIn;
		// Deferred past the commit's OWN focus work. Creating a fence focuses this surface
		// twice — once as it mounts, once when the commit seats its caret — and opening on the
		// first would put the field up only for the second to blur it straight back down. A
		// fence that is still bare is completed first (language or not), so the picker opens
		// over a real block.
		void tick().then(() => {
			const completed = completeBareFence();
			if (!offerLanguage) return;
			if (completed) {
				void tick().then(() => {
					autoOpenLanguage = true;
				});
			} else {
				autoOpenLanguage = true;
			}
		});
	}

	/**
	 * A fence with no body line — a just-typed opener, or an opener glued to its closer — is a
	 * block whose only bytes are its own chrome: nowhere for a caret, so the markers must paint.
	 * Writes opener, one empty body line, closer, with the caret on that line. Block math gets
	 * this from the Enter-completion seam, which a fence cannot use: ``` parses as an (unclosed)
	 * fence the moment it is typed, so no paragraph is left for that seam to claim.
	 */
	function completeBareFence(): boolean {
		if (!el) return false;
		const meta = metadataOf(node, 'fencedCode');
		const slice = sliceFencedCode(node);
		const text = getDisplayText();
		const ending = trailingLineEnding(node.raw);
		const offset = backend.getRaw() ?? 0;
		if (!meta.closed) {
			if (slice.body.trim() !== '') return false;
			const closer = meta.fenceMarker.repeat(meta.fenceLength);
			const completed = text + ending + ending + closer;
			pendingCursorOffset = commitDisplay(completed, offset, text.length + ending.length);
			return true;
		}
		if (slice.body !== '') return false;
		const openerLength = slice.openerLine.length;
		const completed = text.slice(0, openerLength) + ending + text.slice(openerLength);
		pendingCursorOffset = commitDisplay(completed, offset, openerLength);
		return true;
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

	// The chip's write: the opener's info span, through the display funnel so the fence rule
	// runs over it, isolated so no typing burst on either side joins its undo entry.
	function commitLanguage(info: string): void {
		// Unchanged or refused bytes are a close, not a write — no entry, no edit event. The seed
		// is `meta.info`, TRIMMED, so a byte test alone lets a bare Enter respell a padded fence.
		if (info === infoString) {
			returnCaretToBody();
			return;
		}
		const display = getDisplayText();
		const written = writeFenceInfo(display, info, fenceShapeOf(node));
		const bodyStart = clampCaretToBody(node, 0);
		if (written !== null && written !== display) {
			controller.isolateUndoEntry(() => commitDisplay(written, bodyStart, bodyStart));
		}
		returnCaretToBody();
	}

	/**
	 * This block's own door, not `moveFocus`: the rail is chrome over one block. Offset 0 is
	 * NOT the body — on an UNCLOSED fence the opener run counts as content by design (that is
	 * what lets a just-typed ` ``` ` be deleted back out), so `focus(0)` parks the caret BEFORE
	 * the backticks and the next keystroke rewrites the opener. `clampRangeToBody` clamps
	 * unconditionally, which is the "wherever the body starts" this needs.
	 */
	function returnCaretToBody(): void {
		// Focus first and SEAT through the pending-caret channel the render effect drains. A
		// bare `focus()` after a tick raced the commit's own re-render, which replaces every
		// child of the walk container and dropped the seat on the floor.
		el?.focus({ preventScroll: true });
		void tick().then(() => {
			// Read the body AFTER the commit lands. Writing a language lengthens the opener, so
			// an offset measured against the pre-commit node points into the info string that
			// just grew — the caret arrived inside `js` and typing split it.
			const at = clampRangeToBody(node, { start: 0, end: 0 }).start;
			pendingCursorOffset = at;
			focus(at);
		});
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	const onCompositionEnd = editableSurface.onCompositionEnd;

	// An IME deletes the selection as it starts composing, and beforeinput's
	// insertCompositionText is not cancelable — so a fence-crossing selection shrinks
	// onto its body span here, before the composition owns the surface.
	function onCompositionStart(): void {
		const sel = el ? getSelectionOffsets(el) : null;
		if (sel && crossesFenceBoundary(node, sel)) {
			const span = fenceEditSpan(node, sel);
			setSelection(span.start, span.end);
		}
		editableSurface.onCompositionStart();
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (guardFenceRangedEdit(e)) return;
		// Soft break: Shift+Enter, and mobile/IME insertLineBreak without a keydown.
		// Gated on !composing so an IME emitting it mid-composition does not sync.
		if (e.inputType === 'insertLineBreak' && !composing && el) {
			e.preventDefault();
			// Mobile/IME paths skip onKeyDown so preEditOffset may be stale; capture fresh.
			const branchPreEditOffset = backend.getRaw() ?? 0;
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: enterSpliceSpan(currentRange()),
				mode: 'soft',
				ending: trailingLineEnding(node.raw)
			});
			pendingCursorOffset = commitDisplay(result.newText, branchPreEditOffset, result.newCursor);
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = getSelectionOffsets(el);
		const offset = selOffsets ? selOffsets.start : (backend.getRaw() ?? 0);

		const meta = metadataOf(node, 'fencedCode');
		const result = computeAutoPair({
			text,
			selection: selOffsets ?? { start: offset, end: offset },
			typed: data,
			unclosedBacktickFence: meta.closed === false && meta.fenceMarker === '`'
		});
		if (!result) return;

		e.preventDefault();
		if (result.kind === 'skip') {
			setCursorOffset(el, asDomTextOffset(result.caretOffset));
			return;
		}
		if (result.kind === 'wrap') {
			// Both endpoints sit inside the body, so whatever the seam inserts ahead of
			// the wrap's start moves its end by the same delta.
			const start = commitDisplay(result.newText, preEditOffset, result.selection.start);
			const shift = start - result.selection.start;
			pendingSelection = { start, end: result.selection.end + shift };
		} else {
			pendingCursorOffset = commitDisplay(result.newText, preEditOffset, result.caretOffset);
		}
	}

	// ── Fence-crossing edits ──────────────────────────────────────────────────

	/**
	 * Where an Enter-family splice lands (the `code.newline` command and the soft
	 * break): a caret clamps out of the fence lines, a selection is replaced on its
	 * body span like every other ranged edit here.
	 */
	function enterSpliceSpan(range: CodeRange): CodeRange {
		if (range.start !== range.end) return fenceEditSpan(node, range);
		const at = clampEnterOffsetToBody(node, range.start);
		return { start: at, end: at };
	}

	/**
	 * The one guard for every native edit that rewrites a range here — delete,
	 * forward-delete, type-over, word delete, drag. One that crosses a fence line is
	 * re-sited onto the body rather than left to splice the fence away.
	 */
	function guardFenceRangedEdit(e: InputEvent): boolean {
		if (composing || !el) return false;
		const range = pendingEditRange(e, el);
		if (!range) return false;
		if (!crossesFenceBoundary(node, range)) return guardHiddenFenceDelete(e, range);

		e.preventDefault();
		const insert = rangedEditInsertion(e, fenceEditSpan(node, range));
		if (insert === null) return true;
		const edit = computeFenceRangedEdit(node, range, insert);
		if (!edit) return true;
		// Mobile/IME beforeinput arrives without a preceding keydown, so the undo
		// anchor reads fresh rather than trusting preEditOffset (see the soft-break arm).
		pendingCursorOffset = commitDisplay(edit.newText, backend.getRaw() ?? 0, edit.newCursor);
		return true;
	}

	/**
	 * A delete while the fence lines hide is applied here, whatever range the engine reports:
	 * Chromium, deleting the last visible character of a line, also removes the unrendered nodes
	 * beside it — the opener's whole fence line — so a Backspace on the last body character
	 * left `\n\`\`\`` and reparsed the block into a fresh fence. The span is clamped to the body.
	 */
	function guardHiddenFenceDelete(e: InputEvent, range: CodeRange): boolean {
		if (!showRail || !/^delete(?!By)/.test(e.inputType)) return false;
		e.preventDefault();
		const span = clampRangeToBody(node, range);
		if (span.end > span.start) {
			const text = getDisplayText();
			pendingCursorOffset = commitDisplay(
				text.slice(0, span.start) + text.slice(span.end),
				backend.getRaw() ?? 0,
				span.start
			);
		}
		return true;
	}

	/**
	 * What the pending edit will rewrite. `getTargetRanges()` is the authority — a word
	 * delete at a collapsed caret reports the word, not the caret — and is
	 * feature-detected because jsdom does not implement it.
	 */
	function pendingEditRange(e: InputEvent, surface: HTMLElement): CodeRange | null {
		const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
		if (targets.length > 0) return getRangeOffsets(surface, targets[0]);
		const selected = getSelectionOffsets(surface);
		if (selected) return selected;
		const caret = backend.getRaw();
		return caret === null ? null : { start: caret, end: caret };
	}

	/**
	 * The text each claimed input type writes over its span: only a payload readable off the event
	 * or mintable here is re-sited, every other type is REFUSED (null: prevented, nothing
	 * committed). Text riding a `dataTransfer` would reach `parse()` without the paste transforms
	 * (G4.11).
	 */
	function rangedEditInsertion(e: InputEvent, span: CodeRange): string | null {
		if (e.inputType.startsWith('delete')) return '';
		switch (e.inputType) {
			case 'insertText':
				return e.data ?? '';
			case 'insertLineBreak':
				return trailingLineEnding(node.raw);
			// The keydown path auto-indents (computeCodeEnter 'normal'), and a mobile or
			// IME insertParagraph is the same gesture arriving without a keydown.
			case 'insertParagraph':
				return (
					trailingLineEnding(node.raw) + getLineLeadingWhitespace(getDisplayText(), span.start)
				);
			default:
				return null;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;
		if (!el) return;

		preEditOffset = backend.getRaw() ?? 0;

		if ((await handleSharedKeydown(e, sharedCtx)) || editableSurface.isDetached()) return;

		if (wiring.dispatchChord(e, { kind: node.kind, runCommand })) return;
	}

	const onKeyDownTraced = withKeydownVerdict(onKeyDown);

	// ── Commands ────────────────────────────────────────────────────────

	export function runCommand(id: CommandId): boolean {
		if (reorderRunCommand(id, reorder, () => myPath)) return true;
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
				indentSelection();
				return true;
			case 'code.dedent':
				dedentSelection();
				return true;
			case 'code.backspace':
				return codeBackspace();
			case 'code.delete':
				return codeDelete();
			default:
				return false;
		}
	}

	function codeBackspace(): boolean {
		if (!el || hasSelection()) return false;
		const offset = backend.getRaw() ?? 0;
		// offset===0 is the universal contract; the classifyFenceBoundary check catches the
		// fence boundary, where a native Backspace would delete the opener's terminating `\n`.
		if (
			offset === 0 ||
			classifyFenceBoundary({ node, offset, forward: false }).kind === 'exitPrev'
		) {
			// At the top of an EMPTY fence the block is the only thing the press could mean:
			// there is no text to delete and nothing to merge, and stepping the caret out
			// leaves a block the user just asked to be rid of. A fence with a body keeps the
			// step-out — one press must never take code with it.
			if (bodyText().trim() === '') {
				void blockEdit.deleteBlock(index);
				focusActions.moveFocus(index - 1, 'end');
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
			const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
			pendingCursorOffset = commitDisplay(newText, preEditOffset, offset - 1);
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || hasSelection()) return false;
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
	// textContent, so the CST never sees the edit — handle Enter via the CST path.
	function codeNewline(): boolean {
		if (!el) return false;
		// Read the caret live: cross-block dispatch calls runCommand without an
		// onKeyDown to refresh preEditOffset, so the undo anchor must read fresh.
		const offset = backend.getRaw() ?? 0;
		const text = getDisplayText();
		const meta = metadataOf(node, 'fencedCode');

		// Source mode paints the markers and never completes a bare fence on focus, so Enter is
		// where it happens there; the marker-hiding rungs already did it as the caret arrived.
		if (completeBareFence()) {
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
			closeUnclosedFenceAndDescend(exit.newText);
			return true;
		}
		if (exit.kind !== 'none') {
			if (exit.kind === 'exitWithEdit') {
				commitDisplay(exit.newText, offset, offset);
			}
			exitDownward();
			return true;
		}

		// The undo anchor stays on the true pre-edit caret (`offset`); the splice
		// itself lands wherever the fence lines allow.
		const span = enterSpliceSpan(currentRange());

		// Electric indent: between an empty bracket pair, expand into three lines with an
		// extra indent on the middle. Quote pairs stay inline; a selection is replaced.
		const ending = trailingLineEnding(node.raw);
		if (span.start === span.end && isBetweenEmptyBracketPair(text, span.start)) {
			const at = span.start;
			const indent = getLineLeadingWhitespace(text, at);
			const inner = indent + ELECTRIC_INDENT_UNIT;
			const newText = text.slice(0, at) + ending + inner + ending + indent + text.slice(at);
			const innerCaret = at + ending.length + inner.length;
			pendingCursorOffset = commitDisplay(newText, offset, innerCaret);
			return true;
		}

		const enter = computeCodeEnter({
			display: text,
			selection: span,
			mode: 'normal',
			ending
		});
		pendingCursorOffset = commitDisplay(enter.newText, offset, enter.newCursor);
		return true;
	}

	// A closed-fence Enter-exit lands within the fence's OWN container scope: the next
	// sibling, else a paragraph minted in-scope. Without this a nested last child would
	// delegate the caret outside its container.
	function exitDownward(): void {
		const container = myPath.length > 1 ? nodeAt(getDoc(), myPath.slice(0, -1)) : null;
		const isNestedLastChild = !!container?.children && index === container.children.length - 1;
		if (isNestedLastChild) blockEdit.descendToBody(index);
		else focusActions.moveFocus(index + 1, 'start');
	}

	// Leaving an unclosed fence downward mints its closer, keeping save→reload from lazy-absorbing
	// the trailing blocks into it. Closer and fresh paragraph land as ONE replaceBlock commit.
	function closeUnclosedFenceAndDescend(closedDisplay: string): void {
		const meta = metadataOf(node, 'fencedCode');
		const lineEnding = trailingLineEnding(node.raw);
		const closedFence: CstNode = {
			kind: 'fencedCode',
			leadingTrivia: '',
			raw: closedDisplay + lineEnding,
			metadata: { ...meta, closed: true }
		};
		// The blank separator line and the paragraph's own line are both pure line
		// ending, so both take the fence's (G4.20) — the same one the closer above got.
		const paragraphBelow = emptyParagraph(lineEnding, lineEnding);
		void blockEdit.replaceBlock(index, [closedFence, paragraphBelow], {
			replacementIndex: 1,
			offset: 0
		});
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
		const sel = getSelectionOffsets(el);
		if (sel) return sel;
		const cursor = backend.getRaw() ?? 0;
		return { start: cursor, end: cursor };
	}

	function applyIndentResult(result: IndentResult): void {
		const start = commitDisplay(result.text, result.selection.start, result.selection.start);
		if (result.selection.start === result.selection.end) {
			pendingCursorOffset = start;
			return;
		}
		// Both endpoints sit inside the body, so an escalation inserting at the opener
		// run moves them by the same delta.
		const shift = start - result.selection.start;
		pendingSelection = { start, end: result.selection.end + shift };
	}

	// Both gestures rewrite whole LINES, so their range clamps out of the fence lines —
	// the multi-line sibling of codeNewline's clampEnterOffsetToBody. `el` is required
	// only because currentRange() reads the DOM selection through it.
	function indentSelection(): void {
		if (!el) return;
		applyIndentResult(indentLines(getDisplayText(), clampRangeToBody(node, currentRange())));
	}

	function dedentSelection(): void {
		if (!el) return;
		const text = getDisplayText();
		const result = dedentLines(text, clampRangeToBody(node, currentRange()));
		if (result.text === text) return;
		applyIndentResult(result);
	}

	// ── Pointer + clipboard ─────────────────────────────────────────────

	function onPointerDown(e: PointerEvent): void {
		void crossBlock.handlePointerDown(e);
	}

	// Code has no ambient markers, so its DOM-text selection IS its raw slice: copy falls
	// to the seam's visible-selection default, and cut writes that string before deleting.
	const clipboard = createClipboardHandlers({
		stickyColumn,
		edgeAffinity,
		selection,
		getDoc,
		crossBlock,
		isReadOnly: () => readOnly,
		caret: editableSurface.caret,
		events: editorEvents,
		onPasteImage,
		// Copy is verbatim while the delete clamps: the clipboard keeps the literal bytes
		// selected, fence characters included, and only the body half is removed.
		cutTail: (e) => {
			e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
			if (!el) return;
			const selOffsets = getSelectionOffsets(el);
			if (!selOffsets) return;
			const edit = computeFenceRangedEdit(node, selOffsets, '');
			if (!edit) return;
			pendingCursorOffset = commitDisplay(edit.newText, edit.newCursor, edit.newCursor);
		},
		pasteTail: async (pastedText) => {
			if (!el) return;
			// Paste refuses where typing refuses: a target confined to fence structure has
			// nothing to paste into. The tree-op owns the splice, so the span goes to it.
			const target = currentRange();
			if (isStructureOnlyRange(node, target)) return;
			const sel = fenceEditSpan(node, target);
			const result = await pasteDispatch(
				{
					pastedText,
					targetPath: myPath,
					offset: sel.start,
					preDelete: sel.start !== sel.end ? { start: sel.start, end: sel.end } : undefined
				},
				{
					doc: getDoc(),
					blockEdit,
					controller: pasteCoordinator,
					grammar,
					activePlugins
				}
			);

			if (result.inlineCaretOffset !== undefined) {
				pendingCursorOffset = result.inlineCaretOffset;
			}
		}
	});
	const { onCopy, onCut, onPaste } = clipboard;

	export function insertMarkdown(md: string): boolean {
		return clipboard.insertMarkdown(md);
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="code-block"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
	role="textbox"
	spellcheck="false"
	oninput={onInput}
	onfocus={onSurfaceFocus}
	onkeydown={onKeyDownTraced}
	onbeforeinput={onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>
<!-- Beside the walk container, never inside it: the render effect replaces that element's
	children on every commit, and the offset walk counts everything that survives there. -->
{#if showRail}
	<CodeBlockRail
		info={infoString}
		editable={!readOnly}
		autoOpen={autoOpenLanguage}
		onCommit={commitLanguage}
		onCancel={(returnCaret) => returnCaret && returnCaretToBody()}
		onRun={onRunCode ? () => onRunCode(runRequest()) : undefined}
		onCopy={copyBody}
		menuItems={codeMenuItems ? () => codeMenuItems(runRequest()) : undefined}
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
	/* Focus lives in the rail's search field while the picker is open — outside this element —
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
