// @vitest-environment jsdom
/**
 * The dev-mode warning when an image edit is refused: dropping the commit keeps the author's
 * bytes, and the warning keeps that from being a mystery. The three outcomes are tested together
 * because the interesting one is a hook returning the same bytes back, which the commit's
 * equality check drops with no warning: that is why a hook must refuse a field it cannot store.
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

describe('a declined image edit says which inline syntax handler declined and why', () => {
	it('names the inline syntax handler and the missing hook when none was registered', () => {
		registerWikiRung();
		const { committer, controller, target, seen } = committerFor(SOURCE);
		committer.commitImageEdit(target, seen, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		const fires = warnings();
		expect(fires).toHaveLength(1);
		expect(fires[0]).toContain('[image-edit]');
		expect(fires[0]).toContain('"![["');
		expect(fires[0]).toContain('registered no rewriteImage hook');
	});

	// Telling them apart matters: "you forgot a hook" and "your hook has no way to write
	// this edit" send a plugin author to different places.
	it('distinguishes a hook that declined this particular edit', () => {
		registerWikiRung(rewriteWikiImage);
		const { committer, controller, target, seen } = committerFor(SOURCE);
		committer.commitImageEdit(target, seen, { ...RESIZED, title: 'Cat' });
		expect(controller.commitStructural).not.toHaveBeenCalled();
		const fires = warnings();
		expect(fires).toHaveLength(1);
		expect(fires[0]).toContain('cannot represent this edit');
	});

	// The quiet failure a consumer hits first: a hook that ignores the edited field returns the
	// source unchanged, so nothing refuses and the equality check drops it in silence.
	it('says nothing when a hook returns the bytes it was given', () => {
		registerWikiRung(() => '![[cat.png|300]]');
		const { committer, controller, target, seen } = committerFor(SOURCE);
		committer.commitImageEdit(target, seen, RESIZED);
		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(warnings()).toEqual([]);
	});
});
