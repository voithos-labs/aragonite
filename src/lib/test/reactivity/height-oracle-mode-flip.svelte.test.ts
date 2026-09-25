// @vitest-environment jsdom
// Miss-analysis: the mode switch's own suites assert the caret, the edge affinity and the
// event, and the windowing suites stub the height estimator out, so nothing asked what a switch
// does to heights the other mode measured. The "no rebuild" half is the rest of that miss: the
// first fix paired the drop with a width bump, and only the presentation e2e saw the scroll.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '../blocks/editor-mount';
import { mountEditorOverProps, unmountEditorOverProps } from '../harness/editor-over-props.svelte';
import type { HeightOracle } from '$lib/cursor/height-oracle';
import { settleEditor } from '$lib/test/harness/settle';

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
	// Reading mode changes the most of any mode: every marker stops painting at once.
	it('drops every measured height when the mode flips', async () => {
		const { oracle, props } = mountAtSource();
		expect(oracle.measured(WINDOWED_OUT_ID)).toBe(OTHER_MODE_HEIGHT);

		props.presentationMode = 'reading';
		await settleEditor();

		expect(oracle.measured(WINDOWED_OUT_ID)).toBeUndefined();
	});

	// The drop happens on its own. Bumping the width version here forces a rebuild, and the mode
	// switch has already blurred, so the window recomputes with no block held, unmounts the
	// caret's block, and placing the caret again scrolls it back, losing the user's place (#221).
	// Each block re-measures on its own mount instead, which costs the user nothing.
	it('forces no rebuild: the flip moves the width version for nobody', async () => {
		const { editor, props } = mountAtSource();
		const before = editor.__test.getWidthVersion();

		props.presentationMode = 'live';
		await settleEditor();

		expect(editor.__test.getWidthVersion()).toBe(before);
	});

	// A mode switch is not an edit: rewriting the prop with that mode already in force must
	// drop nothing.
	it('drops nothing when the prop is rewritten with the mode already in force', async () => {
		const { oracle, props } = mountAtSource();

		props.presentationMode = 'source';
		await settleEditor();

		expect(oracle.measured(WINDOWED_OUT_ID)).toBe(OTHER_MODE_HEIGHT);
	});
});
