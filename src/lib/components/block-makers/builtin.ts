/** The built-in block types, to place a plugin's block type relative to one or tell a block's type. */
import { ALL_BLOCK_KINDS, type BlockKind } from '../../core/nodes';
import { blockKindLabel } from '../../a11y-strings';
import type { BlockType } from '../../schema/plugin-unit';

export const builtin: { readonly blocks: Readonly<Record<BlockKind, BlockType>> } = {
	// Marked pure so a build that never reads the table leaves it out.
	blocks: /* @__PURE__ */ Object.fromEntries(
		/* @__PURE__ */ ALL_BLOCK_KINDS.map((kind) => [
			kind,
			{ name: kind, label: blockKindLabel(kind) }
		])
	) as Record<BlockKind, BlockType>
};
