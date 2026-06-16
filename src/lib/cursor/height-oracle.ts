/**
 * Per-kind block-height estimator plus a measured-height cache for virtual
 * rendering. estimate() is O(1) from `node.raw` length, including containers
 * (their raw is materialized, so no subtree walk). Measured heights, recorded
 * on mount, supersede estimates and are keyed by stable block id, so structural
 * index shifts and undo don't invalidate them.
 */
import type { BlockKind, CstNode } from '../core/nodes';

export interface HeightOracleOptions {
	lineHeight: number; // px per wrapped prose line
	codeLineHeight: number; // px per code source line
	avgCharWidth: number; // px, for chars-per-line from width
	blockChrome: number; // px of margin/padding per block
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
		const kind: BlockKind = node.kind;
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
			default:
				return wrappedLines(raw.length, width) * opts.lineHeight + opts.blockChrome;
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
