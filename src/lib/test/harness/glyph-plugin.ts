// A `:name:` glyph on the process-wide inline registrars: a widget drawn as plain DOM that shows a
// character in place of its bytes, deleted whole and stepped over, on the bare `:` that directive
// text also reads. The suites about those registrars take it as their fixture.
import {
	INLINE_PRIORITIES,
	declarePluginInlineKind,
	definePlugin,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type EditorPlugin,
	type InlineNode
} from '#lib/plugin.js';

export const GLYPH_KIND = 'harness-glyph';
export const GLYPH_PRIORITY = INLINE_PRIORITIES.plugin + 10;

const GLYPHS = new Map([
	['smile', '😄'],
	['rocket', '🚀']
]);

function claimGlyph(raw: string, pos: number, end: number, kind: InlineNode['kind']) {
	const close = raw.indexOf(':', pos + 1);
	if (close === -1 || close >= end) return null;
	const glyph = GLYPHS.get(raw.slice(pos + 1, close));
	return glyph === undefined ? null : { kind, start: pos, end: close + 1, decoded: glyph };
}

export function glyphPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-glyph',
		setup() {
			const kind = declarePluginInlineKind(GLYPH_KIND);
			registerInlineSyntax(':', (raw, pos, end) => claimGlyph(raw, pos, end, kind), {
				// Directive text holds `:` at the plugin priority, so the glyph takes the next one.
				priority: GLYPH_PRIORITY
			});
			registerInlineWidgetKind(kind, {
				isWidget: () => true,
				view: (shell, { inline }) => {
					shell.textContent = inline.decoded ?? '';
					return {};
				},
				editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
			});
		}
	});
}
