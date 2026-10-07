// @vitest-environment jsdom
// BlockHost unwraps the `containerApi` export a container hands over its whole interface under.
// A ref entry left holding the raw instance is a block the caret can never reach, failing far from
// here, so the result is asserted at the ref entry over a real container.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { resolveBlockSurface, type ContainerBlockComponent } from '#lib/block-component.js';
import { takeDevWarns } from '../support/warn-gate';
import { registerBlockComponent } from '#lib/schema/block-component-registry.js';
import { registerBuiltInBlocks } from '#lib/components/built-in-blocks.js';
import SurfacelessBlock from './fixtures/SurfacelessBlock.svelte';
import { mountBlockHost, type MountedHost } from './mount-host';
import { installEditorDomStubsForTests } from '#lib/testing.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { makeShimChildList } from '#lib/test/harness/editor-actions.js';
import { componentAt } from '#lib/reactivity/child-list.js';

// The vitest setup registers the built-in descriptors only, but the container
// assertions need BlockHost to dispatch a real blockquote.
beforeAll(() => {
	installEditorDomStubsForTests();
	registerBuiltInBlocks();
});

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

describe('resolveBlockSurface', () => {
	const leaf = { focus() {}, getCursorOffset: () => null, editable: true, focusable: true };
	// A full container, not merely present: the union's container half requires the
	// descent methods, so a block-shaped `containerApi` does not type-check here either.
	const container: ContainerBlockComponent = {
		...leaf,
		parkCaret: () => {},
		getCursorPosition: () => null,
		focusByPath: () => {},
		childList: () => makeShimChildList([]),
		focusAtColumn: () => {},
		isVerticallyTransparent: () => false,
		enterEdgeWidget: () => false
	};

	it('unwraps a container instance to the surface it published', () => {
		// By identity, not by shape: `publishRefSlot` clears an entry only while it still
		// holds the ref it wrote, so a wrapper built per read would clear a neighbour's.
		expect(resolveBlockSurface({ containerApi: container })).toBe(container);
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

		// The container-only methods: an instance handed over as `{ containerApi }` has
		// none of them, so the parent's focus descent would find a ref it cannot use.
		const ref = mounted.refs[0];
		expect(typeof ref?.focus).toBe('function');
		expect(typeof ref?.parkCaret).toBe('function');
		expect(typeof ref?.focusByPath).toBe('function');
		expect(typeof ref?.childList).toBe('function');
		expect((ref as { containerApi?: unknown }).containerApi).toBeUndefined();
	});

	it('resolves a nested container the same way, one level down', () => {
		// Nesting is the ref chain proper: the outer container's own entry must hold
		// something whose descent reaches the inner container's own interface.
		const doc = parse('> - item\n');

		mounted = mountBlockHost(doc, { index: 0 });
		const inner = componentAt(mounted.refs[0]!.childList!(), [0]);

		expect(typeof inner?.focusByPath).toBe('function');
		expect((inner as { containerApi?: unknown } | null)?.containerApi).toBeUndefined();
	});

	it('fills a leaf’s slot with the leaf’s own surface', () => {
		mounted = mountBlockHost(parse('plain prose\n'), { index: 0 });

		expect(typeof mounted.refs[0]?.getCursorOffset).toBe('function');
	});

	it('dev-warns when a component publishes neither surface shape', () => {
		const doc = parse('surfaceless\n');
		const kind = testLeaf('host-surfaceless');
		// The cast is the point: `defineBlockComponent` rejects this component, so the
		// only way here is the escape hatch, and this warn is what covers it.
		registerBlockComponent(kind, {
			component: SurfacelessBlock as unknown as Parameters<
				typeof registerBlockComponent
			>[1]['component']
		});
		doc.children[0].kind = kind;

		mounted = mountBlockHost(doc, { index: 0 });

		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('published no BlockComponent surface');
		expect(fires[0].details).toBe(kind);
	});

	it('stays quiet for a container that published correctly', () => {
		mounted = mountBlockHost(parse('> quoted\n'), { index: 0 });
		expect(takeDevWarns()).toEqual([]);
	});
});
