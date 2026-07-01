/**
 * `:::note` fenced-div callout — a plugin container kind built entirely on the
 * public registration seams. Dev/e2e harness only (Task 1 of WS-B Cycle 1):
 * proves a plugin can parse, hold child blocks, and round-trip a nested
 * container byte-for-byte before any component exists.
 */

import {
	declarePluginKind,
	registerBlockKind,
	registerBlockOpener,
	isBlockKindRegistered,
	setPluginMetadata,
	getPluginMetadata
} from '$lib/plugin';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';

export const NOTE = 'note';
const OPEN = /^:::(\w+)\s*$/;
const CLOSE = /^:::\s*$/;

interface CalloutMetadata {
	calloutType: string;
}

/**
 * Reconstruct `raw` from children after a structural edit. The opener sets `raw`
 * verbatim on parse (so round-trip never calls this); it matters only when the
 * callout's children mutate, and it must invert the opener exactly to satisfy
 * the `'strip'` container contract.
 */
export function rebuildCalloutRaw(node: CstNode): void {
	const type = getPluginMetadata<CalloutMetadata>(node)?.calloutType ?? NOTE;
	const inner = serialize({
		prefix: node.innerPrefix ?? '',
		children: node.children ?? [],
		suffix: node.innerSuffix ?? ''
	});
	node.raw = `:::${type}\n${inner}:::\n`;
}

export function registerCalloutKind(): void {
	if (isBlockKindRegistered(NOTE)) return; // idempotent for HMR / re-import
	const note = declarePluginKind(NOTE);

	registerBlockKind(note, {
		mergeRole: 'container',
		editable: true,
		isContainer: true,
		supportsInline: false,
		containerContract: 'strip',
		rebuildRaw: rebuildCalloutRaw,
		unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
	});

	registerBlockOpener(note, {
		priority: 45, // between blockquote (40) and list (50); ::: is claimed by no built-in
		interruptsParagraph: (line) => OPEN.test(line),
		tryOpen(ctx) {
			const opener = ctx.line.text.match(OPEN);
			if (!opener) return null;

			let i = ctx.index + 1;
			while (i < ctx.end && !CLOSE.test(ctx.lines[i].text)) i++;
			if (i >= ctx.end) return null; // unterminated fence declines to paragraph

			const innerText = ctx.lines
				.slice(ctx.index + 1, i)
				.map((l) => l.raw)
				.join('');
			const inner = parse(innerText);
			const raw = ctx.lines
				.slice(ctx.index, i + 1)
				.map((l) => l.raw)
				.join('');

			const node: CstNode = {
				kind: note,
				leadingTrivia: ctx.leadingTrivia,
				raw,
				innerPrefix: inner.prefix,
				children: inner.children,
				innerSuffix: inner.suffix
			};
			setPluginMetadata<CalloutMetadata>(node, { calloutType: opener[1] });
			return { node, nextIndex: i + 1 };
		}
	});
}
