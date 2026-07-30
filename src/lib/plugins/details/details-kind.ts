/**
 * `<details>` collapsible — the second reserved-chrome container consumer, built
 * on the same public seams as the callout. Ships as the `aragonite/plugins/details`
 * bundled plugin (and doubles as a dogfood/e2e validator).
 *
 * Canonical form (byte-pinned):
 *
 *     <details open>
 *     <summary>Title</summary>
 *
 *     …blank-line-wrapped Markdown children…
 *
 *     </details>
 *
 * The `<summary>` is a real CST child at index 0 (kind `details-summary`, plain
 * text) whose tags live in the container's own raw, so `strip(raw)` diverges
 * from `serialize(children)` — hence the `'opaque'` contract (raw authoritative,
 * exempt from `checkStaleRaw`). `open` is metadata round-tripping to the opener
 * bytes. Non-canonical `<details …>` declines to the built-in htmlBlock.
 */

import {
	chromeChild,
	containerClosure,
	declarePluginKind,
	declaredPluginKind,
	registerBlockKind,
	registerBlockOpener,
	registerChromeLeaf,
	setPluginMetadata,
	getPluginMetadata,
	parse,
	serializeChildren,
	trimTrailingLineEnding,
	matchFenceOpen,
	matchFenceClose,
	htmlBlockTagLineMatcher,
	OPENER_PRIORITIES,
	type CstNode
} from '$lib/plugin';

export const DETAILS = 'details';
export const DETAILS_SUMMARY = 'details-summary';

const OPEN_LINE = /^<details( open)?>$/;
const SUMMARY_LINE = /^<summary>(.*)<\/summary>$/;
const CLOSE_LINE = /^<\/details>$/;

export interface DetailsMetadata {
	open: boolean;
	/** Authored line ending (`\n` or `\r\n`) for the three chrome lines (opener, summary,
	 *  closer). A single captured ending governs all three — a well-formed CRLF/LF document
	 *  has uniform endings, so the rebuild reproduces them byte-identically. */
	lineEnding: string;
	/** Whether the `</details>` closer line ends with a newline; false for a document-final
	 *  details with no trailing newline, so the rebuild does not add one. */
	closerNewline: boolean;
}

type TagVerdict = 'open' | 'close' | null;

/** The container's own canonical spelling — what `parse` reproduces, and the only
 *  form `rebuildDetailsRaw` emits. */
const canonicalTagLine = (text: string): TagVerdict =>
	OPEN_LINE.test(text) ? 'open' : CLOSE_LINE.test(text) ? 'close' : null;

/** What CommonMark hands to raw-HTML passthrough — a superset of the canonical
 *  form, and therefore of what closes the element in a browser. */
const passthroughTagLine = htmlBlockTagLineMatcher('details');

/**
 * Make a tag verdict fence-aware. A `</details>` inside a fenced code block is
 * content on both sides of the round trip, so neither the recognizer nor the
 * escape may count it — one counting it and the other not is what would let the
 * scan mistake a code sample for the closer, or the escape rewrite one. Stateful
 * across a run of lines, because the fence is.
 */
function createTagScanner(tagLine: (text: string) => TagVerdict) {
	let fence: { marker: '`' | '~'; length: number } | null = null;
	return (text: string): TagVerdict => {
		if (fence) {
			if (matchFenceClose(text, fence.marker, fence.length)) fence = null;
			return null;
		}
		const opened = matchFenceOpen(text);
		if (opened) {
			fence = { marker: opened.marker, length: opened.length };
			return null;
		}
		return tagLine(text);
	};
}

const createDetailsTagScanner = () => createTagScanner(canonicalTagLine);

/** Line indices whose tag has no partner under `tagLine`'s accounting: a closer
 *  matching no opener, or an opener still unmatched when the walk ends. */
function unpairedTagLines(
	lines: readonly string[],
	tagLine: (text: string) => TagVerdict,
	settled: ReadonlySet<number>
): number[] {
	const classify = createTagScanner(tagLine);
	const openIndices: number[] = [];
	const unpaired: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const verdict = classify(lines[i]);
		if (settled.has(i)) continue;
		if (verdict === 'open') openIndices.push(i);
		else if (verdict === 'close' && openIndices.pop() === undefined) unpaired.push(i);
	}
	return [...unpaired, ...openIndices];
}

