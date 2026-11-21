// One forward pass over `[start, end)`: handlers first at each position, then the built-in reading
// of the character there. Brackets and delimiter runs are resolved as in commonmark.js; the result
// is a flat token list the tree is built from. A handler's claim at `[` or `![` stands only where
// a probe, a second pass from that bracket, finds no built-in link or image closing inside it.
import type { InlineNode } from '../../nodes';
import type { GrammarView } from '../../../schema/block-openers';
import { recordInlineScan } from '../../../perf/instruments';
import {
	emailEnd,
	emailStart,
	isAutolinkBoundary,
	matchAngleAutolink,
	readBareUrl
} from './autolinks';
import {
	codePointAt,
	codePointBefore,
	isAsciiPunctuation,
	isUnicodePunctuation,
	isUnicodeWhitespace
} from './chars';
import { checkClaim, stampClaim } from './claims';
import { backtickRuns } from './code-span';
import type { LinkReferenceResolver } from './definitions';
import { DelimiterStack, type Delimiter } from './emphasis';
import { matchCharRef } from './entities';
import { labelEnd, labelKey, readInlineTail, STILL_OPEN } from './link-grammar';
import { rawHtmlReader } from './raw-html';
import { inlineTable, type InlineTable } from './inline-table';
import type { InlineHandler } from './plugin-syntax';
import { readSizeHint } from './size-hint';
import { closeWrapper, openWrapper, token, type Token } from './token';

interface Bracket {
	token: number;
	start: number;
	textStart: number;
	image: boolean;
	id: number;
	bracketAfter: boolean;
	/** The delimiter stack's top when the bracket opened: emphasis inside pairs above it. */
	delimiters: Delimiter | null;
	/** The literal reference shape this bracket would complete as its label. */
	shape?: Shape;
}

/** A full or collapsed reference left literal, from its first `[` to its label's `]`. */
export interface Shape {
	startToken: number;
	endToken: number;
	labelOpen: number;
	labelClose: number;
	node: InlineNode;
}

/** A label to look up: as written, its key, and where the link would end. */
interface Reference {
	written: string;
	key: string;
	end: number;
	/** Present for the full and collapsed forms, which stay a shape when the lookup misses. */
	shape?: Omit<Shape, 'startToken'>;
}

interface Target {
	url: string;
	title?: string;
	label?: string;
	end: number;
}

/** The next position at or after `from` the parse may read, or -1. The search stops at `end`, so
 *  a short range of a long block costs the range, not the rest of the block. */
export function specialFinder(
	raw: string,
	end: number,
	table: InlineTable
): (from: number) => number {
	const pattern = table.specials;
	const searched = end < raw.length ? raw.slice(0, end) : raw;
	return (from) => {
		pattern.lastIndex = from;
		return pattern.exec(searched)?.index ?? -1;
	};
}

/** What a scan and the probes it runs share: one reader per range, built once from its start. */
interface Readers {
	start: number;
	table: InlineTable;
	next: (from: number) => number;
	rawHtml: (pos: number) => number;
	closers?: (from: number, length: number) => number;
	/** The one probe the range's brackets are asked through; probes never nest. */
	probe?: Scan;
	/** The last question a probe answered, which a bare url and the claim after it both ask. */
	askedAt: number;
	askedUntil: number;
	answer: boolean;
}

function readersFor(raw: string, start: number, end: number, table: InlineTable): Readers {
	return {
		start,
		table,
		next: specialFinder(raw, end, table),
		rawHtml: rawHtmlReader(raw, end),
		askedAt: -1,
		askedUntil: -1,
		answer: false
	};
}

/** Whether a `](` or a `][` starts in `[from, until)`: where a bracket whose text opens with
 *  another can close as a link, since it can be no shortcut reference. */
function holdsLinkTail(raw: string, from: number, until: number): boolean {
	for (let i = from; i < until; i++) {
		if (raw[i] === ']' && (raw[i + 1] === '(' || raw[i + 1] === '[')) return true;
	}
	return false;
}

/** Whether a plugin prefix opens the same bracket a built-in link or image opens. */
const opensBuiltinBracket = (prefix: string) => prefix[0] === '[' || prefix.startsWith('![');

