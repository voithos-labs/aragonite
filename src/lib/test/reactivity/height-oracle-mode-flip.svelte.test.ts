// @vitest-environment jsdom
// Miss-analysis: windowing suites stub the estimator, so no test asked what a mode switch drops.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	destroyMountedEditors
} from '$lib/test/harness/mount-editor.svelte';
import type { HeightOracle } from '$lib/cursor/height-oracle';
import { settleEditor } from '$lib/test/harness/settle';

interface HeightSeam {
	getHeightOracle(): HeightOracle;
	getWidthVersion(): number;
}

const WINDOWED_OUT_ID = 'windowed-out-block';
const OTHER_MODE_HEIGHT = 99;

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** Mounts in source mode, then records a height as a mounted block's measure pass would. */
function mountAtSource() {
	const mounted = mountEditor<HeightSeam>({
		source: 'one\n\ntwo\n',
		presentationMode: 'source'
	});
	const oracle = mounted.instance.__test.getHeightOracle();
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

	// A width bump would rebuild with no block held (the switch has blurred), unmounting the
	// caret's block and losing the user's place; each block re-measures on its own mount instead.
	it('forces no rebuild: the flip moves the width version for nobody', async () => {
		const { instance: editor, props } = mountAtSource();
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
