// @vitest-environment jsdom
//
// BlockHost's error boundary stands between one bad plugin component and a blank
// document. Two halves, neither visible from the source: the failed block still SHOWS
// its bytes and reports on the error channel, and the boundary heals on a byte change
// — a small document never windows the host out to remount it, so an edit that fixes
// the input is the only way back.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { parse } from '$lib/core/parser';
import { createEditorEvents, type EditorEvents } from '$lib/editor-events';
import { registerBlockComponent, defineBlockComponent } from '$lib/schema/block-component-registry';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import type { CstNode } from '$lib/core/nodes';
import ThrowingBlock from './fixtures/ThrowingBlock.svelte';
import {
	declareComponentlessKind,
	installBlockHostLayoutStubs,
	mountBlockHost
} from './mount-host';
import type { MountedHost } from './mount-host';

beforeAll(installBlockHostLayoutStubs);

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	__resetSchemaRegistriesForTests();
});

interface ErrorReport {
	origin: string;
	context?: { path?: number[] };
}

/** A host over one block whose component throws while its raw says `boom`. */
function mountThrowing(raw: string, parentPath: number[] = []) {
	const doc = parse(raw);
	const kind = declareComponentlessKind('host-throwing');
	registerBlockComponent(kind, defineBlockComponent(ThrowingBlock));
	doc.children[0].kind = kind;
	// $state so a later byte write reaches the boundary-retry effect.
	const node: CstNode = $state(doc.children[0]);
	doc.children[0] = node;

	const events: EditorEvents = createEditorEvents();
	const errors: ErrorReport[] = [];
	events.on('error', (report) => errors.push(report as ErrorReport));

	const host = mountBlockHost(doc, { node, parentPath }, { services: { events } });
	return { host, node, errors };
}

describe('a block whose component throws degrades instead of blanking', () => {
	it('shows the block’s bytes in the failed placeholder', () => {
		const { host } = mountThrowing('boom text\n');
		mounted = host;

		const failed = host.el.querySelector('[data-failed-block]');
		expect(failed).not.toBeNull();
		expect(failed?.querySelector('pre')?.textContent).toBe('boom text\n');
	});

	it('reports the failure on the editor error channel with the block’s path', () => {
		const { host, errors } = mountThrowing('boom text\n', [2]);
		mounted = host;

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('render');
		expect(errors[0].context?.path).toEqual([2, 0]);
	});

	it('publishes no ref while the boundary holds the fallback', () => {
		// A container walking its refs must not resolve a component that never
		// finished mounting.
		const { host } = mountThrowing('boom text\n');
		mounted = host;

		expect(host.refs[0]).toBeUndefined();
	});
});

describe('the boundary heals when the block’s bytes change', () => {
	it('re-renders the component once the raw no longer throws', () => {
		const { host, node } = mountThrowing('boom text\n');
		mounted = host;
		expect(host.el.querySelector('[data-failed-block]')).not.toBeNull();

		node.raw = 'fixed text\n';
		flushSync();

		expect(host.el.querySelector('[data-failed-block]')).toBeNull();
		expect(host.el.querySelector('.throwing-block')?.textContent).toBe('fixed text\n');
		expect(host.refs[0]).toBeDefined();
	});

	it('re-enters the fallback when the new bytes throw again', () => {
		// Non-vacuity for the retry: a reset that healed unconditionally would leave
		// the component's second throw uncaught.
		const { host, node, errors } = mountThrowing('boom text\n');
		mounted = host;

		node.raw = 'boom again\n';
		flushSync();

		expect(host.el.querySelector('[data-failed-block]')).not.toBeNull();
		expect(errors.length).toBeGreaterThan(1);
	});
});