export class Scan {
	readonly tokens: Token[] = [];
	readonly shapes: Shape[] = [];
	private readonly delimiters = new DelimiterStack();
	private readonly brackets: Bracket[] = [];
	private readonly bareEmails = new Set<Token>();
	private readonly readers: Readers;
	/** On a probe, where the claim it asks about ends; -1 on a scan. */
	private until: number;
	/** Set on a probe: the answer once the bracket it opened at `start` resolves. */
	private probed?: boolean;
	/** Where the literal text not yet in a token starts. */
	private pending: number;
	/** An email's local part reaches back no further than this. */
	private emailFloor: number;
	private bracketIds = 0;
	/** Link openers with an id below this are inactive: no links in links. */
	private linksBefore = 0;
	private awaitingLabel?: Shape;

	constructor(
		private readonly raw: string,
		private start: number,
		private readonly end: number,
		private readonly resolver: LinkReferenceResolver | undefined,
		private readonly grammar: GrammarView,
		/** Set on a probe: its parent's readers, and where the claim it asks about ends. */
		probe?: { readers: Readers; until: number }
	) {
		this.pending = this.emailFloor = start;
		this.until = probe?.until ?? -1;
		if (!probe) recordInlineScan();
		this.readers = probe?.readers ?? readersFor(raw, start, end, inlineTable(grammar));
	}

	private get isProbe(): boolean {
		return this.until >= 0;
	}

	run(): this {
		const { next } = this.readers;
		for (let at = next(this.start); at >= 0;) at = next(this.claim(at) || this.read(at));
		if (this.pending < this.end) this.tokens.push(token(this.pending, this.end));
		this.delimiters.process(null);
		return this;
	}

	/** Points a probe at the bracket at `start`, its state as a new scan's. */
	private restart(start: number, until: number): this {
		this.tokens.length = this.shapes.length = this.brackets.length = 0;
		this.delimiters.top = null;
		this.awaitingLabel = this.probed = undefined;
		this.bareEmails.clear();
		this.start = this.pending = this.emailFloor = start;
		this.until = until;
		this.bracketIds = this.linksBefore = 0;
		return this;
	}

	/** Whether the bracket a built-in link or image opens at `start` closes as one before `until`. */
	private completes(): boolean {
		const { next } = this.readers;
		for (let at = this.start; at >= 0 && at < this.until && this.probed === undefined;) {
			at = next(this.claim(at) || this.read(at));
		}
		return this.probed === true;
	}

	private get rawHtml() {
		return this.readers.rawHtml;
	}

	private push(t: Token, crossable = false): void {
		if (this.pending < t.start) this.tokens.push(token(this.pending, t.start));
		this.tokens.push(t);
		this.pending = t.end;
		if (!crossable) this.emailFloor = t.end;
	}

	private leaf(node: InlineNode): number {
		this.push(token(node.start, node.end, node));
		return node.end;
	}

	/** The first handler on this character that claims, or 0. */
	private claim(pos: number): number {
		const claimed = this.handlerClaim(pos);
		if (!claimed) return 0;
		checkClaim(claimed.node, claimed.handler.prefix, pos, this.end);
		stampClaim(claimed.node, claimed.handler);
		return this.leaf(claimed.node);
	}

	private handlerClaim(pos: number): { node: InlineNode; handler: InlineHandler } | null {
		for (const handler of this.readers.table.handlers(this.raw[pos])) {
			const { prefix } = handler;
			const bracket = opensBuiltinBracket(prefix);
			// A probe reads a bracket claim as the brackets it spells, so probes never nest.
			if (bracket && this.isProbe) continue;
			if (pos + prefix.length > this.end || !this.raw.startsWith(prefix, pos)) continue;
			const node = handler.recognizer(this.raw, pos, this.end, this.grammar);
			if (!node) continue;
			// The editor declines for the plugin where a built-in link or image closes in its claim.
			if (bracket && this.builtinCompletes(pos, node.end)) return null;
			return { node, handler };
		}
		return null;
	}

