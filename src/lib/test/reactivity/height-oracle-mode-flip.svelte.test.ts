// @vitest-environment jsdom
// Miss-analysis: the flip seam's own suites assert caret, affinity and the announced event, and
// the windowing suites stub the oracle out, so nothing asked what a flip does to heights the
// other mode measured — the one editor-owned cache the flip invalidates without touching.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '../blocks/editor-mount';
import {
	mountEditorOverProps,
	settlePropWrite,
	unmountEditorOverProps
} from '../harness/editor-over-props.svelte';
import type { HeightOracle } from '$lib/cursor/height-oracle';

interface HeightSeam {
	getHeightOracle(): HeightOracle;
	getWidthVersion(): number;
}

const WINDOWED_OUT_ID = 'windowed-out-block';
const OTHER_MODE_HEIGHT = 99;

beforeAll(installLayoutStubs);
afterEach(unmountEditorOverProps);

/** Mounts in source mode, then records a height as a mounted block's measure pass would. */
function mountAtSource() {
	const mounted = mountEditorOverProps<HeightSeam>({
		source: 'one\n\ntwo\n',
		presentationMode: 'source'
	});
	const oracle = mounted.editor.__test.getHeightOracle();
	oracle.recordMeasured(WINDOWED_OUT_ID, OTHER_MODE_HEIGHT);
	return { ...mounted, oracle };
}

describe('a presentation-mode flip does not keep the heights the other mode measured', () => {
	// Reading is the largest delta of any rung — every marker stops painting at once.
	it('drops every measured height when the mode flips', async () => {
		const { oracle, props } = mountAtSource();
		expect(oracle.measured(WINDOWED_OUT_ID)).toBe(OTHER_MODE_HEIGHT);

		props.presentationMode = 'reading';
		await settlePropWrite();

		expect(oracle.measured(WINDOWED_OUT_ID)).toBeUndefined();
	});

	// The drop alone is invisible to the reactive graph: a flip moves no id and no port, so
	// the width version is the only signal left that re-runs a scope's rebuild effect. Without
	// it the spacers keep serving the model built from the heights just dropped.
	it('bumps the width version, the only rebuild signal a flip can move', async () => {
		const { editor, props } = mountAtSource();
		const before = editor.__test.getWidthVersion();

		props.presentationMode = 'live';
		await settlePropWrite();

		expect(editor.__test.getWidthVersion()).toBeGreaterThan(before);
	});

	// The flip is a mode change, not an edit: rewriting the prop with the mode already in
	// force must cost neither the drop nor the rebuild.
	it('does neither when the prop is rewritten with the mode already in force', async () => {
		const { editor, oracle, props } = mountAtSource();
		const before = editor.__test.getWidthVersion();

		props.presentationMode = 'source';
		await settlePropWrite();

		expect(oracle.measured(WINDOWED_OUT_ID)).toBe(OTHER_MODE_HEIGHT);
		expect(editor.__test.getWidthVersion()).toBe(before);
	});
});