/**
 * Line indices to escape, to a fixpoint over BOTH accountings.
 *
 * Two predicates, because the two renderers disagree about what a tag line is:
 * aragonite's recognizer is the canonical spelling (widening it would change what
 * parses as a details — a byte-level behavior change), while a browser closes the
 * element on anything CommonMark passes through raw. A pair balanced under one and
 * split under the other (`<details>` closed by ` </details>`) is a line the first
 * pass escapes and the second pass then finds newly unpaired, so iterating to a
 * fixpoint escapes BOTH members and leaves neither renderer holding a stray.
 *
 * Terminates: every round escapes at least one line and escaping never mints a
 * tag, so the unescaped-tag count strictly decreases.
 */
function strayTagLines(lines: readonly string[]): Set<number> {
	const escaped = new Set<number>();
	for (;;) {
		const found = [
			...unpairedTagLines(lines, canonicalTagLine, escaped),
			...unpairedTagLines(lines, passthroughTagLine, escaped)
		].filter((i) => !escaped.has(i));
		if (found.length === 0) return escaped;
		for (const i of found) escaped.add(i);
	}
}

/** Absolute offsets of the `<` the escape rewrites, ascending. */
function strayEscapePoints(raw: string): number[] {
	const starts: number[] = [];
	const texts: string[] = [];
	let pos = 0;
	while (pos < raw.length) {
		const nl = raw.indexOf('\n', pos);
		const lineEnd = nl < 0 ? raw.length : nl + 1;
		starts.push(pos);
		texts.push(trimTrailingLineEnding(raw.slice(pos, lineEnd)));
		pos = lineEnd;
	}
	return [...strayTagLines(texts)]
		.sort((a, b) => a - b)
		.map((i) => starts[i] + texts[i].indexOf('<'));
}

/** The entity form of `<`: renders as the literal glyph in a paragraph, inside an
 *  html block's passthrough, and on GitHub alike, while matching no tag line. */
const ESCAPED_LT = '&lt;';

/** Body bytes made legal inside a details: every stray tag line's `<` escaped. */
function escapeStrayDetailsTags(raw: string): string {
	const points = strayEscapePoints(raw);
	if (points.length === 0) return raw;

	let out = '';
	let cursor = 0;
	for (const at of points) {
		out += raw.slice(cursor, at) + ESCAPED_LT;
		cursor = at + 1;
	}
	return out + raw.slice(cursor);
}

/** {@link escapeStrayDetailsTags}'s caret image: each escape ahead of the caret
 *  pushes it by the entity's growth. */
function mapStrayEscapeOffset(raw: string, offset: number): number {
	const grown = ESCAPED_LT.length - 1;
	return strayEscapePoints(raw).reduce((at, point) => (point < offset ? at + grown : at), offset);
}

/**
 * Reconstruct `raw` from children after a structural edit. Child 0 is the summary
 * (emitted into the `<summary>` header line); children 1+ are the body. Mirrors
 * `rebuildCalloutRaw`: the two header lines plus the trailing close are the
 * container syntax, `innerPrefix`/`innerSuffix` carry the body's blank-line wrap
 * verbatim so a canonical parse rebuilds byte-identically. The authored line ending
 * threads through metadata so a CRLF-authored block rebuilds CRLF-safe.
 */
export function rebuildDetailsRaw(node: CstNode): void {
	const meta = getPluginMetadata<DetailsMetadata>(node);
	const open = meta?.open ?? false;
	const lineEnding = meta?.lineEnding ?? '\n';
	const closerEnd = (meta?.closerNewline ?? true) ? lineEnding : '';
	const children = node.children ?? [];
	const summaryText = children[0] ? trimTrailingLineEnding(children[0].raw) : '';
	const body = children.slice(1);
	const inner = (node.innerPrefix ?? '') + serializeChildren(body) + (node.innerSuffix ?? '');
	const opener = `<details${open ? ' open' : ''}>${lineEnding}<summary>${summaryText}</summary>`;
	node.raw = `${opener}${lineEnding}${inner}</details>${closerEnd}`;
}

