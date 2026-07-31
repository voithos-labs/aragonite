// @vitest-environment jsdom
//
// Mounts the kind→component dispatcher per kind class, so a registry mis-wire or a
// lost fallback fails as a missing surface rather than surviving to review — the
// source scan (invariants/lint/block-host-prop-thread) cannot see either.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import type { Document } from '$lib/core/nodes';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { registerBlockComponent, defineBlockComponent } from '$lib/schema/block-component-registry';
import { createRegistryView } from '$lib/schema/registry-view';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import RecordingBlock from './fixtures/RecordingBlock.svelte';
import {
	declareComponentlessKind,
	installBlockHostLayoutStubs,
	mountBlockHost
} from './mount-host';
import type { MountedHost } from './mount-host';

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

/** Reparent a parsed block onto a document of its own, so `[0]` addresses it. */
function docOf(source: string): Document {
	return parse(source);
}

// One source per kind class the dispatcher distinguishes, with the selector its
// registered component owns.
const KIND_CLASSES: Array<{ label: string; source: string; kind: string; selector: string }> = [
	{ label: 'prose leaf', source: 'hello\n', kind: 'paragraph', selector: '.paragraph-block' },
	{
		label: 'code',
		source: '```js\nlet a = 1;\n```\n',
		kind: 'fencedCode',
		selector: '.code-block'
	},
	{ label: 'container', source: '> quoted\n', kind: 'blockquote', selector: '.blockquote-block' },
	{
		label: 'table',
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
		kind: 'table',
		selector: '[role="table"]'
	},
	{ label: 'rule', source: '---\n', kind: 'thematicBreak', selector: '.thematic-break-block' }
];

describe('BlockHost dispatches each kind class to its registered component', () => {
	for (const { label, source, kind, selector } of KIND_CLASSES) {
		it(`renders the ${label} component and tags the host with its kind`, () => {
			mounted = mountBlockHost(docOf(source));

			expect(mounted.el.dataset.blockKind).toBe(kind);
			expect(mounted.el.querySelector(selector)).not.toBeNull();
			// The raw-editable fallback is the failure mode this rules out: it also
			// renders, so "something rendered" would pass for a lost registration.
			expect(mounted.el.querySelector('.raw-block')).toBeNull();
		});
	}

	it('applies the registry’s extraProps, which only the dispatcher can deliver', () => {
		mounted = mountBlockHost(docOf('### three\n'));

		expect(mounted.el.querySelector('.heading-3')).not.toBeNull();
	});

	it('renders a plugin kind’s registered component, same as a built-in', () => {
		// Positive control for the fallback pair below: "no component rendered" only
		// means something once a plugin kind is shown to render one.
		const kind = declareComponentlessKind('host-plugin');
		registerBlockComponent(kind, defineBlockComponent(RecordingBlock));
		const doc = docOf('plugin text\n');
		doc.children[0].kind = kind;

		mounted = mountBlockHost(doc);

		expect(mounted.el.querySelector('.recording-block')?.textContent).toBe('plugin text\n');
		expect(mounted.el.querySelector('.raw-block')).toBeNull();
	});

	it('addresses the block by its parent path plus its index', () => {
		const doc = docOf('one\n\ntwo\n');
		mounted = mountBlockHost(doc, { index: 1, parentPath: [4, 2] });

		expect(mounted.el.dataset.blockPath).toBe('[4,2,1]');
	});
});

describe('BlockHost falls back to a raw-editable surface when no component resolves', () => {
	it('renders a kind that has a descriptor but no component', () => {
		const doc = docOf('orphan text\n');
		doc.children[0].kind = declareComponentlessKind('host-orphan');

		mounted = mountBlockHost(doc);

		const fallback = mounted.el.querySelector('.raw-block');
		expect(fallback).not.toBeNull();
		expect(fallback?.textContent).toBe('orphan text');
	});

	it('renders a kind whose component this instance’s registry view disables', () => {
		// The enablement door to "no component" reaches BlockHost through the
		// per-instance registry view: a host reading the globals would render it.
		const kind = declareComponentlessKind('host-disabled');
		registerBlockComponent(kind, defineBlockComponent(RecordingBlock));
		const doc = docOf('disabled text\n');
		doc.children[0].kind = kind;

		mounted = mountBlockHost(
			doc,
			{},
			{ services: { registryView: createRegistryView({ isEnabled: (k) => k !== kind }) } }
		);

		expect(mounted.el.querySelector('.recording-block')).toBeNull();
		expect(mounted.el.querySelector('.raw-block')?.textContent).toBe('disabled text');
	});
});
