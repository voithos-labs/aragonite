<script lang="ts">
	// Render-primary block math: a `$$…$$` leaf that shows its KaTeX display render
	// by default and reveals the raw source in a contenteditable on focus/click,
	// re-rendering on blur. The source surface reuses `createEditableSurface` (the
	// CodeBlock plumbing — cross-block selection, sticky-column traversal, arrow
	// boundary nav) and the caret core reuses `createSourceReveal`; only the swap
	// differs (a reactive render↔source toggle instead of inline's span-swap).
	//
	// The source edit is EPHEMERAL: `isInputSuppressed` keeps per-keystroke CST
	// commits off, so the whole reveal→edit→blur lands as ONE undo entry, mirroring
	// inline math (design A2). Blur reads the live DOM text and commits once.
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions
	} from '$lib/action-contracts';
	import type { BlockComponent, StickyColumnDirection } from '$lib/block-component';
	import type { CstNode } from '$lib/core/nodes';
	import {
		BLOCK_EDIT_KEY,
		BLOCK_EL_LOOKUP_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		DOC_KEY,
		EDITOR_LIFETIME_KEY,
		EDITOR_ROOT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		KEYBINDING_OVERRIDES_KEY,
		PASTE_COORDINATOR_KEY,
		REORDER_ACTION_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		type BlockElLookup,
		type DocumentGetter,
		type KeybindingOverridesGetter
	} from '$lib/editor-keys';
	import type { ReorderAction } from '$lib/editor-actions/reorder-action';
	import type { UndoController } from '$lib/editor-actions/deps';
	import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '$lib/cursor/sticky-column';
	import type { SelectionState } from '$lib/selection/selection-state.svelte';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionFocusOffset as getSelectionFocusOffsetHelper
	} from '$lib/cursor/content-offsets';
	import { handleSharedKeydown } from '$lib/selection/shared-keydown';
	import { createEditableSurface } from '$lib/components/blocks/editable-surface';
	import { parkFocusOnEditorRoot } from '$lib/selection/native-bridge';
	import { createSourceReveal } from '$lib/cursor/reveal-source';
	import { trimTrailingLineEnding } from '$lib/core/lines';
	import { eventToChord } from '$lib/schema/keybindings';
	import { dispatchKeyCommand, type CommandId } from '$lib/schema/commands';
	import { createMemoizedRenderer, katexRenderer } from './math-renderer';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const pasteCoordinator = getContext<PasteCommitCoordinator>(PASTE_COORDINATOR_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const keybindingOverrides = getContext<KeybindingOverridesGetter>(KEYBINDING_OVERRIDES_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const reorder = getContext<ReorderAction>(REORDER_ACTION_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const editorLifetime = getContext<AbortSignal | undefined>(EDITOR_LIFETIME_KEY);

	const render = createMemoizedRenderer(katexRenderer);

	let sourceEl: HTMLDivElement | undefined = $state();
	let renderEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);
	let composing = $state(false);
	let sourcePopulated = false;
	let preEditOffset = 0;

	// The whole `$$…$$` fence bytes, minus the block's trailing line ending — the
	// editable source and the raw the offset walk counts. `serialize` re-emits
	// `raw`, so committing `sourceText + '\n'` round-trips byte-for-byte.
	const sourceText = $derived(trimTrailingLineEnding(node.raw));

	// KaTeX renders the inner formula: the fence stripped and surrounding blank
	// lines trimmed (a bare `$$` multi-line fence has its content on later lines).
	function mathInner(fenced: string): string {
		let inner = fenced;
		if (inner.startsWith('$$')) inner = inner.slice(2);
		if (inner.endsWith('$$')) inner = inner.slice(0, -2);
		return inner.trim();
	}

	const editableSurface = createEditableSurface({
		getEl: () => sourceEl ?? null,
		getAmbientLength: () => 0,
		// Ephemeral: the source edit lives only in the DOM until blur, so no
		// per-keystroke CST commit. `readText`/`commitInput` are therefore unused.
		isInputSuppressed: () => true,
		backend: {
			getRaw: () => (sourceEl ? (getCursorOffsetHelper(sourceEl) ?? null) : null),
			setRaw: (offset) => {
				if (sourceEl) setCursorOffsetHelper(sourceEl, offset);
			},
			buildRange: (start, end) => (sourceEl ? createRangeFromOffsets(sourceEl, start, end) : null)
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
		setPendingCursor: () => {},
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
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		getFocusOffset: () => (sourceEl ? getSelectionFocusOffsetHelper(sourceEl) : null),
		getTextLen: () => (sourceEl?.textContent ?? '').length,
		readText: () => sourceEl?.textContent ?? '',
		commitInput: () => {}
	});

	const sharedCtx = editableSurface.sharedCtx;
	const crossBlock = editableSurface.crossBlock;

	// The caret core; the swap is our reactive `revealed` flag. `commit()` (caret
	// at the trailing edge) is inline's Escape-cancel path — block commits on blur
	// via `commitReveal` instead, so we only ever drive `reveal()` here.
	const reveal = createSourceReveal({
		get container() {
			return sourceEl ?? null;
		},
		get sourceStart() {
			return 0;
		},
		get sourceEnd() {
			return sourceText.length;
		},
		get source() {
			return sourceText;
		},
		getAmbientLength: () => 0,
		isRevealed: () => revealed,
		showSource: () => {
			revealed = true;
		},
		showRendered: () => {
			revealed = false;
		}
	});

	// ── View rendering ──────────────────────────────────────────────────────────

	// Rendered view: KaTeX display of the current source. Re-run on every mount of
	// the render div (revealed → false recreates it) and on any source change; the
	// memoized renderer clones a cached node, so re-rendering the same formula is cheap.
	$effect(() => {
		if (revealed || !renderEl) return;
		renderEl.replaceChildren(render(mathInner(sourceText), { display: true }).dom);
	});

	// Source view: populate the contenteditable ONCE per reveal as a single text
	// node (white-space: pre keeps internal `\n`s, so `textContent === source` and the
	// offset walk stays exact). Ephemeral edits then own the DOM until blur.
	$effect(() => {
		if (!revealed) {
			sourcePopulated = false;
			return;
		}
		if (!sourceEl || sourcePopulated) return;
		sourceEl.textContent = sourceText;
		sourcePopulated = true;
	});

	// Windowed out while the source is focused: hand focus to the editor root so the
	// next keystroke routes through its document listener instead of <body>.
	$effect(() => {
		const el = sourceEl;
		return () => parkFocusOnEditorRoot(el ?? null, getEditorRoot());
	});

	// ── Reveal / commit ───────────────────────────────────────────────────────

	function commitReveal(): void {
		if (!revealed) return;
		// A cross-block selection sweeping through keeps the source revealed so its
		// rects measure real text, not the folded render; it folds when the selection clears.
		if (selection.isCrossBlock) return;
		const edited = sourceEl?.textContent ?? sourceText;
		revealed = false; // reactive re-render → KaTeX of the edited source
		if (edited === sourceText) return; // no edit — a pure view toggle, nothing for the CST
		// One undo entry: the anchor is where the caret entered, the post-edit caret
		// sits at the source's new trailing edge. No pending-cursor set — focus has
		// already left, and a re-render must not yank it back.
		blockEdit.updateBlockContent(index, edited + '\n', preEditOffset, edited.length);
	}

	function onRenderPointerDown(e: PointerEvent): void {
		// Shift-click extends a selection (handled once revealed); a plain click reveals.
		if (e.shiftKey) return;
		e.preventDefault();
		void reveal.reveal(0);
	}

	function onFocusOut(): void {
		commitReveal();
	}

	// Insert a literal newline into the single source text node, keeping the offset
	// walk exact (a native Enter would split it into <div>/<br>). Ephemeral — no CST commit.
	function insertNewlineAtCaret(): void {
		if (!sourceEl) return;
		const text = sourceEl.textContent ?? '';
		const offset = getCursorOffsetHelper(sourceEl) ?? text.length;
		sourceEl.textContent = text.slice(0, offset) + '\n' + text.slice(offset);
		setCursorOffsetHelper(sourceEl, offset + 1);
	}

	// ── BlockComponent interface ────────────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	// Focus reveals: mount the source, focus it, land the caret at `offset`.
	export function focus(offset: number): void {
		void reveal.reveal(offset);
	}

	// Sticky-column entry: mount the source, then land at the column nearest x on
	// the first/last visual line — the code-block traversal contract.
	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		void (async () => {
			if (!revealed) {
				revealed = true;
				await tick();
			}
			if (!sourceEl) return;
			editableSurface.surface.focusAtColumn(x, from);
		})();
	}

	export function getCursorOffset(): number | null {
		if (!revealed || !sourceEl) return null;
		return editableSurface.surface.getCursorOffset();
	}

	export function getSelectedText(): string {
		return revealed ? editableSurface.surface.getSelectedText() : '';
	}

	export function setSelection(start: number, end: number): void {
		if (revealed) editableSurface.surface.setSelection(start, end);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		return revealed ? editableSurface.surface.measurePartialRects(startOffset, endOffset) : [];
	}

	export function runCommand(id: CommandId): boolean {
		switch (id) {
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
		focusAtColumn,
		getCursorOffset,
		getSelectedText,
		setSelection,
		measurePartialRects,
		runCommand
	} satisfies BlockComponent);

	// ── Event handlers ──────────────────────────────────────────────────────────

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing || !sourceEl) return;
		preEditOffset = getCursorOffsetHelper(sourceEl) ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		const chord = eventToChord(e);
		if (
			chord &&
			dispatchKeyCommand(chord, { kind: node.kind, runCommand }, { history }, keybindingOverrides())
		) {
			e.preventDefault();
			return;
		}

		// Enter builds multiline math (e.g. `aligned`); it never splits the block.
		if (e.key === 'Enter') {
			e.preventDefault();
			insertNewlineAtCaret();
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	const onInput = editableSurface.onInput;
	const onCompositionStart = editableSurface.onCompositionStart;
	const onCompositionEnd = editableSurface.onCompositionEnd;
</script>

{#if revealed}
	<div
		bind:this={sourceEl}
		tabindex="0"
		class="math-block-source"
		contenteditable="true"
		role="textbox"
		aria-label="Math source"
		spellcheck="false"
		oninput={onInput}
		onkeydown={onKeyDown}
		onpointerdown={onPointerDown}
		onfocusout={onFocusOut}
		oncompositionstart={onCompositionStart}
		oncompositionend={onCompositionEnd}
	></div>
{:else}
	<div
		bind:this={renderEl}
		class="math-block-render"
		role="button"
		tabindex="-1"
		aria-label="Math (click to edit)"
		onpointerdown={onRenderPointerDown}
	></div>
{/if}

<style>
	.math-block-source {
		display: block;
		width: 100%;
		outline: none;
		padding: 12px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-accent, #567b67);
		border-radius: 4px;
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		box-sizing: border-box;
		min-height: 1.4em;
	}

	.math-block-render {
		display: block;
		padding: 8px 12px;
		text-align: center;
		cursor: text;
		border: 1px solid transparent;
		border-radius: 4px;
		overflow-x: auto;
	}

	.math-block-render:hover {
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.08));
	}
</style>
