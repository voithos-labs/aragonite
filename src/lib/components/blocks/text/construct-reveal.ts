/**
 * preview-inline's construct-reveal trigger: within the focused block, an inline
 * construct's markers stay CSS-hidden until the caret enters the construct's
 * inclusive `[start, end]` range; entering reveals the FULL chain of enclosing
 * constructs (`**bold *italic***` with the caret in the italic shows both
 * wrappers' markers — the Obsidian model, and what editing a nested construct
 * needs); leaving folds it back. Everything is a class flip on the marker spans
 * the render stamped with `data-construct-*` — the DOM text never changes, so
 * raw offsets survive every flip and a revealed construct is ordinary source
 * text (typing in it is byte-honest with no commit ceremony).
 *
 * Edges are INCLUSIVE on both sides so the reveal always precedes the step that
 * would land in marker text: the caret at a construct's start/end offset has
 * already revealed it, and the next arrow step enters visible text. At a shared
 * boundary between adjacent constructs both reveal — and nothing more is needed:
 * the caret is a raw offset, the revealed bytes are visible, and typing lands at
 * that offset. No stored-marks affinity picks a boundary "winner" (the classic
 * ambiguity — invisible markup boundaries, empty constructs — doesn't arise:
 * revealed source is visible, and GFM has no empty wrapped construct). The affinity
 * contract is exactly "raw offset + inclusive reveal edges"; see the affinity spec.
 *
 * Runs on selection cadence (the component's selectionchange handler, composition-
 * gated) plus a forced re-apply from the render effect — a rebuild mints fresh
 * unrevealed spans, and waiting for the async selectionchange would paint one
 * folded frame per keystroke while typing inside a revealed construct. A third,
 * synchronous entry backstops both: Chromium prioritizes input events over normal
 * tasks, so rapid arrow presses outrun the selectionchange reveal and compute
 * their caret motion against still-folded markers — skipping the hidden bytes.
 * `prepareStep` runs in keydown, revealing the chain for the position the step
 * lands on BEFORE the browser's default acts; it only ever reveals (folds stay on
 * the selection cadence with its recheck discipline). The inline tree arrives
 * through the non-reactive accessor, so no cadence registers reactive
 * dependencies.
 *
 * A would-fold to no chain must SURVIVE A TICK (widget-interaction's escape
 * re-check): cross-block entry clears the native selection before the cross-block
 * flag flips, manufacturing a transient fold-shaped state a slow machine delivers
 * early. Chain-to-chain changes apply immediately — no transient manufactures
 * those. While a cross-block selection is active the state freezes wholesale,
 * so a sweep anchored in revealed marker text keeps its layout.
 */

import { tick } from 'svelte';
import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import { getInlineContent } from '../../../core/inline/inline-cache';
import { toClampedRawOffset } from '../../../cursor/coordinate-spaces';
import { domTextOffsetAtNode } from '../../../cursor/widget-offset';
import {
	isInteractionTraceEnabled,
	traceRevealOpen,
	traceRevealFold
} from '../../../debug/interaction-trace';

export const CONSTRUCT_REVEAL_CLASS = 'md-construct-reveal';

/** The built-in marker-bearing inline kinds the reveal covers. Images ride along
 *  for their alt-only rendering; widget-rendered images have no marker spans, so
 *  their membership is inert there. Plugin inline kinds either render as widgets
 *  (their own reveal policies) or as raw source with no marker spans — neither
 *  has anything for this trigger to flip. */
const REVEALABLE_KINDS: ReadonlySet<InlineNode['kind']> = new Set([
	'emphasis',
	'strong',
	'strikethrough',
	'inlineCode',
	'link',
	'image'
]);

// ── Chain math (pure) ────────────────────────────────────────────────────────

/**
 * Every revealable construct whose inclusive `[start, end]` contains `offset`,
 * outermost first. Inclusive on both edges (see module header); at a boundary
 * shared by adjacent siblings both are collected.
 */
export function constructChainAtOffset(nodes: InlineNode[], offset: number): InlineNode[] {
	const chain: InlineNode[] = [];
	collectChain(nodes, offset, chain);
	return chain;
}

function collectChain(nodes: InlineNode[], offset: number, out: InlineNode[]): void {
	for (const node of nodes) {
		if (offset < node.start || offset > node.end) continue;
		if (REVEALABLE_KINDS.has(node.kind)) out.push(node);
		if (node.children && node.children.length > 0) collectChain(node.children, offset, out);
	}
}

// ── Trigger (DOM class flips) ────────────────────────────────────────────────

interface ChainEntry {
	kind: InlineNode['kind'];
	start: number;
	end: number;
}

export interface ConstructRevealDeps {
	get node(): NodeView;
	get linkRef(): LinkReferenceResolverRef | undefined;
	getEl: () => HTMLElement | null;
	getAmbientLength: () => number;
	getPresentationMode: () => PresentationMode;
	/** Cross-block selections freeze the reveal state (see module header). */
	isCrossBlock: () => boolean;
}

