import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { getPluginMetadata, type AnyBlockKind } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { collectCrossBlockText } from '../../selection/clipboard-text';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { augmentBlockKind, getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import type { SelectionPoint } from '../../selection/primitives';

// A cross-block copy whose END lands inside a container's reserved chrome (title/summary) used to
// emit wrapper-less bytes that reparse to a bare paragraph, losing the container kind on paste.

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

function registerPlugins() {
	// registerChromeLeaf registers a paste surface the schema reset leaves orphaned,
	// so both registries reset before re-registering (a re-register would collide).
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerCalloutKind();
	registerDetailsKind();
}

describe('cross-block copy ending in reserved chrome', () => {
	beforeEach(registerPlugins);

	it('mid-title endpoint synthesizes a reparseable note with truncated title, empty body', () => {
		const doc = parse('Above\n\n:::callout Title\nBody\n:::\n\nBelow\n');
		const text = collectCrossBlockText(doc, point([0], 2), point([1, 0], 3));
		const note = parse(text).children.find((c) => c.kind === 'callout');
		expect(note).toBeDefined();
		expect(note!.children?.map((c) => c.kind)).toEqual(['callout-title']);
		expect(trimTrailingLineEnding(note!.children![0].raw)).toBe('Tit');
	});

	it('whole-title endpoint (offset at chrome end) synthesizes the full title, empty body', () => {
		const doc = parse('Above\n\n:::callout Title\nBody\n:::\n\nBelow\n');
		const text = collectCrossBlockText(doc, point([0], 2), point([1, 0], 5));
		const note = parse(text).children.find((c) => c.kind === 'callout');
		expect(note!.children?.map((c) => c.kind)).toEqual(['callout-title']);
		expect(trimTrailingLineEnding(note!.children![0].raw)).toBe('Title');
	});

	// The details opener carries `open` in metadata; the synthesized container must
	// hand rebuildRaw the live node's metadata so the flag round-trips to bytes.
	for (const { label, src, open } of [
		{
			label: 'open',
			src: 'Above\n\n<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n',
			open: true
		},
		{
			label: 'closed',
			src: 'Above\n\n<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n',
			open: false
		}
	]) {
		it(`mid-summary endpoint (${label}) synthesizes a details with the open flag preserved`, () => {
			const doc = parse(src);
			const text = collectCrossBlockText(doc, point([0], 2), point([1, 0], 3));
			const details = parse(text).children.find((c) => c.kind === 'details');
			expect(details).toBeDefined();
			expect(getPluginMetadata<{ open: boolean }>(details!)?.open).toBe(open);
			expect(details!.children?.map((c) => c.kind)).toEqual(['details-summary']);
			expect(trimTrailingLineEnding(details!.children![0].raw)).toBe('Sum');
		});
	}

	it('hands rebuildRaw a metadata copy: a plugin writing metadata cannot touch the live node', () => {
		const kind = DETAILS as AnyBlockKind;
		const original = getBlockKindDescriptor(kind).rebuildRaw!;
		augmentBlockKind(kind, {
			container: {
				rebuildRaw: (node) => {
					const meta = getPluginMetadata<Record<string, unknown>>(node);
					if (meta) meta.rogue = true;
					original(node);
				}
			}
		});

		const doc = parse(
			'Above\n\n<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n'
		);
		const text = collectCrossBlockText(doc, point([0], 2), point([1, 0], 3));

		expect(text).toContain('<details open>'); // the rogue wrapper still rebuilt
		expect(getPluginMetadata<{ rogue?: boolean }>(doc.children[1])?.rogue).toBeUndefined();
	});

	// Regression pins: a non-chrome container endpoint (listItem / blockquote) must
	// still recover its marker via the existing suffix-arithmetic path, untouched.
	it('leaves the listItem marker-recovery path unchanged', () => {
		const doc = parse('Above\n\n1. hello\n');
		const text = collectCrossBlockText(doc, point([0], 2), point([1, 0, 0], 3));
		expect(text).toBe('ove\n1. hel');
	});

	it('leaves a blockquote endpoint on the marker-recovery path', () => {
		const doc = parse('Above\n\n> quoted\n');
		const text = collectCrossBlockText(doc, point([0], 2), point([1, 0], 3));
		expect(text).toBe('ove\n> quo');
	});
});
