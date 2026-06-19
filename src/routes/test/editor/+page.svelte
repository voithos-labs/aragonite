<script lang="ts">
	import { onMount } from 'svelte';
	import Editor from '$lib/editor/components/Editor.svelte';
	import { parse } from '$lib/editor/core/parser';
	import { serialize } from '$lib/editor/core/serializer';
	import { SHOWCASE_CONTENT } from '$lib/editor/e2e/test-content';
	import { applyTheme, DEFAULT_THEME } from '$lib/theme';
	import {
		dumpTree,
		dumpUndoStack,
		dumpInlineTree,
		dumpOperationsLog
	} from '$lib/editor/debug/inspect';
	import { parseInline, getContentRange, isProseKind } from '$lib/editor/core/inline';
	import { findBlockPathForElement } from '$lib/editor/selection/path-lookup';
	import { isBlockNode, nodeAt } from '$lib/editor/tree-operations/node-ops';
	import { spliceChildren } from '$lib/editor/tree-operations/children';
	import { getStateForNode } from '$lib/editor/reactivity/state-registry';
	import type { BlockKind, CstNode } from '$lib/editor/core/nodes';
	import {
		registerBlockKind,
		tryGetBlockKindDescriptor
	} from '$lib/editor/schema/block-kind-descriptor';
	import { registerBlockComponent } from '$lib/editor/schema/block-component-registry';
	import {
		enablePerfInstruments,
		resetPerfInstruments,
		perfSnapshot
	} from '$lib/editor/perf/instruments';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import ThrowOnRenderBlock from './ThrowOnRenderBlock.svelte';

	let source = $state(SHOWCASE_CONTENT);
	let editor: ReturnType<typeof Editor>;

	// Single reactive counter that retriggers panel getters. Bumped by BOTH
	// editor ops (via the ops-log subscriber) AND native DOM selection changes
	// (selectionchange). Without the selectionchange half, clicking in a block
	// moves the caret but no Svelte signal fires, so the inline/selection
	// sections never refresh.
	let panelTick = $state(0);

	onMount(() => {
		applyTheme(DEFAULT_THEME);
	});

	$effect(() => {
		if (typeof window === 'undefined' || !editor) return;
		const log = editor.__test.getOperationsLog?.();
		if (!log) return;
		const unsub = log.subscribe(() => {
			panelTick += 1;
		});
		return () => unsub();
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		const onSelectionChange = () => {
			panelTick += 1;
		};
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	// Panel-display view of the editor's live source. MUST NOT feed back into
	// the `source` prop — Editor re-initializes from source changes, which
	// would wipe undo / selection / CST on every op.
	const liveSource = $derived.by(() => {
		panelTick;
		return editor?.getSource() ?? source;
	});

	// Path of the block containing the current native selection's start.
	// Prefers the range's container over document.activeElement so it still
	// resolves when focus has moved to the panel (e.g., after clicking a
	// section header) — the browser's last selection still points into the
	// editor's DOM.
	function getFocusedBlockPath(): number[] | null {
		if (typeof window === 'undefined') return null;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const node = sel.getRangeAt(0).startContainer;
		const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
		return findBlockPathForElement(el);
	}

	// True when the editor's current selection spans two different blocks.
	function isCrossBlockSnapshot(sel: {
		anchor: { path: number[] };
		focus: { path: number[] };
	}): boolean {
		const a = sel.anchor.path;
		const f = sel.focus.path;
		if (a.length !== f.length) return true;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== f[i]) return true;
		}
		return false;
	}

	// Selection section string. Covers both cross-block (via editor.getSelection)
	// and single-block (native DOM) modes. editor.getSelection's cross-block
	// branch only populates when SelectionState is active, so we fall back to
	// reading the native selection for single-block carets.
	function liveSelectionText(): string {
		const editorSel = editor?.getSelection();
		if (editorSel && isCrossBlockSnapshot(editorSel)) {
			const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
			return `anchor=${fmt(editorSel.anchor)} focus=${fmt(editorSel.focus)} cross-block=true`;
		}
		if (typeof window === 'undefined') return '(no selection)';
		const nativeSel = window.getSelection();
		if (!nativeSel || nativeSel.rangeCount === 0) return '(no selection)';
		const range = nativeSel.getRangeAt(0);
		const startNode = range.startContainer;
		const endNode = range.endContainer;
		const startEl =
			startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element);
		const endEl =
			endNode.nodeType === Node.TEXT_NODE ? endNode.parentElement : (endNode as Element);
		const startPath = findBlockPathForElement(startEl);
		const endPath = findBlockPathForElement(endEl);
		if (!startPath || !endPath) return '(no selection in editor)';
		const lines = [
			`mode=single-block${range.collapsed ? ' (caret)' : ' (range)'}`,
			`anchor=[${startPath.join(',')}] focus=[${endPath.join(',')}]`,
			// Native Range offsets are relative to startContainer/endContainer
			// (often the contenteditable div, not a text node), so they're
			// child-index counts — not raw offsets. The raw line below carries
			// CST-coordinate values.
			`range: startContainer=${describeNode(range.startContainer)} startOffset=${range.startOffset} endContainer=${describeNode(range.endContainer)} endOffset=${range.endOffset}`
		];
		if (editorSel) {
			const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
			lines.push(`raw: anchor=${fmt(editorSel.anchor)} focus=${fmt(editorSel.focus)}`);
		}
		if (!range.collapsed) {
			const selected = nativeSel.toString();
			if (selected) lines.push(`selected=${JSON.stringify(selected)}`);
		}
		return lines.join('\n');
	}

	function describeNode(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE) return '#text';
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			const cls =
				typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
			return el.tagName.toLowerCase() + cls;
		}
		return '#' + node.nodeType;
	}

	let capturedErrorOrigins: string[] = [];
	let disposeErrorCapture: (() => void) | undefined;

	$effect(() => {
		if (typeof window === 'undefined' || !editor) return;

		(window as any).__test = {
			getSource: () => editor.getSource(),
			getDocument: () => editor.__test.getDocument(),
			setSource: (md: string) => {
				source = md;
			},
			getBlockCount: () => {
				const doc = parse(editor.getSource());
				return doc.children.length;
			},
			// Structurally splice the children of a NESTED container (by path) IN PLACE, ids
			// kept in lockstep via the production helper, then retrigger that container's
			// reactivity. Unlike setSource (a full reparse that resets scroll + model) or undo
			// (which scrolls back to the edited region), this fires the container scope's
			// windowing rebuild on a count change WITHOUT moving the scroll — the VR-2 above-fold
			// anchor-remap path. `markdown` is parsed to top-level blocks and inserted as the
			// container's children. Root-only paths are rejected (root ids live in a separate
			// `blockIds` array this helper can't reach).
			spliceContainerChildren: (
				path: number[],
				at: number,
				removeCount: number,
				markdown: string
			): void => {
				if (path.length === 0) return;
				const container = nodeAt(editor.__test.getDocument(), path) as CstNode | null;
				if (!container) return;
				const inserted = markdown ? parse(markdown).children : [];
				spliceChildren(container, at, removeCount, ...inserted);
				container.children = [...(container.children ?? [])];
			},
			getBlockKind: (index: number) => {
				const doc = parse(editor.getSource());
				return doc.children[index]?.kind ?? '';
			},
			// Force a top-level block to a kind with a descriptor but NO registered
			// component, so it reaches BlockHost's no-component branch. Exercises the
			// visible-raw fallback (a kind outside ALL_BLOCK_KINDS, so it doesn't
			// perturb the startup registry-completeness check).
			makeBlockOrphan: (index: number): void => {
				const kind = 'orphanTest' as BlockKind;
				if (!tryGetBlockKindDescriptor(kind)) {
					registerBlockKind(kind, {
						mergeRole: 'not-mergeable',
						editable: true,
						isContainer: false,
						supportsInline: false
					});
				}
				const doc = editor.__test.getDocument();
				const node = doc.children[index] as CstNode | undefined;
				if (!node) return;
				node.kind = kind;
				doc.children = [...doc.children];
			},
			// Force a top-level block to a kind whose component throws during
			// render, exercising BlockHost's <svelte:boundary> failed-snippet path.
			makeBlockThrowOnRender: (index: number): void => {
				const kind = 'throwTest' as BlockKind;
				if (!tryGetBlockKindDescriptor(kind)) {
					registerBlockKind(kind, {
						mergeRole: 'not-mergeable',
						editable: false,
						isContainer: false,
						supportsInline: false
					});
					// A throwing stub isn't a full BlockComponent, but it throws before
					// any method is read.
					registerBlockComponent(kind, {
						component: ThrowOnRenderBlock as unknown as Parameters<
							typeof registerBlockComponent
						>[1]['component']
					});
				}
				const doc = editor.__test.getDocument();
				const node = doc.children[index] as CstNode | undefined;
				if (!node) return;
				node.kind = kind;
				doc.children = [...doc.children];
			},
			isCrossBlockActive: () => {
				return document.querySelector('[data-cross-block]') !== null;
			},
			isCrossBlockSelection: (): boolean => {
				const sel = editor?.getSelection();
				if (!sel) return false;
				return isCrossBlockSnapshot(sel);
			},
			getSelectionPaths: () => {
				const sel = editor?.getSelection();
				if (!sel) return null;
				return {
					anchor: { path: sel.anchor.path, offset: sel.anchor.offset },
					focus: { path: sel.focus.path, offset: sel.focus.offset }
				};
			},
			roundTripStable: (): boolean => {
				const src = editor.getSource();
				return serialize(parse(src)) === src;
			},
			// ── Perf instruments surface ──────────────────────────────────────
			perf: {
				enable: enablePerfInstruments,
				reset: resetPerfInstruments,
				snapshot: perfSnapshot
			},
			// ── Debug engine surface ──────────────────────────────────────────
			dumpTree: (opts?: Parameters<typeof dumpTree>[1]) =>
				dumpTree(parse(editor.getSource()), opts),
			dumpSelection: () => liveSelectionText(),
			dumpInlineTree: () => {
				const path = getFocusedBlockPath();
				if (!path) return '';
				const doc = parse(editor.getSource());
				const node = nodeAt(doc, path);
				if (!node || !isBlockNode(node) || !isProseKind(node.kind)) return '';
				const range = getContentRange(node);
				const inline = parseInline(node.raw, range.start, range.end);
				return dumpInlineTree(inline);
			},
			dumpUndoStack: (n = 10) => dumpUndoStack(editor.__test.getUndoStack(), n),
			dumpOperationsLog: (n = 20) => dumpOperationsLog(editor.__test.getOperationsLog(), n),
			// ── Edit-event counting probe ─────────────────────────────────────
			/**
			 * Begin accumulating structural edit events (op !== 'input').
			 * Call `stopEditCount()` to unsubscribe and retrieve the count.
			 * Only one session at a time — calling startEditCount again while
			 * one is running replaces the previous subscription.
			 */
			startEditCount: (): void => {
				if ((window as any).__test._editCountDispose) {
					(window as any).__test._editCountDispose();
				}
				(window as any).__test._editCount = 0;
				(window as any).__test._editCountDispose = editor
					.getEvents()
					.on('edit', (e: { op: string }) => {
						if (e.op !== 'input') (window as any).__test._editCount++;
					});
			},
			stopEditCount: (): number => {
				const dispose = (window as any).__test._editCountDispose;
				if (dispose) dispose();
				(window as any).__test._editCountDispose = null;
				return (window as any).__test._editCount ?? 0;
			},
			/**
			 * Accumulate structural edit op names (op !== 'input') until
			 * `stopEditOpCapture()` returns them. One session at a time.
			 */
			startEditOpCapture: (): void => {
				if ((window as any).__test._editOpCaptureDispose) {
					(window as any).__test._editOpCaptureDispose();
				}
				(window as any).__test._editOps = [] as string[];
				(window as any).__test._editOpCaptureDispose = editor
					.getEvents()
					.on('edit', (e: { op: string }) => {
						if (e.op !== 'input') (window as any).__test._editOps.push(e.op);
					});
			},
			stopEditOpCapture: (): string[] => {
				const dispose = (window as any).__test._editOpCaptureDispose;
				if (dispose) dispose();
				(window as any).__test._editOpCaptureDispose = null;
				return (window as any).__test._editOps ?? [];
			},
			// ── Error-event capture probe ─────────────────────────────────────
			/**
			 * Accumulate `error`-event origins until `getCapturedErrors()` reads
			 * them. Subscribes to the same EditorEvents instance BlockHost emits
			 * to, so a caught render failure surfaces here. One session at a time.
			 */
			startErrorCapture: (): void => {
				capturedErrorOrigins = [];
				disposeErrorCapture?.();
				disposeErrorCapture = editor.getEvents().on('error', (e) => {
					capturedErrorOrigins.push(e.origin);
				});
			},
			getCapturedErrors: (): string[] => capturedErrorOrigins,
			// ── List item id probe ────────────────────────────────────────────
			/**
			 * Return the innerBlockIds array for the first list node found at
			 * the given top-level block index. Useful for identity-preservation
			 * regression tests that check which id survives a cross-scope delete.
			 */
			getListItemIds: (blockIndex: number): string[] => {
				const doc = editor.__test.getDocument();
				const node = doc.children[blockIndex] as CstNode | undefined;
				if (!node) return [];
				const state = getStateForNode(node);
				return state ? [...state.innerBlockIds] : [];
			},
			// ── BlockComponent surface probe ─────────────────────────────────
			/**
			 * Lets E2E specs assert the shallow/deep cursor contract that
			 * `getSelection()` hides — e.g., a 2D surface like TableBlock must
			 * null its shallow getCursorOffset because (row, col) can't be
			 * losslessly packed into one integer.
			 */
			getBlockCursorSurface: (
				path: number[]
			): {
				exists: boolean;
				cursorOffset: number | null;
				cursorPosition: { path: number[]; offset: number } | null;
			} => {
				const block = editor.__test.getBlockComponent(path);
				if (!block) return { exists: false, cursorOffset: null, cursorPosition: null };
				const cursorOffset = block.getCursorOffset();
				const cursorPosition = block.getCursorPosition?.() ?? null;
				return { exists: true, cursorOffset, cursorPosition };
			},
			// ── BlockListState consistency probe ─────────────────────────────
			/**
			 * Walk the live CST — NOT a re-parse — and report any container
			 * whose registered BlockListState has innerBlockIds of a different
			 * length from its node.children. Regression guard for the
			 * cross-block-delete desync bug where nested state was left out of
			 * sync with the mutated children array.
			 */
			auditBlockListStateConsistency: (): Array<{
				path: number[];
				kind: string;
				childrenLen: number;
				idsLen: number;
				refsLen: number;
			}> => {
				const doc = editor.__test.getDocument();
				const violations: Array<{
					path: number[];
					kind: string;
					childrenLen: number;
					idsLen: number;
					refsLen: number;
				}> = [];
				function walk(node: CstNode, path: number[]): void {
					if (!node.children) return;
					const state = getStateForNode(node);
					if (state) {
						const childrenLen = node.children.length;
						const idsLen = state.innerBlockIds.length;
						const refsLen = state.innerBlockRefs.length;
						if (idsLen !== childrenLen || refsLen !== childrenLen) {
							violations.push({ path: [...path], kind: node.kind, childrenLen, idsLen, refsLen });
						}
					}
					for (let i = 0; i < node.children.length; i++) {
						walk(node.children[i], [...path, i]);
					}
				}
				for (let i = 0; i < doc.children.length; i++) {
					walk(doc.children[i], [i]);
				}
				return violations;
			}
		};
	});
