import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { setPluginMetadata } from '$lib/plugin';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { reclassifyContainer } from '$lib/tree-operations';
import { rebuildContainerRaw } from '$lib/schema/container-raw';
import { createGrammarView } from '$lib/schema/block-openers';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import type { CstNode, Document } from '$lib/core/nodes';

// The pure half of the container kind-change path: a container whose rebuilt raw opens
// as a different kind is replaced in its parent's slot. Eligibility is the opener
// registry, since a kind with no standalone recognizer reparses to something else. The
// editor-driven half is test/plugins/admonitions/github-alert-typed-formation.test.ts.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

/** Write `raw` into the container's first leaf and rebuild, as an inner edit does. */
function editFirstLeaf(container: CstNode, raw: string): void {
	container.children![0].raw = raw;
	rebuildContainerRaw(container);
}

describe('reclassifyContainer', () => {
	it('promotes a blockquote whose rebuilt raw opens as a github alert', () => {
		const doc: Document = parse('> [!TI\n');
		editFirstLeaf(doc.children[0], '[!TIP]\n');

		const replacement = reclassifyContainer(doc, 0);

		expect(replacement?.kind).toBe('githubAlert');
		expect(doc.children[0]).toBe(replacement);
		expect(checkStaleRaw(doc.children[0])).toBeNull();
	});

	it('carries the slot leading trivia onto the replacement', () => {
		const doc: Document = parse('intro\n\n\n> [!TI\n');
		const quoteIndex = 1;
		const trivia = doc.children[quoteIndex].leadingTrivia;
		expect(trivia).not.toBe('');
		editFirstLeaf(doc.children[quoteIndex], '[!TIP]\n');

		expect(reclassifyContainer(doc, quoteIndex)?.leadingTrivia).toBe(trivia);
	});

	// The mirror direction, reachable only by a metadata write: the pass must not be one-way.
	it('demotes an alert whose rebuilt marker no longer names an alert type', () => {
		const doc: Document = parse('> [!TIP]\n> body\n');
		setPluginMetadata(doc.children[0], { alertType: 'NOPE' });
		rebuildContainerRaw(doc.children[0]);
		expect(doc.children[0].raw).toBe('> [!NOPE]\n> body\n');

		expect(reclassifyContainer(doc, 0)?.kind).toBe('blockquote');
	});

	it('leaves a container whose kind is unchanged in place', () => {
		const doc: Document = parse('> body\n');
		const before = doc.children[0];
		editFirstLeaf(before, 'edited\n');

		expect(reclassifyContainer(doc, 0)).toBeNull();
		expect(doc.children[0]).toBe(before);
	});

	// A listItem's raw parses to a LIST and a tableRow's to a paragraph, so re-deriving
	// either from its own raw destroys it. The rule is the opener registry, not a name list.
	it.each([
		['listItem', '- [!TI\n', '[!TIP]\n'],
		['tableRow', '| a |\n| - |\n| b |\n', 'x']
	])('never re-derives %s, which has no standalone opener', (kind, source, leafRaw) => {
		const doc: Document = parse(source);
		const container = { children: doc.children[0].children! };
		const child = container.children[0];
		expect(child.kind).toBe(kind);
		child.children![0].raw = leafRaw;
		rebuildContainerRaw(child);

		expect(reclassifyContainer(container, 0)).toBeNull();
		expect(container.children[0].kind).toBe(kind);
	});

	it('leaves leaf blocks alone — updateNodeContent owns their kind', () => {
		const doc: Document = parse('plain\n');
		doc.children[0].raw = '# heading\n';

		expect(reclassifyContainer(doc, 0)).toBeNull();
	});

	it('resolves through the instance grammar, not the global registry', () => {
		const doc: Document = parse('> [!TI\n');
		editFirstLeaf(doc.children[0], '[!TIP]\n');
		const withoutAlerts = createGrammarView((kind) => kind !== 'githubAlert');

		expect(reclassifyContainer(doc, 0, withoutAlerts)).toBeNull();
		expect(doc.children[0].kind).toBe('blockquote');
	});

	// A freshly-parsed replacement carries no childIds, so undefined keys reach the nested
	// keyed `{#each}` and throw on the second child. One body child cannot expose it.
	it('assigns child ids on a replacement with a multi-block body', () => {
		const doc: Document = parse('> [!TI\n>\n> a\n>\n> b\n');
		editFirstLeaf(doc.children[0], '[!TIP]\n');

		const alert = reclassifyContainer(doc, 0);

		expect(alert?.children).toHaveLength(2);
		expect(alert?.childIds).toHaveLength(2);
		expect(alert?.childIds?.filter(Boolean)).toHaveLength(2);
	});

	// The backfilled focus paragraph has no bytes in the typed raw, unlike a blockquote whose
	// `>` line doubles as the blank body, so the replacement must rebuild through it (G1.1).
	it('backfills a caret target into a marker-only alert and rebuilds its raw', () => {
		const doc: Document = parse('> [!TI\n');
		editFirstLeaf(doc.children[0], '[!TIP]\n');

		const alert = reclassifyContainer(doc, 0);

		expect(alert?.children).toHaveLength(1);
		expect(alert?.raw).toBe('> [!TIP]\n>\n');
		expect(checkStaleRaw(alert!)).toBeNull();
	});
});
