/**
 * Per-kind block-height estimator plus a measured-height cache for virtual
 * rendering. estimate() is O(1) from `node.raw` length, including containers
 * (their raw is materialized, so no subtree walk). Measured heights, recorded
 * on mount, supersede estimates and are keyed by stable block id, so structural
 * index shifts and undo don't invalidate them.
 */
import type { NodeView } from '../core/node-views';
import { isCollapsedContainer } from '../schema/reserved-chrome';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

// Any image: inline `![alt](url)`, reference `![alt][ref]`, or shortcut
// `![ref]`. Captures the alt segment so a `|WxH` size hint can be read. The
// char-based prose estimate badly undercounts a rendered image, so an
// image-bearing block is floored / sized off this match, not its raw length.
const IMAGE_ALT = /!\[([^\]]*)\]/g;
// Size hint inside the alt, e.g. `Square|200x200` or `photo|400` (width only).
const SIZE_HINT = /\|(\d+)(?:x(\d+))?/;

export interface HeightOracleOptions {
	lineHeight: number; // px per wrapped prose line
	codeLineHeight: number; // px per code source line
	avgCharWidth: number; // px, for chars-per-line from width
	blockChrome: number; // px of margin/padding per block
	imageBlockMinHeight: number; // px floor for an image-bearing paragraph
}

export interface HeightOracle {
	estimate(node: NodeView, width: number): number;
	measured(id: string): number | undefined;
	recordMeasured(id: string, height: number): void;
	/** measured(id) ?? estimate(node, width). */
	height(id: string, node: NodeView, width: number): number;
	/** Drop measured heights (call on container width change — wrap depends on width). */
	invalidateWidth(): void;
	clear(): void;
}

export function createHeightOracle(opts: HeightOracleOptions): HeightOracle {
	const measuredById = new Map<string, number>();

	function wrappedLines(visibleLen: number, width: number): number {
		const perLine = Math.max(1, Math.floor(width / opts.avgCharWidth));
		return Math.max(1, Math.ceil(visibleLen / perLine));
	}

	function sourceLines(raw: string): number {
		let n = 1;
		for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') n++;
		if (raw.endsWith('\n')) n--; // trailing newline shouldn't add a phantom line
		return Math.max(1, n);
	}

	// Sum of per-image rendered heights in a prose block. Each image contributes
	// its `|WxH` hint height when present, else the min-height floor (an unsized
	// image's height isn't knowable until decode — the ResizeObserver corrects it
	// post-mount). Returns 0 for image-free raw. Reads raw only, never inline.
	function imageHeights(raw: string): number {
		let total = 0;
		IMAGE_ALT.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = IMAGE_ALT.exec(raw)) !== null) {
			const hint = SIZE_HINT.exec(m[1]);
			total += hint && hint[2] ? Number(hint[2]) : opts.imageBlockMinHeight;
		}
		return total;
	}

	function estimate(node: NodeView, width: number): number {
		// A collapsed container mounts only its chrome row; its body lives in `raw`
		// but never renders, so estimating from full `raw` over-counts it several-
		// fold. One chrome line + block chrome is the tight estimate, matching what
		// the summary/title row actually paints. Reads the declared collapse probe,
		// so no per-kind arm is needed (cursor/ reading schema/ is layer-legal).
		if (isCollapsedContainer(node)) return opts.lineHeight + opts.blockChrome;
		// A descriptor's own O(1) estimate supersedes the built-in arms (a rendered
		// artifact is far taller than its source text); the oracle still adds chrome.
		const custom = tryGetBlockKindDescriptor(node.kind)?.estimateHeight;
		if (custom) return custom(node, { width }) + opts.blockChrome;
		const kind = node.kind;
		const raw = node.raw;
		switch (kind) {
			case 'thematicBreak':
				return opts.lineHeight + opts.blockChrome;
			case 'fencedCode':
			case 'indentedCode':
			case 'htmlBlock':
				return sourceLines(raw) * opts.codeLineHeight + opts.blockChrome;
			case 'table':
			case 'tableRow':
				// Source-line count models a normal table; a wide table wraps its cells
				// far beyond its row count, which the blob-wrap of the whole raw catches.
				return (
					Math.max(sourceLines(raw), wrappedLines(raw.length, width)) * opts.lineHeight +
					opts.blockChrome
				);
			case 'blockquote':
			case 'list':
			case 'listItem': {
				// O(1), no subtree walk: a container is at least one line + chrome per
				// child, and at least its materialized text wrapped as a blob. The blob
				// term alone ignores every newline and per-child chrome, undercounting a
				// stacked container several-fold; the child-count term alone ignores wrap.
				// `children` is already on the node.
				const childCount = Math.max(1, node.children?.length ?? 1);
				const byChildren = childCount * (opts.lineHeight + opts.blockChrome);
				const byText = wrappedLines(raw.length, width) * opts.lineHeight + opts.blockChrome;
				return Math.max(byChildren, byText);
			}
			default: {
				const prose = wrappedLines(raw.length, width) * opts.lineHeight + opts.blockChrome;
				const images = imageHeights(raw);
				return images > 0 ? Math.max(prose, images) : prose;
			}
		}
	}

	return {
		estimate,
		measured: (id) => measuredById.get(id),
		recordMeasured: (id, height) => {
			measuredById.set(id, height);
		},
		height: (id, node, width) => measuredById.get(id) ?? estimate(node, width),
		invalidateWidth: () => measuredById.clear(),
		clear: () => measuredById.clear()
	};
}
