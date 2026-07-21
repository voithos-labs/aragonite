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
import { splitLines, type ParsedLine } from '../lines';
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

			const lineEnding = ctx.line.raw.endsWith('\r\n') ? '\r\n' : '\n';

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
					return { node: factory(parsed), nextIndex: ctx.index + 1 };
				}
				// A leaf re-derives its content range from `node.raw`, so a generic leaf
				// needs no metadata; a kind-only registration just restamps the kind.
				const node = makeBlockNode({
					kind: (def?.kind ?? leaf) as AnyBlockKind,
					leadingTrivia: ctx.leadingTrivia,
					raw: ctx.line.raw
				});
				return { node, nextIndex: ctx.index + 1 };
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
				return { node: factory(parsed), nextIndex: closerIdx + 1 };
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
			return { node, nextIndex: closerIdx + 1 };
		}
	});
}

// ── Closer indexing ─────────────────────────────────────────────────────────

// A closer is a line that is entirely colons (`isDirectiveCloser(text, 1)`),
// closing any opener whose colon count is ≤ the line's length. Their positions
// and counts are indexed once per line array — an unclosed-opener flood otherwise
// rescans to EOF per opener (O(n²)). Keyed by array identity, so nested reparses
// (their own stripped arrays) and windows cache independently, and the entry is
// collected with the array.
const closerIndexCache = new WeakMap<ParsedLine[], { positions: Int32Array; counts: Int32Array }>();

function closerIndex(lines: ParsedLine[]): { positions: Int32Array; counts: Int32Array } {
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
	const index = { positions: Int32Array.from(positions), counts: Int32Array.from(counts) };
	closerIndexCache.set(lines, index);
	return index;
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
	const { positions, counts } = closerIndex(lines);
	let lo = 0;
	let hi = positions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (positions[mid] <= afterIndex) lo = mid + 1;
		else hi = mid;
	}
	for (let k = lo; k < positions.length && positions[k] < end; k++) {
		if (counts[k] >= colonCount) return positions[k];
	}
	return -1;
}
