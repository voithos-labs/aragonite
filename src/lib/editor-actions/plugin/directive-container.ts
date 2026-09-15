/**
 * `rebuildRaw` for a directive container whose reserved child 0 is an editable title
 * written into the opener line. Puts the title back into the opener, serializes
 * `children[1:]` as the body, and keeps the authored line ending a hand-written copy
 * would drop. The no-title version is `core/directive`'s `rebuildDirectiveContainerRaw`.
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
			// The parser records only the opener's line ending, so the closer's is read off the
			// current raw, where the closer is the last line.
			closerLineEnding: trailingLineEnding(node.raw)
		});
	};
}
