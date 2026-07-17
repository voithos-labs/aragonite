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
	OPENER_PRIORITIES,
	type CstNode
} from '$lib/plugin';

export const DETAILS = 'details';
export const DETAILS_SUMMARY = 'details-summary';

const OPEN_LINE = /^<details( open)?>$/;
const SUMMARY_LINE = /^<summary>(.*)<\/summary>$/;
const CLOSE_LINE = /^<\/details>$/;

interface DetailsMetadata {
	open: boolean;
}

/**
 * Reconstruct `raw` from children after a structural edit. Child 0 is the summary
 * (emitted into the `<summary>` header line); children 1+ are the body. Mirrors
 * `rebuildCalloutRaw`: the two header lines plus the trailing close are the
 * container syntax, `innerPrefix`/`innerSuffix` carry the body's blank-line wrap
 * verbatim so a canonical parse rebuilds byte-identically.
 */
export function rebuildDetailsRaw(node: CstNode): void {
	const open = getPluginMetadata<DetailsMetadata>(node)?.open ?? false;
	const children = node.children ?? [];
	const summaryText = children[0] ? trimTrailingLineEnding(children[0].raw) : '';
	const body = children.slice(1);
	const inner = (node.innerPrefix ?? '') + serializeChildren(body) + (node.innerSuffix ?? '');
	const opener = `<details${open ? ' open' : ''}>\n<summary>${summaryText}</summary>`;
	node.raw = `${opener}\n${inner}</details>\n`;
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
				isCollapsed: (node) => !getPluginMetadata<DetailsMetadata>(node)?.open
			},
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: '<details>\n<summary>Title</summary>\n\nbody\n\n</details>\n',
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=opaque — rebuildDetailsRaw' },
			focus: { mode: 'implemented', via: 'focus walks to the summary chrome / first body child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole; collapse-aware merge walk'
			},
			selectionPaint: { mode: 'implemented', via: 'body child blocks paint; container cover' },
			searchPaint: {
				mode: 'implemented',
				via: 'children are real blocks — search descends and paints'
			},
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: {
				mode: 'implemented',
				via: 'updateOwnMetadata — the open-state toggle commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a copy starting mid-summary into the body drops the container wrapper (issues.md)'
			},
			simOracle: {
				mode: 'implemented',
				via: 'details container/windowing e2e under the [invariant:] watcher'
			}
		}
	});

	registerChromeLeaf(detailsSummary, { blockClass: 'details-summary' });

	registerBlockOpener(details, {
		// Slots into the gap just below htmlBlock, which else claims `<details>` as a type-6 block.
		priority: OPENER_PRIORITIES.htmlBlock - 5,
		// defensive parity, not current behavior: htmlBlock@70's type-6 interrupt
		// already covers the canonical opener and details wins the re-dispatch at 65 —
		// this guards against a future priority/interrupt regression.
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
			for (let i = summaryIdx + 1; i < ctx.end; i++) {
				const t = ctx.lines[i].text;
				if (OPEN_LINE.test(t)) {
					depth++;
				} else if (CLOSE_LINE.test(t)) {
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
			setPluginMetadata<DetailsMetadata>(node, { open: openMatch[1] !== undefined });
			return { node, nextIndex: closeIdx + 1 };
		}
	});
}
