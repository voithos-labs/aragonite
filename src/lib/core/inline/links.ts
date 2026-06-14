/**
 * Inline pipeline stage 1.5: link, image, and autolink scanning over the text
 * regions left by earlier pre-passes (backticks, escapes, entity references).
 *
 * The links.ts ↔ index.ts module cycle is benign: parseInline is called at
 * runtime, not module-init.
 */

import type { InlineNode } from '../nodes';
import { parseImageDimensions } from './image-dimensions';
import { parseInline } from './index';
import { normalizeLinkLabel, type LinkReferenceResolver } from './link-reference-resolver';
import {
	forEachGap,
	isContainedInAny,
	occupiedEndAt,
	occupiedRangesFrom,
	type Range
} from './ranges';

// ── GFM §6.9 shared helpers ─────────────────────────────────────────────────

const TRAILING_PUNCT = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

/**
 * Trim trailing punctuation per GFM §6.9. Returns the adjusted end offset.
 *
 * Conditional ): only when there are more `)` than `(` in [urlStart, end).
 * Conditional ;: only when the part before is NOT shaped like an HTML entity
 * (a `;` preceded by `&` followed by alphanumerics / `#` and digits/hex back to `&`).
 */
export function trimTrailingPunctuation(raw: string, urlStart: number, urlEnd: number): number {
	let end = urlEnd;
	while (end > urlStart) {
		const ch = raw[end - 1];
		if (TRAILING_PUNCT.has(ch)) {
			end--;
			continue;
		}
		if (ch === ')') {
			let opens = 0;
			let closes = 0;
			for (let i = urlStart; i < end; i++) {
				if (raw[i] === '(') opens++;
				else if (raw[i] === ')') closes++;
			}
			if (closes > opens) {
				end--;
				continue;
			}
			break;
		}
		if (ch === ';') {
			// Look back for &name; / &#NNN; / &#xHHH;
			let j = end - 2;
			while (j > urlStart && /[0-9A-Fa-f]/.test(raw[j])) j--;
			if (j >= urlStart + 2 && raw[j] === 'x' && raw[j - 1] === '#' && raw[j - 2] === '&') {
				break;
			}
			j = end - 2;
			while (j > urlStart && /[0-9]/.test(raw[j])) j--;
			if (j >= urlStart + 1 && raw[j] === '#' && raw[j - 1] === '&') {
				break;
			}
			j = end - 2;
			while (j > urlStart && /[A-Za-z0-9]/.test(raw[j])) j--;
			if (j >= urlStart && raw[j] === '&' && j < end - 2) {
				break;
			}
			end--;
			continue;
		}
		break;
	}
	return end;
}

/**
 * Per GFM §6.9: a bare autolink is valid only at start-of-region or after
 * whitespace, `*`, `_`, `~`, or `(`.
 */
export function isValidLeadingBoundary(raw: string, pos: number, regionStart: number): boolean {
	if (pos <= regionStart) return true;
	const ch = raw[pos - 1];
	return /\s/.test(ch) || ch === '*' || ch === '_' || ch === '~' || ch === '(';
}

// ── Public entry ────────────────────────────────────────────────────────────

