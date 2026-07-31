// Dogfood for an inline rung that mints a BUILT-IN kind over syntax of its own:
// `![[path|width]]` becomes a real `image`, so widget, caret, and resize handles all
// work. `rewriteImage` is the point — without it a resize writes GFM over the embed.
import {
	definePlugin,
	registerInlineSyntax,
	INLINE_PRIORITIES,
	type ImageFields,
	type InlineNode
} from '$lib/plugin';

const EMBED = /^!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/;
// The grammars overlap: `![[a]](u)` is a built-in image whose alt is `[a]`, and a
// rung consulted ahead of the switch has to decline that one itself.
const IMAGE_TARGET = /\.(png|jpg|svg)$/;

export const wikiEmbedPlugin = definePlugin({
	name: 'wiki-embed',
	setup() {
		registerInlineSyntax('!', recognizeEmbed, {
			prefix: '![[',
			priority: INLINE_PRIORITIES.prefixOverride,
			rewriteImage
		});
	}
});

function recognizeEmbed(raw: string, pos: number, end: number): InlineNode | null {
	const match = EMBED.exec(raw.slice(pos, end));
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

// An embed names only a target and a width, so a title, a label, or an alt edited away
// from the target has no form here and declines rather than escaping into GFM. Ignoring
// the alt case instead would return byte-identical bytes the commit's guard drops silently.
function rewriteImage(source: string, fields: ImageFields): string | null {
	if (!source.startsWith('![[')) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	if (fields.alt !== fields.url) return null;
	return `![[${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}
