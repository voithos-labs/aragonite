/**
 * A container block type's spec, and the facts every editor system reads, derived from it; its
 * opener is the shared reader in `core/parsers/strip-container.ts`.
 */
import { getPluginMetadata } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { IndentedLines, MarkedLines } from '../core/strip-lines';
import type { ContainerLines } from '../core/parsers/strip-container';
import type { BuiltinRegistration } from './block-kind-descriptor';
import { fixtureOf, heightEstimate, type BlockCommon, type DrawDepends } from './block-shapes';
import type { Block } from './doc-view';
import type { ContainerDrawContext, Drawn } from './drawing';

export type { ContainerLines } from '../core/parsers/strip-container';

// ── Spec ─────────────────────────────────────────────────────────────────────

/** A block holding other blocks; the editor writes its bytes from `lines`, never the plugin. */
export type ContainerSpec<D> = BlockCommon<D> & {
	lines: ContainerLines<D>;
	/** Text joined to its end from below lands in its deepest text block; default true. */
	joins?: boolean;
	/** A pasted container of this type joins one it lands in, where `key` names a data field the
	 *  two must share; absent, it nests. */
	merges?: { key?: keyof NoInfer<D> & string };
} & (
		| { draw?: never; depends?: never }
		| ({
				draw(
					block: Block<NoInfer<D>>,
					ctx: ContainerDrawContext
				): Drawn<NoInfer<D>, ContainerDrawContext>;
		  } & DrawDepends)
	);

// ── Derived ──────────────────────────────────────────────────────────────────

/** The facts a container derives from its spec and its shape. */
export function containerRegistration(
	spec: ContainerSpec<unknown>,
	lines: MarkedLines | IndentedLines<unknown>
): BuiltinRegistration {
	const marked = lines.shape === 'marked';
	return {
		label: spec.label,
		editable: true,
		supportsInline: false,
		// A quote-like container reads as part of the text around it, so it shows no drag handle.
		pageRole: spec.role ?? (marked ? 'prose' : 'object'),
		mergeRole: spec.joins === false ? 'not-mergeable' : 'container',
		gapEdges: 'none',
		...fixtureOf(spec.sample),
		...(spec.height ? { estimateHeight: heightEstimate(spec.height) } : {}),
		container: {
			lines,
			...(spec.merges ? { merges: spec.merges } : {}),
			reorderChildren: {},
			// A marked container's markers go with its first child; an indented one's stay with it.
			unwrapRole: {
				firstChildBackspace: marked
					? 'lift-first-child-drop-opener'
					: 'lift-first-child-keep-container',
				middleChildBackspace: 'default-merge'
			}
		}
	};
}

/** The marker an indented container shows ahead of its first child's text, read-only. */
export function ambientMarker<D>(lines: IndentedLines<D>, node: NodeView): string {
	return lines.first(getPluginMetadata<D>(node) as D);
}
