// @vitest-environment jsdom
//
// Miss-analysis: the paste suites all drove a grammar-less dispatch, where the global and the
// instance view answer alike, so no test ever pasted a plugin kind's syntax into an editor that
// did not list the plugin (GH #267).
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { parse } from '$lib/core/parser';
import { parrotPlugin, PARROT } from '$lib/plugins/parrot';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { registerPasteSurface } from '$lib/tree-operations/paste-surfaces';
import { __getDefaultTextSurface } from '$lib/tree-operations/paste/hooks';
import { createRegistryView } from '$lib/schema/registry-view';
import { activationFor, kindEnablementFor } from '$lib/schema/plugin-activation';
import { makeEditorActionsDeps, makeStubBlockEdit } from '$lib/test/harness/editor-actions';

const PARROT_LINE = '%%parrot party responsibly\n';

/** The grammar an editor whose `plugins` prop lists `names` parses through. */
function grammarListing(names: string[]) {
	return createRegistryView({ isEnabled: kindEnablementFor(activationFor(names)) }).grammar;
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([parrotPlugin()]);
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
});
afterEach(resetPluginPlatformForTests);

async function pasteInto(grammar: ReturnType<typeof grammarListing>) {
	const { deps } = makeEditorActionsDeps(parse('target\n').children);
	const blockEdit = makeStubBlockEdit();
	await pasteDispatch(
		{ pastedText: PARROT_LINE, targetPath: [0], offset: 'target'.length },
		{
			doc: deps.doc,
			blockEdit,
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
			grammar
		}
	);
	return { doc: deps.doc, blockEdit };
}

describe('a paste parses through the instance grammar, not the global one', () => {
	it('lands the plugin kind for an editor that lists the plugin', async () => {
		const { doc } = await pasteInto(grammarListing(['parrot']));
		expect(doc.children.map((c) => c.kind)).toContain(PARROT);
	});

	// The unlisted opener is gone, so the clipboard is one paragraph: inline, and the marker
	// bytes land as prose rather than minting a kind this editor resolves no component for.
	it('falls back to prose for an editor that does not', async () => {
		const { doc, blockEdit } = await pasteInto(grammarListing([]));
		expect(doc.children.map((c) => c.kind)).not.toContain(PARROT);
		const write = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(write[1]).toContain('target%%parrot party responsibly');
	});
});
