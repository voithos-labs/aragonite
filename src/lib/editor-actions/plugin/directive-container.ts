/**
 * `rebuildRaw` factory for a directive-backed container whose reserved child 0 is
 * an editable title emitted into the opener line (a callout, an admonition). It
 * owns the three things every hand-written copy got right by luck: the title's
 * return to the opener info, the `children[1:]` body serialization, and — the one
 * a copy silently drops — threading the authored `lineEnding` so a CRLF document
 * rebuilds byte-identically. The directive name is the only per-kind variable, so
 * the caller supplies just a resolver over its own metadata.
 *
 * The generic no-title sibling is `core/directive`'s `rebuildDirectiveContainerRaw`
 * (info stored verbatim in metadata, whole children as body); this is the
 * title-child-0 shape.
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
			// The parse side threads only the opener ending; recover the closer's own
			// ending off the current raw (the closer is its last line). Ignored when
			// `closerNewline` is false.
			closerLineEnding: trailingLineEnding(node.raw)
		});
	};
}
