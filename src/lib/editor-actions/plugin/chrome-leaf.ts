/**
 * Register a title-row leaf kind: editable text at a reserved child index of a plugin
 * container (a details summary). The container declares the index via `reservedChrome`; this
 * registers the leaf. The child is one line of plain text.
 */

import type { BlockView } from '../../schema/block-view';
import { registerTitleRowLeaf, type ChromeLeafOptions } from '../../schema/title-row-leaf';
import { makeBlockNode, type AnyBlockKind, type CstNode } from '../../core/nodes';

/**
 * Create the reserved child-0 node for a title-row leaf. An empty title becomes a bare
 * newline, so the empty leaf still holds a line.
 */
export function chromeChild(kind: AnyBlockKind, text: string): CstNode {
	return makeBlockNode({ kind, leadingTrivia: '', raw: text ? `${text}\n` : '\n' });
}

export type { ChromeLeafOptions } from '../../schema/title-row-leaf';

/** `view` draws the row, so the caller applies `blockClass` when it builds the view. */
export function registerChromeLeaf(
	kind: AnyBlockKind,
	view: BlockView,
	opts: Omit<ChromeLeafOptions, 'blockClass'> = {}
): void {
	registerTitleRowLeaf(kind, view, opts);
}
