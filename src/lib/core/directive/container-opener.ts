/**
 * The one block opener owning `:::`/`::` directive syntax. It dispatches by name
 * through the directive registry: a registered name delegates to its
 * `fromDirective` factory, an unregistered name falls back to the lossless
 * generic kinds. Priority 45 sits between blockquote (40) and list (50) — no
 * built-in claims a colon fence, so the slot is free. Core-relative imports, not
 * `$lib/plugin` — the barrel pulls a Svelte component in and would cycle.
 */

import { registerBlockOpener, isBlockOpenerRegistered } from '../../schema/block-openers';
import { OPENER_PRIORITIES } from '../../schema/opener-priorities';
import { declaredPluginKind } from '../../schema/plugin-kind';
import {
	makeBlockNode,
	setPluginMetadata,
	type AnyBlockKind,
	type CstNode,
	type Document
} from '../nodes';
import { parseBlocks, joinRaw } from '../parser';
import { splitLines, trailingLineEnding, type ParsedLine } from '../lines';
import { defaultGrammarView } from '../../schema/block-openers';
import { matchDirectiveOpener, isDirectiveCloser } from './grammar';
import { resolveBlockDirectiveFactory, resolveDirective, type ParsedDirective } from './registry';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF, type DirectiveContainerMetadata } from './kinds';

export function registerDirectiveOpeners(): void {
	if (isBlockOpenerRegistered(DIRECTIVE_CONTAINER)) return; // idempotent for HMR / re-import

	const container = declaredPluginKind(DIRECTIVE_CONTAINER);
	const leaf = declaredPluginKind(DIRECTIVE_LEAF);

	registerBlockOpener(container, {
		// Priced off the ladder, never as a bare integer: renumbering a built-in has
		// to move this with it. A colon fence collides with no built-in matcher, so
		// it only needs to sit in the gap between blockquote and list.
		priority: OPENER_PRIORITIES.blockquote + 5,
		interruptsParagraph: (line) => matchDirectiveOpener(line) !== null,
		tryOpen(ctx) {
			const fence = matchDirectiveOpener(ctx.line.text);
			if (!fence) return null;

			const lineEnding = trailingLineEnding(ctx.line.raw);

			if (fence.tier === 'leaf') {
				const def = resolveDirective('leaf', fence.name);
				const factory = resolveBlockDirectiveFactory('leaf', fence.name);
				if (factory) {
					const parsed: ParsedDirective = {
						fence,
						body: undefined,
						leadingTrivia: ctx.leadingTrivia,
						raw: ctx.line.raw,
						closerColonCount: 0,
						closerNewline: false,
						lineEnding
					};
					return { node: factory(parsed), consumed: 1 };
				}
				// A leaf re-derives its content range from `node.raw`, so a generic leaf
				// needs no metadata; a kind-only registration just restamps the kind.
				const node = makeBlockNode({
					kind: (def?.kind ?? leaf) as AnyBlockKind,
					leadingTrivia: ctx.leadingTrivia,
					raw: ctx.line.raw
				});
				return { node, consumed: 1 };
			}

			// Colon-count-aware lookup of the matching closer: a shorter nested closer
			// (`:::` inside a `::::`) does not close here. Closer positions are indexed
			// once per line array, so an unclosed-opener flood stays linear instead of
			// rescanning to EOF per opener.
			const closerIdx = findDirectiveCloser(ctx.lines, ctx.index, ctx.end, fence.colonCount);
			if (closerIdx === -1) return null; // unterminated declines to paragraph

			const closerLine = ctx.lines[closerIdx];
			const bodyText = joinRaw(ctx.lines, ctx.index + 1, closerIdx);
			const raw = joinRaw(ctx.lines, ctx.index, closerIdx + 1);
			// Reparse the body one nesting level deeper, so nested directives share
			// the container-depth cap instead of overflowing via a fresh parse().
			const bodyLines = splitLines(bodyText);
			const inner = parseBlocks(bodyLines, 0, bodyLines.length, defaultGrammarView, ctx.depth + 1);
			const body: Document = { kind: 'document', ...inner };
			// The closer line is all colons (isDirectiveCloser guarantees an empty
			// remainder), so its text length is the exact closer colon count.
			const closerColonCount = closerLine.text.length;
			const closerNewline = closerLine.raw.endsWith('\n');

			const factory = resolveBlockDirectiveFactory('container', fence.name);
			if (factory) {
				const parsed: ParsedDirective = {
					fence,
					body,
					leadingTrivia: ctx.leadingTrivia,
					raw,
					closerColonCount,
					closerNewline,
					lineEnding
				};
				return { node: factory(parsed), consumed: closerIdx + 1 - ctx.index };
			}

			const node: CstNode = {
				kind: container,
				leadingTrivia: ctx.leadingTrivia,
				raw,
				innerPrefix: body.prefix,
				children: body.children,
				innerSuffix: body.suffix
			};
			setPluginMetadata<DirectiveContainerMetadata>(node, {
				name: fence.name,
				colonCount: fence.colonCount,
				info: fence.info,
				closerColonCount,
				closerNewline,
				lineEnding
			});
			return { node, consumed: closerIdx + 1 - ctx.index };
		}
	});
}

