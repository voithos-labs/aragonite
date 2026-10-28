// @vitest-environment jsdom
// A DOM view that throws degrades exactly as a Svelte block component does: BlockHost's boundary
// shows the block's bytes, the error event names its path, and a foreign-runtime throw is named.
// Miss-analysis: new surface; a view's throws run in an attachment and an effect, not a render.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createEditorEvents } from '#lib/editor-events.js';
import { svelteBlockView } from '#lib/components/svelte-block-view.js';
import { defineBlockView, type BlockView } from '#lib/plugin.js';
import { installEditorDomStubsForTests } from '#lib/testing.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountBlockHost, type MountedHost } from './mount-host';
import ThrowingAtMountBlock from './fixtures/ThrowingAtMountBlock.svelte';
import ThrowingOnChangeBlock from './fixtures/ThrowingOnChangeBlock.svelte';
import { THROWN_MESSAGE } from './fixtures/thrown-message';

beforeAll(installEditorDomStubsForTests);

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

interface ErrorReport {
	origin: string;
	context?: { path?: number[] };
}

const throwing = (raw: string, word: string) => {
	if (raw.includes(word)) throw new TypeError(THROWN_MESSAGE);
};

const FORMS: { form: string; atMount: () => BlockView; onChange: () => BlockView }[] = [
	{
		form: 'a Svelte component',
		atMount: () => svelteBlockView(ThrowingAtMountBlock),
		onChange: () => svelteBlockView(ThrowingOnChangeBlock)
	},
	{
		form: 'a DOM view',
		atMount: () =>
			defineBlockView({
				surface: 'none',
				mount(target, ctx) {
					throwing(ctx.state().node.raw, 'boom');
					target.textContent = ctx.state().node.raw;
					return {};
				}
			}),
		onChange: () =>
			defineBlockView({
				surface: 'none',
				mount(target, ctx) {
					target.textContent = ctx.state().node.raw;
					return { update: (state) => throwing(state.node.raw, 'bang') };
				}
			})
	}
];

function mountHost(view: BlockView, raw: string) {
	const doc = parse(raw);
	doc.children[0].kind = testLeaf('throwing-view', { view });
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

describe.each(FORMS)('a block drawn by $form', ({ atMount, onChange }) => {
	it('shows the failed-block notice, reports and names the cause when it throws mounting', () => {
		const { host, errors } = mountHost(atMount(), 'boom text\n');
		expectFailedBlock(host, errors, 'boom text\n');
	});

	it('does the same when it throws on a change to its bytes', () => {
		const { host, node, errors } = mountHost(onChange(), 'calm text\n');
		expect(host.el.querySelector('[data-failed-block]')).toBeNull();
		node.raw = 'bang text\n';
		flushSync();
		expectFailedBlock(host, errors, 'bang text\n');
	});
});

describe('a DOM view whose destroy throws', () => {
	it('is reported, and the block still tears down', async () => {
		const view = defineBlockView({
			surface: 'none',
			mount(target) {
				target.textContent = 'drawn';
				return {
					destroy() {
						throw new Error('destroy exploded');
					}
				};
			}
		});
		const { host, errors } = mountHost(view, 'text\n');
		const el = host.el;
		await host.dispose();
		mounted = null;
		expect(errors).toEqual([expect.objectContaining({ origin: 'render' })]);
		expect(el.isConnected).toBe(false);
	});
});