export function registerDetailsKind(): void {
	const details = declarePluginKind(DETAILS);
	const detailsSummary = declarePluginKind(DETAILS_SUMMARY);

	registerBlockKind(details, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'opaque',
			rebuildRaw: rebuildDetailsRaw,
			reservedChrome: {
				kind: detailsSummary,
				isCollapsed: (node) => !getPluginMetadata<DetailsMetadata>(node)?.open,
				expandPatch: () => ({ open: true }) satisfies Partial<DetailsMetadata>
			},
			unwrapRole: {
				firstChildBackspace: 'lift-first-child',
				middleChildBackspace: 'default-merge'
			},
			bodyWrite: { normalize: escapeStrayDetailsTags, mapOffset: mapStrayEscapeOffset }
		},
		conformanceFixture: '<details>\n<summary>Title</summary>\n\nbody\n\n</details>\n',
		closure: containerClosure({
			roundTripVia: 'container contract=opaque — rebuildDetailsRaw',
			focus: { mode: 'implemented', via: 'focus walks to the summary chrome / first body child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole; collapse-aware merge walk'
			},
			undo: {
				mode: 'implemented',
				via: 'updateOwnMetadata — an open-state flip (disclosure toggle, or a reveal opening the expandPatch door) commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the summary re-emits the details — a mid-summary start reopens it around the collected body, a mid-summary end yields a summary-only details'
			},
			simOracle: {
				mode: 'implemented',
				via: 'details container/windowing e2e under the [invariant:] watcher'
			}
		})
	});

	registerChromeLeaf(detailsSummary, { blockClass: 'details-summary' });

	registerBlockOpener(details, {
		// Slots into the gap just below htmlBlock, which else claims `<details>` as a type-6 block.
		priority: OPENER_PRIORITIES.htmlBlock - 5,
		// defensive parity, not current behavior: htmlBlock's type-6 interrupt already
		// covers the canonical opener and details wins the re-dispatch — this guards
		// against a future priority/interrupt regression.
		interruptsParagraph: (line) => OPEN_LINE.test(line),
		tryOpen(ctx) {
			const openMatch = ctx.line.text.match(OPEN_LINE);
			if (!openMatch) return null;

			const summaryIdx = ctx.index + 1;
			if (summaryIdx >= ctx.end) return null;
			const summaryMatch = ctx.lines[summaryIdx].text.match(SUMMARY_LINE);
			if (!summaryMatch) return null;

			// Depth-counted scan to the matching close; nested details recurse via parse.
			let depth = 1;
			let closeIdx = -1;
			const classify = createDetailsTagScanner();
			for (let i = summaryIdx + 1; i < ctx.end; i++) {
				const tag = classify(ctx.lines[i].text);
				if (tag === 'open') {
					depth++;
				} else if (tag === 'close') {
					depth--;
					if (depth === 0) {
						closeIdx = i;
						break;
					}
				}
			}
			if (closeIdx === -1) return null; // unterminated declines to htmlBlock

			const bodyText = ctx.lines
				.slice(summaryIdx + 1, closeIdx)
				.map((l) => l.raw)
				.join('');
			const body = parse(bodyText);
			const raw = ctx.lines
				.slice(ctx.index, closeIdx + 1)
				.map((l) => l.raw)
				.join('');

			const node: CstNode = {
				kind: details,
				leadingTrivia: ctx.leadingTrivia,
				raw,
				innerPrefix: body.prefix,
				children: [
					chromeChild(declaredPluginKind(DETAILS_SUMMARY), summaryMatch[1]),
					...body.children
				],
				innerSuffix: body.suffix
			};
			setPluginMetadata<DetailsMetadata>(node, {
				open: openMatch[1] !== undefined,
				lineEnding: ctx.line.lineEnding,
				closerNewline: ctx.lines[closeIdx].lineEnding !== ''
			});
			return { node, consumed: closeIdx + 1 - ctx.index };
		}
	});
}
