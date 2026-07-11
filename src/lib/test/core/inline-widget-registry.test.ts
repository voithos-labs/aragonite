// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import type { Component } from 'svelte';
import type { InlineNode } from '../../core/nodes';
import {
	registerInlineWidgetKind,
	isInlineWidget,
	getInlineWidgetComponent,
	type InlineWidgetComponentProps,
	__resetInlineWidgetsForTests
} from '../../core/inline/inline-widgets';

// A kind the registry has never seen, cast through the closed inline-kind union
// the way a real inline-widget plugin would.
const PLUGIN_KIND = 'test-inline-widget' as InlineNode['kind'];
const pluginNode = { kind: PLUGIN_KIND, start: 0, end: 3 } as InlineNode;
const imageNode: InlineNode = { kind: 'image', start: 0, end: 6, alt: '', url: 'x' };
// Truthy stand-in; the mutual-exclusion guard reads only its presence.
const FakeComponent = (() => {}) as unknown as Component<InlineWidgetComponentProps>;

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

describe('registerInlineWidgetKind — component and buildWidget are mutually exclusive', () => {
	afterEach(__resetInlineWidgetsForTests);

	it('throws, naming the kind, when a descriptor declares both', () => {
		expect(() =>
			registerInlineWidgetKind(PLUGIN_KIND, {
				isWidget: () => true,
				component: FakeComponent,
				buildWidget: () => document.createElement('span')
			})
		).toThrow(new RegExp(PLUGIN_KIND));
		// The rejected registration never took: the kind stays unknown.
		expect(isInlineWidget(pluginNode, 'xxx')).toBe(false);
	});

	it('registers a component-only kind and exposes it through the accessor', () => {
		registerInlineWidgetKind(PLUGIN_KIND, { isWidget: () => true, component: FakeComponent });
		expect(getInlineWidgetComponent(PLUGIN_KIND)).toBe(FakeComponent);
	});

	it('leaves a buildWidget-only kind with no component', () => {
		registerInlineWidgetKind(PLUGIN_KIND, {
			isWidget: () => true,
			buildWidget: () => document.createElement('span')
		});
		expect(getInlineWidgetComponent(PLUGIN_KIND)).toBeUndefined();
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
