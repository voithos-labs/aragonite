import { describe, it, expect } from 'vitest';
import { checkInlineMenuCommitAcrossSwap } from '$lib/testing';
import { createSlashSource } from '$lib/plugins/slash-commands/slash-source';
import type { EditorContext } from '$lib/plugin';

// The kit cell must pass a source that writes through the context its commit is handed, and
// fail one that writes through the context it closed over.
function held() {
	let release = () => {};
	const wait = new Promise<void>((r) => (release = r));
	return { wait, release: () => release() };
}

describe('checkInlineMenuCommitAcrossSwap', () => {
	it('passes the slash source with a host run that waits, then inserts', async () => {
		const gate = held();
		const run = async (editor: EditorContext) => {
			await gate.wait;
			await editor.insertMarkdown('> embed');
		};
		await checkInlineMenuCommitAcrossSwap({
			source: (editor) =>
				createSlashSource(
					Object.create(editor, { options: { value: { entries: [{ id: 'e', label: 'E', run }] } } })
				),
			item: { id: 'e', label: 'E', insert: '' },
			release: gate.release
		});
	});

	it('passes a source that writes through its onEditor context only if the note is unchanged', async () => {
		const gate = held();
		await checkInlineMenuCommitAcrossSwap({
			source: (editor) => ({
				name: 'guarded',
				trigger: '@',
				items: () => [],
				onCommit: async () => {
					const generation = editor.documentGeneration;
					await gate.wait;
					if (editor.documentGeneration === generation) await editor.insertMarkdown('> card');
				}
			}),
			item: { id: 'a', label: 'A', insert: '' },
			release: gate.release
		});
	});

	it('fails a source whose waiting commit writes through its onEditor context unguarded', async () => {
		const gate = held();
		await expect(
			checkInlineMenuCommitAcrossSwap({
				source: (editor) => ({
					name: 'closure',
					trigger: '@',
					items: () => [],
					onCommit: async () => {
						await gate.wait;
						await editor.insertMarkdown('> card');
					}
				}),
				item: { id: 'a', label: 'A', insert: '' },
				release: gate.release
			})
		).rejects.toThrow(/after the host loaded another document/);
	});
});
