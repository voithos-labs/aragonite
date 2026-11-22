// A registered paste transform's effect must be visible from the published API: everything
// below imports only `@voithos-labs/aragonite/plugin` and `@voithos-labs/aragonite/testing`,
// so it is exactly the suite a third-party author can write.
// Miss-analysis: only e2e specs pinned `registerPasteTransform`, so no unit test saw its wiring.
import { describe, it, expect } from 'vitest';
import { definePlugin, registerPasteTransform } from '#lib/plugin.js';
import { installPlugins } from '#lib';
import { resetPluginPlatformForTests, rewritePaste } from '#lib/testing.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const upcaseHeadings = {
	name: 'upcase-headings',
	transform: (text: string) => (text.startsWith('# ') ? text.toUpperCase() : null)
};

const bangToBullet = {
	name: 'bang-to-bullet',
	transform: (text: string) => (text.startsWith('!') ? `- ${text.slice(1)}` : null)
};

describe('the registered paste pipeline, driven through aragonite/testing', () => {
	it('runs a registered transform over the pasted text', () => {
		registerPasteTransform(upcaseHeadings);
		expect(rewritePaste('# title\n', undefined)).toBe('# TITLE\n');
	});

	it('leaves text a transform declines untouched', () => {
		registerPasteTransform(upcaseHeadings);
		expect(rewritePaste('plain body\n', undefined)).toBe('plain body\n');
	});

	it('runs transforms in install order, each seeing the prior output', () => {
		registerPasteTransform(bangToBullet);
		registerPasteTransform(upcaseHeadings);
		// bang-to-bullet declines a heading, upcase-headings declines a bullet: order is only
		// visible through a text the first rewrites into something the second matches.
		registerPasteTransform({
			name: 'bullet-to-heading',
			transform: (text) => (text.startsWith('- ') ? `# ${text.slice(2)}` : null)
		});
		expect(rewritePaste('!note\n', undefined)).toBe('# note\n');
	});

	it('runs a plugin transform only for a list of plugins that names it', () => {
		const shouter = definePlugin({
			name: 'shouter',
			setup: () => registerPasteTransform(upcaseHeadings)
		});
		const quiet = definePlugin({ name: 'quiet', setup: () => {} });
		installPlugins([shouter]);
		expect(rewritePaste('# title\n', [shouter])).toBe('# TITLE\n');
		expect(rewritePaste('# title\n', [quiet])).toBe('# title\n');
	});

	it('declines for the whole pipeline once the registry is reset', () => {
		registerPasteTransform(upcaseHeadings);
		resetPluginPlatformForTests();
		expect(rewritePaste('# title\n', undefined)).toBe('# title\n');
	});

	// A throwing transform is contained as a decline, so one bad plugin cannot swallow a paste
	// that the covering range delete has already committed.
	it('contains a throwing transform as a decline', () => {
		registerPasteTransform({
			name: 'thrower',
			transform: () => {
				throw new Error('boom');
			}
		});
		expect(rewritePaste('body\n', undefined)).toBe('body\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['paste-transform']);
	});
});

describe('registerPasteTransform is register-once', () => {
	it('throws on a duplicate name, as every registry does', () => {
		registerPasteTransform(upcaseHeadings);
		expect(() => registerPasteTransform(upcaseHeadings)).toThrow(/already registered/);
	});
});
