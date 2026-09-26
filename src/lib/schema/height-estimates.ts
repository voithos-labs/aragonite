/**
 * The height guesses windowing uses before a block has been measured, one per shape of block, for
 * the descriptors' `estimateHeight`. Each returns the content height; the estimator adds the
 * block's frame. All are O(1) in the tree: they read `raw` and a child count, never a subtree.
 */

import type { NodeView } from '../core/node-views';
import { parseImageDimensions } from '../core/inline/image-dimensions';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

/** What an estimate reads besides the block: the editor's width and its type metrics, in px. */
export interface HeightEstimateEnv {
	width: number;
	/** One wrapped line of prose. */
	lineHeight: number;
	/** One source line of code. */
	codeLineHeight: number;
	/** An average character, for how many fit on a line. */
	avgCharWidth: number;
	/** A block's margin and padding, which the estimator adds once per block. */
	blockChrome: number;
	/** The floor for an image whose alt carries no height. */
	imageBlockMinHeight: number;
}

const NEWLINE = 10;

// Any image form, capturing the alt, whose `|WxH` hint sizes the rendered image.
const IMAGE_ALT = /!\[([^\]]*)\]/g;

function wrappedLines(length: number, env: HeightEstimateEnv): number {
	const perLine = Math.max(1, Math.floor(env.width / env.avgCharWidth));
	return Math.max(1, Math.ceil(length / perLine));
}

function sourceLines(raw: string): number {
	let n = 1;
	// Code units, not `raw[i]`: the indexed read creates a one-character string per byte.
	for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === NEWLINE) n++;
	if (raw.endsWith('\n')) n--;
	return Math.max(1, n);
}

// An image's hinted height, else the floor: an unsized image is not knowable until it decodes.
function imageHeights(raw: string, env: HeightEstimateEnv): number {
	let total = 0;
	IMAGE_ALT.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = IMAGE_ALT.exec(raw)) !== null) {
		total += parseImageDimensions(m[1]).height ?? env.imageBlockMinHeight;
	}
	return total;
}

// ── Estimates ───────────────────────────────────────────────────────────────

/** Wrapped text, or the images it holds when they stand taller than it. */
export function proseEstimate(node: NodeView, env: HeightEstimateEnv): number {
	const text = wrappedLines(node.raw.length, env) * env.lineHeight;
	// The substring test first: most prose holds no image, and the alt scan is the costly part.
	if (!node.raw.includes('![')) return text;
	// The image heights, the floor included, size the whole block, frame and all.
	return Math.max(text, imageHeights(node.raw, env) - env.blockChrome);
}

/** One line, whatever the bytes: a divider. */
export function singleLineEstimate(_node: NodeView, env: HeightEstimateEnv): number {
	return env.lineHeight;
}

/** One code line per source line: code does not wrap. */
export function sourceLinesEstimate(node: NodeView, env: HeightEstimateEnv): number {
	return sourceLines(node.raw) * env.codeLineHeight;
}

/**
 * A container by its contract: a grid by its rows, or by its whole source wrapped when its cells
 * wrap past that; any other container by the larger of a line per child and its text wrapped, since
 * the first ignores wrap and the second ignores each child's own margin.
 */
export function containerEstimate(node: NodeView, env: HeightEstimateEnv): number {
	const wrapped = wrappedLines(node.raw.length, env) * env.lineHeight;
	if (tryGetBlockKindDescriptor(node.kind)?.containerContract === 'grid') {
		return Math.max(sourceLines(node.raw) * env.lineHeight, wrapped);
	}
	const children = Math.max(1, node.children?.length ?? 1);
	return Math.max(children * (env.lineHeight + env.blockChrome) - env.blockChrome, wrapped);
}
