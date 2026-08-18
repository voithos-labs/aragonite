// @vitest-environment jsdom
/**
 * The dev diagnostic on a declined image edit: suppressing the commit keeps the author's bytes,
 * and the warn keeps the suppression from being a mystery. The three outcomes are pinned together
 * because the interesting one is a hook returning byte-identical bytes — dropped by the commit's
 * equality guard, warning NOTHING, which is why a hook must decline a field it cannot represent.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { __resetInlineSyntaxForTests } from '../../core/inline/scan/plugin-syntax';
import { committerFor } from './committer-harness';
import { registerWikiRung, rewriteWikiImage } from './wiki-image-rung';
import { takeDevWarns } from '../support/warn-gate';

const SOURCE = '![[cat.png|300]]\n';
const RESIZED = { alt: 'cat.png', url: 'cat.png', width: 320 };

afterEach(() => __resetInlineSyntaxForTests());

const warnings = (): string[] => takeDevWarns().map((w) => `[${w.tag}] ${w.message}`);

describe('a declined image edit says which rung declined and why', () => {
	it('names the rung and the missing hook when none was registered', () => {
		registerWikiRung();
		const { committer, controller, target } = committerFor(SOURCE);
		committer.commitImageEdit(target, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		const fires = warnings();
		expect(fires).toHaveLength(1);
		expect(fires[0]).toContain('[image-edit]');
		expect(fires[0]).toContain('"![["');
		expect(fires[0]).toContain('registered no rewriteImage hook');
	});

	// The discriminator matters: "you forgot a hook" and "your hook has no form for
	// this edit" send an author to different places.
	it('distinguishes a hook that declined this particular edit', () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target } = committerFor(SOURCE);
		committer.commitImageEdit(target, { ...RESIZED, title: 'Cat' });
		expect(controller.commitStructural).not.toHaveBeenCalled();
		const fires = warnings();
		expect(fires).toHaveLength(1);
		expect(fires[0]).toContain('cannot represent this edit');
	});

	// The quiet failure a consumer hits first: a hook that ignores the edited field returns the
	// source unchanged, so the seam never declines and the equality guard drops it silently.
	it('says nothing when a hook returns the bytes it was given', () => {
		registerWikiRung(() => '![[cat.png|300]]');
		const { committer, controller, target } = committerFor(SOURCE);
		committer.commitImageEdit(target, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(warnings()).toEqual([]);
	});
});
