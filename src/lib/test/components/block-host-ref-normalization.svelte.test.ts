// @vitest-environment jsdom
//
// BlockHost is the one place that knows a container publishes its whole
// `BlockComponent` surface under a single `containerApi` export — Svelte 5 instance
// exports are individual top-level declarations with no spread, and re-declaring a
// dozen of them by hand once let four blocks drop the park door one at a time.
//
// Everything downstream reads what this resolves: the parent's `innerBlockRefs`
// focus/reveal walks, both overlays, the cross-block dispatcher. A slot left holding
// the raw instance is a block whose caret never lands, and it fails nowhere near
// here — so the resolution is asserted at the slot, over a REAL container.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { resolveBlockSurface } from '$lib/block-component';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import { registerBlockComponent } from '$lib/schema/block-component-registry';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import SurfacelessBlock from './fixtures/SurfacelessBlock.svelte';
import {
	declareComponentlessKind,
	installBlockHostLayoutStubs,
	mountBlockHost,
	type MountedHost
} from './mount-host';

// The vitest setup registers built-in DESCRIPTORS only; the container assertions
// below need BlockHost to dispatch a real blockquote, so the component registry is
// bootstrapped here too. Built-ins survive `__resetSchemaRegistriesForTests`.
beforeAll(() => {
	installBlockHostLayoutStubs();
	registerBuiltInBlocks();
});

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	__resetSchemaRegistriesForTests();
});

describe('resolveBlockSurface', () => {
	const leaf = { focus() {}, getCursorOffset: () => null, editable: true, focusable: true };

	it('unwraps a container instance to the surface it published', () => {
		// By identity, not by shape: `publishRefSlot` clears a slot only while it still
		// holds the ref it wrote, so a wrapper minted per read would stomp a neighbour's.
		expect(resolveBlockSurface({ containerApi: leaf })).toBe(leaf);
	});

	it('passes a leaf instance through, by identity', () => {
		expect(resolveBlockSurface(leaf)).toBe(leaf);
	});

	it('resolves an unmounted instance to undefined', () => {
		expect(resolveBlockSurface(undefined)).toBeUndefined();
	});
});

describe('BlockHost publishes the resolved surface, not the instance', () => {
	it('fills a container’s slot with the container surface', () => {
		const doc = parse('> quoted\n');

		mounted = mountBlockHost(doc, { index: 0 });

		// The container-only verbs: an instance published as `{ containerApi }` carries
		// none of them, and the parent's focus walk would find a ref with no doors.
		const ref = mounted.refs[0];
		expect(typeof ref?.focus).toBe('function');
		expect(typeof ref?.parkCaret).toBe('function');
		expect(typeof ref?.focusByPath).toBe('function');
		expect(typeof ref?.getBlockComponentByPath).toBe('function');
		expect(typeof ref?.revealByPath).toBe('function');
		expect((ref as { containerApi?: unknown }).containerApi).toBeUndefined();
	});

	it('resolves a nested container the same way, one level down', () => {
		// The nested walk is the ref chain proper: the outer container's own slot must
		// hold a surface whose descent reaches the inner container's surface.
		const doc = parse('> - item\n');

		mounted = mountBlockHost(doc, { index: 0 });
		const inner = mounted.refs[0]?.getBlockComponentByPath?.([0]);

		expect(typeof inner?.focusByPath).toBe('function');
		expect((inner as { containerApi?: unknown } | null)?.containerApi).toBeUndefined();
	});

	it('fills a leaf’s slot with the leaf’s own surface', () => {
		mounted = mountBlockHost(parse('plain prose\n'), { index: 0 });

		expect(typeof mounted.refs[0]?.getCursorOffset).toBe('function');
	});

	it('dev-warns when a component publishes neither surface shape', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		const doc = parse('surfaceless\n');
		const kind = declareComponentlessKind('host-surfaceless');
		// The cast is the point: `defineBlockComponent` rejects this component, so the
		// only way here is the escape hatch, and this warn is what covers it.
		registerBlockComponent(kind, {
			component: SurfacelessBlock as unknown as Parameters<
				typeof registerBlockComponent
			>[1]['component']
		});
		doc.children[0].kind = kind;

		try {
			mounted = mountBlockHost(doc, { index: 0 });

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('published no BlockComponent surface'),
				kind
			);
		} finally {
			warn.mockRestore();
			resetEditorEnv();
		}
	});

	it('stays quiet for a container that published correctly', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });

		try {
			mounted = mountBlockHost(parse('> quoted\n'), { index: 0 });

			const surfaceWarns = warn.mock.calls.filter(
				(args) => typeof args[0] === 'string' && args[0].includes('published no BlockComponent')
			);
			expect(surfaceWarns).toEqual([]);
		} finally {
			warn.mockRestore();
			resetEditorEnv();
		}
	});
});
