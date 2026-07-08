import { describe, it, expect } from 'vitest';
import * as pluginBarrel from '$lib/plugin';
import { registerInlineSyntax } from '$lib/core/inline/scan/plugin-syntax';
import { registerInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { declarePluginInlineKind, declaredPluginInlineKind } from '$lib/schema/plugin-kind';
import type {
	InlineSyntaxRecognizer,
	InlineWidgetDescriptor,
	InlineWidgetEditingPolicy,
	InlineWidgetEditingContext,
	PluginInlineKind
} from '$lib/plugin';

// The inline authoring surface is unstable (pre-freeze). This probe pins the
// symbols a plugin imports from `aragonite/plugin` to their core implementations,
// so a dropped or mis-wired re-export fails here rather than in a downstream plugin.
describe('aragonite/plugin inline authoring surface', () => {
	it('re-exports the inline registration functions from their core modules', () => {
		expect(pluginBarrel.registerInlineSyntax).toBe(registerInlineSyntax);
		expect(pluginBarrel.registerInlineWidgetKind).toBe(registerInlineWidgetKind);
	});

	it('re-exports the inline-kind mint and lookup', () => {
		expect(pluginBarrel.declarePluginInlineKind).toBe(declarePluginInlineKind);
		expect(pluginBarrel.declaredPluginInlineKind).toBe(declaredPluginInlineKind);
	});

	it('keeps the internal inline seams off the barrel', () => {
		for (const seam of [
			'augmentInlineWidgetKind',
			'getInlineWidgetEditing',
			'getInlineSyntax',
			'hasInlineSyntax',
			'__resetInlineSyntaxForTests',
			'__resetInlineWidgetsForTests'
		]) {
			expect(pluginBarrel).not.toHaveProperty(seam);
		}
	});

	it('exposes the widget-authoring types (compile-time contract)', () => {
		const recognizer: InlineSyntaxRecognizer = () => null;
		const editing: InlineWidgetEditingPolicy = { deleteGranularity: 'atomic', onEdge: 'step-over' };
		const descriptor: InlineWidgetDescriptor = { isWidget: () => false, editing };
		const widgetStartOf = (ctx: InlineWidgetEditingContext) => ctx.widgetStart;
		const kind: PluginInlineKind | null = null;

		expect(recognizer('', 0, 0)).toBeNull();
		expect(descriptor.isWidget({} as never, '')).toBe(false);
		expect(widgetStartOf).toBeTypeOf('function');
		expect(kind).toBeNull();
	});
});
