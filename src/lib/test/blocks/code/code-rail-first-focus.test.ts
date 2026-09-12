// @vitest-environment jsdom
//
// Miss-analysis: the language offer was pinned by clicking into a fence, where no arrival key
// is noted, so a keyboard walk through an empty fence in a loaded document never met the picker
// that took its focus.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, tick } from 'svelte';
import { createEdgeAffinityState } from '$lib/cursor/edge-affinity';
import { mountCode, type MountedCode } from './mount-code';

const BARE_FENCE = '```\n```\n';

let mounted: MountedCode | null = null;

afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

async function focusFence(arrival: 'step' | 'seat'): Promise<void> {
	const edgeAffinity = createEdgeAffinityState();
	if (arrival === 'step') edgeAffinity.note({ key: 'ArrowRight', altKey: false });
	mounted = mountCode(BARE_FENCE, {
		policies: { presentationMode: () => 'live' },
		services: { edgeAffinity }
	});
	mounted.el.focus();
	flushSync();
	// The offer defers past the completion's own focus work by two ticks.
	await tick();
	await tick();
	await tick();
	flushSync();
}

const picker = () => mounted!.target.querySelector('.code-lang-picker');
const completions = () => mounted!.blockEdit.updateBlockContent;

describe('a bare fence taking the caret', () => {
	it('completes and offers a language when the caret was seated, not stepped', async () => {
		await focusFence('seat');

		expect(completions()).toHaveBeenCalledWith(0, '```\n\n```\n', expect.anything());
		expect(picker()).not.toBeNull();
	});

	it('completes but keeps the caret when the caret stepped in from a neighbour', async () => {
		await focusFence('step');

		expect(completions()).toHaveBeenCalledWith(0, '```\n\n```\n', expect.anything());
		expect(picker()).toBeNull();
	});
});
