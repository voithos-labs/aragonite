import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	dispatchKeyCommand,
	dispatchKindCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests,
	type CommandErrorReport
} from '$lib/schema/block-commands';
import { __resetCommandWarningsForTests } from '$lib/schema/commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { CstNode } from '$lib/core/nodes';

const history = { history: { requestUndo() {}, requestRedo() {} } };
const nodeOf = (kind: string): CstNode =>
	({
		kind: kind as CstNode['kind'],
		leadingTrivia: '',
		raw: ''
	}) as CstNode;

afterEach(() => {
	__resetCommandWarningsForTests();
	__resetBlockCommandsForTests();
	vi.restoreAllMocks();
});

// A minted command bound to a leaf kind used to dead-key on the leaf path (the
// registry tier was deferred). It now resolves when the focused surface supplies a
// command context — the same seam the container-bubble path uses.
describe('leaf-path dispatch of a minted block command', () => {
	it('runs the handler with the target context + binding arg when a context is supplied', () => {
		const updateMetadata = vi.fn();
		const handler = vi.fn(() => true);
		const id = registerBlockCommand('paragraph', 'demo.tag', handler);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph', arg: 7 }
		]);
		const node = nodeOf('paragraph');
		const runCommand = vi.fn(() => false);

		const handled = dispatchKeyCommand(
			'Mod+Shift+K',
			{ kind: 'paragraph', runCommand, getCommandContext: () => ({ node, updateMetadata }) },
			history,
			overrides
		);

		expect(handled).toBe(true);
		expect(handler).toHaveBeenCalledWith({ node, updateMetadata, arg: 7 });
		expect(runCommand).not.toHaveBeenCalled();
	});
});

// A plugin handler that throws must not escape as an uncaught error. Both dispatch
// paths route the throw to the caller's sink and no-op the gesture. Built-in
// command execution stays UNwrapped — its throws are editor bugs and stay loud.
describe('a throwing plugin handler is contained at the dispatch seam', () => {
	it('contains a leaf-path throw, reports it, and consumes the key', () => {
		const boom = new Error('leaf boom');
		const id = registerBlockCommand('paragraph', 'demo.boom', () => {
			throw boom;
		});
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const node = nodeOf('paragraph');
		const reports: CommandErrorReport[] = [];

		const handled = dispatchKeyCommand(
			'Mod+Shift+K',
			{
				kind: 'paragraph',
				runCommand: () => false,
				getCommandContext: () => ({ node, updateMetadata: () => {} })
			},
			history,
			overrides,
			(r) => reports.push(r)
		);

		expect(handled).toBe(true);
		expect(reports).toEqual([{ kind: 'paragraph', command: id, error: boom }]);
	});

	it('contains a container-bubble throw the same way', () => {
		const boom = new Error('bubble boom');
		const id = registerBlockCommand('listItem', 'demo.boom', () => {
			throw boom;
		});
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'listItem' }
		]);
		const node = nodeOf('listItem');
		const reports: CommandErrorReport[] = [];

		const handled = dispatchKindCommand(
			'Mod+Shift+K',
			{
				kind: 'listItem',
				runCommand: () => false,
				getCommandContext: () => ({ node, updateMetadata: () => {} })
			},
			overrides,
			(r) => reports.push(r)
		);

		expect(handled).toBe(true);
		expect(reports[0]).toMatchObject({ kind: 'listItem', command: id, error: boom });
	});

	it('contains the throw even with no sink wired — safety is unconditional', () => {
		const id = registerBlockCommand('paragraph', 'demo.boom', () => {
			throw new Error('unwired');
		});
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		const node = nodeOf('paragraph');

		expect(() =>
			dispatchKeyCommand(
				'Mod+Shift+K',
				{
					kind: 'paragraph',
					runCommand: () => false,
					getCommandContext: () => ({ node, updateMetadata: () => {} })
				},
				history,
				overrides
			)
		).not.toThrow();
	});

	it('does NOT contain a built-in command throw — editor bugs stay loud', () => {
		// Mod+B → format.toggleStrong (a built-in id): its runCommand is the block's
		// own, executed unwrapped, so a throw propagates.
		const runCommand = vi.fn(() => {
			throw new Error('builtin boom');
		});
		expect(() => dispatchKeyCommand('Mod+B', { kind: 'paragraph', runCommand }, history)).toThrow(
			'builtin boom'
		);
	});
});
