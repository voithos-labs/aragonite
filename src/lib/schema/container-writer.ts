/**
 * Writes a container's bytes from its children: through the line shape its kind states, or, for a
 * list, a table and a kind registered with its own rebuild, through that. `writeContainerRaw` is
 * the one reader of either; the list's and table's rebuilds are also called by name.
 */

import type { CstNode } from '../core/nodes';
import { firstDisplayLine } from '../core/lines';
import {
	codecFromShape,
	WRITES_LINES,
	type IndentedLines,
	type LineShape
} from '../core/strip-lines';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import type { GrammarView } from './block-openers';
import type { ChildRawChange } from './child-spans';
import { rebuildStripRaw, type StripRebuild } from './strip-rebuild';

/** `node`'s bytes written from its children as `grammar` reads them; `changed` names the one child
 *  whose bytes moved. */
export function writeContainerRaw(
	node: CstNode,
	grammar: GrammarView,
	changed?: ChildRawChange
): StripRebuild | undefined {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (descriptor?.lines) return writeShapedRaw(node, descriptor.lines, grammar, changed);
	return descriptor?.rebuildRaw?.(node, changed) ?? undefined;
}

function writeShapedRaw<D>(
	node: CstNode,
	shape: LineShape<D>,
	grammar: GrammarView,
	changed?: ChildRawChange
): StripRebuild | undefined {
	if (!node.children) return;
	if (WRITES_LINES in shape) return shape[WRITES_LINES](node, grammar, changed) || undefined;
	if (shape.shape === 'indented') return writeIndented(node, shape, grammar, changed);
	return rebuildStripRaw(node, codecFromShape(shape), { grammar, changed });
}

/** The data a container is written under: its metadata, over what its old first line reads. */
export function dataOver<D>(node: CstNode, read: D | undefined): D {
	return { ...read, ...node.metadata } as D;
}

/** The previous bytes are read under the marker their own first line was written with. */
function writeIndented<D>(
	node: CstNode,
	shape: IndentedLines<D>,
	grammar: GrammarView,
	changed: ChildRawChange | undefined
): StripRebuild {
	const match = shape.open.exec(firstDisplayLine(node.raw).text);
	const was = match ? shape.data(match) : undefined;
	const data = dataOver(node, was);
	const lines = codecFromShape(shape, data);
	const previous =
		was !== undefined && shape.first(was) !== shape.first(data)
			? codecFromShape(shape, was)
			: lines;
	return rebuildStripRaw(node, lines, { grammar, changed, previous });
}
