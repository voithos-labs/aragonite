/**
 * Dogfood for in-body tags, limestone's own integration reproduced here: a bare `#` trigger
 * mints a plugin inline kind whose widget paints the tag and whose source reveals for editing.
 * The registration is limestone's value for value (`revealSource`, `claimsActivationClick`), so
 * what this battery pins is what that app gets.
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
			// `#` is no built-in's trigger, so the default plugin rung takes it with no prefix
			// or priority of its own.
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
