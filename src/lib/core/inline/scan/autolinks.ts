/**
 * `<` dispatch (spec autolinks §6.5, then raw HTML §6.6) plus the GFM §6.9 bare/www/email pass
 * over completed text runs. No conformance reference covers the extension: these rules follow
 * the GFM spec text, then cmark-gfm where its prose runs out (`scanEmailDomain`), and diverge
 * from both at `hasValidDomain`: a scheme'd host needs no period, so `http://localhost` links.
 */

import type { InlineNode } from '../../nodes';
import { matchHtmlFormAt } from '../html-tag-grammar';
import { appendNode, type ScanContext } from './scan-state';
import { percentEncodeUri } from './url';

// ── GFM §6.9 boundary and trim rules ────────────────────────────────────────

const TRAILING_PUNCT = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

/**
 * GFM §6.9 trailing-punctuation trim. `)` goes only when unbalanced; `;` normally stays, but an
 * entity-shaped tail (`&` + alphanumerics + `;`) is excluded with its `&` (spec ex. 626).
 */
export function trimTrailingPunctuation(raw: string, urlStart: number, urlEnd: number): number {
	// Parens counted once and the balance maintained while trimming: a recount per
	// trimmed `)` makes paren floods quadratic.
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
 * GFM §6.9: no underscore in either of a domain's last two dot-separated segments, so
 * `www.xxx._yyy.zzz` stays literal while `www._xxx.yyy.zzz` links. cmark-gfm's extra exemption
 * for 10+-dot hosts is an implementation artifact, deliberately not reproduced (file header).
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
 * GFM §6.9: valid only at start-of-region or after whitespace, `*`, `_`, `~`, or `(`. Applied to
 * every bare form here, per the spec text; cmark-gfm applies it to the `www.` form alone.
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
 * Runs before emphasis pairing so a delimiter absorbed into a URL can never pair; consumed
 * delimiters are pruned. Children of already-wrapped link/image nodes are scanned too.
 */
export function scanGfmAutolinks(ctx: ScanContext): void {
	const matches = spliceBareAutolinks(ctx.raw, ctx.nodes);
	if (matches.length > 0) {
		ctx.delimiters = ctx.delimiters.filter((d) => !meetsAMatch(matches, d.node.start, d.node.end));
	}
	scanChildren(ctx.raw, ctx.nodes);
}

/** Matches are disjoint and ascending; the linear alternative is quadratic on a dense block. */
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
	// Iterative: nesting depth is input-controlled, so per-level recursion overflows the stack.
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
 * The replacement is accumulated and written back rather than spliced per run: spreading a match
 * array as call arguments hits V8's argument limit past ~65k matches, and the block never heals.
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
 * Untouched text nodes keep their identity: live delimiters reference their run node by object,
 * so only nodes overlapping a match may be re-cut (their delimiters having been pruned).
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
 * `lit` is lowercase. Folds letters only: a blind `| 0x20` would let control characters alias
 * punctuation (0x0E | 0x20 is `.`).
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
	// `.` is trailing punctuation, so the trim can cross the `www.` prefix and leave a bare
	// `www`, a live link to a host the user never wrote. Hence at-or-below floor checks here.
	if (urlEnd <= pos + 4) return null;
	if (!hasValidDomain(raw, pos, urlEnd)) return null;
	// GFM §6.9: a www autolink carries no scheme in its bytes. The raw span stays verbatim;
	// only the derived href gains `http://`, exactly as email prepends `mailto:`.
	return { kind: 'autolink', start: pos, end: urlEnd, url: 'http://' + raw.slice(pos, urlEnd) };
}

const EMAIL_LOCAL = /[A-Za-z0-9._+-]/;
const EMAIL_DOMAIN_CHAR = /[A-Za-z0-9_-]/;
const EMAIL_LABEL_START = /[A-Za-z0-9]/;
const EMAIL_DOMAIN_END = /[A-Za-z]/;

/**
 * The email domain per GFM §6.9: alphanumerics/`-`/`_` separated by periods, at least one
 * period, no `-`/`_` at the end. Past that prose the rule is cmark-gfm's: the last character
 * must be a LETTER, and a `.` separates labels only when an alphanumeric follows (`a@b._c` and
 * `a@b.c1` stay literal; `a@.b` is accepted). Returns the domain end, or -1.
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
	// The walk stops before any `.` it did not count, so `end - 1` is a domain character.
	return EMAIL_DOMAIN_END.test(raw[end - 1]) ? end : -1;
}

function matchBareEmailAutolink(
	raw: string,
	atPos: number,
	regionStart: number,
	regionEnd: number
): InlineNode | null {
	let localStart = atPos;
	while (localStart > regionStart && EMAIL_LOCAL.test(raw[localStart - 1])) localStart--;
	if (localStart === atPos) return null; // empty local-part
	// The boundary applies at the URL's start, which for email is the local-part start.
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
