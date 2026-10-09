// What you'd go to at an offset: the link the card edits (live mode only) or a widget the offset
// touches whose kind claims the activation click. Mod+K and the "Edit link" menu row read this.
// Miss-analysis: Mod+K only knew links, so a widget that followed on a click had no editing path
// but the arrow keys, and no test asked what Mod+K does beside one.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { registerInlineSyntax } from '#lib/core/inline/scan/plugin-syntax.js';
import { registerInlineWidgetKind } from '#lib/core/inline/inline-widgets.js';
import { declarePluginInlineKind } from '#lib/schema/plugin-kind.js';
import { followTargetAt } from '#lib/components/blocks/text/link-at-point.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

// `[a](https://e.com)` spans 2..20 and `%%w%%` 21..26.
const SOURCE = 'x [a](https://e.com) %%w%% y\n';

function registerWidget(claimsActivationClick: boolean): void {
	const kind = declarePluginInlineKind('followTargetWidget');
	registerInlineSyntax('%', (raw, pos, end) => {
		if (!raw.startsWith('%%', pos)) return null;
		const close = raw.indexOf('%%', pos + 2);
		if (close < 0 || close + 2 > end) return null;
		return { kind, start: pos, end: close + 2, children: [] };
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		buildWidget: () => document.createElement('span'),
		editing: { revealSource: true, claimsActivationClick }
	});
}

function targetAt(offset: number, mode: PresentationMode) {
	const node = parse(SOURCE).children[0];
	const hit = followTargetAt(node, offset, fixtureReading({}, mode));
	if (hit === null) return null;
	return hit.edit === 'card' ? `link@${hit.link.start}` : `widget@${hit.widget.start}`;
}

describe('followTargetAt', () => {
	it('finds the link around the offset in live mode only, where the card edits it', () => {
		registerWidget(true);
		expect(targetAt(3, 'live')).toBe('link@2');
		expect(targetAt(3, 'source')).toBeNull();
		expect(targetAt(3, 'preview-inline')).toBeNull();
	});

	it('finds a claiming widget the offset touches, from either edge, in every editable mode', () => {
		registerWidget(true);
		for (const mode of ['live', 'source', 'preview-block', 'preview-inline'] as const) {
			expect(targetAt(21, mode), mode).toBe('widget@21');
			expect(targetAt(26, mode), mode).toBe('widget@21');
		}
		expect(targetAt(21, 'reading')).toBeNull();
	});

	it('finds nothing at plain text, or at a widget whose kind claims no click', () => {
		registerWidget(false);
		expect(targetAt(0, 'live')).toBeNull();
		expect(targetAt(28, 'live')).toBeNull();
		expect(targetAt(21, 'live')).toBeNull();
	});
});
