// @vitest-environment jsdom
// The `setup` row with a DOM: the same plugin that reads `unchecked` in plain Node runs here, against
// an editor that reads the plugin's samples, commits drafts and answers as one with nothing on screen.
import { describe, expect, it, vi } from 'vitest';
import { definePlugin, lineBlock, type Editor } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

// A block type is the first listing plugin's, so each plugin here makes its own.
function withSetup(name: string, setup: (editor: Editor) => void | (() => void)) {
	const memo = lineBlock({
		name: 'memo',
		label: 'Memo',
		sample: '%%a memo',
		insert: { none: 'a fixture of the check suite' },
		match: /^%%(?<text>.*)$/
	});
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [memo], setup })
	});
}

const setupRow = (report: CheckReport) => report.rows.find((row) => row.check === 'setup');

describe('the setup row with a DOM', () => {
	it('runs a setup that reaches for document, then the function it returns', async () => {
		let disposed = false;
		const touches = withSetup('touches', () => {
			void document.title;
			return () => void (disposed = true);
		});
		expect(setupRow(await check(touches))?.status).toBe('passed');
		expect(disposed).toBe(true);
	});

	it("hands setup an editor over the plugin's samples, with real drafts and nothing on screen", async () => {
		const seen: unknown[] = [];
		const reads = withSetup('reads', (editor) => {
			const [block] = editor.doc.blocks;
			seen.push(block.type.name, editor.view.boxOf(block), editor.selection, editor.mode);
			void editor
				.edit()
				.replace({ from: block.from + 2, to: block.from + 3 }, 'A')
				.commit()
				.then((result) => seen.push(result, editor.doc.text));
		});
		await check(reads);
		expect(seen.slice(0, 3)).toEqual(['reads/memo', null, null]);
		await vi.waitFor(() => expect(seen.slice(-2)).toEqual([{ ok: true }, '%%A memo\n']));
	});

	it('fails a setup that throws, naming what it threw', async () => {
		const throws = withSetup('throws', () => {
			throw new Error('no editor for me');
		});
		const report = await check(throws).catch((error: unknown) => {
			if (isCheckFailure(error)) return error.report;
			throw error;
		});
		expect(setupRow(report)).toMatchObject({ status: 'failed', detail: 'threw: no editor for me' });
	});
});
