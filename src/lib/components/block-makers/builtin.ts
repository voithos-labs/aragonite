/** The built-in block and inline types, to place a plugin's block type relative to one or tell what
 *  a block or a piece is. */
import {
	ALL_BLOCK_KINDS,
	INLINE_KIND_TABLE,
	type BlockKind,
	type InlineNodeKind
} from '../../core/nodes';
import type { InlineType } from '../../schema/doc-view';
import { blockKindLabel } from '../../a11y-strings';
import type { BlockType } from '../../schema/plugin-unit';

export const builtin: {
	readonly blocks: Readonly<Record<BlockKind, BlockType>>;
	readonly inlines: Readonly<Record<InlineNodeKind, InlineType>>;
} = {
	// Marked pure so a build that never reads the table leaves it out.
	blocks: /* @__PURE__ */ Object.fromEntries(
		/* @__PURE__ */ ALL_BLOCK_KINDS.map((kind) => [
			kind,
			{ name: kind, label: blockKindLabel(kind) }
		])
	) as Record<BlockKind, BlockType>,
	inlines: /* @__PURE__ */ Object.fromEntries(
		/* @__PURE__ */ Object.keys(INLINE_KIND_TABLE).map((kind) => [kind, { name: kind }])
	) as Record<InlineNodeKind, InlineType>
};
