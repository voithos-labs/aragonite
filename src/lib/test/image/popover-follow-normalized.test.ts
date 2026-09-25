// Miss-analysis: every follow case wrote a paragraph, whose kind stores the bytes it is given, so
// no test wrote an image in a kind whose own write rule changes or refuses the bytes.
import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createImageEditCommitter } from '../../components/image/image-edit-commit';
import { imageFieldsFromInline } from '../../components/image/image-source-bytes';
import { createWidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { getInlineContent } from '../../core/inline/inline-cache';
import { parse } from '../../core/parser';
import type { CstNode, Document } from '../../core/nodes';
import { createEditorEvents } from '../../editor-events';
import { makeStubController } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';
import { testLeaf } from '$lib/test/harness/test-kinds';

afterEach(() => resetPluginPlatformForTests());

/** A leaf kind that renders inline images and stores `rule(raw)` for every write of its bytes. */
function probeKind(name: string, rule: (raw: string, node: { raw: string }) => string): string {
	const kind = testLeaf(name, {
		supportsInline: true,
		normalizeRawWrite: rule
	});
	return kind;
}

/** Two images in one block of `kind`, the second selected, and an edit to the first. */
function secondImageSelected(kind: string) {
	let doc: Document = parse('![a](a.png) ![b](a.png)\n');
	(doc.children[0] as CstNode).kind = kind as CstNode['kind'];
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	const committer = createImageEditCommitter({
		getDoc: () => doc,
		getEditorEl: () => null,
		widgetSelection,
		controller: makeStubController(),
		events: createEditorEvents(),
		reading: fixtureReading()
	});
	widgetSelection.select({ paragraphPath: [0], sourceStart: 12, preSelectOffset: 0 });
	const first = getInlineContent(
		doc.children[0] as CstNode,
		undefined,
		undefined,
		defaultGrammarView
	).find((n) => n.kind === 'image')!;
	committer.commitImageEdit(
		{ paragraphPath: [0], sourceStart: 0, preSelectOffset: 11 },
		imageFieldsFromInline(first),
		{ alt: 'a longer', url: 'a.png' }
	);
	/** The document after a content change, as the content-version effect sees it. */
	const changeTo = (raw: string) => {
		doc = parse(raw);
		(doc.children[0] as CstNode).kind = kind as CstNode['kind'];
		committer.clearStaleSelection();
	};
	return { widgetSelection, changeTo };
}

describe('the popover follow after a kind rewrites the bytes it was given', () => {
	it('moves the selection by the length the kind stored', async () => {
		const pad = probeKind('probe-pad', (raw) => raw.replace('![a longer]', '![a longer!]'));
		const s = secondImageSelected(pad);

		s.changeTo('![a longer!](a.png) ![b](a.png)\n');
		await tick();

		expect(s.widgetSelection.getSelected()?.sourceStart).toBe(20);
	});

	it('arms nothing when the kind refuses the write', async () => {
		const refuse = probeKind('probe-refuse', (_raw, node) => node.raw);
		const s = secondImageSelected(refuse);

		// A later change that moves nothing: the selected image stays where it is.
		s.changeTo('![a](a.png) ![b](a.png)\n');
		await tick();

		expect(s.widgetSelection.getSelected()?.sourceStart).toBe(12);
	});
});
