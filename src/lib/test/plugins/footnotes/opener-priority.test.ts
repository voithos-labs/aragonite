import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';

describe('footnote definition opener priority', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('claims [^label]: as its own kind, outranking linkReferenceDefinition', () => {
		const doc = parse('[^1]: A footnote.\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe(FOOTNOTE_DEF_KIND);
	});

	it('declines a plain link reference definition, leaving it to the built-in', () => {
		const doc = parse('[label]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
	});

	it('recognizes the definition only under the footnote (^) form', () => {
		const footnote = parse('[^note]: text\n');
		const plain = parse('[note]: https://example.com\n');
		expect(footnote.children[0].kind).toBe(FOOTNOTE_DEF_KIND);
		expect(plain.children[0].kind).toBe('linkReferenceDefinition');
	});

	it('claims every [^label]: form, including a valid-URL body', () => {
		// The matcher keys on the leading-caret label, not the body, so a url-content
		// footnote is claimed too — the built-in reserves those labels away from link
		// reference definitions, so there is no priority contest to lose.
		const doc = parse('[^1]: https://example.com\n');
		expect(doc.children[0].kind).toBe(FOOTNOTE_DEF_KIND);
	});
});
