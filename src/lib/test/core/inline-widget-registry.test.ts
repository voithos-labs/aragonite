import { afterEach, describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import {
	registerInlineWidgetKind,
	isInlineWidget,
	__resetInlineWidgetsForTests
} from '../../core/inline/inline-widgets';

// A kind the registry has never seen, cast through the closed inline-kind union
// the way a real inline-widget plugin would.
const PLUGIN_KIND = 'test-inline-widget' as InlineNode['kind'];
const pluginNode = { kind: PLUGIN_KIND, start: 0, end: 3 } as InlineNode;
const imageNode: InlineNode = { kind: 'image', start: 0, end: 6, alt: '', url: 'x' };

describe('registerInlineWidgetKind — register-once', () => {
	afterEach(__resetInlineWidgetsForTests);

	it('rejects re-registering the built-in image kind, leaving it intact', () => {
		expect(() => registerInlineWidgetKind('image', { isWidget: () => false })).toThrow(
			/register-once|already registered/i
		);
		// The rejected re-registration never took: image still recognizes as a widget.
		expect(isInlineWidget(imageNode, '![](x)')).toBe(true);
	});

	it('registers a fresh plugin kind once, then rejects a duplicate', () => {
		registerInlineWidgetKind(PLUGIN_KIND, { isWidget: () => true });
		expect(isInlineWidget(pluginNode, 'xxx')).toBe(true);
		expect(() => registerInlineWidgetKind(PLUGIN_KIND, { isWidget: () => false })).toThrow(
			/register-once|already registered/i
		);
	});
});

describe('__resetInlineWidgetsForTests', () => {
	afterEach(__resetInlineWidgetsForTests);

	it('clears plugin kinds but keeps the built-ins', () => {
		registerInlineWidgetKind(PLUGIN_KIND, { isWidget: () => true });
		expect(isInlineWidget(pluginNode, 'xxx')).toBe(true);

		__resetInlineWidgetsForTests();

		expect(isInlineWidget(pluginNode, 'xxx')).toBe(false);
		expect(isInlineWidget(imageNode, '![](x)')).toBe(true);
	});
});
