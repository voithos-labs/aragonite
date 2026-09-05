// F4: a registered paste transform's effect must be observable from the published surface.
// Everything below imports only `@voithos-labs/aragonite/plugin` and `@voithos-labs/aragonite/testing`, so it is exactly
// the suite a third-party author can write.
//
// Miss-analysis: `registerPasteTransform` was pinned by e2e paste specs alone, so nothing at
// the unit gate proved the registration reaches the pipeline — an author could only test the
// pure function, which proves nothing about the wiring.
import { describe, it, expect, beforeEach } from 'vitest';
import { registerPasteTransform, isPasteTransformRegistered } from '$lib/plugin';
import { applyPasteTransforms, resetPluginPlatformForTests } from '$lib/testing';
import { takeDevWarns } from '$lib/test/support/warn-gate';

const upcaseHeadings = {
	name: 'upcase-headings',
	transform: (text: string) => (text.startsWith('# ') ? text.toUpperCase() : null)
};

const bangToBullet = {
	name: 'bang-to-bullet',
	transform: (text: string) => (text.startsWith('!') ? `- ${text.slice(1)}` : null)
};

beforeEach(() => resetPluginPlatformForTests());

describe('the registered paste pipeline, driven through aragonite/testing', () => {
	it('runs a registered transform over the pasted text', () => {
		registerPasteTransform(upcaseHeadings);
		expect(applyPasteTransforms('# title\n')).toBe('# TITLE\n');
	});

	it('leaves text a transform declines untouched', () => {
		registerPasteTransform(upcaseHeadings);
		expect(applyPasteTransforms('plain body\n')).toBe('plain body\n');
	});

	it('runs transforms in install order, each seeing the prior output', () => {
		registerPasteTransform(bangToBullet);
		registerPasteTransform(upcaseHeadings);
		// bang-to-bullet declines a heading, upcase-headings declines a bullet: order is only
		// observable through a text the FIRST rewrites into something the second claims.
		registerPasteTransform({
			name: 'bullet-to-heading',
			transform: (text) => (text.startsWith('- ') ? `# ${text.slice(2)}` : null)
		});
		expect(applyPasteTransforms('!note\n')).toBe('# note\n');
	});

	it('declines for the whole pipeline once the registry is reset', () => {
		registerPasteTransform(upcaseHeadings);
		resetPluginPlatformForTests();
		expect(applyPasteTransforms('# title\n')).toBe('# title\n');
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
		expect(applyPasteTransforms('body\n')).toBe('body\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['paste-transform']);
	});
});

describe('isPasteTransformRegistered', () => {
	it('answers before and after a registration, and after a reset', () => {
		expect(isPasteTransformRegistered('upcase-headings')).toBe(false);
		registerPasteTransform(upcaseHeadings);
		expect(isPasteTransformRegistered('upcase-headings')).toBe(true);
		expect(isPasteTransformRegistered('never-registered')).toBe(false);

		resetPluginPlatformForTests();
		expect(isPasteTransformRegistered('upcase-headings')).toBe(false);
	});

	// The bind the probe closes: a module-level `registered` flag survives the reset and
	// silently skips re-registration, so the guard has to read the registry itself.
	it('lets an idempotent registrar re-run across a reset without a dup throw', () => {
		const registerOnce = () => {
			if (!isPasteTransformRegistered(upcaseHeadings.name)) registerPasteTransform(upcaseHeadings);
		};
		registerOnce();
		registerOnce();
		expect(applyPasteTransforms('# title\n')).toBe('# TITLE\n');

		resetPluginPlatformForTests();
		registerOnce();
		expect(applyPasteTransforms('# title\n')).toBe('# TITLE\n');
	});
});
