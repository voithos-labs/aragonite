import { describe, it, expect, beforeEach, vi } from 'vitest';
import { composeExpandDoor } from '$lib/editor-actions/plugin/container';
import { getPluginMetadata, setPluginMetadata, type CstNode } from '$lib/core/nodes';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

// What opening a collapsed body commits, and when it declines. `expandPatch` is declared
// beside `isCollapsed` on `reservedChrome`, so the rule that hides a body and the one that
// opens it read the same place.

function registerCollapsible(name: string, withDoor: boolean) {
	const chrome = declarePluginKind(`${name}-chrome`);
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: {
			contract: 'strip',
			rebuildRaw: () => {},
			reservedChrome: {
				kind: chrome,
				isCollapsed: (n) => !getPluginMetadata<{ open: boolean }>(n)?.open,
				...(withDoor ? { expandPatch: () => ({ open: true }) } : {})
			}
		}
	});
	return kind;
}

function containerNode(kind: ReturnType<typeof declarePluginKind>, open: boolean): CstNode {
	const node: CstNode = { kind, leadingTrivia: '', raw: '' };
	setPluginMetadata(node, { open });
	return node;
}

function door(
	kind: ReturnType<typeof declarePluginKind>,
	over: { open?: boolean; mode?: 'source' | 'reading' }
) {
	const node = containerNode(kind, over.open ?? false);
	const commit = vi.fn<(patch: Record<string, unknown>) => void>();
	return {
		commit,
		open: composeExpandDoor({
			getNode: () => node,
			isCollapsed: () => !(over.open ?? false),
			getPresentationMode: () => over.mode ?? 'source',
			commit
		})
	};
}

describe('composeExpandDoor', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('commits the declared patch for a collapsed container', async () => {
		const d = door(registerCollapsible('door-open', true), {});

		await expect(d.open()).resolves.toBe(true);
		expect(d.commit).toHaveBeenCalledWith({ open: true });
	});

	it('declines without committing when the container is already open', async () => {
		const d = door(registerCollapsible('door-already', true), { open: true });

		await expect(d.open()).resolves.toBe(false);
		expect(d.commit).not.toHaveBeenCalled();
	});

	// The floor: a collapsible kind that declares no `expandPatch` opens without committing
	// anything, rather than the editor inventing a patch on its behalf.
	it('declines when the kind declares no expandPatch', async () => {
		const d = door(registerCollapsible('door-none', false), {});

		await expect(d.open()).resolves.toBe(false);
		expect(d.commit).not.toHaveBeenCalled();
	});

	// Reading mode commits nothing at all (G4.19, in a place the lint cannot see): opening
	// there just shows the title row instead of editing the document.
	it('declines in reading mode — the reveal degrades rather than committing', async () => {
		const d = door(registerCollapsible('door-reading', true), { mode: 'reading' });

		await expect(d.open()).resolves.toBe(false);
		expect(d.commit).not.toHaveBeenCalled();
	});
});
