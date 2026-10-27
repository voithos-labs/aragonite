import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	dispatchKeyCommand,
	dispatchKindCommand,
	registerBlockCommand,
	type CommandErrorReport
} from '#lib/schema/block-commands.js';
import { normalizeKeybindingOverrides } from '#lib/schema/keybinding-overrides.js';
import type { CstNode } from '#lib/core/nodes.js';
import { commandContext, commandContextWith } from '../harness/command-context';

const nodeOf = (kind: string): CstNode =>
	({
		kind: kind as CstNode['kind'],
		leadingTrivia: '',
		raw: ''
	}) as CstNode;

afterEach(() => {
	vi.restoreAllMocks();
});

// A plugin command bound to a leaf kind resolves once the focused block supplies a command
// context, through the same code the container-bubble path uses.
describe('leaf-path dispatch of a created block command', () => {
	it('runs the handler with the target context + binding arg when a context is supplied', () => {
		const updateMetadata = vi.fn();
		const replaceRaw = vi.fn();
		const handler = vi.fn(() => true);
		const id = registerBlockCommand('paragraph', 'demo.tag', handler);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph', arg: 7 }
		]);
		const node = nodeOf('paragraph');
		const runCommand = vi.fn(() => false);

		const handled = dispatchKeyCommand(
			'Mod+Shift+K',
			{
				kind: 'paragraph',
				runCommand,
				getCommandContext: () => ({ node, updateMetadata, replaceRaw })
			},
			commandContextWith(overrides)
		);

		expect(handled).toBe(true);
		expect(handler).toHaveBeenCalledWith({
			node,
			updateMetadata,
			replaceRaw,
			arg: 7,
			afterRemoval: false
		});
		expect(runCommand).not.toHaveBeenCalled();
	});
});

// A plugin command runs once a shown source is written. Miss-analysis: only block moves waited, and
// no row ran a plugin command over an open source, so a rewrite from stale bytes went unseen.
describe('a plugin command over a shown source', () => {
	const tagCommand = () =>
		registerBlockCommand('paragraph', 'demo.tag', (ctx) => {
			ctx.replaceRaw(`${ctx.node.raw}!`);
			return true;
		});

	it('runs after the source is written, against the node that write left', () => {
		const id = tagCommand();
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		let node = { ...nodeOf('paragraph'), raw: 'tex' };
		let written: (() => void) | undefined;
		const replaceRaw = vi.fn();

		const handled = dispatchKeyCommand(
			'Mod+Shift+K',
			{
				kind: 'paragraph',
				runCommand: () => false,
				getCommandContext: () => ({ node, updateMetadata: () => {}, replaceRaw }),
				afterSourceCommit: (run) => (written = run)
			},
			commandContextWith(overrides)
		);

		expect(handled).toBe(true);
		expect(replaceRaw).not.toHaveBeenCalled();
		node = { ...node, raw: 'text' };
		written!();
		expect(replaceRaw).toHaveBeenCalledWith('text!');
	});

	it("answers with the handler's own result when no source is shown", () => {
		const id = registerBlockCommand('paragraph', 'demo.decline', () => false);
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);

		const handled = dispatchKeyCommand(
			'Mod+Shift+K',
			{
				kind: 'paragraph',
				runCommand: () => false,
				getCommandContext: () => ({
					node: nodeOf('paragraph'),
					updateMetadata: () => {},
					replaceRaw: () => {}
				}),
				afterSourceCommit: (run) => run()
			},
			commandContextWith(overrides)
		);

		expect(handled).toBe(false);
	});
});

// A throw from a plugin goes to the caller's error callback on both dispatch paths; a built-in
// command is not wrapped, because a throw there is an editor bug and stays loud.
describe('a throwing plugin handler is contained at the command dispatch', () => {
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
				getCommandContext: () => ({ node, updateMetadata: () => {}, replaceRaw: () => {} })
			},
			commandContextWith(overrides, { onCommandError: (r) => reports.push(r) })
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
				getCommandContext: () => ({ node, updateMetadata: () => {}, replaceRaw: () => {} })
			},
			commandContextWith(overrides, { onCommandError: (r) => reports.push(r) })
		);

		expect(handled).toBe(true);
		expect(reports[0]).toMatchObject({ kind: 'listItem', command: id, error: boom });
	});

	it('does not contain a built-in command throw: editor bugs stay loud', () => {
		// Mod+B → format.toggleStrong (a built-in id): its runCommand is the block's
		// own, executed unwrapped, so a throw propagates.
		const runCommand = vi.fn(() => {
			throw new Error('builtin boom');
		});
		expect(() =>
			dispatchKeyCommand('Mod+B', { kind: 'paragraph', runCommand }, commandContext())
		).toThrow('builtin boom');
	});
});