	private builtinCompletes(pos: number, until: number): boolean {
		const { readers } = this;
		if (readers.askedAt === pos && readers.askedUntil === until) return readers.answer;
		const textOpensBracket = this.raw[pos + (this.raw[pos] === '!' ? 2 : 1)] === '[';
		if (textOpensBracket && !holdsLinkTail(this.raw, pos, until)) return false;
		readers.probe ??= new Scan(this.raw, pos, this.end, this.resolver, this.grammar, {
			readers,
			until
		});
		readers.answer = readers.probe.restart(pos, until).completes();
		readers.askedAt = pos;
		readers.askedUntil = until;
		return readers.answer;
	}

	private read(pos: number): number {
		const { raw, end } = this;
		switch (raw[pos]) {
			case '\\': {
				const node = this.backslash(pos);
				return node ? this.leaf(node) : pos + 1;
			}
			case '`':
				return this.backticks(pos);
			case '&': {
				const ref = matchCharRef(raw, pos, end);
				return ref ? this.leaf(ref) : pos + 1;
			}
			case '*':
			case '_':
			case '~':
				return this.delimiterRun(pos);
			case '[':
				return this.openBracket(pos, pos + 1);
			case '!':
				return raw[pos + 1] === '[' && pos + 1 < end ? this.openBracket(pos, pos + 2) : pos + 1;
			case ']':
				return this.closeBracket(pos);
			case '<': {
				const autolink = matchAngleAutolink(raw, pos, end);
				if (autolink) return this.leaf(autolink);
				const html = this.rawHtml(pos);
				return html ? this.leaf({ kind: 'rawHtml', start: pos, end: html }) : pos + 1;
			}
			case '\n':
				return this.lineEnd(pos);
			case '@':
				return this.email(pos);
			case 'w':
			case 'W':
			case 'h':
			case 'H':
				return this.bareUrl(pos);
			default:
				return pos + 1;
		}
	}

	private backslash(pos: number): InlineNode | null {
		const { raw, end } = this;
		if (pos + 1 < end && isAsciiPunctuation(raw[pos + 1]))
			return { kind: 'escape', start: pos, end: pos + 2 };
		if (raw[pos + 1] === '\n' && pos + 1 < end)
			return { kind: 'hardLineBreak', start: pos, end: pos + 2 };
		if (raw.startsWith('\r\n', pos + 1) && pos + 2 < end)
			return { kind: 'hardLineBreak', start: pos, end: pos + 3 };
		return null;
	}

	/** The end of the backtick run at `pos`, and where its closing run starts (-1 for none). */
	private backtickRun(pos: number): [after: number, close: number] {
		let after = pos;
		while (after < this.end && this.raw[after] === '`') after++;
		const { readers } = this;
		const closers = (readers.closers ??= backtickRuns(this.raw, readers.start, this.end));
		return [after, closers(after, after - pos)];
	}

	private backticks(pos: number): number {
		const [after, close] = this.backtickRun(pos);
		if (close < 0) return after;
		const text = this.raw.slice(after, close);
		return this.leaf({ kind: 'inlineCode', start: pos, end: close + after - pos, text });
	}

	private delimiterRun(pos: number): number {
		const { raw } = this;
		const char = raw[pos];
		let after = pos;
		while (after < this.end && raw[after] === char) after++;
		const length = after - pos;
		if (char === '~' && length > 2) return after;
		const before = codePointBefore(raw, pos);
		const next = codePointAt(raw, after);
		const [spaceBefore, spaceAfter] = [isUnicodeWhitespace(before), isUnicodeWhitespace(next)];
		const [punctBefore, punctAfter] = [isUnicodePunctuation(before), isUnicodePunctuation(next)];
		const left = !spaceAfter && (!punctAfter || spaceBefore || punctBefore);
		const right = !spaceBefore && (!punctBefore || spaceAfter || punctAfter);
		const canOpen = char === '_' ? left && (!right || punctBefore) : left;
		const canClose = char === '_' ? right && (!left || punctAfter) : right;
		if (!canOpen && !canClose) return after;
		const t = token(pos, after);
		this.push(t, char === '_');
		this.delimiters.push({ token: t, char, length, count: length, canOpen, canClose });
		return after;
	}