export function scanLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[],
	resolver?: LinkReferenceResolver
): InlineNode[] {
	const occupiedRanges = occupiedRangesFrom(occupied);

	// Pass 1: links and images may span occupied ranges (entity in link text,
	// escape inside alt, etc.). Bracket pairing skips over occupied content so
	// `[` inside a code span doesn't masquerade as a link delimiter.
	const linksAndImages = scanLinksAndImages(raw, start, end, occupiedRanges, resolver);

	// Occupied ranges enclosed by a link/image already live inside that node's
	// children (see parseInline call in scanLinksAndImages). They must not
	// re-appear as top-level siblings or seed phantom autolink scans into the
	// link's destination bytes.
	const linkAndImageRanges: Range[] = linksAndImages.map((n) => ({ start: n.start, end: n.end }));
	const outerOccupiedRanges = occupiedRanges.filter(
		(r) => !isContainedInAny(r, linkAndImageRanges)
	);

	// Pass 2: autolinks fill the gaps left by occupied + links. They stop at
	// occupied/whitespace boundaries so e.g. `https://x.com&amp;y` does not
	// absorb the entity into the autolinked URL.
	const closedRanges: Range[] = [...outerOccupiedRanges, ...linkAndImageRanges].sort(
		(a, b) => a.start - b.start
	);

	const autolinks: InlineNode[] = [];
	forEachGap(closedRanges, start, end, (s, e) => scanRegionForAutolinks(raw, s, e, autolinks));

	const found: InlineNode[] = [...linksAndImages, ...autolinks];
	if (found.length === 0) return occupied;

	const outerOccupied = occupied.filter(
		(n) =>
			n.kind !== 'text' && !isContainedInAny({ start: n.start, end: n.end }, linkAndImageRanges)
	);
	const allOccupied: InlineNode[] = [...outerOccupied, ...found].sort((a, b) => a.start - b.start);

	const result: InlineNode[] = [];
	let cursor = start;

	for (const node of allOccupied) {
		if (cursor < node.start) {
			result.push({
				kind: 'text',
				start: cursor,
				end: node.start,
				text: raw.slice(cursor, node.start)
			});
		}
		result.push(node);
		cursor = node.end;
	}
	if (cursor < end) {
		result.push({
			kind: 'text',
			start: cursor,
			end,
			text: raw.slice(cursor, end)
		});
	}

	return result;
}

// ── Links and images ───────────────────────────────────────────────────────

/**
 * Parse `(url "title")` starting at `(`. Angle-bracket URLs (`<url>`) are
 * NOT decoded: the brackets survive in the url field. Safe because url is
 * a rendering cache — never re-serialized.
 */
function parseDestination(
	raw: string,
	pos: number,
	limit: number
): { url: string; title: string | undefined; end: number } | null {
	if (pos >= limit || raw[pos] !== '(') return null;
	pos++;

	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	const urlStart = pos;
	while (
		pos < limit &&
		raw[pos] !== ')' &&
		raw[pos] !== ' ' &&
		raw[pos] !== '\t' &&
		raw[pos] !== '"' &&
		raw[pos] !== "'"
	) {
		pos++;
	}
	const url = raw.slice(urlStart, pos);

	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	let title: string | undefined;
	if (pos < limit && (raw[pos] === '"' || raw[pos] === "'")) {
		const quote = raw[pos];
		pos++;
		const titleStart = pos;
		while (pos < limit && raw[pos] !== quote) pos++;
		if (pos >= limit) return null;
		title = raw.slice(titleStart, pos);
		pos++;
	}

	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	if (pos >= limit || raw[pos] !== ')') return null;
	pos++;

	return { url, title, end: pos };
}

function scanLinksAndImages(
	raw: string,
	start: number,
	end: number,
	occupied: Range[],
	resolver?: LinkReferenceResolver
): InlineNode[] {
	const out: InlineNode[] = [];
	let pos = start;

	while (pos < end) {
		const skip = occupiedEndAt(occupied, pos);
		if (skip !== null) {
			pos = skip;
			continue;
		}

		const ch = raw[pos];

		if (
			ch === '!' &&
			pos + 1 < end &&
			raw[pos + 1] === '[' &&
			occupiedEndAt(occupied, pos + 1) === null
		) {
			const bracketOpen = pos + 1;
			const bracketClose = findMatchingBracket(raw, bracketOpen, end, occupied);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					const altRaw = raw.slice(bracketOpen + 1, bracketClose);
					const dims = parseImageDimensions(altRaw);
					out.push({
						kind: 'image',
						start: pos,
						end: dest.end,
						alt: dims.displayAlt,
						url: dest.url,
						...(dest.title !== undefined ? { title: dest.title } : {}),
						...(dims.width !== undefined ? { width: dims.width } : {}),
						...(dims.height !== undefined ? { height: dims.height } : {})
					});
					pos = dest.end;
					continue;
				}

				if (resolver !== undefined) {
					const ref = matchReferenceImage(raw, pos, bracketOpen, bracketClose, end, resolver);
					if (ref !== null) {
						out.push(ref);
						pos = ref.end;
						continue;
					}
				}
			}
			pos++;
			continue;
		}

		if (ch === '[') {
			const bracketClose = findMatchingBracket(raw, pos, end, occupied);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					const children = parseInline(raw, pos + 1, bracketClose, resolver);
					out.push({
						kind: 'link',
						start: pos,
						end: dest.end,
						children,
						url: dest.url,
						...(dest.title !== undefined ? { title: dest.title } : {})
					});
					pos = dest.end;
					continue;
				}

				if (resolver !== undefined) {
					const ref = matchReferenceLink(raw, pos, bracketClose, end, resolver);
					if (ref !== null) {
						out.push(ref);
						pos = ref.end;
						continue;
					}
				}
			}
			pos++;
			continue;
		}

		pos++;
	}

	return out;
}

