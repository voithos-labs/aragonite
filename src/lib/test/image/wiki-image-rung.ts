/**
 * A minimal `![[target|width]]` rung minting built-in `image` nodes — the shape a
 * consumer's Obsidian-style embed plugin registers, and the fixture every
 * claimed-image suite drives. Registered per test with or without its rewrite
 * hook, because "claimed and rewritable" and "claimed and not" are the two halves
 * of the contract.
 */

import type { ImageFields, InlineNode } from '../../core/nodes';
import { registerInlineSyntax, INLINE_PRIORITIES } from '../../core/inline/scan/plugin-syntax';

const WIKI_EMBED = /^!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/;
// The two grammars overlap — `![[a]](u)` is a built-in image whose alt is `[a]` —
// and the rung, consulted first, has to decline that one itself.
const IMAGE_TARGET = /\.(png|jpg|svg)$/;

export function recognizeWikiImage(raw: string, pos: number, end: number): InlineNode | null {
	const match = WIKI_EMBED.exec(raw.slice(pos, end));
	if (!match || !IMAGE_TARGET.test(match[1])) return null;
	const [claimed, target, width] = match;
	return {
		kind: 'image',
		start: pos,
		end: pos + claimed.length,
		alt: target,
		url: target,
		...(width !== undefined ? { width: Number(width) } : {})
	};
}

/** `![[…]]` carries a target and an optional width and nothing else, so a title
 *  or a reference label has no form in this grammar and the hook declines. */
export function rewriteWikiImage(source: string, fields: ImageFields): string | null {
	if (!source.startsWith('![[')) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	return `![[${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}

export function registerWikiRung(rewriteImage?: typeof rewriteWikiImage): void {
	registerInlineSyntax('!', recognizeWikiImage, {
		prefix: '![[',
		priority: INLINE_PRIORITIES.prefixOverride,
		...(rewriteImage !== undefined ? { rewriteImage } : {})
	});
}