</script>

<div class="test-harness">
	<div class="editor-slot">
		<Editor bind:this={editor} {source} />
	</div>
	<DebugPanel
		rawSource={liveSource}
		getCst={() => dumpTree(parse(liveSource))}
		getSelection={() => {
			void panelTick;
			return liveSelectionText();
		}}
		getUndoStack={() => {
			void panelTick;
			const stack = editor?.__test?.getUndoStack?.();
			return stack ? dumpUndoStack(stack) : '(editor not ready)';
		}}
		getInlineTree={() => {
			// panelTick read FIRST — if editor is undefined on the derived's first
			// evaluation (possible during HMR re-mount or tight initial-mount
			// timing), the early return below would skip the signal read and the
			// derived would never subscribe. Reading it unconditionally makes the
			// dep registration independent of editor's ready state.
			void panelTick;
			if (!editor) return '';
			const path = getFocusedBlockPath();
			if (!path) return '';
			const doc = parse(liveSource);
			const node = nodeAt(doc, path);
			if (!node || !isBlockNode(node) || !isProseKind(node.kind)) return '';
			const range = getContentRange(node);
			const inline = parseInline(node.raw, range.start, range.end);
			return dumpInlineTree(inline);
		}}
		getOpsLog={() => {
			const log = editor?.__test?.getOperationsLog?.();
			return log ? dumpOperationsLog(log) : '';
		}}
		opsLogTick={panelTick}
	/>
</div>

<style>
	.test-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
	}
	.editor-slot {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
