/**
 * In-body tags, limestone's own integration reproduced here: a bare `#` trigger declares a plugin
 * inline kind whose widget paints the tag and whose source shows for editing. The registration
 * matches limestone's value for value (`revealSource`, `claimsActivationClick`), so what these
 * tests pin is what that app gets.
 */
import {
	definePlugin,
	declarePluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type EditorPlugin,
	type InlineNode
} from '$lib/plugin';
import BodyTag from './BodyTag.svelte';
import { recognizeTag } from './tag-scan';

export const BODY_TAG_KIND = 'harness-tag';

export function tagsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-tags',
		setup() {
			const tag = declarePluginInlineKind(BODY_TAG_KIND);
			// No built-in claims `#`, so this registers at the default plugin priority with no
			// prefix of its own.
			registerInlineSyntax('#', (raw, pos, end): InlineNode | null => {
				const span = recognizeTag(raw, pos, end);
				return span ? { kind: tag, start: span.start, end: span.end, text: span.name } : null;
			});
			registerInlineWidgetKind(tag, {
				isWidget: () => true,
				component: BodyTag,
				editing: { revealSource: true, claimsActivationClick: true }
			});
		}
	});
}
