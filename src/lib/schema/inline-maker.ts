/** `inline`: a plugin's inline construct, claimed at its prefix and drawn as one of four arms. */
import type { ImageFields, InlineNode, PluginInlineKind } from '../core/nodes';
import { isBuiltInTrigger } from '../core/inline/scan/plugin-syntax';
import type { WidgetEditing } from '../core/inline/inline-widgets';
import { checkLocalName } from './block-shapes';
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import {
	madeInline,
	type FunctionMatcher,
	type ImagePiece,
	type Inline,
	type InlineArm,
	type InlineMaking,
	type InlineSpec,
	type LinkPiece,
	type RegexMatcher,
	type Widget
} from './inline-type';

type Common<D> = Omit<InlineSpec<D>, 'match' | 'read'> & InlineArm<D>;

/** Makes an inline construct; a claim starts where the text starts with `prefix`, and is what the
 *  matcher takes there. */
export function inline<D>(spec: Common<D> & RegexMatcher<D>): Inline<D>;
export function inline<D>(spec: Common<D> & FunctionMatcher<D>): Inline<D>;
export function inline<D>(spec: InlineSpec<D>): Inline<D>;
export function inline<D>(spec: InlineSpec<D>): Inline<D> {
	checkLocalName('inline', spec.name);
	const refuse = (why: string): never => {
		throw new Error(`inline '${spec.name}': ${why}`);
	};
	const { prefix } = spec;
	if (prefix === '' || /[\]\r\n]/.test(prefix[0]))
		refuse(`prefix ${JSON.stringify(prefix)} can never be reached`);
	if (prefix.length === 1 && isBuiltInTrigger(prefix)) {
		refuse(`"${prefix}" is read by the editor itself, so the prefix needs a second character`);
	}
	if (spec.pair && prefix.length > 1) refuse('`pair` needs a one-character prefix');
	const claimEnd = matcherOf(spec);
	const read = spec.read as (found: RegExpExecArray | string) => D | null;
	const split = spec.split ?? 'whole';
	// The match and its data at `pos`, or null where the construct declines.
	const take = (raw: string, pos: number, end: number): { end: number; data: D } | null => {
		const found = claimEnd(raw, pos, end);
		if (found === null || found.end < pos + prefix.length) return null;
		const data = read(found.match ?? raw.slice(pos, found.end));
		return data === null ? null : { end: found.end, data };
	};
	const making = {
		local: spec.name,
		label: spec.label,
		prefix,
		after: spec.after === undefined ? [] : 'name' in spec.after ? [spec.after] : spec.after,
		pair: spec.pair ?? false,
		split,
		widget: null,
		className: null
	};
	if ('widget' in spec) {
		return madeInline<D>({
			...making,
			claim: (raw, pos, end, kind) => plainClaim(take(raw, pos, end), pos, kind),
			widget: {
				isWidget: () => true,
				editing: widgetEditing(spec.widget, spec.follow !== undefined, refuse),
				frame: spec.widget.height === 'tall',
				own: {
					draw: spec.draw as never,
					follow: spec.follow as never,
					key: spec.key as never,
					depends: spec.depends
				}
			}
		});
	}
	if (spec.class !== undefined) {
		const claim: InlineMaking['claim'] = (raw, pos, end, kind) =>
			plainClaim(take(raw, pos, end), pos, kind);
		return madeInline<D>({ ...making, claim, className: spec.class, follow: spec.follow as never });
	}
	if (spec.as === 'image') {
		const { image, write } = spec;
		return madeInline<D>({
			...making,
			claim(raw, pos, end) {
				const taken = take(raw, pos, end);
				if (!taken) return null;
				const piece = image(taken.data);
				const rewriteImage =
					write && ((_: string, fields: ImageFields) => imageWrite(fields, taken.data, write));
				return {
					kind: 'image',
					start: pos,
					end: taken.end,
					alt: piece.alt,
					url: piece.src,
					...(piece.title !== null && { title: piece.title }),
					...(piece.width !== null && { width: piece.width }),
					...(piece.height !== null && { height: piece.height }),
					syntaxClaim: { prefix, split, ...(rewriteImage && { rewriteImage }) }
				};
			}
		});
	}
	const { link, write } = spec;
	let warned = false;
	return madeInline<D>({
		...making,
		claim(raw, pos, end, kind) {
			const taken = take(raw, pos, end);
			if (!taken) return null;
			const piece = link(taken.data);
			const claim = raw.slice(pos, taken.end);
			const at = textStart(claim, prefix.length, piece);
			if (at === TWICE && devChecksOn && !warned) {
				warned = true;
				const { text } = piece;
				devWarn(
					'inline-link-text',
					`inline '${kind}': the link text "${text}" shows up twice in "${claim}", so the claim reads as text; give its LinkPiece an \`at\``
				);
			}
			if (at < 0) return null;
			const rewriteLink =
				write &&
				((fields: { text: string; url: string; title?: string }) =>
					write({ href: fields.url, text: fields.text, title: fields.title ?? null }, taken.data));
			return {
				kind: 'link',
				start: pos,
				end: taken.end,
				url: piece.href,
				...(piece.title !== null && { title: piece.title }),
				children: [
					{ kind: 'text', start: pos + at, end: pos + at + piece.text.length, text: piece.text }
				],
				syntaxClaim: { prefix, split, link: true, ...(rewriteLink && { rewriteLink }) }
			};
		}
	});
}

