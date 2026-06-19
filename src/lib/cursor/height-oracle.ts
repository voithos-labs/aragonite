/**
 * Per-kind block-height estimator plus a measured-height cache for virtual
 * rendering. estimate() is O(1) from `node.raw` length, including containers
 * (their raw is materialized, so no subtree walk). Measured heights, recorded
 * on mount, supersede estimates and are keyed by stable block id, so structural
 * index shifts and undo don't invalidate them.
 */
import type { CstNode } from '../core/nodes';

// Inline image syntax `![alt](url)` — the form that embeds a sized, rendered
// image whose height the char-based estimate badly undercounts.
const IMAGE_RAW = /!\[[^\]]*\]\(/;

export interface HeightOracleOptions {
	lineHeight: number; // px per wrapped prose line
	codeLineHeight: number; // px per code source line
	avgCharWidth: number; // px, for chars-per-line from width
	blockChrome: number; // px of margin/padding per block
	imageBlockMinHeight: number; // px floor for an image-bearing paragraph (raw chars badly undercount a rendered image)
}

export interface HeightOracle {
	estimate(node: CstNode, width: number): number;
	measured(id: string): number | undefined;
	recordMeasured(id: string, height: number): void;
	/** measured(id) ?? estimate(node, width). */
	height(id: string, node: CstNode, width: number): number;
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

	function estimate(node: CstNode, width: number): number {
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
				return sourceLines(raw) * opts.lineHeight + opts.blockChrome;
			default: {
				const prose = wrappedLines(raw.length, width) * opts.lineHeight + opts.blockChrome;
				// A rendered image dwarfs its `![alt](url)` source — the char-based estimate
				// would seed a tall block at ~1 line, so a screenful of images undercounts to
				// near-zero and activation/spacers under-mount. Floor it (reading raw only —
				// never inlineContent in an estimate path).
				return IMAGE_RAW.test(raw) ? Math.max(prose, opts.imageBlockMinHeight) : prose;
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
