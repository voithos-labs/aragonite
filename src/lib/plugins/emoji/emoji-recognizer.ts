/**
 * GitHub `:shortcode:` emoji as an inline kind with an atomic glyph widget. The
 * literal `:smile:` bytes stay in the block's raw, so round-trip and portability are
 * untouched; the glyph is only what the widget paints. Recognition is gated on
 * registration, so with the plugin absent `:smile:` is ordinary prose.
 */

import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	mintWidgetShell,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type InlineNode,
	type PluginInlineKind
} from '$lib/plugin';
import { EMOJI_TABLE } from './emoji-table';

export const EMOJI_KIND = 'emoji';

// The gemoji alphabet: uppercase is excluded to match GitHub, and excluding the
// newline is what keeps a reference from spanning a line.
function isShortcodeChar(code: number): boolean {
	return (
		(code >= 0x61 && code <= 0x7a) || // a-z
		(code >= 0x30 && code <= 0x39) || // 0-9
		code === 0x5f || // _
		code === 0x2b || // +
		code === 0x2d // -
	);
}

/** Matches only a shortcode in the table, carrying the glyph on `decoded` as an entity does; the
 *  name is sliced only once a closing colon bounds it, so a miss allocates nothing. */
export function recognizeEmoji(
	raw: string,
	pos: number,
	end: number,
	kind: PluginInlineKind
): InlineNode | null {
	let i = pos + 1;
	while (i < end && raw.charCodeAt(i) !== 0x3a) {
		if (!isShortcodeChar(raw.charCodeAt(i))) return null;
		i++;
	}
	if (i >= end || i === pos + 1) return null;
	const glyph = EMOJI_TABLE.get(raw.slice(pos + 1, i));
	if (glyph === undefined) return null;
	return { kind, start: pos, end: i + 1, decoded: glyph };
}

/** `user-select: none` keeps the caret from entering the glyph; set inline because a widget
 *  built by `buildWidget` has no scoped stylesheet. */
export function buildEmojiWidget(node: InlineNode): HTMLSpanElement {
	const shell = mintWidgetShell('md-emoji-widget', node);
	shell.textContent = node.decoded ?? '';
	shell.style.userSelect = 'none';
	return shell;
}

export function registerEmoji(): void {
	const kind = declarePluginInlineKind(EMOJI_KIND);
	registerInlineSyntax(':', (raw, pos, end) => recognizeEmoji(raw, pos, end, kind), {
		// Registering `:` twice at the same priority is refused, so the +10 is what lets emoji
		// share the trigger with the directive text handler.
		priority: INLINE_PRIORITIES.plugin + 10
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		buildWidget: (node) => buildEmojiWidget(node),
		editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
	});
}
