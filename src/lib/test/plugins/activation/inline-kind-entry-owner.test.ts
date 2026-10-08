// @vitest-environment jsdom
// Miss-analysis: every kind-entry activation test registered the entry in the declaring plugin's
// own setup, so the inline registries answering to the registrant never showed.
import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	pluginInlineKindOwner
} from '#lib/schema/plugin-kind.js';
import { isInlineWidgetKind, registerInlineWidgetKind } from '#lib/core/inline/inline-widgets.js';
import {
	getInlineConstructPolicy,
	registerInlineConstructPolicy
} from '#lib/schema/inline-construct-policy.js';
import { grammarListing } from './grammar-listing';

const MARK = 'owned-mark';

const declarer = definePlugin({
	name: 'declarer',
	setup() {
		declarePluginInlineKind(MARK);
	}
});

describe('an inline widget registered by another plugin answers to the kind’s declarer', () => {
	beforeEach(() => {
		const registrant = definePlugin({
			name: 'registrant',
			setup() {
				registerInlineWidgetKind(declaredPluginInlineKind(MARK), {
					isWidget: () => true,
					buildWidget: () => document.createElement('span')
				});
			}
		});
		installPlugins([declarer, registrant]);
	});

	it('reads the declarer as the kind’s owner', () => {
		expect(pluginInlineKindOwner(MARK)).toBe('declarer');
	});

	it('resolves in an editor that lists the declarer but not the registrant', () => {
		expect(isInlineWidgetKind(declaredPluginInlineKind(MARK), grammarListing(['declarer']))).toBe(
			true
		);
	});

	it('is absent from an editor that lists the registrant but not the declarer', () => {
		expect(isInlineWidgetKind(declaredPluginInlineKind(MARK), grammarListing(['registrant']))).toBe(
			false
		);
	});
});

describe('an inline construct policy registered by another plugin answers to the kind’s declarer', () => {
	it('stays readable when the registrant’s setup throws after registering it', () => {
		const registrant = definePlugin({
			name: 'registrant',
			setup() {
				registerInlineConstructPolicy(declaredPluginInlineKind(MARK), {
					edgeAffinity: 'never-extend',
					autoUnwrapOnEmpty: false,
					splitBehavior: 'plain',
					revealable: true
				});
				throw new Error('registrant setup failed');
			}
		});
		installPlugins([declarer]);
		expect(() => installPlugins([registrant])).toThrow(/registrant setup failed/);
		expect(getInlineConstructPolicy(declaredPluginInlineKind(MARK))?.revealable).toBe(true);
	});
});
