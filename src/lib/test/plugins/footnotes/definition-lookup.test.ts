import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '$lib/plugins/footnotes';
// Plugin-internal: the walk answers a reference widget's jump, which only a mounted widget
// makes.
import { findFootnoteDefinitionLanding } from '$lib/plugins/footnotes/footnote-lookup';

describe('footnote definition lookup (where a reference jump lands)', () => {
	beforeEach(() => {
		// Install so `[^label]:` opens a footnote-def at all; without the plugin every
		// definition line parses as a paragraph and the walk finds nothing.
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('lands in the definition body, not on the container that seats no caret', () => {
		const doc = parse('Prose [^a] and [^b].\n\n[^a]: A def.\n\n[^b]: B def.\n');
		expect(findFootnoteDefinitionLanding(doc, 'a')).toEqual([1, 0]);
		expect(findFootnoteDefinitionLanding(doc, 'b')).toEqual([2, 0]);
	});

	it('walks into a container to find a nested definition', () => {
		const doc = parse('Prose [^a].\n\n> [^a]: Quoted def.\n');
		expect(findFootnoteDefinitionLanding(doc, 'a')).toEqual([1, 0, 0]);
	});

	it('returns null for a label no definition carries', () => {
		const doc = parse('An orphan [^missing].\n\n[^other]: Other def.\n');
		expect(findFootnoteDefinitionLanding(doc, 'missing')).toBeNull();
	});

	it('answers with the first of two definitions sharing a label', () => {
		const doc = parse('Prose [^a].\n\n[^a]: First.\n\n[^a]: Second.\n');
		expect(findFootnoteDefinitionLanding(doc, 'a')).toEqual([1, 0]);
	});

	it('finds a definition that sits before its reference', () => {
		const doc = parse('[^a]: Defined up front.\n\nProse [^a].\n');
		expect(findFootnoteDefinitionLanding(doc, 'a')).toEqual([0, 0]);
	});
});
