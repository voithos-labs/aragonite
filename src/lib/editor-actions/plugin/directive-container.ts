/**
 * `rebuildRaw` factory for a directive-backed container whose reserved child 0 is an
 * editable title emitted into the opener line. Owns the title's return to the opener
 * info, the `children[1:]` body, and the authored `lineEnding` a hand-written copy
 * drops. The no-title sibling is `core/directive`'s `rebuildDirectiveContainerRaw`.
 */

import { serializeDirective } from '../../core/directive/grammar';
import { concatChildren as serializeChildren } from '../../core/serializer';
import { trimTrailingLineEnding, trailingLineEnding } from '../../core/lines';
import { getPluginMetadata, type CstNode } from '../../core/nodes';

export function createDirectiveRebuild<
	M extends {
		colonCount: number;
		closerColonCount: number;
		closerNewline: boolean;
		lineEnding: string;
	}
>(directiveName: (meta: M | undefined) => string): (node: CstNode) => void {
	return (node) => {
		const meta = getPluginMetadata<M>(node);
		const children = node.children ?? [];
		const title = children[0] ? trimTrailingLineEnding(children[0].raw) : '';
		node.raw = serializeDirective({
			colonCount: meta?.colonCount ?? 3,
			name: directiveName(meta),
			info: title ? ` ${title}` : '',
			innerPrefix: node.innerPrefix ?? '',
			body: serializeChildren(children.slice(1)),
			innerSuffix: node.innerSuffix ?? '',
			closerColonCount: meta?.closerColonCount ?? meta?.colonCount ?? 3,
			closerNewline: meta?.closerNewline ?? true,
			lineEnding: meta?.lineEnding,
			// The parse side threads only the opener ending, so recover the closer's own
			// off the current raw, where the closer is the last line.
			closerLineEnding: trailingLineEnding(node.raw)
		});
	};
}