function findMatchingBracket(
	raw: string,
	bracketStart: number,
	limit: number,
	occupied: Range[]
): number {
	let depth = 0;
	let pos = bracketStart;
	while (pos < limit) {
		const skip = occupiedEndAt(occupied, pos);
		if (skip !== null) {
			pos = skip;
			continue;
		}
		if (raw[pos] === '[') depth++;
		else if (raw[pos] === ']') {
			depth--;
			if (depth === 0) return pos;
		}
		pos++;
	}
	return -1;
}

// CommonMark §4.7: brackets inside a reference label may be backslash-escaped.
// Returns the next unescaped `]` in [from, end), or -1 — matching the LRD
// parser's escape-aware label scan so both sides resolve the same label.
function indexOfUnescapedBracket(raw: string, from: number, end: number): number {
	for (let i = from; i < end; i++) {
		if (raw[i] === '\\') {
			i++; // skip the escaped char (covers `\]` and `\\`)
			continue;
		}
		if (raw[i] === ']') return i;
	}
	return -1;
}

/**
 * Try the three reference forms against a `[…]` pair at [pos, bracketClose].
 * Full and collapsed both *commit* to the reference shape — if their label
 * fails to resolve, the brackets render as plain text rather than falling
 * through to shortcut. Only an unfollowed `[…]` triggers shortcut.
 */
function matchReferenceLink(
	raw: string,
	pos: number,
	bracketClose: number,
	end: number,
	resolver: LinkReferenceResolver
): InlineNode | null {
	const textStart = pos + 1;
	const textEnd = bracketClose;
	const text = raw.slice(textStart, textEnd);

	// Form 1: full reference [text][label]
	if (bracketClose + 1 < end && raw[bracketClose + 1] === '[') {
		const labelClose = indexOfUnescapedBracket(raw, bracketClose + 2, end);
		if (labelClose !== -1 && labelClose < end) {
			const labelRaw = raw.slice(bracketClose + 2, labelClose);
			if (labelRaw.length > 0) {
				const resolved = resolver(labelRaw);
				if (resolved !== undefined) {
					return buildResolvedLink(
						raw,
						pos,
						labelClose + 1,
						textStart,
						textEnd,
						labelRaw,
						resolved,
						resolver
					);
				}
				// Full form committed to reference shape — emit unresolvedReference
				// so the renderer can flag the failed resolution.
				return {
					kind: 'unresolvedReference',
					start: pos,
					end: labelClose + 1,
					label: normalizeLinkLabel(labelRaw),
					refKind: 'link'
				};
			}
			// Form 2: collapsed reference [text][]
			const resolved = resolver(text);
			if (resolved !== undefined) {
				return buildResolvedLink(
					raw,
					pos,
					labelClose + 1,
					textStart,
					textEnd,
					text,
					resolved,
					resolver
				);
			}
			return {
				kind: 'unresolvedReference',
				start: pos,
				end: labelClose + 1,
				label: normalizeLinkLabel(text),
				refKind: 'link'
			};
		}
	}

	// Form 3: shortcut reference [label] — only when not followed by [ or (
	const next = bracketClose + 1;
	if (next < end && (raw[next] === '[' || raw[next] === '(')) {
		return null;
	}
	const resolved = resolver(text);
	if (resolved !== undefined) {
		return buildResolvedLink(
			raw,
			pos,
			bracketClose + 1,
			textStart,
			textEnd,
			text,
			resolved,
			resolver
		);
	}
	return null;
}