// ── Closer indexing ─────────────────────────────────────────────────────────

// A closer is a line that is entirely colons (`isDirectiveCloser(text, 1)`),
// closing any opener whose colon count is ≤ the line's length. Their positions and
// counts are indexed once per line array — an unclosed-opener flood otherwise
// rescans to EOF per opener (O(n²)). Keyed by array identity, so nested reparses
// (their own stripped arrays) and windows cache independently, and the entry is
// collected with the array.
//
// `maxCounts` is a max-tree over `counts`, so "first closer at or after k whose run
// is long enough" is a descent rather than a forward walk. Bucketing positions per
// exact colon count — the obvious alternative — fixes only the single-count case: a
// document spanning K distinct run lengths pays a binary search per candidate count,
// which is worse than the walk it replaces. The tree is indifferent to how the
// counts are distributed.
interface CloserIndex {
	positions: Int32Array;
	counts: Int32Array;
	/** Heap-layout max-tree over `counts`, padded to `leafBase` leaves. */
	maxCounts: Int32Array;
	leafBase: number;
}

const closerIndexCache = new WeakMap<ParsedLine[], CloserIndex>();

function closerIndex(lines: ParsedLine[]): CloserIndex {
	const cached = closerIndexCache.get(lines);
	if (cached) return cached;
	const positions: number[] = [];
	const counts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const text = lines[i].text;
		if (isDirectiveCloser(text, 1)) {
			positions.push(i);
			counts.push(text.length);
		}
	}
	let leafBase = 1;
	while (leafBase < counts.length) leafBase *= 2;
	const maxCounts = new Int32Array(2 * leafBase);
	maxCounts.set(counts, leafBase);
	for (let i = leafBase - 1; i >= 1; i--) {
		maxCounts[i] = Math.max(maxCounts[2 * i], maxCounts[2 * i + 1]);
	}
	const index: CloserIndex = {
		positions: Int32Array.from(positions),
		counts: Int32Array.from(counts),
		maxCounts,
		leafBase
	};
	closerIndexCache.set(lines, index);
	return index;
}

/**
 * Smallest closer-index slot at or after `from` whose count is ≥ `min`, or -1.
 * Padding leaves hold 0 and a directive opener runs at least two colons, so they
 * never match.
 */
function firstCloserAtLeast(index: CloserIndex, from: number, min: number): number {
	const descend = (node: number, lo: number, hi: number): number => {
		if (hi <= from || index.maxCounts[node] < min) return -1;
		if (hi - lo === 1) return lo;
		const mid = (lo + hi) >>> 1;
		const left = descend(node * 2, lo, mid);
		return left !== -1 ? left : descend(node * 2 + 1, mid, hi);
	};
	return descend(1, 0, index.leafBase);
}

/**
 * First line index in `(afterIndex, end)` that closes an opener of `colonCount`
 * colons (a colon run of length ≥ `colonCount`), or -1 when unterminated.
 * Equivalent to scanning `isDirectiveCloser` forward, over the closer index.
 */
function findDirectiveCloser(
	lines: ParsedLine[],
	afterIndex: number,
	end: number,
	colonCount: number
): number {
	const index = closerIndex(lines);
	const { positions } = index;
	let lo = 0;
	let hi = positions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (positions[mid] <= afterIndex) lo = mid + 1;
		else hi = mid;
	}
	const slot = firstCloserAtLeast(index, lo, colonCount);
	if (slot === -1 || slot >= positions.length || positions[slot] >= end) return -1;
	return positions[slot];
}
