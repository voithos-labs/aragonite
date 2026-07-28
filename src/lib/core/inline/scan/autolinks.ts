/**
 * `<` dispatch (spec autolinks §6.5, then raw HTML §6.6) and the GFM §6.9
 * bare/www/email autolink pass over completed text runs.
 *
 * The conformance reference has no autolink extension, so the GFM rules here
 * answer to the GFM spec text where it is explicit — including the blanket
 * leading-boundary rule, which cmark-gfm applies to www/url but not to email.
 * Where the prose runs out, cmark-gfm settles the corner, since it is what
 * GitHub runs (see `scanEmailDomain`). Its `np > 10` underscore escape is the
 * one exception, called out at `hasValidDomain`.
 */

import type { InlineNode } from '../../nodes';
import { matchHtmlFormAt } from '../html-tag-grammar';
import { appendNode, type ScanContext } from './scan-state';
import { percentEncodeUri } from './url';

// ── GFM §6.9 boundary and trim rules ────────────────────────────────────────

const TRAILING_PUNCT = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

/**
 * Trim trailing punctuation per GFM §6.9. Returns the adjusted end offset.
 *
 * Conditional ): only when there are more `)` than `(` in [urlStart, end).
 * Conditional ;: a `;` is not trailing punctuation, so it normally stays; but a
 * tail resembling an entity reference (`&` + one or more alphanumerics + `;`) is
 * excluded — the `&` and everything after — then trimming continues (spec ex. 626).
 */
export function trimTrailingPunctuation(raw: string, urlStart: number, urlEnd: number): number {
	// Parens are counted once and the balance maintained while trimming — a
	// recount per trimmed `)` makes paren floods quadratic. Only the `)` branch
	// removes parens, so decrementing `closes` there keeps the counts exact.
	let opens = 0;
	let closes = 0;
	for (let i = urlStart; i < urlEnd; i++) {
		if (raw[i] === '(') opens++;
		else if (raw[i] === ')') closes++;
	}
	let end = urlEnd;
	while (end > urlStart) {
		const ch = raw[end - 1];
		if (TRAILING_PUNCT.has(ch)) {
			end--;
			continue;
		}
		if (ch === ')') {
			if (closes > opens) {
				end--;
				closes--;
				continue;
			}
			break;
		}
		if (ch === ';') {
			// An entity-shaped tail (`&` + one-or-more alphanumerics + `;`) is excluded
			// with the `&`; a `;` that does not resemble an entity is not trailing
			// punctuation and stays in the url.
			let j = end - 2;
			while (j > urlStart && /[A-Za-z0-9]/.test(raw[j])) j--;
			if (j >= urlStart && raw[j] === '&' && j < end - 2) {
				end = j;
				continue;
			}
			break;
		}
		break;
	}
	return end;
}

const HOST_CHAR = /[\p{L}\p{N}_.-]/u;

/**
 * Per GFM §6.9 a valid domain carries no underscore in either of its last two
 * dot-separated segments, so `www.xxx._yyy.zzz` stays literal while
 * `www._xxx.yyy.zzz` links. The host ends at the first non-host character, which
 * is what keeps an underscore in a path or query out of the decision.
 *
 * cmark-gfm additionally exempts hosts carrying more than ten dots, an artifact
 * of its two-counter implementation rather than spec text; this module answers to
 * the spec (see the file header), so that escape is deliberately not reproduced.
 */
