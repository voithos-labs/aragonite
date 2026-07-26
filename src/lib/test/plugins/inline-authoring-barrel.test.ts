import { describe, it, expect } from 'vitest';
import * as pluginBarrel from '$lib/plugin';
import { registerInlineSyntax } from '$lib/core/inline/scan/plugin-syntax';
import { registerInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	isInlineKindDeclared,
	__clearDeclaredPluginInlineKindsForTests
} from '$lib/schema/plugin-kind';
import type {
	InlineSyntaxRecognizer,
	InlineWidgetDescriptor,
	InlineWidgetEditingPolicy,
	InlineWidgetEditingContext,
	PluginInlineKind,
	InlineNode
} from '$lib/plugin';

// The inline authoring surface is unstable (pre-freeze). This probe pins the
// symbols a plugin imports from `aragonite/plugin` to their core implementations,
// so a dropped or mis-wired re-export fails here rather than in a downstream plugin.
describe('aragonite/plugin inline authoring surface', () => {
	it('re-exports the inline registration functions from their core modules', () => {
		expect(pluginBarrel.registerInlineSyntax).toBe(registerInlineSyntax);
		expect(pluginBarrel.registerInlineWidgetKind).toBe(registerInlineWidgetKind);
	});

	it('re-exports the inline-kind mint, lookup, and idempotence probe', () => {
		expect(pluginBarrel.declarePluginInlineKind).toBe(declarePluginInlineKind);
		expect(pluginBarrel.declaredPluginInlineKind).toBe(declaredPluginInlineKind);
		expect(pluginBarrel.isInlineKindDeclared).toBe(isInlineKindDeclared);
	});

	it('isInlineKindDeclared probes the declared-set without throwing', () => {
		__clearDeclaredPluginInlineKindsForTests();
		expect(pluginBarrel.isInlineKindDeclared('probe-kind')).toBe(false);
		declarePluginInlineKind('probe-kind');
		expect(pluginBarrel.isInlineKindDeclared('probe-kind')).toBe(true);
		__clearDeclaredPluginInlineKindsForTests();
	});

	it('keeps the internal inline seams off the barrel', () => {
		for (const seam of [
			'augmentInlineWidgetKind',
			'getInlineWidgetEditing',
			'getInlineWidgetComponent',
			'hasInlineSyntax',
			'hasPrefixRungs',
			'hasScanProbeRungs',
			'isScanProbeTrigger',
			'getInlineRungs',
			'getUnreservedRungs',
			'getPrefixRungs',
			'__resetInlineSyntaxForTests',
			'__resetInlineWidgetsForTests'
		]) {
			expect(pluginBarrel).not.toHaveProperty(seam);
		}
	});

	it('exposes the widget-authoring types (compile-time contract)', () => {
		const recognizer: InlineSyntaxRecognizer = () => null;
		const editing: InlineWidgetEditingPolicy = { revealSource: true };
		const descriptor: InlineWidgetDescriptor = { isWidget: () => false, editing };
		const widgetStartOf = (ctx: InlineWidgetEditingContext) => ctx.widgetStart;
		const kind: PluginInlineKind | null = null;
		const node: InlineNode = { kind: 'math' as PluginInlineKind, start: 0, end: 0 };

		expect(recognizer('', 0, 0)).toBeNull();
		expect(descriptor.isWidget({} as never, '')).toBe(false);
		expect(widgetStartOf).toBeTypeOf('function');
		expect(kind).toBeNull();
		expect(node.start).toBe(0);
	});
});