export interface ConstructReveal {
	/** Re-evaluate the caret chain and flip marker classes to match. `force` after
	 *  a rebuild: fresh spans carry no reveal class even when the chain key is
	 *  unchanged, and the fold-recheck tick must not delay the re-apply. */
	update(force?: boolean): void;
	/** Synchronous keydown backstop: reveal the union of the chains at the caret
	 *  and one raw offset away in `delta`'s direction (0 = the caret alone, for
	 *  destructive keys) before the browser's default runs. Reveal-only — never
	 *  folds, never consumes the event. */
	prepareStep(delta: -1 | 0 | 1): void;
	/** Keydown wiring for `prepareStep`: plain arrows step ±1, plain Backspace/
	 *  Delete re-assert the caret chain. Owns the key vocabulary so the component
	 *  stays free of destructive-key literals (G4.12 scans those as interceptor
	 *  shape; this module holds no preventDefault and consumes nothing). */
	prepareForKeydown(e: KeyboardEvent): void;
}

export function createConstructReveal(deps: ConstructRevealDeps): ConstructReveal {
	// Primitive descriptors + live span refs of the applied chain. Span refs go
	// stale on rebuild (replaced DOM); removing a class from a detached span is a
	// harmless no-op, and `force` re-resolves against the fresh DOM.
	let appliedChain: ChainEntry[] = [];
	let appliedSpans: Element[] = [];
	let appliedKey = '';
	let foldRecheckQueued = false;

	function chainKey(chain: ChainEntry[]): string {
		return chain.map((n) => `${n.start}:${n.end}`).join(',');
	}

	/** Caret raw offset while the mode is on and the caret sits in this block. */
	function caretOffset(): number | null {
		const el = deps.getEl();
		if (!el || deps.getPresentationMode() !== 'preview-inline') return null;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.focusNode || !el.contains(sel.focusNode)) return null;
		return toClampedRawOffset(
			domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset),
			deps.getAmbientLength()
		);
	}

	function inlines(): InlineNode[] {
		return getInlineContent(deps.node, deps.linkRef?.current, deps.linkRef?.signature ?? '');
	}

	const toEntry = (n: InlineNode): ChainEntry => ({ kind: n.kind, start: n.start, end: n.end });

	/** The chain the current selection asks for — [] when the mode is off, the
	 *  caret is elsewhere, or no construct contains it. */
	function evaluateChain(): ChainEntry[] {
		const offset = caretOffset();
		if (offset === null) return [];
		return constructChainAtOffset(inlines(), offset).map(toEntry);
	}

	function traceTransitions(prev: ChainEntry[], next: ChainEntry[]): void {
		if (!isInteractionTraceEnabled()) return;
		const id = (n: ChainEntry) => `${n.kind}:${n.start}-${n.end}`;
		const prevIds = new Set(prev.map(id));
		const nextIds = new Set(next.map(id));
		for (const n of next) if (!prevIds.has(id(n))) traceRevealOpen('construct', id(n));
		for (const n of prev) if (!nextIds.has(id(n))) traceRevealFold('caret-exit', id(n));
	}

	function apply(chain: ChainEntry[], key: string): void {
		const el = deps.getEl();
		const next: Element[] = [];
		if (el) {
			for (const node of chain) {
				const spans = el.querySelectorAll(
					`[data-construct-start="${node.start}"][data-construct-end="${node.end}"]`
				);
				for (const span of spans) {
					span.classList.add(CONSTRUCT_REVEAL_CLASS);
					next.push(span);
				}
			}
		}
		for (const span of appliedSpans) {
			if (!next.includes(span)) span.classList.remove(CONSTRUCT_REVEAL_CLASS);
		}
		traceTransitions(appliedChain, chain);
		appliedChain = chain;
		appliedSpans = next;
		appliedKey = key;
	}

	function queueFoldRecheck(): void {
		if (foldRecheckQueued) return;
		foldRecheckQueued = true;
		void (async () => {
			try {
				await tick();
			} finally {
				foldRecheckQueued = false;
			}
			if (deps.isCrossBlock()) return;
			const chain = evaluateChain();
			if (chain.length === 0 && appliedKey !== '') apply([], '');
		})();
	}

	function update(force = false): void {
		if (deps.isCrossBlock()) return;
		const chain = evaluateChain();
		const key = chainKey(chain);
		if (force) {
			apply(chain, key);
			return;
		}
		if (key === appliedKey) return;
		if (key === '') {
			queueFoldRecheck();
			return;
		}
		apply(chain, key);
	}

	function prepareStep(delta: -1 | 0 | 1): void {
		if (deps.isCrossBlock()) return;
		const offset = caretOffset();
		if (offset === null) return;
		const tree = inlines();
		const chain = constructChainAtOffset(tree, offset).map(toEntry);
		if (delta !== 0) {
			for (const n of constructChainAtOffset(tree, offset + delta)) {
				if (!chain.some((c) => c.start === n.start && c.end === n.end)) chain.push(toEntry(n));
			}
		}
		// Reveal-only: an empty union means the step needs nothing shown, and any
		// fold it implies belongs to the selection cadence.
		if (chain.length === 0) return;
		const key = chainKey(chain);
		if (key === appliedKey) return;
		apply(chain, key);
	}

	function prepareForKeydown(e: KeyboardEvent): void {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'ArrowRight') prepareStep(1);
		else if (e.key === 'ArrowLeft') prepareStep(-1);
		else if (e.key === 'Backspace' || e.key === 'Delete') prepareStep(0);
	}

	return { update, prepareStep, prepareForKeydown };
}
