// `|N` / `|NxM` is an Obsidian extension, not part of GFM. The `@X,Y[,Z]` tail on the `NxM`
// form is this editor's own: the pan and zoom of the image inside that frame.

import type { ImageCrop } from '../nodes';

const MAX_DIMENSION = 10000;
export const MAX_CROP_ZOOM = 4;

// The longest decodable suffix, `|10000x10000@100,100,4.00`. Bounding the pipe search to that
// tail keeps nested-label floods linear.
const MAX_SUFFIX_SEARCH = 26;

export interface ParsedImageAlt {
	displayAlt: string;
	width: number | undefined;
	height: number | undefined;
	crop: ImageCrop | undefined;
}

const NO_HINT = { width: undefined, height: undefined, crop: undefined };

export function parseImageDimensions(alt: string): ParsedImageAlt {
	const lastPipe = boundedLastPipe(alt);
	const dims = lastPipe === -1 ? null : parseDimensionSuffix(alt.slice(lastPipe + 1));
	if (dims === null) return { displayAlt: alt, ...NO_HINT };
	return { displayAlt: alt.slice(0, lastPipe), ...dims };
}

function boundedLastPipe(alt: string): number {
	const floor = alt.length > MAX_SUFFIX_SEARCH ? alt.length - MAX_SUFFIX_SEARCH : 0;
	for (let i = alt.length - 1; i >= floor; i--) {
		if (alt[i] === '|') return i;
	}
	return -1;
}

function parseDimensionSuffix(
	s: string
): { width: number; height: number | undefined; crop: ImageCrop | undefined } | null {
	const xIdx = s.indexOf('x');
	if (xIdx === -1) {
		const w = parseStrictInt(s);
		if (w === null) return null;
		return { width: w, height: undefined, crop: undefined };
	}
	const atIdx = s.indexOf('@');
	const heightEnd = atIdx === -1 ? s.length : atIdx;
	const w = parseStrictInt(s.slice(0, xIdx));
	const h = parseStrictInt(s.slice(xIdx + 1, heightEnd));
	if (w === null || h === null) return null;
	if (atIdx === -1) return { width: w, height: h, crop: undefined };
	const crop = parseCropTail(s.slice(atIdx + 1));
	// A malformed tail is not a hint at all: the whole suffix stays alt text.
	if (crop === null) return null;
	return { width: w, height: h, crop };
}

/** `X,Y` or `X,Y,Z`: whole percents 0–100 and a zoom of 1–4 with up to two decimals. */
function parseCropTail(s: string): ImageCrop | null {
	const parts = s.split(',');
	if (parts.length < 2 || parts.length > 3) return null;
	const x = parsePercent(parts[0]);
	const y = parsePercent(parts[1]);
	if (x === null || y === null) return null;
	if (parts.length === 2) return { x, y, z: 1 };
	if (!/^[1-4](?:\.\d{1,2})?$/.test(parts[2])) return null;
	const z = Number(parts[2]);
	if (z > MAX_CROP_ZOOM) return null;
	return { x, y, z };
}

function parsePercent(s: string): number | null {
	if (!/^\d{1,3}$/.test(s)) return null;
	const n = Number(s);
	return n > 100 ? null : n;
}

/** No leading zeros: a padded run is alt text, not a hint. */
function parseStrictInt(s: string): number | null {
	if (!/^[1-9]\d*$/.test(s)) return null;
	const n = Number(s);
	if (n <= 0 || n > MAX_DIMENSION) return null;
	return n;
}
