/**
 * Per-kind block-height estimator plus a measured-height cache for virtual rendering.
 * `estimate` is O(1) from `node.raw` length even for containers (their raw is
 * materialized, so no subtree walk). Measured heights supersede estimates and are keyed by
 * stable block id, so structural index shifts and undo don't invalidate them.
 */
import type { NodeView } from '../core/node-views';
import { isCollapsedContainer } from '../schema/reserved-chrome';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

// Any image form, capturing the alt segment for its `|WxH` size hint. The char-based prose
// estimate badly undercounts a rendered image, so an image-bearing block sizes off this.
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
	/** Drop every measured height; estimates carry the model until each block re-measures. */
	dropMeasured(): void;
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

	// Each image contributes its `|WxH` hint height, else the min-height floor — an unsized
	// image isn't knowable until decode, which the ResizeObserver corrects post-mount.
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
		// A collapsed container's body lives in `raw` but never renders, so estimating from
		// full `raw` over-counts it several-fold; only the chrome row paints.
		if (isCollapsedContainer(node)) return opts.lineHeight + opts.blockChrome;
		// A descriptor's own O(1) estimate supersedes the built-in arms (a rendered artifact
		// is far taller than its source text); the oracle still adds chrome.
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
				// Source lines model a normal table; a wide one wraps its cells far beyond its
				// row count, which the blob-wrap of the whole raw catches.
				return (
					Math.max(sourceLines(raw), wrappedLines(raw.length, width)) * opts.lineHeight +
					opts.blockChrome
				);
			case 'blockquote':
			case 'list':
			case 'listItem': {
				// Max of two terms, each alone wrong: the blob term ignores newlines and
				// per-child chrome, the child-count term ignores wrap. Still O(1), no walk.
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
		dropMeasured: () => measuredById.clear()
	};
}