	private lineEnd(pos: number): number {
		const { raw } = this;
		const lineEnd = raw[pos - 1] === '\r' && pos - 1 >= this.pending ? pos - 1 : pos;
		let spaces = lineEnd;
		while (spaces > this.pending && raw[spaces - 1] === ' ') spaces--;
		return lineEnd - spaces >= 2
			? this.leaf({ kind: 'hardLineBreak', start: spaces, end: pos + 1 })
			: pos + 1;
	}

	private openBracket(pos: number, textStart: number): number {
		this.push(token(pos, textStart));
		const enclosing = this.brackets.at(-1);
		if (enclosing) enclosing.bracketAfter = true;
		const shape = this.awaitingLabel?.labelOpen === pos ? this.awaitingLabel : undefined;
		this.awaitingLabel = undefined;
		this.brackets.push({
			token: this.tokens.length - 1,
			start: pos,
			textStart,
			image: textStart - pos === 2,
			id: this.bracketIds++,
			bracketAfter: false,
			delimiters: this.delimiters.top,
			...(shape ? { shape } : {})
		});
		return textStart;
	}

	private closeBracket(pos: number): number {
		const opener = this.brackets.pop();
		if (!opener) return pos + 1;
		const active = opener.image || opener.id >= this.linksBefore;
		const reference = active ? this.referenceLabel(opener, pos) : null;
		const target = active
			? (readInlineTail(this.raw, pos + 1, this.end) ?? this.resolve(reference))
			: null;
		if (this.isProbe && opener.start === this.start) {
			this.probed = target !== null;
			return pos + 1;
		}
		const closing = token(pos, target ? target.end : pos + 1);
		if (!target) {
			this.push(closing);
			if (opener.shape?.labelClose === pos)
				this.shapes.push({ ...opener.shape, endToken: this.tokens.length - 1 });
			if (reference?.shape) this.awaitingLabel = { ...reference.shape, startToken: opener.token };
			return pos + 1;
		}
		const node = this.target(opener, pos, target);
		const opening = this.tokens[opener.token];
		opening.litStart = opening.litEnd;
		closing.litStart = closing.litEnd;
		openWrapper(opening, node);
		closeWrapper(closing);
		this.push(closing);
		this.delimiters.process(opener.delimiters);
		if (!opener.image) {
			this.linksBefore = this.bracketIds;
			this.revertEmails(opener.token);
		}
		return target.end;
	}

	private target(opener: Bracket, pos: number, { url, title, label, end }: Target): InlineNode {
		const fields = {
			start: opener.start,
			end,
			children: [],
			url,
			...(title !== undefined ? { title } : {})
		};
		const labelled = label === undefined ? fields : { ...fields, label };
		if (!opener.image) return { kind: 'link', ...labelled };
		const { displayAlt, ...hint } = readSizeHint(this.raw.slice(opener.textStart, pos));
		return { kind: 'image', ...labelled, alt: displayAlt, ...hint };
	}

	/** The reference label after the `]` at `pos`: the full form's, or the text's for the collapsed
	 *  and shortcut forms; null when there is none to look up. */
	private referenceLabel(opener: Bracket, pos: number): Reference | null {
		if (!this.resolver) return null;
		const { raw } = this;
		const close = labelEnd(raw, pos + 1, this.end);
		const full = close > pos + 3;
		let written: string;
		if (full) written = raw.slice(pos + 2, close - 1);
		else if (!opener.bracketAfter && labelEnd(raw, opener.textStart - 1, this.end) === pos + 1) {
			written = raw.slice(opener.textStart, pos);
		} else return null;
		const key = labelKey(written);
		if (!key) return null;
		if (!full && close !== pos + 3) return { written, key, end: pos + 1 };
		const node: InlineNode = {
			kind: 'unresolvedReference',
			start: opener.start,
			end: close,
			label: key,
			refKind: opener.image ? 'image' : 'link'
		};
		return {
			written,
			key,
			end: close,
			shape: { endToken: -1, labelOpen: pos + 1, labelClose: close - 1, node }
		};
	}