// ── Internal ─────────────────────────────────────────────────────────────────

type ClaimEnd = (
	raw: string,
	pos: number,
	end: number
) => { end: number; match?: RegExpExecArray } | null;

function matcherOf<D>(spec: InlineSpec<D>): ClaimEnd {
	const { match } = spec;
	if (typeof match === 'function') {
		return (raw, pos, end) => {
			const at = match(raw, pos, end);
			return at < 0 ? null : { end: at };
		};
	}
	// Sticky, so a match starts at the prefix and nowhere later; a range shorter than the block
	// reads only its own bytes.
	const sticky = new RegExp(match.source, match.flags.replace(/[gy]/g, '') + 'y');
	return (raw, pos, end) => {
		sticky.lastIndex = pos;
		const found = sticky.exec(end < raw.length ? raw.slice(0, end) : raw);
		return found ? { end: pos + found[0].length, match: found } : null;
	};
}

// Where a link's text starts in its claim: at `at` where the piece says so, else its one run
// after the prefix. -1 where the text isn't there, `TWICE` where it is twice with no `at`.
function textStart(claim: string, prefix: number, piece: LinkPiece): number {
	const { text, at } = piece;
	if (text === '') return -1;
	if (at !== undefined) return claim.startsWith(text, at) ? at : -1;
	const first = claim.indexOf(text, prefix);
	return first < 0 ? -1 : claim.includes(text, first + 1) ? TWICE : first;
}

const TWICE = -2;

function plainClaim<D>(
	taken: { end: number; data: D } | null,
	pos: number,
	kind: PluginInlineKind
): InlineNode | null {
	return taken && { kind, start: pos, end: taken.end, data: taken.data };
}

// An image piece has no crop or reference label, so an edit setting either is refused, never
// written without it.
function imageWrite<D>(
	fields: ImageFields,
	data: D,
	write: (image: ImagePiece, data: D) => string | null
): string | null {
	if (fields.crop !== undefined || fields.label !== undefined) return null;
	const piece: ImagePiece = {
		src: fields.url,
		alt: fields.alt,
		title: fields.title ?? null,
		width: fields.width ?? null,
		height: fields.height ?? null
	};
	return write(piece, data);
}

/** The widget's fields as the editing policy the editor's widget routes read. */
function widgetEditing(
	widget: Widget,
	follows: boolean,
	refuse: (why: string) => never
): WidgetEditing {
	if ((widget.click === 'follow') !== follows) {
		refuse("`click: 'follow'` and `follow` go together");
	}
	const showsOnArrow = widget.arrows === 'into';
	const showsOnClick = widget.click === 'source' || (widget.click === 'follow' && showsOnArrow);
	const { inner, caret } = widget;
	return {
		deleteGranularity: widget.delete === 'whole' ? 'atomic' : 'select-then-delete',
		...(widget.arrows !== 'into' && {
			onEdge: widget.arrows === 'over' ? ('step-over' as const) : ('select' as const)
		}),
		...((showsOnArrow || showsOnClick) && {
			revealSource: true,
			...(showsOnArrow !== showsOnClick && {
				revealOn: showsOnArrow ? ('arrows' as const) : ('click' as const)
			})
		}),
		claimsActivationClick: widget.click === 'follow',
		...(inner && { revealContentSpan: inner }),
		...(caret && {
			revealOffsetAtPoint: (el: HTMLElement, _source: string, x: number, y: number) =>
				caret(el, { x, y })
		})
	};
}
