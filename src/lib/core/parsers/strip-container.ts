/**
 * The reader of a container whose markers sit on its own lines (a quote, an alert, a footnote):
 * every line read through the shape's line syntax, which the container writer writes with too.
 */
import { makeBlockNode, setPluginMetadata, type AnyBlockKind, type Document } from '../nodes';
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
export type ContainerLines<D extends object> =
	MarkedLines | (MarkedLines & { head: HeadedLines<D>['head'] }) | IndentedLines<D>;

/** The opener of a marked or indented container. A line with no marker continues it only as the
 *  lazy line of a paragraph open above; a blank line belongs to it only when one below does. */
export function stripOpener<D extends object>(
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
			const spans = childLineSpans(ctx, from, end, open.codec, doc);
			if (spans) node.childSpans = spans;
			if (open.data !== undefined) setPluginMetadata(node, open.data);
			return { node, consumed: end - ctx.index };
		}
	};
}

/** Whether lines a completion wrote read as this container: its opening line first, and a marker on
 *  every line after. */
export function stripClaims<D extends object>(
	lines: ContainerLines<D>,
	written: readonly string[]
): boolean {
	const open = written.length > 0 && openingLine(lines, written[0]);
	return (
		!!open && written.slice(1).every((line) => open.codec.read(line, INNER_LINE)?.lazy === false)
	);
}

/** The data `text` opens a container of `lines` with; undefined where it opens none. */
export function openingData<D extends object>(
	lines: ContainerLines<D>,
	text: string
): D | undefined {
	return openingLine(lines, text)?.data;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const BLANK_TAIL: LinePlace = { first: false, trailingBlank: true };

/** The container's line syntax and data, if `text` opens one. */
function openingLine<D extends object>(
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

/** Where each child's lines sit in the container's bytes, its body being lines `[from, end)`; none
 *  where a child opens on a lazy line or a line holds no child but a closing bare marker. */
function childLineSpans(
	ctx: OpenContext,
	from: number,
	end: number,
	codec: LineCodec,
	body: Document
): Uint32Array | undefined {
	const { lines } = ctx;
	const { children } = body;
	if (children.length === 0) return undefined;
	const base = lines[ctx.index].start;
	const at = (line: number) => (line < lines.length ? lines[line].start : lines.at(-1)!.end) - base;
	const spans = new Uint32Array(children.length * 2);
	let line = from;
	const pass = (bytes: string) => {
		for (let nl = bytes.indexOf('\n'); nl >= 0; nl = bytes.indexOf('\n', nl + 1)) line++;
		// A last line with no ending is a line of its own too.
		if (bytes !== '' && !bytes.endsWith('\n')) line++;
	};
	pass(body.prefix);
	for (let i = 0; i < children.length; i++) {
		if (line >= end) return undefined;
		const place = line === ctx.index ? FIRST_LINE : INNER_LINE;
		if (codec.read(lines[line].text, place)?.lazy !== false) return undefined;
		spans[i * 2] = at(line);
		pass(children[i].leadingTrivia + children[i].raw);
		spans[i * 2 + 1] = at(line);
	}
	pass(body.suffix);
	// A last bare marker with no line ending holds no byte of the body, and a rebuild keeps it as it is.
	const closing = lines[end - 1];
	const closes = closing?.lineEnding === '' && codec.read(closing.text, INNER_LINE)?.text === '';
	return line === end || (line === end - 1 && closes) ? spans : undefined;
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
