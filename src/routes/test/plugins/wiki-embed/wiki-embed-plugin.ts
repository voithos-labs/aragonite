// An `inline()` construct that reads as a built-in image in syntax of its own: `![[path|width]]`
// is a real `image`, so the widget, the caret and the resize handles all work. `write` is the
// point: without it a resize would be refused rather than written as GFM over the embed.
import { definePlugin, inline } from '#lib/plugin.js';

const EMBED = /!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/;
const IMAGE_TARGET = /\.(png|jpg|svg)$/;

const embed = inline({
	name: 'embed',
	label: 'Embed',
	prefix: '![[',
	match: EMBED,
	read: ([, target, width]) =>
		IMAGE_TARGET.test(target)
			? { target, width: width === undefined ? null : Number(width) }
			: null,
	sample: '![[a.png|400]]',
	as: 'image',
	image: ({ target, width }) => ({ src: target, alt: target, title: null, width, height: null }),
	// An embed names only a target and a width, so a title or an alt edited away from the target
	// can't be written here: it declines instead of falling back to GFM.
	write: (image) =>
		image.title !== null || image.alt !== image.src
			? null
			: `![[${image.src}${image.width !== null ? `|${image.width}` : ''}]]`
});

export const wikiEmbedPlugin = definePlugin({
	name: 'wiki-embed',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [embed] })
});