	private resolve(reference: Reference | null): Target | null {
		const hit = reference && this.resolver!(reference.written);
		if (!reference || !hit) return null;
		return {
			url: hit.url,
			...(hit.title !== undefined ? { title: hit.title } : {}),
			label: reference.key,
			end: reference.end
		};
	}

	/** A link's text holds no bare email: the ones found while its bracket was open go back to text. */
	private revertEmails(fromToken: number): void {
		for (let i = fromToken + 1; i < this.tokens.length; i++) {
			const t = this.tokens[i];
			if (!this.bareEmails.has(t)) continue;
			delete t.node;
			t.litStart = t.start;
		}
	}

	private bareUrl(pos: number): number {
		const { raw } = this;
		if (this.brackets.length > 0 || (pos > this.start && !isAutolinkBoundary(raw[pos - 1])))
			return pos + 1;
		const url = readBareUrl(raw, pos, this.end, (at) => this.urlAdvance(at));
		return url ? this.leaf(url) : pos + 1;
	}

	/** Where a bare url continues past `at`, or -1 where a construct that ends it starts. */
	private urlAdvance(at: number): number {
		if (this.handlerClaim(at)) return -1;
		switch (this.raw[at]) {
			case '[':
				return this.mayOpenLink(at) ? -1 : at + 1;
			case '&':
				return matchCharRef(this.raw, at, this.end) ? -1 : at + 1;
			case '\\':
				return this.backslash(at) ? -1 : at + 1;
			case '`': {
				const [after, close] = this.backtickRun(at);
				return close < 0 ? after : -1;
			}
			default:
				return at + 1;
		}
	}

	/** Whether the `[` at `at` may open a link (or a reference shape), which a bare url ends before;
	 *  a GFM url keeps every other bracket. Reading one label ahead keeps the question local. */
	private mayOpenLink(at: number): boolean {
		const { raw, end, resolver } = this;
		const close = labelEnd(raw, at, end);
		if (close === STILL_OPEN) return false;
		// A nested bracket, a long label, or a `]` something inside may hide: only the bracket reading knows.
		if (close < 0 || this.mayHideBracket(at + 1, close - 1)) return true;
		if (raw[close] === '(' && readInlineTail(raw, close, end)) return true;
		if (!resolver) return false;
		if (raw[close] === '[' && labelEnd(raw, close, end) > 0) return true;
		return resolver(raw.slice(at + 1, close - 1)) !== undefined;
	}

	/** Whether a code span, a tag or plugin syntax starting in `[from, bracket)` may run over the
	 *  `]` at `bracket`. */
	private mayHideBracket(from: number, bracket: number): boolean {
		for (let i = from; i < bracket; i++) {
			if (this.raw[i] === '`' || this.raw[i] === '<') return true;
			const claimed = this.handlerClaim(i);
			if (claimed && claimed.node.end > bracket) return true;
		}
		return false;
	}

	private email(at: number): number {
		const { raw } = this;
		const { start, xmpp } = emailStart(raw, at, this.emailFloor);
		if (start === at || (start > this.start && !isAutolinkBoundary(raw[start - 1]))) return at + 1;
		const end = emailEnd(raw, at, this.end, xmpp);
		if (end < 0) return at + 1;
		this.retract(start);
		const bytes = raw.slice(start, end);
		const url = /^(mailto|xmpp):/.test(bytes) ? bytes : 'mailto:' + bytes;
		const t = token(start, end, { kind: 'autolink', start, end, url });
		this.push(t);
		this.bareEmails.add(t);
		return end;
	}

	/** Takes back the tokens an email's local part reached over: text and `_` runs. */
	private retract(start: number): void {
		const { tokens, delimiters } = this;
		while (tokens.length > 0 && tokens[tokens.length - 1].start >= start) tokens.pop();
		const last = tokens.at(-1);
		if (last && last.end > start) last.end = last.litEnd = start;
		while (delimiters.top && delimiters.top.token.start >= start) delimiters.remove(delimiters.top);
		this.pending = Math.min(this.pending, start);
	}
}
