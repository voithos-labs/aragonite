// @vitest-environment jsdom
//
// The block-edge arms in a mode that paints no marker: the caret's reachable bounds are the
// kind's CONTENT range, and a kind declaring `contentStartBackspace: 'demote-first'` gives up its
// own structural bytes before the merge cascade sees the press.
// Miss-analysis: the arms were pinned only through their byte effects at raw 0, which every mode
// agrees on, so nothing could observe the bound moving — the one thing live changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import type { PresentationMode } from '$lib/presentation-mode';
import { DIRECTIVE_LEAF, registerDirectiveKinds } from '$lib/core/directive/kinds';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

/** One block under a presentation root, focused, with the caret seated by the block's own door. */
function mountBlock(source: string, mode: PresentationMode, caret: number) {
	const root = document.createElement('div');
	if (mode !== 'source') root.setAttribute('data-presentation', mode);
	document.body.appendChild(root);
	const doc = parse(source);
	const blockEdit = makeStubBlockEdit();

	// The reference map the editor root builds, so a reference construct is a construct here too.
	const references = buildLinkReferenceMap(doc.children);
	const instance = mount(TextEditableBlock, {
		target: root,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			blockEdit,
			doc: {
				doc: () => doc,
				linkRef: { current: references.resolve, signature: references.signature }
			},
			policies: { presentationMode: () => mode }
		})
	});
	flushSync();

	(root.querySelector('.text-editable-block') as HTMLElement).focus();
	instance.setSelection(caret, caret);
	return { instance, blockEdit };
}

let mounted: ReturnType<typeof mountBlock>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('Backspace at content start in live mode', () => {
	it('demotes an ATX heading in one commit instead of merging', () => {
		mounted = mountBlock('## Title\n', 'live', 3);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title\n', 3, 0);
		expect(mounted.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
	});

	// Setext carries its structure as a SUFFIX, so its content start is raw 0 and the same
	// declaration has to reach the press from the other end.
	it('drops a setext heading’s underline', () => {
		mounted = mountBlock('Title\n===\n', 'live', 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title\n', 0, 0);
		expect(mounted.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
	});

	// Raw 0 is behind the unpainted prefix, so no caret walk reports it — but a caret door can
	// still park one there, and a gate testing equality would make the press a dead key. The arm
	// reads at-or-before the reachable start, so the gesture does the visible thing either way.
	it('still demotes from raw 0, an offset behind the unpainted prefix', () => {
		mounted = mountBlock('## Title\n', 'live', 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title\n', 0, 0);
		expect(mounted.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
	});

	// A heading opening with a construct hides two runs before its first visible byte, and the
	// caret walk reports THAT offset — the bound has to be the reachable one or the press dies.
	it('demotes a heading that opens with a construct, at the caret the walk reports', () => {
		mounted = mountBlock('## **B** head\n', 'live', 5);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, '**B** head\n', 5, 2);
	});

	// A REFERENCE construct is only a construct once the document's definitions resolve it: read
	// without them `[B][r]` is plain text, its `[`s are content, and the bound stays at the `#`s
	// where no caret ever lands. The bounds read the tree the render painted, resolver included.
	it('demotes a heading opening with a reference link', () => {
		mounted = mountBlock('## [B][r] head\n\n[r]: https://example.com\n', 'live', 4);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, '[B][r] head\n', 4, 1);
	});

	// The other kind whose content start moved: a directive leaf's `::` is unpainted too, so its
	// content-start press now reaches the cascade, where `not-mergeable` turns it into a focus
	// move. Asserted through the declarations the arm reads — the leaf's opener needs the plugin's
	// grammar, which a bare block mount does not stand up, and the paragraph row above already
	// drives the undeclared path end to end.
	it('leaves a declared-content kind with no demote to the cascade', () => {
		registerDirectiveKinds();
		try {
			const leaf = getBlockKindDescriptor(declaredPluginKind(DIRECTIVE_LEAF));
			expect(leaf.getContentRange).toBeDefined();
			expect(leaf.contentStartBackspace).toBeUndefined();
			expect(leaf.mergeRole).toBe('not-mergeable');
		} finally {
			__resetSchemaRegistriesForTests();
		}
	});

	// The command's other half, for the callers that never pass the keydown dispatch (cross-block
	// dispatch, a plugin chord): a setext heading cannot absorb the block below without pulling
	// its underline into view, so the arm declines wherever the caret claims to be.
	it('declines mergeNext on a block whose structure sits past its content', () => {
		mounted = mountBlock('Title\n===\n', 'live', 7);

		expect(mounted.instance.runCommand('block.mergeNext')).toBe(false);
		expect(mounted.blockEdit.mergeWithNext).not.toHaveBeenCalled();
	});

	it('merges a kind that declares no demote, at its own content start', () => {
		mounted = mountBlock('Title\n', 'live', 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.mergeWithPrevious).toHaveBeenCalledWith(0);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});

// Source and the preview rungs paint the prefix, so the bytes beside the caret are the user's to
// delete and raw 0 is the block's start exactly as before.
describe('the same press outside a marker-hiding mode', () => {
	it.each<PresentationMode>(['source', 'preview-inline'])('merges at raw 0 in %s', (mode) => {
		mounted = mountBlock('## Title\n', mode, 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.mergeWithPrevious).toHaveBeenCalledWith(0);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('does not fire at the content start in source', () => {
		mounted = mountBlock('## Title\n', 'source', 3);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(false);
		expect(vi.mocked(mounted.blockEdit.updateBlockContent)).not.toHaveBeenCalled();
	});
});
