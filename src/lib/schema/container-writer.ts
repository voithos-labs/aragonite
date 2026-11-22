/**
 * Writes a container's bytes from its children: through the line shape its kind states, or, for a
 * list, a table and a kind registered with its own rebuild, through that. `writeContainerRaw` is
 * the one reader of either; the list's and table's rebuilds are also called by name.
 */

import type { CstNode } from '../core/nodes';
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
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

function writeShapedRaw<D extends object>(
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
	if (devChecksOn) {
		const what = nonObjectData(read) ?? nonObjectData(node.metadata);
		if (what) {
			devWarn(
				'container-data',
				`${node.kind}: its data is ${what}, where a container's data must be an object`
			);
		}
	}
	return { ...read, ...node.metadata } as D;
}

/** What `data` is, where a container's writer can't lay its metadata over it: a primitive, null or
 *  an array. Null for an object, or for no data at all. */
export function nonObjectData(data: unknown): string | null {
	if (data === undefined) return null;
	if (Array.isArray(data)) return 'an array';
	if (data === null) return 'null';
	return typeof data === 'object' ? null : `a ${typeof data}`;
}

/** The previous bytes are read under the marker their own first line was written with. */
function writeIndented<D extends object>(
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
