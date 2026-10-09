/**
 * `[[note]]` links inside the text, limestone's integration reproduced here: a `[[` recognizer
 * declares a plugin inline kind whose widget paints the note's name, follows on a plain click
 * (`plainClickActivates`) and shows its source when the caret arrows in (`revealSource`). The
 * widget asks the editor's `isActivationClick` prop, as a host's link component would.
 */
import {
	definePlugin,
	declarePluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	INLINE_PRIORITIES,
	type EditorPlugin,
	type InlineNode
} from '#lib/plugin.js';
import WikiLink from './WikiLink.svelte';

export const WIKILINK_KIND = 'harness-wikilink';

export function wikiLinksPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-wikilinks',
		setup() {
			const link = declarePluginInlineKind(WIKILINK_KIND);
			registerInlineSyntax(
				'[',
				(raw, pos, end): InlineNode | null => {
					const span = recognizeWikiLink(raw, pos, end);
					return span ? { kind: link, start: span.start, end: span.end, text: span.inner } : null;
				},
				{ prefix: '[[', priority: INLINE_PRIORITIES.prefixOverride }
			);
			registerInlineWidgetKind(link, {
				isWidget: () => true,
				component: WikiLink,
				editing: { revealSource: true, claimsActivationClick: true, plainClickActivates: true }
			});
		}
	});
}

// `[[name]]` on one line, with no `[` inside and a name that isn't blank
function recognizeWikiLink(
	raw: string,
	pos: number,
	end: number
): { start: number; end: number; inner: string } | null {
	if (!raw.startsWith('[[', pos)) return null;
	for (let i = pos + 2; i < end; i++) {
		const ch = raw[i];
		if (ch === '\n' || ch === '[') return null;
		if (ch === ']') {
			if (raw[i + 1] !== ']' || i + 1 >= end) return null;
			const inner = raw.slice(pos + 2, i);
			return inner.trim() ? { start: pos, end: i + 2, inner } : null;
		}
	}
	return null;
}
