// An example of an inline handler that creates a built-in kind from syntax of its own:
// `![[path|width]]` becomes a real `image`, so the widget, the caret and the resize handles all
// work. `rewriteImage` is the point: without it a resize would write GFM over the embed.
import {
	definePlugin,
	registerInlineSyntax,
	INLINE_PRIORITIES,
	type ImageFields,
	type InlineNode
} from '$lib/plugin';

const EMBED = /^!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/;
// The two grammars overlap: `![[a]](u)` is a built-in image whose alt is `[a]`, and a handler
// consulted first has to turn that one down itself.
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

// An embed names only a target and a width, so a title, a label, or an alt edited away from the
// target cannot be written here: this declines instead of falling back to GFM.
function rewriteImage(source: string, fields: ImageFields): string | null {
	if (!source.startsWith('![[')) return null;
	if (fields.title !== undefined || fields.label !== undefined) return null;
	if (fields.alt !== fields.url) return null;
	return `![[${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
}
