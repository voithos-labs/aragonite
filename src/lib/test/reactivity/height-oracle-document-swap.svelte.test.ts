// @vitest-environment jsdom
// Miss-analysis: `cursor/height-oracle` tests the cache's own methods and every windowing
// suite hands the block lists a stub estimator, so no test ever ran the real one across the
// one change where all of its keys die at once.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { tick } from 'svelte';
import { installLayoutStubs } from '../blocks/editor-mount';
import {
	mountEditorOverProps,
	typeInFirstBlock,
	unmountEditorOverProps
} from '../harness/editor-over-props.svelte';
import type { HeightOracle } from '$lib/cursor/height-oracle';
import { settleEditor } from '$lib/test/harness/settle';

interface HeightSeam {
	getHeightOracle(): HeightOracle;
	getContentVersion(): number;
}

const OUTGOING_ID = 'outgoing-block';
const OUTGOING_HEIGHT = 99;

// jsdom lays nothing out, so the stub also keeps the width path, the cache's other way of
// losing entries, from firing: anything the cache loses here was lost to the swap.
beforeAll(installLayoutStubs);
afterEach(unmountEditorOverProps);

/** Mounts, then records a measured height as a mounted block's measure pass would. */
function mountWithMeasuredBlock() {
	const mounted = mountEditorOverProps<HeightSeam>({ source: 'one\n\ntwo\n' });
	const oracle = mounted.editor.__test.getHeightOracle();
	oracle.recordMeasured(OUTGOING_ID, OUTGOING_HEIGHT);
	return { ...mounted, oracle };
}

describe('the measured-height cache does not outlive the document it measured', () => {
	it('drops a measured height when the `source` prop replaces the document', async () => {
		const { oracle, props } = mountWithMeasuredBlock();
		expect(oracle.measured(OUTGOING_ID)).toBe(OUTGOING_HEIGHT);

		props.source = 'only\n';
		await settleEditor();

		expect(oracle.measured(OUTGOING_ID)).toBeUndefined();
	});

	// Replacing the document is the only time an edit may drop these: ids survive a keystroke,
	// so dropping them then would cost a full re-measure per batch of typing.
	it('keeps measured heights across an edit, which replaces no document', async () => {
		const { editor, oracle, target } = mountWithMeasuredBlock();
		const before = editor.__test.getContentVersion();

		typeInFirstBlock(target, 'one!');
		await tick();

		// The version is what tells the two apart: an input the editor ignored would leave the
		// height standing too, and prove nothing.
		expect(editor.__test.getContentVersion()).not.toBe(before);
		expect(oracle.measured(OUTGOING_ID)).toBe(OUTGOING_HEIGHT);
	});
});
