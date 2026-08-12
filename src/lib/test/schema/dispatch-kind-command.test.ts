import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatchKindCommand, registerBlockCommand } from '$lib/schema/block-commands';
import { __resetBlockCommandsForTests } from '$lib/schema/block-commands';
import { mintCommandId } from '$lib/schema/command-id';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { takeDevWarns } from '../support/warn-gate';
import type { CstNode } from '$lib/core/nodes';

const listItemNode = (): CstNode => ({
	kind: 'listItem',
	leadingTrivia: '',
	raw: '',
	metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
});

describe('container-bubble dispatch over the block-command registry', () => {
	afterEach(() => {
		__resetBlockCommandsForTests();
		vi.restoreAllMocks();
	});

	it('runs the registered handler with the command context and the binding arg', () => {
		const updateMetadata = vi.fn();
		const handler = vi.fn(() => true);
		const id = registerBlockCommand('listItem', 'demo.setFoo', handler);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'listItem', arg: 42 }
		]);
		const node = listItemNode();
		const runCommand = vi.fn(() => false);

		const handled = dispatchKindCommand(
			'Mod+Shift+K',
			{ kind: 'listItem', runCommand, getCommandContext: () => ({ node, updateMetadata }) },
			overrides
		);

		expect(handled).toBe(true);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ node, updateMetadata, arg: 42 });
		expect(runCommand).not.toHaveBeenCalled();
	});

	it('dead-keys and warns once when a bound plugin id has no registered handler', () => {
		// Minted but never registered on any kind → getBlockCommand misses.
		const id = mintCommandId('demo.ghost');
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'listItem' }
		]);
		const runCommand = vi.fn(() => false);

		const first = dispatchKindCommand('Mod+Shift+K', { kind: 'listItem', runCommand }, overrides);
		const second = dispatchKindCommand('Mod+Shift+K', { kind: 'listItem', runCommand }, overrides);

		expect(first).toBe(false);
		expect(second).toBe(false);
		expect(runCommand).not.toHaveBeenCalled();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});

	it('falls through to runCommand for a built-in kind command with no command context', () => {
		const runCommand = vi.fn(() => true);

		// The built-in listItem keymap binds Tab → list.indent.
		const handled = dispatchKindCommand('Tab', { kind: 'listItem', runCommand });

		expect(handled).toBe(true);
		expect(runCommand).toHaveBeenCalledWith('list.indent', undefined);
	});

	it('returns false without warning when no binding resolves', () => {
		const runCommand = vi.fn(() => false);
		const handled = dispatchKindCommand('Mod+J', { kind: 'listItem', runCommand });
		expect(handled).toBe(false);
		expect(runCommand).not.toHaveBeenCalled();
		expect(takeDevWarns()).toEqual([]);
	});
});