function buildResolvedLink(
	raw: string,
	start: number,
	end: number,
	textStart: number,
	textEnd: number,
	label: string,
	resolved: { url: string; title?: string },
	resolver: LinkReferenceResolver
): InlineNode {
	const children = parseInline(raw, textStart, textEnd, resolver);
	return {
		kind: 'link',
		start,
		end,
		children,
		url: resolved.url,
		...(resolved.title !== undefined ? { title: resolved.title } : {}),
		label: normalizeLinkLabel(label)
	};
}

/**
 * Try to match `![alt][label]`, `![alt][]`, or `![label]` reference forms.
 * `pos` points at the `!`; `bracketOpen` at the `[`; `bracketClose` at the `]`.
 */
function matchReferenceImage(
	raw: string,
	pos: number,
	bracketOpen: number,
	bracketClose: number,
	end: number,
	resolver: LinkReferenceResolver
): InlineNode | null {
	const altRaw = raw.slice(bracketOpen + 1, bracketClose);

	// Form 1: full reference ![alt][label]
	if (bracketClose + 1 < end && raw[bracketClose + 1] === '[') {
		const labelClose = indexOfUnescapedBracket(raw, bracketClose + 2, end);
		if (labelClose !== -1 && labelClose < end) {
			const labelRaw = raw.slice(bracketClose + 2, labelClose);
			if (labelRaw.length > 0) {
				const resolved = resolver(labelRaw);
				if (resolved !== undefined) {
					return buildResolvedImage(pos, labelClose + 1, altRaw, labelRaw, resolved);
				}
				return {
					kind: 'unresolvedReference',
					start: pos,
					end: labelClose + 1,
					label: normalizeLinkLabel(labelRaw),
					refKind: 'image'
				};
			}
			// Form 2: collapsed reference ![alt][]
			const resolved = resolver(altRaw);
			if (resolved !== undefined) {
				return buildResolvedImage(pos, labelClose + 1, altRaw, altRaw, resolved);
			}
			return {
				kind: 'unresolvedReference',
				start: pos,
				end: labelClose + 1,
				label: normalizeLinkLabel(altRaw),
				refKind: 'image'
			};
		}
	}

	// Form 3: shortcut reference ![label] — only when not followed by [ or (
	const next = bracketClose + 1;
	if (next < end && (raw[next] === '[' || raw[next] === '(')) {
		return null;
	}
	const resolved = resolver(altRaw);
	if (resolved !== undefined) {
		return buildResolvedImage(pos, bracketClose + 1, altRaw, altRaw, resolved);
	}
	return null;
}

function buildResolvedImage(
	start: number,
	end: number,
	altRaw: string,
	label: string,
	resolved: { url: string; title?: string }
): InlineNode {
	const dims = parseImageDimensions(altRaw);
	return {
		kind: 'image',
		start,
		end,
		alt: dims.displayAlt,
		url: resolved.url,
		...(resolved.title !== undefined ? { title: resolved.title } : {}),
		...(dims.width !== undefined ? { width: dims.width } : {}),
		...(dims.height !== undefined ? { height: dims.height } : {}),
		label: normalizeLinkLabel(label)
	};
}

// ── Autolink dispatcher ─────────────────────────────────────────────────────

function scanRegionForAutolinks(raw: string, start: number, end: number, out: InlineNode[]): void {
	let pos = start;
	while (pos < end) {
		const ch = raw[pos];
		let matched: InlineNode | null = null;

		if (ch === '<') {
			matched = matchAngleBracketAutolink(raw, pos, end);
		} else if (ch === 'h' || ch === 'H') {
			matched = matchBareHttpAutolink(raw, pos, start, end);
		} else if (ch === 'w' || ch === 'W') {
			matched = matchBareWwwAutolink(raw, pos, start, end);
		} else if (ch === '@') {
			matched = matchBareEmailAutolink(raw, pos, start, end);
		}

		if (matched !== null) {
			out.push(matched);
			pos = matched.end;
			continue;
		}
		pos++;
	}
}

