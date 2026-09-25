// @vitest-environment jsdom
// Miss-analysis: every windowing suite mounts its list below the mode read, and every mode
// suite loads a document too short to window, so a check keyed on the presentation mode had no
// test to fail; only the perf gate's live rows saw the O(document) keystroke it caused.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	destroyMountedEditors
} from '$lib/test/harness/mount-editor.svelte';
import type { PresentationMode } from '$lib/presentation-mode';

const BLOCKS = 200;
// One estimated line per paragraph puts the height table several viewports past the threshold
// that turns windowing on, whatever jsdom reports for the scroll container.
const TALL = Array.from({ length: BLOCKS }, (_, i) => `paragraph ${i}\n`).join('\n');

const MODES: PresentationMode[] = ['source', 'reading', 'preview-block', 'preview-inline', 'live'];

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('windowing activates on modeled height alone', () => {
	// Live mode's blocks are the heavy ones, which is the argument for a bounded mounted set, not
	// against it; the source row is the control that proves the fixture is big enough at all.
	for (const presentationMode of MODES) {
		it(`windows a tall document in ${presentationMode} mode`, () => {
			const { target } = mountEditor({ source: TALL, presentationMode });
			const root = target.querySelector('.editor');

			expect(root?.getAttribute('data-windowing')).toBe('active');
			expect(target.querySelectorAll('[data-block-path]').length).toBeLessThan(BLOCKS);
		});
	}
});
