// @vitest-environment jsdom
// Miss-analysis: every windowing suite mounts the scope below the mode read, and every mode
// suite loads a document too short to window, so a gate keyed on the presentation mode had no
// test to fail; only the perf gate's live rows saw the O(doc) keystroke it caused.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '../blocks/editor-mount';
import { mountEditorOverProps, unmountEditorOverProps } from '../harness/editor-over-props.svelte';
import type { PresentationMode } from '$lib/presentation-mode';

const BLOCKS = 200;
// One estimated line per paragraph puts the model several viewports past the activation
// watermark, whatever jsdom reports for the port.
const TALL = Array.from({ length: BLOCKS }, (_, i) => `paragraph ${i}\n`).join('\n');

const MODES: PresentationMode[] = ['source', 'reading', 'preview-block', 'preview-inline', 'live'];

beforeAll(installLayoutStubs);
afterEach(unmountEditorOverProps);

describe('windowing activates on modeled height alone', () => {
	// Live's blocks are the heavy ones, which is the case for a bounded mount, not against it;
	// the source row is the control that proves the fixture clears the budget at all.
	for (const presentationMode of MODES) {
		it(`windows a tall document in ${presentationMode} mode`, () => {
			const { target } = mountEditorOverProps({ source: TALL, presentationMode });
			const root = target.querySelector('.editor');

			expect(root?.getAttribute('data-windowing')).toBe('active');
			expect(target.querySelectorAll('[data-block-path]').length).toBeLessThan(BLOCKS);
		});
	}
});