const ANGLE_EMAIL = /^[A-Za-z0-9._+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+$/;

function matchAngleBracketAutolink(raw: string, pos: number, end: number): InlineNode | null {
	const closeAngle = raw.indexOf('>', pos + 1);
	if (closeAngle === -1 || closeAngle >= end) return null;
	const inner = raw.slice(pos + 1, closeAngle);

	if (/^https?:\/\/\S+$/.test(inner)) {
		return {
			kind: 'autolink',
			start: pos,
			end: closeAngle + 1,
			url: inner
		};
	}

	if (ANGLE_EMAIL.test(inner)) {
		// Regex permits trailing '-' in final domain segment; GFM forbids it.
		if (inner[inner.length - 1] === '-') return null;
		return {
			kind: 'autolink',
			start: pos,
			end: closeAngle + 1,
			url: `mailto:${inner}`
		};
	}

	return null;
}

function matchBareHttpAutolink(
	raw: string,
	pos: number,
	regionStart: number,
	end: number
): InlineNode | null {
	if (!isValidLeadingBoundary(raw, pos, regionStart)) return null;
	const lower = raw.slice(pos, pos + 8).toLowerCase();
	const schemeLen = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : 0;
	if (schemeLen === 0) return null;
	let urlEnd = pos + schemeLen;
	while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
	if (urlEnd === pos + schemeLen) return null;
	urlEnd = trimTrailingPunctuation(raw, pos, urlEnd);
	if (urlEnd === pos + schemeLen) return null;
	return {
		kind: 'autolink',
		start: pos,
		end: urlEnd,
		url: raw.slice(pos, urlEnd)
	};
}

function matchBareWwwAutolink(
	raw: string,
	pos: number,
	regionStart: number,
	end: number
): InlineNode | null {
	if (!isValidLeadingBoundary(raw, pos, regionStart)) return null;
	const prefixLen = 4;
	const prefix = raw.slice(pos, pos + prefixLen).toLowerCase();
	if (prefix !== 'www.') return null;
	let urlEnd = pos + prefixLen;
	while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
	if (urlEnd === pos + prefixLen) return null;
	urlEnd = trimTrailingPunctuation(raw, pos, urlEnd);
	if (urlEnd === pos + prefixLen) return null;
	return {
		kind: 'autolink',
		start: pos,
		end: urlEnd,
		url: raw.slice(pos, urlEnd)
	};
}

const EMAIL_LOCAL = /[A-Za-z0-9._+\-]/;
const EMAIL_DOMAIN_CHAR = /[A-Za-z0-9\-]/;

function matchBareEmailAutolink(
	raw: string,
	atPos: number,
	regionStart: number,
	regionEnd: number
): InlineNode | null {
	// Scan backward for local-part.
	let localStart = atPos;
	while (localStart > regionStart && EMAIL_LOCAL.test(raw[localStart - 1])) localStart--;
	if (localStart === atPos) return null; // empty local-part
	// Boundary applies at the start of the URL, which for email is the local-part start.
	if (!isValidLeadingBoundary(raw, localStart, regionStart)) return null;

	const domainStart = atPos + 1;
	let domainEnd = domainStart;
	while (domainEnd < regionEnd && EMAIL_DOMAIN_CHAR.test(raw[domainEnd])) domainEnd++;
	if (domainEnd === domainStart) return null; // empty first segment
	if (raw[domainEnd - 1] === '-') return null; // GFM: last seg char cannot be -
	if (domainEnd >= regionEnd || raw[domainEnd] !== '.') return null;
	const firstSegEnd = domainEnd;

	// Walk additional `.<segment>` greedily.
	while (domainEnd < regionEnd && raw[domainEnd] === '.') {
		const segStart = domainEnd + 1;
		let segEnd = segStart;
		while (segEnd < regionEnd && EMAIL_DOMAIN_CHAR.test(raw[segEnd])) segEnd++;
		if (segEnd === segStart) break; // empty segment after dot
		if (raw[segEnd - 1] === '-') break; // GFM: domain segment cannot end in -
		domainEnd = segEnd;
	}
	if (domainEnd === firstSegEnd) return null; // never got a second segment

	const urlEnd = trimTrailingPunctuation(raw, localStart, domainEnd);
	if (urlEnd === domainStart) return null; // trim ate everything past @

	return {
		kind: 'autolink',
		start: localStart,
		end: urlEnd,
		url: `mailto:${raw.slice(localStart, urlEnd)}`
	};
}
