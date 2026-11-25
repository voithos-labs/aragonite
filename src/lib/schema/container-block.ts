/**
 * A container block type's spec, and the facts every editor system reads, derived from it; a
 * marked or indented container's opener is the shared reader in `core/parsers/strip-container.ts`,
 * a fenced one's comes with its lines (`schema/fenced-lines.ts`), and a colon one is read by the
 * directive grammar its lines turn on (`components/block-makers/colon-lines.ts`).
 */
import { getPluginMetadata, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	READS_LINES,
	type ColonLines,
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
import type { Editor } from './plugin-unit';
import type { AmbientPrefix } from '../block-component';

export type { ContainerLines } from '../core/parsers/strip-container';

// ── Spec ─────────────────────────────────────────────────────────────────────

/** A block holding other blocks; the editor writes its bytes from `lines`, never the plugin. */
export type ContainerSpec<D extends object> = BlockCommon<D, Chord> & {
	/** Text joined to its end from below lands in its deepest text block; default true. */
	joins?: boolean;
	/** Its body folds away under its title row, as the data says; for now only fenced lines with a
	 *  title give a container one. */
	closable?: Closable<NoInfer<D>>;
} & (
		| {
				lines: ContainerLines<D>;
				/** A pasted container of this type joins one it lands in, where `key` names a data field
				 *  the two must share; absent, it nests. */
				merges?: { key?: keyof NoInfer<D> & string };
		  }
		// A pasted closing line can't say which container it ends, so one closed by a line nests.
		| { lines: FencedLines<D> | ColonLines; merges?: never }
	) &
	(
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

/** The facts a container derives from its spec and its shape; `rowKind` names its title row once an
 *  editor has named the type. */
export function containerRegistration(
	spec: ContainerSpec<object>,
	lines: MarkedLines | IndentedLines<object> | FencedLines<object> | ColonLines,
	rowKind: () => AnyBlockKind
): BuiltinRegistration {
	const marked = lines.shape === 'marked';
	const reading = lines.shape === 'fenced' ? lines[READS_LINES] : null;
	const colon = lines.shape === 'colon';
	const titled = colon || reading?.title !== undefined;
	// A colon type's data is its name, which its opening line spells and no metadata write reaches.
	if (spec.closable && !reading?.title) {
		throw new Error(
			`container "${spec.name}": closable needs a title row, for now fenced lines with a title`
		);
	}
	// A marked container's markers go with its first child; any other's lines stay with it.
	const firstChild = marked ? 'lift-first-child-drop-opener' : 'lift-first-child-keep-container';
	return {
		label: spec.label,
		...(spec.dragLabel !== undefined && { dragLabel: spec.dragLabel }),
		editable: true,
		supportsInline: false,
		// A quote-like container reads as part of the text around it, so it shows no drag handle.
		pageRole: spec.role ?? (marked ? 'prose' : 'object'),
		mergeRole: spec.joins === false ? 'not-mergeable' : 'container',
		// A marked or indented container's edges are its first and last child's text.
		gapEdges: gapEdgesOf({ edgesInText: reading === null && !colon }),
		...samplesOf(spec.sample),
		...(spec.height ? { estimateHeight: heightEstimate(spec.height) } : {}),
		container: {
			lines,
			...(spec.merges && { merges: spec.merges }),
			...(reading ? { bodyWrite: reading.bodyWrite } : colon ? {} : { reorderChildren: {} }),
			// A title row is always kept, so its container names no first-child strategy.
			...(titled
				? { reservedChrome: titleRowOf(spec.closable, rowKind) }
				: {
						unwrapRole: { firstChildBackspace: firstChild, middleChildBackspace: 'default-merge' }
					})
		}
	};
}

/** The title row a titled container holds as child 0, folding its body where `closable` says:
 *  every reader of a fold (focus, windowing, a reveal) asks these two. */
function titleRowOf(closable: Closable<object> | undefined, rowKind: () => AnyBlockKind) {
	const data = (node: NodeView) => getPluginMetadata<object>(node) ?? {};
	return {
		// Read where the editor holds the type, after it has named it.
		get kind() {
			return rowKind();
		},
		...(closable && {
			isCollapsed: (node: NodeView) => closable.closed(data(node)),
			expandPatch: (node: NodeView) => closable.set(data(node), false) as Record<string, unknown>
		})
	};
}

/** What a marker's link reads from the editor drawing it. */
export interface MarkerHost {
	readonly editor: Editor;
	/** Whether a click follows a link, by the rule the host picked. */
	follows(click: MouseEvent): boolean;
	readonly reading: boolean;
}

/** The marker an indented container shows ahead of its first child's text, read-only; the run its
 *  lines' `link` names is a link that follows by the host's rule. */
export function ambientMarker<D extends object>(
	lines: IndentedLines<D>,
	node: NodeView,
	host: MarkerHost
): AmbientPrefix {
	const data = getPluginMetadata<D>(node) as D;
	const text = lines.first(data);
	const { link } = lines;
	if (!link) return text;
	const follow = () => link.follow(data, host.editor);
	const range = {
		start: 0,
		end: link.length(data),
		className: link.className ?? 'marker-link',
		role: 'link' as const,
		label: link.label(data),
		onClick(e: MouseEvent) {
			if (!host.follows(e)) return;
			// The click only follows, so the block's caret handling never sees it.
			e.preventDefault();
			e.stopPropagation();
			follow();
		}
	};
	// A tab stop only where the block holds no caret for it to interrupt.
	return {
		text,
		interactive: [host.reading ? { ...range, focusable: true, onActivate: follow } : range]
	};
}
