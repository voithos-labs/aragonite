// @vitest-environment jsdom
// A container's `editable` declaration, end to end: a kind declares it, the factory passes it
// through, the mounted block reports it.
// Miss-analysis: no fixture declared `editable: false`, so no test told it from a hardcoded value.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { declaredPluginKind } from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { isBlockEditable } from '$lib/schema/merge-rules';
import { OPAQUE_KIND as KIND, mountOpaque, registerOpaqueKind } from './fixtures/opaque-container';

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
	registerOpaqueKind();
});

afterEach(() => {
	document.body.innerHTML = '';
	resetPluginPlatformForTests();
});

describe('a container kind declaring editable: false', () => {
	it('mounts a surface reporting the declared value, not the shim default', async () => {
		const opaque = mountOpaque();
		expect(opaque.containerApi.editable).toBe(false);
		await opaque.dispose();
	});

	// The declaration reaches the flag the editor actually checks, so the two agree rather
	// than the block saying one thing and merge or search reading another.
	it('agrees with the descriptor flag the gates read', () => {
		expect(isBlockEditable(declaredPluginKind(KIND))).toBe(false);
	});

	it('keeps its caret surface: focusable, and focus lands inside its own box', async () => {
		const opaque = mountOpaque();
		expect(opaque.containerApi.focusable).toBe(true);

		opaque.containerApi.focus(0);
		expect(opaque.box.contains(document.activeElement)).toBe(true);
		// The focused block answers a cursor query, so traversal and selection still see it.
		expect(opaque.containerApi.getCursorOffset()).toBe(0);
		await opaque.dispose();
	});

	it('takes no text input: a typed character creates the paragraph below instead', async () => {
		const opaque = mountOpaque();
		opaque.containerApi.focus(0);

		opaque.surface.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
		);
		flushSync();

		expect(opaque.blockEdit.updateBlockContent).not.toHaveBeenCalled();
		expect(opaque.blockEdit.insertParagraph).toHaveBeenCalledWith(1, 'x');
		await opaque.dispose();
	});
});
