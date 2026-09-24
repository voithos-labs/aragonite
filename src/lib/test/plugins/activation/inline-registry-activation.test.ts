// @vitest-environment jsdom
//
// Miss-analysis: every inline plugin test scanned through the process-wide registry, and the
// two-editor page listed no inline plugin, so nothing ever scanned a trigger in an editor that
// left its plugin out, and the unowned registries reached every editor (GH #266).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginInlineKind } from '$lib/schema/plugin-kind';
import { registerInlineSyntax } from '$lib/core/inline/scan/plugin-syntax';
import { registerInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { parseInline } from '$lib/core/inline';
import { renderInlineNodes } from '$lib/core/inline-render';
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import type { InlineNode } from '$lib/core/nodes';
import { grammarListing } from './grammar-listing';

const MARK = 'caret-mark';

const unlisted = definePlugin({
	name: 'unlisted',
	setup() {
		const kind = declarePluginInlineKind(MARK);
		registerInlineSyntax('^', (raw, pos, end) =>
			pos + 2 <= end ? { kind, start: pos, end: pos + 2 } : null
		);
		registerInlineWidgetKind(kind, {
			isWidget: () => true,
			buildWidget: () => document.createElement('span')
		});
	}
});
const listed = definePlugin({ name: 'listed', setup() {} });

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([listed, unlisted]);
});
afterEach(resetPluginPlatformForTests);

const SOURCE = 'a ^x b';
const kindsIn = (grammar: GrammarView) =>
	parseInline(SOURCE, 0, SOURCE.length, undefined, grammar).map((n) => n.kind);

function renderMark(grammar: GrammarView): DocumentFragment {
	const node: InlineNode = { kind: MARK as InlineNode['kind'], start: 2, end: 4 };
	return renderInlineNodes([node], SOURCE, { grammar });
}

describe("an unlisted plugin's inline syntax stays text", () => {
	it('does not run the recognizer in an editor that left the plugin out', () => {
		expect(kindsIn(grammarListing(['listed']))).toEqual(['text']);
	});

	it('runs it where every installed plugin is active', () => {
		expect(kindsIn(defaultGrammarView)).toContain(MARK);
	});
});

describe("an unlisted plugin's widget kind renders as its source", () => {
	it('builds no widget in an editor that left the plugin out', () => {
		const fragment = renderMark(grammarListing(['listed']));
		expect(fragment.querySelector('[data-inline-widget]')).toBeNull();
		expect(fragment.textContent).toBe('^x');
	});

	it('builds the widget where every installed plugin is active', () => {
		expect(renderMark(defaultGrammarView).textContent).toBe('');
	});
});