function hasValidDomain(raw: string, domainStart: number, limit: number): boolean {
	let hostEnd = domainStart;
	while (hostEnd < limit && HOST_CHAR.test(raw[hostEnd])) hostEnd++;
	let dotsSeen = 0;
	let i = hostEnd;
	while (i > domainStart && dotsSeen < 2) {
		i--;
		if (raw[i] === '.') dotsSeen++;
		else if (raw[i] === '_') return false;
	}
	return true;
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

// ── `<` handler: spec autolink, then raw HTML tag ───────────────────────────

// commonmark.js 0.31.2 reEmailAutolink / reAutolink, tried in that order.
const EMAIL_AUTOLINK =
	/^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
// eslint-disable-next-line no-control-regex -- commonmark reAutolink excludes control chars + space from the URI
const URI_AUTOLINK = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/;

export function handleAngle(ctx: ScanContext): void {
	const node = matchAngleConstruct(ctx.raw, ctx.pos, ctx.end);
	if (node !== null) appendNode(ctx, node);
	else ctx.pos++;
}

function matchAngleConstruct(raw: string, pos: number, end: number): InlineNode | null {
	const ahead = raw.slice(pos, end);
	const email = EMAIL_AUTOLINK.exec(ahead);
	if (email !== null) {
		return {
			kind: 'autolink',
			start: pos,
			end: pos + email[0].length,
			url: percentEncodeUri('mailto:' + email[1])
		};
	}
	const uri = URI_AUTOLINK.exec(ahead);
	if (uri !== null) {
		return {
			kind: 'autolink',
			start: pos,
			end: pos + uri[0].length,
			url: percentEncodeUri(uri[0].slice(1, -1))
		};
	}
	const tag = matchHtmlFormAt(raw, pos, end);
	if (tag !== null) return { kind: 'rawHtml', start: pos, end: pos + tag.length };
	return null;
}

// ── GFM §6.9 pass over completed text runs ──────────────────────────────────

/**
 * Scan every maximal run of adjacent text nodes for bare autolinks. Runs
 * before emphasis pairing so a delimiter absorbed into a URL can never pair;
 * run boundaries (claimed constructs) end URLs. Consumed delimiters are
 * pruned; runs inside already-wrapped link/image children are scanned too —
 * they were spliced out of the top-level list before this pass saw them.
 */
export function scanGfmAutolinks(ctx: ScanContext): void {
	const matches = spliceBareAutolinks(ctx.raw, ctx.nodes);
	if (matches.length > 0) {
		ctx.delimiters = ctx.delimiters.filter((d) => !meetsAMatch(matches, d.node.start, d.node.end));
	}
	scanChildren(ctx.raw, ctx.nodes);
}

/**
 * Whether `[start, end)` overlaps any match. Matches are disjoint and ascending —
 * one left-to-right pass per run, runs walked in order — so the first match ending
 * past `start` is the only candidate. Asking every delimiter about every match is
 * O(delimiters x matches), quadratic on a block that is dense in both.
 */
function meetsAMatch(matches: InlineNode[], start: number, end: number): boolean {
	let lo = 0;
	let hi = matches.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (matches[mid].end <= start) lo = mid + 1;
		else hi = mid;
	}
	return lo < matches.length && matches[lo].start < end;
}

function scanChildren(raw: string, nodes: InlineNode[]): void {
	// Iterative: nesting depth is input-controlled (images nest without bound),
	// so a per-level recursion is a call-stack overflow on adversarial input.
	const pending: InlineNode[][] = [nodes];
	while (pending.length > 0) {
		for (const node of pending.pop()!) {
			if (node.children !== undefined && node.children.length > 0) {
				spliceBareAutolinks(raw, node.children);
				pending.push(node.children);
			}
		}
	}
}

/**
 * Match and splice bare autolinks into `nodes` in place; returns the matches.
 *
 * The replacement is accumulated and written back rather than spliced in per run:
 * spreading a match array as call arguments dies on V8's argument limit past ~65k
 * matches, and that RangeError drops the whole block to the failed-block fallback,
 * which cannot heal — its error boundary resets on a `raw` change the block is no
 * longer editable enough to receive.
 */
function spliceBareAutolinks(raw: string, nodes: InlineNode[]): InlineNode[] {
	const all: InlineNode[] = [];
	const rebuilt: InlineNode[] = [];
	let i = 0;
	while (i < nodes.length) {
		if (nodes[i].kind !== 'text') {
			rebuilt.push(nodes[i]);
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < nodes.length && nodes[j + 1].kind === 'text') j++;
		const matches = scanRunForBareAutolinks(raw, nodes[i].start, nodes[j].end);
		if (matches.length === 0) {
			for (let k = i; k <= j; k++) rebuilt.push(nodes[k]);
		} else {
			for (const match of matches) all.push(match);
			for (const node of spliceRun(raw, nodes.slice(i, j + 1), matches)) rebuilt.push(node);
		}
		i = j + 1;
	}
	// In place: the working list is held by identity (ctx.nodes, a parent's children).
	if (all.length > 0) {
		nodes.length = 0;
		for (const node of rebuilt) nodes.push(node);
	}
	return all;
}

/**
 * Rebuild one text run around its matches. Untouched text nodes keep their
 * identity — live delimiters reference their run node by object, and only
 * nodes overlapping a match may be re-cut (their delimiters are pruned).
 */
function spliceRun(raw: string, runNodes: InlineNode[], matches: InlineNode[]): InlineNode[] {
	const runEnd = runNodes[runNodes.length - 1].end;
	const out: InlineNode[] = [];
	let cursor = runNodes[0].start;
	let k = 0;
	let mi = 0;
	while (cursor < runEnd) {
		if (mi < matches.length && matches[mi].start === cursor) {
			out.push(matches[mi]);
			cursor = matches[mi].end;
			mi++;
			continue;
		}
		while (runNodes[k].end <= cursor) k++;
		const node = runNodes[k];
		const boundary = mi < matches.length ? matches[mi].start : runEnd;
		if (node.start === cursor && node.end <= boundary) {
			out.push(node);
			cursor = node.end;
		} else {
			const sliceEnd = Math.min(node.end, boundary);
			out.push({ kind: 'text', start: cursor, end: sliceEnd, text: raw.slice(cursor, sliceEnd) });
			cursor = sliceEnd;
		}
	}
	return out;
}

