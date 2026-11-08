/**
 * A block as a plugin reads it: its type, its data, its bytes and its text, read-only. What a
 * block type's `draw`, `height` and commands receive.
 */
import { getPluginMetadata, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getContentRange } from '../core/inline';
import type { BlockType } from './plugin-unit';

/** One block of the document. */
export interface Block<D = unknown> {
	readonly type: BlockType<D>;
	readonly data: D;
	/** Its bytes, its line ending included. */
	readonly text: string;
	/** The text the author writes in it, its markers left out. */
	readonly body: string;
	readonly children: readonly Block[];
	/** Its bytes in the document, read when asked (an edit above moves them with no `update`);
	 *  both -1 once it has left the document, which a draft refuses. */
	readonly from: number;
	readonly to: number;
	/** Narrows the block to `type`'s data. */
	is<E>(type: BlockType<E>): this is Block<E>;
}

/** `node` as a plugin reads it; `typeOf` names each kind's block type, and `locate` finds it in
 *  the document as it is when asked. */
export function blockOf<D>(
	node: NodeView,
	typeOf: (kind: AnyBlockKind) => BlockType<unknown>,
	locate: (node: NodeView) => { from: number; to: number } | null = () => null
): Block<D> {
	const type = typeOf(node.kind) as BlockType<D>;
	let children: readonly Block[] | undefined;
	return {
		[NODE]: node,
		type,
		data: getPluginMetadata<D>(node) as D,
		text: node.raw,
		get body() {
			const { start, end } = getContentRange(node);
			return node.raw.slice(start, end);
		},
		get children() {
			return (children ??= (node.children ?? []).map((child) => blockOf(child, typeOf, locate)));
		},
		get from() {
			return locate(node)?.from ?? -1;
		},
		get to() {
			return locate(node)?.to ?? -1;
		},
		is: <E>(other: BlockType<E>): boolean => other.name === type.name
	} as unknown as Block<D>;
}

/** The node a block was read from, which a draft finds again in the document it commits to. */
export function nodeOfBlock(block: Block<unknown>): NodeView | undefined {
	return (block as { [NODE]?: NodeView })[NODE];
}

const NODE = Symbol('Block.node');
