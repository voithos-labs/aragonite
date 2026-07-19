<script lang="ts">
	import { getContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions
	} from '../../../action-contracts';
	import { type BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import { emitCommandError } from '../../../editor-events';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { asDomTextOffset, asRawOffset, type RawOffset } from '../../../cursor/coordinate-spaces';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionFocusOffset as getSelectionFocusOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../../cursor/content-offsets';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import { createEditableSurface } from '../editable-surface';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import {
		writeCrossBlockCopy,
		writeCrossBlockCut
	} from '../../../selection/cross-block/clipboard';
	import { renderCodeBlock } from './code-renderer';
	import {
		getLineLeadingWhitespace,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from './code-editing';
	import { indentLines, dedentLines, type IndentResult } from './code-indent';
	import { computeCodeEnter } from './code-enter';
	import { computeAutoPair } from './code-beforeinput';
	import { computeFenceExit } from './code-fence-exit';
	import { classifyFenceBoundary, clampEnterOffsetToBody } from './code-fence-boundary';
	import { metadataOf } from '../../../core/nodes';
	import {
		trimTrailingLineEnding,
		normalizeLineEndings,
		trailingLineEnding
	} from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { eventToChord } from '../../../schema/keybindings';
	import { type CommandId } from '../../../schema/commands';
	import { dispatchKeyCommand, type CommandErrorSink } from '../../../schema/block-commands';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		reorder,
		selection,
		events: editorEvents
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { keybindingOverrides, presentationMode: getPresentationMode } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		lifetime: editorLifetime,
		pluginEditor
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	const readOnly = $derived(getPresentationMode?.() === 'reading');
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

	// A zero-ambient, widget-free surface: its DOM-text space IS its raw space.
	// Every DOM caret read door-mints across the identity here, once.
	function readCaretOffset(): RawOffset | null {
		const offset = el ? getCursorOffsetHelper(el) : null;
		return offset === null ? null : asRawOffset(offset);
	}

	function readFocusOffset(): RawOffset | null {
		const offset = el ? getSelectionFocusOffsetHelper(el) : null;
		return offset === null ? null : asRawOffset(offset);
	}

	const editableSurface = createEditableSurface({
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		backend: {
			getRaw: readCaretOffset,
			setRaw: (offset) => {
				if (el) setCursorOffsetHelper(el, asDomTextOffset(offset));
			},
			buildRange: (start, end) =>
				el ? createRangeFromOffsets(el, asDomTextOffset(start), asDomTextOffset(end)) : null
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
		getPresentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		getFocusOffset: readFocusOffset,
		getTextLen: () => (el?.textContent ?? '').length,
		readText: () => el?.textContent ?? '',
		// Code anchors undo at preEditOffset only; it has no kind-change remount to
		// re-focus, so it passes no saved offset (the omitted 4th argument).
		commitInput: (text, preEdit) => {
			void blockEdit.updateBlockContent(index, text + trailingLineEnding(node.raw), preEdit);
		}
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = editableSurface.surface.focus;
	export const focusAtColumn = editableSurface.surface.focusAtColumn;
	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node));
		anchorTrailingNewlineForChromium(el);
		lastRenderedRaw = node.raw;

		if (pendingSelection !== null) {
			// Restore only while this block still owns focus: an async flush after
			// focus left would yank the global selection back into the just-blurred
			// block. Sibling of the pendingCursorOffset guard below; the clear runs
			// regardless so a skipped restore is dropped, never re-armed.
			if (document.activeElement === el) {
				const range = createRangeFromOffsets(
					el,
					asDomTextOffset(pendingSelection.start),
					asDomTextOffset(pendingSelection.end)
				);
				if (range) {
					const sel = window.getSelection();
					sel?.removeAllRanges();
					sel?.addRange(range);
				}
			}
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			// Restore only while this block still owns focus: an edit whose text
			// reparses to multiple blocks moves the caret to the split-off sibling
			// (structural commit's afterTick); an unguarded restore would yank it
			// back. Mirrors TextEditableBlock's activeElement guard.
			if (document.activeElement === el) {
				setCursorOffsetHelper(el, asDomTextOffset(pendingCursorOffset));
			}
			pendingCursorOffset = null;
		}
	});

	// Windowed out while focused: hand focus to the editor root so the next
	// keystroke routes through its document-level listener instead of falling to
	// <body>. See parkFocusOnEditorRoot.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
	});

	/**
	 * Chromium with `white-space: pre` won't paint a caret on the line after a
	 * trailing `\n` unless something follows it; typed text routes before the `\n`.
	 * A trailing `<br>` anchors the caret on the new line. BR has empty textContent,
	 * so `textContent === trimTrailingLineEnding(raw)` still holds.
	 * Re-applied every render — the renderer owns the contenteditable's children.
	 */
	function anchorTrailingNewlineForChromium(host: HTMLElement): void {
		if (!host.textContent?.endsWith('\n')) return;
		const br = document.createElement('br');
		br.dataset.caretAnchor = '';
		host.appendChild(br);
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	const onCompositionStart = editableSurface.onCompositionStart;
	const onCompositionEnd = editableSurface.onCompositionEnd;

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		// Soft break path: Shift+Enter on desktop and mobile/IME insertLineBreak
		// without a preceding keydown. Gated on !composing like the insertText arm
		// below: an IME emitting insertLineBreak mid-composition must not sync
		// (its mobile-Enter purpose applies post-compositionend, composing false).
		if (e.inputType === 'insertLineBreak' && !composing && el) {
			e.preventDefault();
			// Mobile/IME paths skip onKeyDown so preEditOffset may be stale; capture fresh.
			const branchPreEditOffset = readCaretOffset() ?? 0;
			// Sibling of codeNewline's opener guard: a soft break splices the same
			// `\n`, so its selection clamps out of the opener line too.
			const range = currentRange();
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: {
					start: clampEnterOffsetToBody(node, range.start),
					end: clampEnterOffsetToBody(node, range.end)
				},
				mode: 'soft'
			});
			blockEdit.updateBlockContent(
				index,
				result.newText + trailingLineEnding(node.raw),
				branchPreEditOffset
			);
			pendingCursorOffset = result.newCursor;
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el);
		const offset = selOffsets ? selOffsets.start : (readCaretOffset() ?? 0);

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
			setCursorOffsetHelper(el, asDomTextOffset(result.caretOffset));
			return;
		}
		blockEdit.updateBlockContent(
			index,
			result.newText + trailingLineEnding(node.raw),
			preEditOffset
		);
		if (result.kind === 'wrap') {
			pendingSelection = result.selection;
		} else {
			pendingCursorOffset = result.caretOffset;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;
		if (!el) return;

		preEditOffset = readCaretOffset() ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		const chord = eventToChord(e);
		if (
			chord &&
			dispatchKeyCommand(
				chord,
				{ kind: node.kind, runCommand },
				{ history, pluginEditor, getPresentationMode },
				keybindingOverrides(),
				onCommandError
			)
		) {
			e.preventDefault();
			return;
		}
	}

	// ── Commands ────────────────────────────────────────────────────────

	export function runCommand(id: CommandId): boolean {
		switch (id) {
			case 'format.toggleStrong':
			case 'format.toggleEmphasis':
				return true; // code blocks don't format-toggle; swallow to stop the browser default
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

	function codeBackspace(): boolean {
		if (!el || hasSelectionHelper()) return false;
		const offset = readCaretOffset() ?? 0;
		// offset===0 is the universal contract; offset===bodyStart catches the
		// fence-boundary case (Home from the body lands there, and native
		// Backspace would delete the opener's terminating `\n`).
		if (
			offset === 0 ||
			classifyFenceBoundary({ node, offset, forward: false }).kind === 'exitPrev'
		) {
			focusActions.moveFocus(index - 1, 'end');
			return true;
		}

		// Pair-delete: remove both halves so the auto-closed companion isn't stranded.
		const text = getDisplayText();
		if (isBetweenEmptyPair(text, offset)) {
			const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
			blockEdit.updateBlockContent(index, newText + trailingLineEnding(node.raw), preEditOffset);
			pendingCursorOffset = offset - 1;
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || hasSelectionHelper()) return false;
		const offset = readCaretOffset() ?? 0;
		if (classifyFenceBoundary({ node, offset, forward: true }).kind === 'exitNext') {
			// Mirror of codeBackspace's unconditional moveFocus(index - 1), but the
			// root's forward asymmetry (past-end appends a paragraph) would strand a
			// spurious block here. Suppress the append: focus the next block if one
			// exists (sibling or via upward delegation), no-op at the true doc end.
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
		const offset = readCaretOffset() ?? 0;
		const text = getDisplayText();
		const meta = metadataOf(node, 'fencedCode');

		const exit = computeFenceExit({ text, offset, meta });
		if (exit.kind !== 'none') {
			if (exit.kind === 'exitWithEdit') {
				blockEdit.updateBlockContent(index, exit.newText + trailingLineEnding(node.raw), offset);
			}
			focusActions.moveFocus(index + 1, 'start');
			return true;
		}

		// Opener-side mirror of the closer guards above: a `\n` spliced into the
		// opener line corrupts the fence, so the splice clamps to the body start.
		// The undo anchor stays on the true pre-edit caret (`offset`).
		const splice = clampEnterOffsetToBody(node, offset);

		// Electric indent: between an empty bracket pair, expand into three lines
		// with an extra indent on the middle line. Quote pairs stay inline.
		if (isBetweenEmptyBracketPair(text, splice)) {
			const indent = getLineLeadingWhitespace(text, splice);
			const inner = indent + ELECTRIC_INDENT_UNIT;
			const newText = text.slice(0, splice) + '\n' + inner + '\n' + indent + text.slice(splice);
			blockEdit.updateBlockContent(index, newText + trailingLineEnding(node.raw), offset);
			pendingCursorOffset = splice + 1 + inner.length;
			return true;
		}

		const enter = computeCodeEnter({
			display: text,
			selection: { start: splice, end: splice },
			mode: 'normal'
		});
		blockEdit.updateBlockContent(index, enter.newText + trailingLineEnding(node.raw), offset);
		pendingCursorOffset = enter.newCursor;
		return true;
	}

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		focusAtColumn,
		runCommand
	} satisfies BlockComponent);

	function currentRange(): { start: number; end: number } {
		if (!el) return { start: 0, end: 0 };
		const sel = getSelectionOffsetsHelper(el);
		if (sel) return sel;
		const cursor = readCaretOffset() ?? 0;
		return { start: cursor, end: cursor };
	}

	function applyIndentResult(result: IndentResult): void {
		blockEdit.updateBlockContent(
			index,
			result.text + trailingLineEnding(node.raw),
			result.selection.start
		);
		if (result.selection.start === result.selection.end) {
			pendingCursorOffset = result.selection.start;
		} else {
			pendingSelection = result.selection;
		}
	}

	function indentSelection(): void {
		if (!el) return;
		applyIndentResult(indentLines(el.textContent ?? '', currentRange()));
	}

	function dedentSelection(): void {
		if (!el) return;
		const text = el.textContent ?? '';
		const result = dedentLines(text, currentRange());
		if (result.text === text) return;
		applyIndentResult(result);
	}

	// ── Pointer + clipboard ─────────────────────────────────────────────

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	function getCopyPayload(): string {
		return window.getSelection()?.toString() ?? '';
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		// Reading mode copies the rendered selection, never the markdown-source
		// cross-block payload.
		if (readOnly) {
			e.clipboardData?.setData('text/plain', getCopyPayload());
			return;
		}
		if (writeCrossBlockCopy(e, { selection, getDoc, crossBlock })) return;
		e.clipboardData?.setData('text/plain', getCopyPayload());
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();
		// Reading mode: cut degrades to copy (the event still fires on a
		// non-editable surface).
		if (readOnly) {
			onCopy(e);
			return;
		}
		if (await writeCrossBlockCut(e, { selection, getDoc, crossBlock })) return;
		e.clipboardData?.setData('text/plain', getCopyPayload());

		if (!el) return;
		const selOffsets = getSelectionOffsetsHelper(el);
		if (selOffsets) {
			const display = getDisplayText();
			const newDisplay = display.slice(0, selOffsets.start) + display.slice(selOffsets.end);
			blockEdit.updateBlockContent(
				index,
				newDisplay + trailingLineEnding(node.raw),
				selOffsets.start
			);
			pendingCursorOffset = selOffsets.start;
		}
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (readOnly) {
			e.preventDefault();
			return;
		}
		if (await crossBlock.handlePaste(e)) return;

		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const pasted = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pasted) return;

		const sel = currentRange();
		const result = await pasteDispatch(
			{
				pastedText: pasted,
				targetPath: myPath,
				offset: sel.start,
				preDelete: sel.start !== sel.end ? { start: sel.start, end: sel.end } : undefined
			},
			{
				doc: getDoc(),
				blockEdit,
				controller: pasteCoordinator
			}
		);

		if (result.inlineCaretOffset !== undefined) {
			pendingCursorOffset = result.inlineCaretOffset;
		}
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
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>

<style>
	.code-block {
		width: 100%;
		outline: none;
		padding: 12px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		tab-size: 4;
		box-sizing: border-box;
		min-height: 1.4em;
	}

	.code-block:focus {
		border-color: var(--color-accent, #567b67);
	}

	.code-block :global(.md-marker) {
		opacity: var(--syntax-marker-dim, 0.4);
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #567b67);
		opacity: 0.7;
	}
</style>
