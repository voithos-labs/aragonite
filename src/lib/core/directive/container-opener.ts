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
import { setPluginMetadata, type AnyBlockKind, type CstNode } from '../nodes';
import { parse } from '../parser';
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
				const node: CstNode = {
					kind: (def?.kind ?? leaf) as AnyBlockKind,
					leadingTrivia: ctx.leadingTrivia,
					raw: ctx.line.raw
				};
				return { node, nextIndex: ctx.index + 1 };
			}

			// Colon-count-aware scan to the matching closer: a shorter nested closer
			// (`:::` inside a `::::`) fails isDirectiveCloser and does not close here.
			let closerIdx = ctx.index + 1;
			while (
				closerIdx < ctx.end &&
				!isDirectiveCloser(ctx.lines[closerIdx].text, fence.colonCount)
			) {
				closerIdx++;
			}
			if (closerIdx >= ctx.end) return null; // unterminated declines to paragraph

			const closerLine = ctx.lines[closerIdx];
			const bodyText = ctx.lines
				.slice(ctx.index + 1, closerIdx)
				.map((l) => l.raw)
				.join('');
			const raw = ctx.lines
				.slice(ctx.index, closerIdx + 1)
				.map((l) => l.raw)
				.join('');
			const body = parse(bodyText);
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
