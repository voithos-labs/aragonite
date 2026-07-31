// `|N` / `|NxM` is an Obsidian extension, not part of GFM.

const MAX_DIMENSION = 10000;

// The longest zero-free decodable suffix, `|10000x10000`. Bounding the pipe search to that tail
// keeps nested-label floods linear, at the deliberate cost of not decoding zero-padded runs.
const MAX_SUFFIX_SEARCH = 12;

export interface ParsedImageAlt {
	displayAlt: string;
	width: number | undefined;
	height: number | undefined;
}

export function parseImageDimensions(alt: string): ParsedImageAlt {
	const lastPipe = boundedLastPipe(alt);
	if (lastPipe === -1) {
		return { displayAlt: alt, width: undefined, height: undefined };
	}

	const suffix = alt.slice(lastPipe + 1);
	if (suffix === '') {
		return { displayAlt: alt, width: undefined, height: undefined };
	}

	const dims = parseDimensionSuffix(suffix);
	if (dims === null) {
		return { displayAlt: alt, width: undefined, height: undefined };
	}

	return {
		displayAlt: alt.slice(0, lastPipe),
		width: dims.width,
		height: dims.height
	};
}

function boundedLastPipe(alt: string): number {
	const floor = alt.length > MAX_SUFFIX_SEARCH ? alt.length - MAX_SUFFIX_SEARCH : 0;
	for (let i = alt.length - 1; i >= floor; i--) {
		if (alt[i] === '|') return i;
	}
	return -1;
}

function parseDimensionSuffix(s: string): { width: number; height: number | undefined } | null {
	const xIdx = s.indexOf('x');
	if (xIdx === -1) {
		const w = parseStrictInt(s);
		if (w === null) return null;
		return { width: w, height: undefined };
	}
	const w = parseStrictInt(s.slice(0, xIdx));
	const h = parseStrictInt(s.slice(xIdx + 1));
	if (w === null || h === null) return null;
	return { width: w, height: h };
}

function parseStrictInt(s: string): number | null {
	if (s.length === 0 || !/^\d+$/.test(s)) return null;
	const n = Number(s);
	if (n <= 0 || n > MAX_DIMENSION) return null;
	return n;
}
