import { readFileSync } from 'node:fs';

/**
 * The `/` demo document as bytes. The owner rewrites it by hand, so the specs on that route
 * derive what they expect from it here rather than pinning sentences that move on every pass.
 * Node-side only: a spec must not import the parser, so this scanner is deliberately coarse
 * and every count it produces is asserted against the rendered DOM.
 */
export const SHOWCASE_MD = readFileSync('src/routes/showcase-content.md', 'utf8');

export interface ShowcaseHeading {
	level: number;
	text: string;
}

export interface ShowcaseScan {
	/** Lines outside every code fence and `$$` display. */
	prose: string[];
	/** Info strings of the document's fenced blocks, one entry per fence. */
	fences: string[];
	/** `$$…$$` displays: one mounted math island each. */
	blockMath: number;
	/** ATX headings in document order: one outline entry each. */
	headings: ShowcaseHeading[];
}

/** A repeated word and how often the paragraph holding it repeats it. */
export interface RepeatedWord {
	word: string;
	count: number;
}

export function scanShowcase(md: string = SHOWCASE_MD): ShowcaseScan {
	const prose: string[] = [];
	const fences: string[] = [];
	const headings: ShowcaseHeading[] = [];
	let openFence: string | null = null;
	let openMath = false;
	let blockMath = 0;
	for (const line of md.split('\n')) {
		const trimmed = line.trim();
		if (openFence !== null) {
			if (trimmed.startsWith(openFence)) openFence = null;
			continue;
		}
		if (openMath) {
			if (trimmed.endsWith('$$')) openMath = false;
			continue;
		}
		const fence = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
		if (fence) {
			openFence = fence[1];
			fences.push(fence[2].trim());
			continue;
		}
		if (trimmed.startsWith('$$')) {
			blockMath++;
			openMath = !(trimmed.length > 2 && trimmed.endsWith('$$'));
			continue;
		}
		const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) headings.push({ level: heading[1].length, text: heading[2] });
		prose.push(line);
	}
	return { prose, fences, blockMath, headings };
}

/**
 * The word a caret should light up: the most-repeated alphabetic word of four letters or more
 * inside one plain paragraph, or null when the document holds none. Tokenized the way
 * `highlight-occurrences` tokenizes, so the spec and the plugin agree on what a word is, and
 * scoped to one paragraph so both marks live in a single mounted block.
 */
export function repeatedWordInParagraph(scan: ShowcaseScan = scanShowcase()): RepeatedWord | null {
	let best: RepeatedWord | null = null;
	for (const paragraph of plainParagraphs(scan.prose)) {
		const counts = new Map<string, number>();
		for (const [token] of paragraph.matchAll(/[\p{L}\p{N}_]+/gu)) {
			if (/^[A-Za-z]{4,}$/.test(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
		}
		for (const [word, count] of counts) {
			if (count >= 2 && count > (best?.count ?? 0)) best = { word, count };
		}
	}
	return best;
}

// A run of consecutive lines that all open like prose is one paragraph block; every container,
// list item, table row, heading and html line opens with a marker character instead.
const OPENS_A_NON_PARAGRAPH = /^\s*($|[>#|`~$<*+:%-]|\d+[.)]\s|!?\[)/;

function plainParagraphs(lines: readonly string[]): string[] {
	const paragraphs: string[] = [];
	let current: string[] = [];
	for (const line of lines) {
		if (OPENS_A_NON_PARAGRAPH.test(line)) {
			if (current.length > 0) paragraphs.push(current.join(' '));
			current = [];
			continue;
		}
		current.push(line);
	}
	if (current.length > 0) paragraphs.push(current.join(' '));
	return paragraphs;
}