function scanRunForBareAutolinks(raw: string, start: number, end: number): InlineNode[] {
	const out: InlineNode[] = [];
	let pos = start;
	while (pos < end) {
		const ch = raw[pos];
		let matched: InlineNode | null = null;
		if (ch === 'h' || ch === 'H') matched = matchBareHttpAutolink(raw, pos, start, end);
		else if (ch === 'w' || ch === 'W') matched = matchBareWwwAutolink(raw, pos, start, end);
		else if (ch === '@') matched = matchBareEmailAutolink(raw, pos, start, end);
		if (matched !== null) {
			out.push(matched);
			pos = matched.end;
			continue;
		}
		pos++;
	}
	return out;
}

// ── GFM bare/www/email matchers ─────────────────────────────────────────────

/**
 * Allocation-free case-insensitive ASCII prefix check; `lit` is lowercase.
 * Case folds on letters only — a blind `| 0x20` would let control characters
 * alias punctuation (0x0E | 0x20 is `.`).
 */
function matchesCI(raw: string, pos: number, lit: string): boolean {
	for (let i = 0; i < lit.length; i++) {
		const code = raw.charCodeAt(pos + i);
		const lower = lit.charCodeAt(i);
		if (code !== lower && !(lower >= 0x61 && lower <= 0x7a && code === lower - 0x20)) return false;
	}
	return true;
}

function matchBareHttpAutolink(
	raw: string,
	pos: number,
	regionStart: number,
	end: number
): InlineNode | null {
	if (!isValidLeadingBoundary(raw, pos, regionStart)) return null;
	const schemeLen = matchesCI(raw, pos, 'https://') ? 8 : matchesCI(raw, pos, 'http://') ? 7 : 0;
	if (schemeLen === 0) return null;
	let urlEnd = pos + schemeLen;
	while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
	if (urlEnd <= pos + schemeLen) return null;
	urlEnd = trimTrailingPunctuation(raw, pos, urlEnd);
	if (urlEnd <= pos + schemeLen) return null;
	if (!hasValidDomain(raw, pos + schemeLen, urlEnd)) return null;
	return { kind: 'autolink', start: pos, end: urlEnd, url: raw.slice(pos, urlEnd) };
}

function matchBareWwwAutolink(
	raw: string,
	pos: number,
	regionStart: number,
	end: number
): InlineNode | null {
	if (!isValidLeadingBoundary(raw, pos, regionStart)) return null;
	if (!matchesCI(raw, pos, 'www.')) return null;
	let urlEnd = pos + 4;
	while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
	if (urlEnd <= pos + 4) return null;
	urlEnd = trimTrailingPunctuation(raw, pos, urlEnd);
	// `.` is trailing punctuation, so the trim can cross the `www.` prefix itself
	// and leave a bare `www` — a live link to a host the user never wrote. Every
	// floor check in this family is at-or-below for that reason.
	if (urlEnd <= pos + 4) return null;
	if (!hasValidDomain(raw, pos, urlEnd)) return null;
	// GFM §6.9: a www autolink has no scheme in its bytes; `http` is inserted
	// automatically. The node's raw span stays verbatim (start..urlEnd) — only
	// the derived href gains the scheme, exactly like email prepends `mailto:`.
	return { kind: 'autolink', start: pos, end: urlEnd, url: 'http://' + raw.slice(pos, urlEnd) };
}

const EMAIL_LOCAL = /[A-Za-z0-9._+-]/;
const EMAIL_DOMAIN_CHAR = /[A-Za-z0-9_-]/;
const EMAIL_LABEL_START = /[A-Za-z0-9]/;
const EMAIL_DOMAIN_END = /[A-Za-z]/;

/**
 * The email domain per GFM §6.9 — "characters which are alphanumeric, or `-` or
 * `_`, separated by periods", at least one period, and no `-` or `_` at the end.
 * Where that prose runs out the rule is cmark-gfm's, since it is what GitHub
 * runs: the last character must be a LETTER, and a `.` separates labels only
 * when an alphanumeric follows it (so `a@b._c` and `a@b.c1` stay literal, while
 * an empty first label in `a@.b` is accepted). Returns the domain's end offset,
 * or -1 when the address is not one.
 */
function scanEmailDomain(raw: string, domainStart: number, regionEnd: number): number {
	let end = domainStart;
	let separators = 0;
	while (end < regionEnd) {
		const ch = raw[end];
		if (ch === '.') {
			if (end + 1 >= regionEnd || !EMAIL_LABEL_START.test(raw[end + 1])) break;
			separators++;
		} else if (!EMAIL_DOMAIN_CHAR.test(ch)) {
			break;
		}
		end++;
	}
	if (separators === 0) return -1;
	// The walk stops before a `.` it did not count, so `end - 1` is a domain
	// character and a trailing-punctuation trim would have nothing to remove.
	return EMAIL_DOMAIN_END.test(raw[end - 1]) ? end : -1;
}

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

	const domainEnd = scanEmailDomain(raw, atPos + 1, regionEnd);
	if (domainEnd < 0) return null;

	return {
		kind: 'autolink',
		start: localStart,
		end: domainEnd,
		url: `mailto:${raw.slice(localStart, domainEnd)}`
	};
}
