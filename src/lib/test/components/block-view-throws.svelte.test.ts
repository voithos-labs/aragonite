// @vitest-environment jsdom
// A Svelte block component that throws degrades in place: BlockHost's boundary shows the block's
// bytes, the error event names its path, and a foreign-runtime throw is named. A block type's
// drawing has the same rows in `plugins/blocks/draw-host.svelte.test.ts`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createEditorEvents } from '#lib/editor-events.js';
import { svelteBlockView } from '#lib/components/svelte-block-view.js';
import type { BlockView } from '#lib/plugin.js';
import { headless } from '#lib/testing.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountBlockHost, type MountedHost } from './mount-host';
import ThrowingAtMountBlock from './fixtures/ThrowingAtMountBlock.svelte';
import ThrowingOnChangeBlock from './fixtures/ThrowingOnChangeBlock.svelte';

beforeAll(headless);

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

interface ErrorReport {
	origin: string;
	context?: { path?: number[] };
}

const leaf = (view: BlockView) => testLeaf('throwing-view', { view });

function mountHost(view: BlockView, raw: string) {
	const doc = parse(raw);
	doc.children[0].kind = leaf(view);
	const node: CstNode = $state(doc.children[0]);
	doc.children[0] = node;
	const events = createEditorEvents();
	const errors: ErrorReport[] = [];
	events.on('error', (report) => errors.push(report as ErrorReport));
	mounted = mountBlockHost(doc, { node, parentPath: [3] }, { services: { events } });
	return { host: mounted, node, errors };
}

function expectFailedBlock(host: MountedHost, errors: ErrorReport[], raw: string): void {
	const failed = host.el.querySelector('[data-failed-block]');
	expect(failed?.querySelector('pre')?.textContent).toBe(raw);
	expect(failed?.textContent).toContain('a different Svelte runtime');
	expect(errors).toEqual([
		expect.objectContaining({ origin: 'render', context: { path: [3, 0] } })
	]);
	expect(takeDevWarns().map((w) => w.tag)).toEqual(['foreign-runtime']);
}

describe('a block drawn by a Svelte component', () => {
	it('shows the failed-block notice, reports and names the cause when it throws mounting', () => {
		const { host, errors } = mountHost(svelteBlockView(ThrowingAtMountBlock), 'boom text\n');
		expectFailedBlock(host, errors, 'boom text\n');
	});

	it('does the same when it throws on a change to its bytes', () => {
		const { host, node, errors } = mountHost(svelteBlockView(ThrowingOnChangeBlock), 'calm text\n');
		expect(host.el.querySelector('[data-failed-block]')).toBeNull();
		node.raw = 'bang text\n';
		flushSync();
		expectFailedBlock(host, errors, 'bang text\n');
	});
});
