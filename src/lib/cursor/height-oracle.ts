/**
 * Per-block height estimates plus a measured-height cache for virtual rendering. Each kind's
 * descriptor makes the estimate (`schema/height-estimates.ts`), O(1) from `node.raw` even for
 * containers, whose raw is materialized. Measured heights supersede estimates and are keyed by
 * stable block id, so structural index shifts and undo don't invalidate them.
 */
import type { NodeView } from '../core/node-views';
import { isCollapsedByDescriptor } from '../schema/reserved-chrome';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import {
	containerEstimate,
	proseEstimate,
	type HeightEstimateEnv
} from '../schema/height-estimates';

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
	/** Drop every measured height. A mounted block list keeps its own heights across a rebuild
	 *  (VR-15), so only a list built after the drop, and any block with a fresh id, starts from estimates. */
	dropMeasured(): void;
}

export function createHeightOracle(opts: HeightOracleOptions): HeightOracle {
	const measuredById = new Map<string, number>();

	// One object for every call, since the height table estimates each block of the document: the
	// metrics read through to `opts`, whose getters follow the editor's type scale.
	const env: HeightEstimateEnv = {
		width: 0,
		get lineHeight() {
			return opts.lineHeight;
		},
		get codeLineHeight() {
			return opts.codeLineHeight;
		},
		get avgCharWidth() {
			return opts.avgCharWidth;
		},
		get blockChrome() {
			return opts.blockChrome;
		},
		get imageBlockMinHeight() {
			return opts.imageBlockMinHeight;
		}
	};

	function estimate(node: NodeView, width: number): number {
		const descriptor = tryGetBlockKindDescriptor(node.kind);
		// A collapsed container's body lives in `raw` but never renders, so estimating from
		// full `raw` over-counts it several-fold; only the title row paints.
		if (isCollapsedByDescriptor(descriptor, node)) return opts.lineHeight + opts.blockChrome;
		const content =
			descriptor?.estimateHeight ?? (descriptor?.isContainer ? containerEstimate : proseEstimate);
		env.width = width;
		return content(node, env) + opts.blockChrome;
	}

	return {
		estimate,
		measured: (id) => measuredById.get(id),
		recordMeasured: (id, height) => {
			measuredById.set(id, height);
		},
		dropMeasured: () => measuredById.clear()
	};
}
