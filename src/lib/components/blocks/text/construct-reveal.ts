/**
 * preview-inline's construct-reveal trigger: an inline construct's markers stay CSS-hidden until
 * the caret enters its INCLUSIVE `[start, end]`, revealing the whole enclosing chain. Reveal is a
 * class flip on `data-construct-*` spans, so the DOM text never changes and raw offsets survive it
 * (spec: the preview-inline-affinity e2e requirement).
 */

import { tick } from 'svelte';
import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
import type { LinkReferenceResolverRef } from '../../../editor-keys';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { isRevealableInlineKind } from '../../../schema/inline-construct-policy';
import { toClampedRawOffset } from '../../../cursor/coordinate-spaces';
import { domTextOffsetAtNode } from '../../../cursor/widget-offset';
import {
	isInteractionTraceEnabled,
	traceRevealOpen,
	traceRevealFold
} from '../../../debug/interaction-trace';

export const CONSTRUCT_REVEAL_CLASS = 'md-construct-reveal';

// ── Chain math (pure) ────────────────────────────────────────────────────────

/**
 * Every revealable construct whose inclusive `[start, end]` contains `offset`, outermost
 * first; at a boundary shared by adjacent siblings both are collected.
 */
export function constructChainAtOffset(nodes: InlineNode[], offset: number): InlineNode[] {
	const chain: InlineNode[] = [];
	collectChain(nodes, offset, chain);
	return chain;
}

function collectChain(nodes: InlineNode[], offset: number, out: InlineNode[]): void {
	for (const node of nodes) {
		if (offset < node.start || offset > node.end) continue;
		if (isRevealableInlineKind(node.kind)) out.push(node);
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
	/** Cross-block selections freeze the reveal state, so a sweep anchored in revealed
	 *  marker text keeps its layout. */
	isCrossBlock: () => boolean;
}

export interface ConstructReveal {
	/** Re-evaluate the caret chain and flip marker classes to match. `force` after a
	 *  rebuild: fresh spans carry no reveal class even on an unchanged chain key. */
	update(force?: boolean): void;
	/** Synchronous keydown backstop, reveal-only: Chromium prioritizes input events over
	 *  normal tasks, so rapid arrows outrun the selectionchange reveal and would step
	 *  against still-folded markers. Reveals the caret's chain plus `delta`'s (0 = neither). */
	prepareStep(delta: -1 | 0 | 1): void;
	/** Keydown wiring for `prepareStep`. Owns the key vocabulary so the component stays
	 *  free of destructive-key literals, which G4.12 scans for as interceptor shape;
	 *  this module holds no preventDefault and consumes nothing. */
	prepareForKeydown(e: KeyboardEvent): void;
}

export function createConstructReveal(deps: ConstructRevealDeps): ConstructReveal {
	// Span refs go stale on rebuild: removing a class from a detached span is a harmless
	// no-op, and `force` re-resolves against the fresh DOM.
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
		return resolvedInlineContent(deps.node, deps.linkRef);
	}

	const toEntry = (n: InlineNode): ChainEntry => ({ kind: n.kind, start: n.start, end: n.end });

	/** The chain the current selection asks for; [] when nothing contains the caret. */
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

	// A fold to no chain must survive a tick: cross-block entry clears the native selection
	// before the cross-block flag flips, manufacturing a transient fold-shaped state.
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
		// Reveal-only: any fold an empty union implies belongs to the selection cadence.
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
