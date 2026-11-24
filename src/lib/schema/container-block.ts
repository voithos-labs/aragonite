/**
 * A container block type's spec, and the facts every editor system reads, derived from it; a
 * marked or indented container's opener is the shared reader in `core/parsers/strip-container.ts`,
 * a fenced one's comes with its lines (`schema/fenced-lines.ts`).
 */
import { getPluginMetadata } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	READS_LINES,
	type FencedLines,
	type IndentedLines,
	type MarkedLines
} from '../core/strip-lines';
import type { ContainerLines } from '../core/parsers/strip-container';
import type { BuiltinRegistration } from './block-kind-descriptor';
import {
	samplesOf,
	heightEstimate,
	gapEdgesOf,
	type BlockCommon,
	type DrawDepends
} from './block-shapes';
import type { Block } from './doc-view';
import type { Chord } from './plugin-command';
import type { ContainerDrawContext, Drawn } from './drawing';
import { TITLE_ROW } from './title-row-leaf';

export type { ContainerLines } from '../core/parsers/strip-container';

// ── Spec ─────────────────────────────────────────────────────────────────────

/** A block holding other blocks; the editor writes its bytes from `lines`, never the plugin. */
export type ContainerSpec<D extends object> = BlockCommon<D, Chord> & {
	lines: ContainerLines<D> | FencedLines<D>;
	/** Text joined to its end from below lands in its deepest text block; default true. */
	joins?: boolean;
	/** A pasted container of this type joins one it lands in, where `key` names a data field the
	 *  two must share; absent, it nests. */
	merges?: { key?: keyof NoInfer<D> & string };
	/** Its body folds away under its title row, as the data says; fenced lines with a title only. */
	closable?: Closable<NoInfer<D>>;
} & (
		| { draw?: never; depends?: never }
		| ({
				draw(
					block: Block<NoInfer<D>>,
					ctx: ContainerDrawContext
				): Drawn<NoInfer<D>, ContainerDrawContext>;
		  } & DrawDepends)
	);

/** Whether a section's body is folded away, read from its data and written into it. */
export interface Closable<D> {
	closed(data: D): boolean;
	/** The data with the section closed or opened; the editor writes it as one undo step. */
	set(data: D, closed: boolean): D;
}

// ── Derived ──────────────────────────────────────────────────────────────────

/** The facts a container derives from its spec and its shape. */
export function containerRegistration(
	spec: ContainerSpec<object>,
	lines: MarkedLines | IndentedLines<object> | FencedLines<object>
): BuiltinRegistration {
	const marked = lines.shape === 'marked';
	const reading = lines.shape === 'fenced' ? lines[READS_LINES] : null;
	if (spec.closable && !reading?.titled) {
		throw new Error(
			`container "${spec.name}": closable needs a title row, so fenced lines with a title`
		);
	}
	return {
		label: spec.label,
		...(spec.dragLabel !== undefined && { dragLabel: spec.dragLabel }),
		editable: true,
		supportsInline: false,
		// A quote-like container reads as part of the text around it, so it shows no drag handle.
		pageRole: spec.role ?? (marked ? 'prose' : 'object'),
		mergeRole: spec.joins === false ? 'not-mergeable' : 'container',
		// A marked or indented container's edges are its first and last child's text.
		gapEdges: gapEdgesOf({ edgesInText: reading === null }),
		...samplesOf(spec.sample),
		...(spec.height ? { estimateHeight: heightEstimate(spec.height) } : {}),
		container: reading
			? {
					lines,
					...(spec.merges ? { merges: spec.merges } : {}),
					bodyWrite: reading.bodyWrite,
					...(reading.titled
						? {
								reservedChrome: titleRowOf(spec.closable),
								unwrapRole: { middleChildBackspace: 'default-merge' as const }
							}
						: {
								unwrapRole: {
									firstChildBackspace: 'lift-first-child-keep-container' as const,
									middleChildBackspace: 'default-merge' as const
								}
							})
				}
			: {
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

/** The title row a titled fenced container holds as child 0, folding its body where `closable`
 *  says: every reader of a fold (focus, windowing, a reveal) asks these two. */
function titleRowOf(closable: Closable<object> | undefined) {
	if (!closable) return { kind: TITLE_ROW };
	const data = (node: NodeView) => getPluginMetadata<object>(node) ?? {};
	return {
		kind: TITLE_ROW,
		isCollapsed: (node: NodeView) => closable.closed(data(node)),
		expandPatch: (node: NodeView) => closable.set(data(node), false) as Record<string, unknown>
	};
}

/** The marker an indented container shows ahead of its first child's text, read-only. */
export function ambientMarker<D extends object>(lines: IndentedLines<D>, node: NodeView): string {
	return lines.first(getPluginMetadata<D>(node) as D);
}
