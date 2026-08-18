/**
 * `<details>` collapsible: the second reserved-chrome container consumer. The
 * `<summary>` is a real CST child at index 0 whose tags live in the container's own
 * raw, so `strip(raw)` diverges from `serialize(children)`, hence `'opaque'` (raw
 * authoritative, exempt from `checkStaleRaw`). Non-canonical `<details …>` declines
 * to the built-in htmlBlock.
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
	parseContainerBody,
	serializeChildren,
	trimTrailingLineEnding,
	matchFenceOpen,
	matchFenceClose,
	htmlBlockTagLineMatcher,
	OPENER_PRIORITIES,
	type ContainerBodyWrap,
	type CstNode
} from '$lib/plugin';

export const DETAILS = 'details';
export const DETAILS_SUMMARY = 'details-summary';

const OPEN_LINE = /^<details( open)?>$/;
const SUMMARY_LINE = /^<summary>(.*)<\/summary>$/;
const CLOSE_LINE = /^<\/details>$/;

/** `<summary>` above and `</details>` below, so a blank against either belongs to the element. */
const BODY_WRAP: ContainerBodyWrap = { afterOpenerLine: true, beforeCloserLine: true };

export interface DetailsMetadata {
	open: boolean;
	/** One captured ending governs all three chrome lines: a well-formed document has
	 *  uniform endings, so the rebuild reproduces them byte-identically. */
	lineEnding: string;
	/** False for a document-final details with no trailing newline, so the rebuild
	 *  does not add one. */
	closerNewline: boolean;
}

type TagVerdict = 'open' | 'close' | null;

/** The canonical spelling: what `parse` reproduces, and the only form `rebuildDetailsRaw` emits. */
const canonicalTagLine = (text: string): TagVerdict =>
	OPEN_LINE.test(text) ? 'open' : CLOSE_LINE.test(text) ? 'close' : null;

/** What CommonMark hands to raw-HTML passthrough: a superset of the canonical form,
 *  and therefore of what closes the element in a browser. */
const passthroughTagLine = htmlBlockTagLineMatcher('details');

/**
 * A `</details>` inside a fenced code block is content on both sides of the round trip, so
 * neither the recognizer nor the escape may count it. Stateful, because the fence is.
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
 * Two accountings, because the recognizer and a browser disagree about what a tag line is,
 * and only the fixpoint leaves neither renderer holding a stray. Terminates because every
 * round escapes a line and escaping never mints a tag.
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

/** Renders as the literal glyph in a paragraph, in an html block's passthrough, and on
 *  GitHub alike, while matching no tag line. */
const ESCAPED_LT = '&lt;';

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

/** {@link escapeStrayDetailsTags}'s caret image: each escape ahead of the caret pushes
 *  it by the entity's growth. */
function mapStrayEscapeOffset(raw: string, offset: number): number {
	const grown = ESCAPED_LT.length - 1;
	return strayEscapePoints(raw).reduce((at, point) => (point < offset ? at + grown : at), offset);
}

/**
 * Child 0 is the summary, children 1+ the body. `innerPrefix`/`innerSuffix` carry the
 * body's blank-line wrap verbatim so a canonical parse rebuilds byte-identically.
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
		// Opaque tier rule: no textual escape hatch at either edge, so both take the gap caret.
		gapEdges: 'both',
		container: {
			contract: 'opaque',
			rebuildRaw: rebuildDetailsRaw,
			bodyWrap: BODY_WRAP,
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
		// Redundant with htmlBlock's type-6 interrupt, which details wins on re-dispatch; kept
		// so the opener's paragraph behavior does not depend on that priority ordering.
		interruptsParagraph: (line) => OPEN_LINE.test(line),
		tryOpen(ctx) {
			const openMatch = ctx.line.text.match(OPEN_LINE);
			if (!openMatch) return null;

			const summaryIdx = ctx.index + 1;
			if (summaryIdx >= ctx.end) return null;
			const summaryMatch = ctx.lines[summaryIdx].text.match(SUMMARY_LINE);
			if (!summaryMatch) return null;

			// Depth-counted so nested details recurse via parse rather than closing early.
			let depth = 1;
			let closeIdx = -1;
			const classify = createTagScanner(canonicalTagLine);
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
			// A fresh parse entry, so the body's own line 0 must not read as the document top.
			const body = parseContainerBody(bodyText, BODY_WRAP, { scope: 'fragment' });
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
