// @vitest-environment jsdom
// Miss-analysis: `cursor/height-oracle` pins the cache's own methods and every windowing
// suite hands the scopes a stub oracle, so no test ever ran the real one across the one
// seam where all of its keys die at once.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import type { HeightOracle } from '$lib/cursor/height-oracle';
import type { EditorInstance } from '$lib/editor-props';

beforeAll(() => {
	// jsdom has no layout, so the stub also keeps the width path — the cache's other
	// eviction — from firing: anything the cache loses here was lost by the swap.
	(globalThis as any).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	Element.prototype.scrollIntoView = () => {};
});

type MountedEditor = EditorInstance & {
	__test: { getHeightOracle(): HeightOracle; getContentVersion(): number };
};

const OUTGOING_ID = 'outgoing-block';
const OUTGOING_HEIGHT = 99;

let mounted: MountedEditor | null = null;
let target: HTMLElement | null = null;

afterEach(() => {
	if (mounted) void unmount(mounted);
	target?.remove();
	mounted = null;
	target = null;
});

/** Mounts, then records a measured height as a mounted block's ResizeObserver would. */
function mountEditor(source: string): {
	editor: MountedEditor;
	oracle: HeightOracle;
	props: { source: string };
} {
	target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({ source });
	mounted = mount(Editor, { target, props }) as MountedEditor;
	flushSync();
	const oracle = mounted.__test.getHeightOracle();
	oracle.recordMeasured(OUTGOING_ID, OUTGOING_HEIGHT);
	return { editor: mounted, oracle, props };
}

async function settleSwap(): Promise<void> {
	flushSync();
	await tick();
	await tick();
}

function typeInFirstBlock(text: string): void {
	const el = target!.querySelector('.text-editable-block') as HTMLElement;
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

describe('the measured-height cache does not outlive the document it measured', () => {
	it('drops a measured height when the `source` prop replaces the document', async () => {
		const { oracle, props } = mountEditor('one\n\ntwo\n');
		expect(oracle.measured(OUTGOING_ID)).toBe(OUTGOING_HEIGHT);

		props.source = 'only\n';
		await settleSwap();

		expect(oracle.measured(OUTGOING_ID)).toBeUndefined();
	});

	// Replacement is the only eviction an edit must not trigger: ids survive a keystroke,
	// so dropping there would cost a full re-measure per typing batch.
	it('keeps measured heights across an edit, which replaces no document', async () => {
		const { editor, oracle } = mountEditor('one\n\ntwo\n');
		const before = editor.__test.getContentVersion();

		typeInFirstBlock('one!');
		await tick();

		// The version is the guard's own oracle: an input the editor ignored would leave the
		// height standing too, and pin nothing.
		expect(editor.__test.getContentVersion()).not.toBe(before);
		expect(oracle.measured(OUTGOING_ID)).toBe(OUTGOING_HEIGHT);
	});
});
