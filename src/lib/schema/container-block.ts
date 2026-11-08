/**
 * A container block type's spec and what the editor derives from it: an opener that reads the lines
 * through the shape's own line syntax, so the parser and the writer agree, and the facts every
 * editor system reads.
 */
import {
	getPluginMetadata,
	setPluginMetadata,
	type CstNode,
	type PluginBlockKind
} from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { joinRaw, parseContainerBody } from '../core/parser';
import {
	codecFromShape,
	FIRST_LINE,
	INNER_LINE,
	type HeadedLines,
	type IndentedLines,
	type LineCodec,
	type LinePlace,
	type MarkedLines
} from '../core/strip-lines';
import type { BlockOpener, OpenContext } from './block-openers';
import type { BuiltinRegistration } from './block-kind-descriptor';
import { containerClosure } from './closure';
import { headedLines } from './headed-lines';
import { fixtureOf, heightEstimate, type BlockCommon } from './block-shapes';
import type { Block } from './doc-view';
import type { ContainerDrawContext, Drawn } from './drawing';

// ── Spec ─────────────────────────────────────────────────────────────────────

/** A block holding other blocks; the editor writes its bytes from `lines`, never the plugin. */
export interface ContainerSpec<D> extends BlockCommon<D> {
	lines: ContainerLines<D>;
	/** Text joined to its end from below lands in its deepest text block; default true. */
	joins?: boolean;
	/** A pasted container of this type joins one it lands in, where `key` names a data field the
	 *  two must share; absent, it nests. */
	merges?: { key?: keyof NoInfer<D> & string };
	draw?(
		block: Block<NoInfer<D>>,
		ctx: ContainerDrawContext
	): Drawn<NoInfer<D>, ContainerDrawContext>;
}

/** How a container's lines look: a marker on every line, under a head line or not, or a marker on
 *  the first and an indent after. */
export type ContainerLines<D> =
	MarkedLines | (MarkedLines & { head: HeadedLines<D>['head'] }) | IndentedLines<D>;

// ── Derived ──────────────────────────────────────────────────────────────────

/** The line shape the editor writes with: a head line brings its own writer. */
export function writtenLines<D>(lines: ContainerLines<D>): MarkedLines | IndentedLines<D> {
	return lines.shape === 'marked' && 'head' in lines ? headedLines(lines) : lines;
}

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
		},
		closure: CONTAINER_CLOSURE
	};
}

/** The opener of a marked or indented container. A line with no marker continues it only as the
 *  lazy line of a paragraph open above; a blank line belongs to it only when one below does. */
export function stripOpener<D>(
	kind: PluginBlockKind,
	lines: ContainerLines<D>,
	priority: number,
	interrupts: boolean
): BlockOpener {
	const head = lines.shape === 'marked' && 'head' in lines ? lines.head : null;
	return {
		priority,
		interruptsParagraph: interrupts ? (text) => openingLine(lines, text) !== null : false,
		tryOpen(ctx) {
			const open = openingLine(lines, ctx.line.text);
			if (!open) return null;
			const end = stripExtent(ctx, open.codec);
			const from = head ? ctx.index + 1 : ctx.index;
			let body = '';
			for (let i = from; i < end; i++) {
				const line = ctx.lines[i];
				const place = !head && i === from ? FIRST_LINE : INNER_LINE;
				body += (open.codec.read(line.text, place)?.text ?? line.text) + line.lineEnding;
			}
			const doc = parseContainerBody(body, head ? { afterOpenerLine: true } : {}, {
				// One level deeper, inside this parse entry, so the body inherits its scope.
				scope: ctx.isDocumentParse ? 'document' : 'fragment',
				depth: ctx.depth + 1,
				grammar: ctx.grammar
			});
			const node: CstNode = {
				kind,
				leadingTrivia: ctx.leadingTrivia,
				raw: joinRaw(ctx.lines, ctx.index, end),
				innerPrefix: doc.prefix,
				children: doc.children,
				innerSuffix: doc.suffix
			};
			if (open.data !== undefined) setPluginMetadata(node, open.data);
			return { node, consumed: end - ctx.index };
		}
	};
}

/** Whether lines a completion wrote read as this container: its opening line first, and a marker on
 *  every line after. */
export function stripClaims<D>(lines: ContainerLines<D>, written: readonly string[]): boolean {
	const open = written.length > 0 && openingLine(lines, written[0]);
	return (
		!!open && written.slice(1).every((line) => open.codec.read(line, INNER_LINE)?.lazy === false)
	);
}

/** The marker an indented container shows ahead of its first child's text, read-only. */
export function ambientMarker<D>(lines: IndentedLines<D>, node: NodeView): string {
	return lines.first(getPluginMetadata<D>(node) as D);
}

// ── Internal ─────────────────────────────────────────────────────────────────

const BLANK_TAIL: LinePlace = { first: false, trailingBlank: true };

// Every container a maker builds answers the editor's systems through the editor's own children.
const CONTAINER_CLOSURE = containerClosure({
	roundTripVia: 'the container writer, from the block type line shape',
	focus: { mode: 'implemented', via: 'derived from the block type' },
	mergeBackspace: { mode: 'implemented', via: 'derived from the block type' },
	undo: { mode: 'inherit-default' },
	simOracle: { mode: 'inherit-default' }
});

/** The container's line syntax and data, if `text` opens one. */
function openingLine<D>(
	lines: ContainerLines<D>,
	text: string
): { codec: LineCodec; data: D | undefined } | null {
	if (lines.shape === 'indented') {
		const match = lines.open.exec(text);
		if (match?.index !== 0) return null;
		const data = lines.data(match);
		const codec = codecFromShape(lines, data);
		// The marker reads back only while it's the one this data writes.
		return codec.read(text, FIRST_LINE) ? { codec, data } : null;
	}
	const marker = lines.reads.exec(text);
	if (marker?.index !== 0 || marker[0] === '') return null;
	if (!('head' in lines)) return { codec: codecFromShape(lines), data: undefined };
	const read = lines.head.match.exec(text.slice(marker[0].length));
	return read ? { codec: codecFromShape(lines), data: lines.head.data(read) } : null;
}

/** The index past a container's last line. */
function stripExtent(ctx: OpenContext, codec: LineCodec): number {
	let end = ctx.index + 1;
	let above = codec.read(ctx.line.text, FIRST_LINE)!.text;
	let aboveFirst = true;
	for (let i = ctx.index + 1; i < ctx.end; i++) {
		const text = ctx.lines[i].text;
		const read = codec.read(text, INNER_LINE);
		if (!read || (read.lazy && !codec.continuesLazily(above, text, aboveFirst, ctx.grammar))) break;
		above = read.lazy ? text : read.text;
		aboveFirst = false;
		if (codec.read(text, BLANK_TAIL)) end = i + 1;
	}
	return end;
}
