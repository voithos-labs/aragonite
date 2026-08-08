/**
 * The bytes an insertion produces while marks are pending. A mark is resolved against the
 * caret's construct chain (§ 4.3): a kind the chain does not carry WRAPS the inserted text, a
 * kind it does carry escapes it — the insertion leaves the construct at the nearer edge, or
 * splits it close-and-reopen when the caret is strictly inside. Pure over the inline tree.
 */

import type { InlineNode } from '../../../core/nodes';
import type { InlineMarkKind } from '../../../cursor/pending-marks';
import { constructContentRange } from './edge-seat';
import { markersFor } from './format-toggle';

/** Outermost first, so a set wraps to one byte string whatever order the chords arrived in. */
const NESTING_ORDER: readonly InlineMarkKind[] = ['strong', 'emphasis'];

export interface MarkedInsertion {
	/** The block's whole display bytes after the insertion. */
	raw: string;
	/** Where the caret lands — after the inserted text, inside whatever now wraps it. */
	caret: number;
}

/**
 * The insertion `text` at `caretOffset` makes under `marks`, or null when the marks name
 * nothing to do. One rewrite, so the seat's caller commits it exactly like any other byte
 * write.
 */
export function resolveMarkedInsertion(
	display: string,
	caretOffset: number,
	text: string,
	marks: ReadonlySet<InlineMarkKind>,
	inlines: readonly InlineNode[]
): MarkedInsertion | null {
	if (marks.size === 0 || text.length === 0) return null;

	// Outermost first: an escape takes every construct inside the outermost one it removes,
	// since bytes cannot leave a parent while staying in its child.
	const chain = markChainAt(caretOffset, inlines);
	const removed = chain.filter((node) => marks.has(node.kind));
	const applied = NESTING_ORDER.filter((kind) => marks.has(kind) && !hasKind(chain, kind));

	if (removed.length === 0) {
		const wrapped = wrap(text, applied);
		return {
			raw: display.slice(0, caretOffset) + wrapped.raw + display.slice(caretOffset),
			caret: caretOffset + wrapped.caret
		};
	}

	// Everything inside the outermost removal is escaped with it; the kinds among them the
	// user did NOT toggle off are re-declared around the payload so the insertion keeps them.
	const escaped = chain.slice(chain.indexOf(removed[0]));
	const kept = NESTING_ORDER.filter(
		(kind) => hasKind(escaped, kind) && !marks.has(kind) && !applied.includes(kind)
	);
	const wrapped = wrap(text, [...applied, ...kept].sort(byNesting));

	let leftEnd = caretOffset;
	let rightStart = caretOffset;
	let closers = '';
	let openers = '';
	for (const node of [...escaped].reverse()) {
		// An empty half would leave the delimiter pair enclosing nothing — invisible `****`,
		// the exact residue live mode must never mint — so step outside the run instead.
		if (leftEnd === node.contentStart) leftEnd = node.start;
		else closers += display.slice(node.contentEnd, node.end);
		if (rightStart === node.contentEnd) rightStart = node.end;
		else openers = display.slice(node.start, node.contentStart) + openers;
	}

	return {
		raw: display.slice(0, leftEnd) + closers + wrapped.raw + openers + display.slice(rightStart),
		caret: leftEnd + closers.length + wrapped.caret
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

function byNesting(a: InlineMarkKind, b: InlineMarkKind): number {
	return NESTING_ORDER.indexOf(a) - NESTING_ORDER.indexOf(b);
}

function hasKind(chain: readonly MarkNode[], kind: InlineMarkKind): boolean {
	return chain.some((node) => node.kind === kind);
}

function wrap(text: string, kinds: readonly InlineMarkKind[]): { raw: string; caret: number } {
	const openers = kinds.map(markersFor).join('');
	const closers = [...kinds].reverse().map(markersFor).join('');
	return { raw: openers + text + closers, caret: openers.length + text.length };
}

interface MarkNode {
	kind: InlineMarkKind;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

function isMarkKind(kind: string): kind is InlineMarkKind {
	return kind === 'strong' || kind === 'emphasis';
}

/**
 * The markable constructs whose CONTENT holds `offset`, outermost first. Content-inclusive at
 * both ends: at a trailing content edge continued typing extends the construct, so that is
 * exactly where a toggle-off has to be able to escape it.
 */
function markChainAt(offset: number, inlines: readonly InlineNode[]): MarkNode[] {
	const chain: MarkNode[] = [];
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			const content = constructContentRange(node);
			if (!content || offset < content.start || offset > content.end) continue;
			if (isMarkKind(node.kind)) {
				chain.push({
					kind: node.kind,
					start: node.start,
					end: node.end,
					contentStart: content.start,
					contentEnd: content.end
				});
			}
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return chain;
}
