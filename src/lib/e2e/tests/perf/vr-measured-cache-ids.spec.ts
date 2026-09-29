import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { spacerCount } from './vr-helpers';

// After a `source` swap the measured-height cache holds only blocks the new document has, even
// for a top-level list that mounts and measures while the swap's first flushes are still running.
// Requirements: e2e/requirements/perf/vr-measured-cache-ids.md.

const LIST_INDEX = 40;

function buildDoc(tag: string): string {
	const para = (i: number) => `${tag} paragraph ${i} with enough words to wrap onto a line.`;
	const list = Array.from({ length: 6 }, (_, i) => `- ${tag} item ${i}\n\n  a second block`).join(
		'\n'
	);
	return [
		...Array.from({ length: LIST_INDEX }, (_, i) => para(i)),
		list,
		...Array.from({ length: 200 }, (_, i) => para(LIST_INDEX + 1 + i))
	].join('\n\n');
}

/** The list's top within the scroll content, or null while it is unmounted. */
function listContentTop(page: Page): Promise<number | null> {
	return page.evaluate((index) => {
		const editor = document.querySelector('.editor') as HTMLElement;
		const host = document.querySelector(`[data-block-path='[${index}]']`);
		if (!host) return null;
		return host.getBoundingClientRect().top - editor.getBoundingClientRect().top + editor.scrollTop;
	}, LIST_INDEX);
}

/** Steps down a viewport at a time until the list mounts, so every block above it is measured. */
async function scrollToList(editor: EditorPage): Promise<number> {
	for (let top = 0; top < 20_000; top += 400) {
		const listTop = await listContentTop(editor.page);
		if (listTop !== null) return listTop;
		await editor.scrollEditorTo(top);
	}
	throw new Error('the list never mounted');
}

function cacheIds(page: Page): Promise<{ measured: string[]; live: string[] }> {
	return page.evaluate(() => {
		const probes = (window as any).__test;
		return { measured: probes.measuredIds(), live: probes.liveBlockIds() };
	});
}

test('a swap leaves only live ids in the measured cache, a list above the fold included', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildDoc('first'));
	expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);

	// The list mounts and measures on the way down, then sits just above the viewport's top.
	const listTop = await scrollToList(editor);
	await editor.scrollEditorTo(listTop + 300);
	await editor.waitForRenderFlush();

	await editor.loadContent(buildDoc('second'));
	for (let i = 0; i < 4; i++) await editor.waitForRenderFlush();

	const { measured, live } = await cacheIds(page);
	const listId = await page.evaluate(
		(index) => (window as any).__test.liveBlockIds()[index] as string,
		LIST_INDEX
	);
	// Without the list's own entry the check says nothing about the container case.
	expect(measured).toContain(listId);
	expect(measured.filter((id) => !live.includes(id))).toEqual([]);
	expect(pageErrors).toEqual([]);
});
