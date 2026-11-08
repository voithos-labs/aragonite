/**
 * The reader of a container whose markers sit on its own lines (a quote, an alert, a footnote):
 * every line read through the shape's line syntax, which the container writer writes with too.
 */
import { makeBlockNode, setPluginMetadata, type AnyBlockKind } from '../nodes';
import { joinRaw, parseContainerBody } from '../parser';
import {
	codecFromShape,
	FIRST_LINE,
	INNER_LINE,
	type HeadedLines,
	type IndentedLines,
	type LineCodec,
	type LinePlace,
	type MarkedLines
} from '../strip-lines';
import type { BlockOpener, OpenContext } from '../../schema/block-openers';

/** How a container's lines look: a marker on every line, under a head line or not, or a marker on
 *  the first and an indent after. */
export type ContainerLines<D> =
	MarkedLines | (MarkedLines & { head: HeadedLines<D>['head'] }) | IndentedLines<D>;

/** The opener of a marked or indented container. A line with no marker continues it only as the
 *  lazy line of a paragraph open above; a blank line belongs to it only when one below does. */
export function stripOpener<D>(
	kind: AnyBlockKind,
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
			const node = makeBlockNode({
				kind,
				leadingTrivia: ctx.leadingTrivia,
				raw: joinRaw(ctx.lines, ctx.index, end),
				innerPrefix: doc.prefix,
				children: doc.children,
				innerSuffix: doc.suffix
			});
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

// ── Internal ─────────────────────────────────────────────────────────────────

const BLANK_TAIL: LinePlace = { first: false, trailingBlank: true };

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
