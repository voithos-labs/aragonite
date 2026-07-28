/**
 * GitHub `:shortcode:` emoji: a first-class inline kind recognized on the bare `:`
 * trigger and rendered as an atomic glyph widget. The literal `:smile:` bytes stay
 * in the block's raw, so round-trip and portability are untouched; the glyph is the
 * widget's only visible text while `data-source-*` carries the source span.
 *
 * Recognition is gated on registration: with the plugin absent `:smile:` is ordinary
 * prose. The `:` rung sits at `INLINE_PRIORITIES.plugin + 10`, one rung ABOVE the
 * directive text tier's default rung, so both coexist on the same trigger — the
 * disjoint grammars never contest a claim (see the why-comment on the register call).
 */

import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	isInlineKindDeclared,
	mintWidgetShell,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type InlineNode,
	type PluginInlineKind
} from '$lib/plugin';
import { EMOJI_TABLE } from './emoji-table';

export const EMOJI_KIND = 'emoji';

// `[a-z0-9_+-]` — the gemoji shortcode alphabet. Uppercase is excluded, matching
// GitHub (shortcodes are lowercase), and the newline is naturally excluded, so a
// reference never spans a line.
function isShortcodeChar(code: number): boolean {
	return (
		(code >= 0x61 && code <= 0x7a) || // a-z
		(code >= 0x30 && code <= 0x39) || // 0-9
		code === 0x5f || // _
		code === 0x2b || // +
		code === 0x2d // -
	);
}

/**
 * `:shortcode:` recognizer over `raw[pos, end)`, where `pos` is the opening `:`.
 * Scans a non-empty run of shortcode chars up to a closing `:`, then claims
 * `[pos, close + 1)` only on a table hit — carrying the glyph on `decoded`, the
 * decoded-entity mold. Declines (null) on a non-shortcode char, an empty pair, an
 * unterminated run, or an unknown name, each leaving the bytes to the next rung.
 *
 * O(name length) per consultation and allocation-free on the hot decline paths: the
 * name is sliced only once a closing colon has bounded a non-empty run, mirroring the
 * directive recognizer's gated slice.
 */
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

/** The atomic-widget DOM: a `[data-inline-widget]` shell whose text is the glyph and
 *  whose source bytes ride `data-source-*`, so the raw-aware walk reads `:smile:`
 *  back while the DOM shows 😄. `user-select: none` keeps the glyph whole — a caret
 *  never lands inside it — set inline since a `buildWidget` island has no style scope. */
export function buildEmojiWidget(node: InlineNode): HTMLSpanElement {
	const shell = mintWidgetShell('md-emoji-widget', node);
	shell.textContent = node.decoded ?? '';
	shell.style.userSelect = 'none';
	return shell;
}

export function registerEmoji(): void {
	// Keyed on the declared-inline-kind registry, not a module latch: the platform
	// reset that clears the inline syntax/widget registries also clears this key, so a
	// reset → re-register re-runs the whole path cleanly (the footnote-reference mold).
	if (isInlineKindDeclared(EMOJI_KIND)) return;
	const kind = declarePluginInlineKind(EMOJI_KIND);
	registerInlineSyntax(':', (raw, pos, end) => recognizeEmoji(raw, pos, end, kind), {
		// One rung ABOVE the directive text tier's default `plugin` rung (which is
		// consulted first). The register-once grain forbids a second (`:`, `:`, plugin)
		// registration, so the +10 is what lets emoji share the trigger; the disjoint
		// grammars mean the order only decides first refusal, never a contested claim.
		priority: INLINE_PRIORITIES.plugin + 10
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		buildWidget: (node) => buildEmojiWidget(node),
		editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
	});
}
