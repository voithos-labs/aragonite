/**
 * The documents and reads the nested-container anchor specs share: a windowed document with a
 * container at root index 30, opened under either scroll mode, and every scroll write the editor
 * makes counted by assigning through the scroll container's own `scrollTop`.
 */
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { gotoPageScroll, scrollPageTo } from './vr-helpers';

export type ScrollMode = 'self' | 'host';

export const CONTAINER = 30;
export const BELOW = 32;

const para = (i: number) => `Paragraph ${i} with enough words in it to fill most of a line.`;

export function docWith(container: string): string {
	return [
		...Array.from({ length: CONTAINER }, (_, i) => para(i)),
		container,
		...Array.from({ length: 150 }, (_, i) => para(CONTAINER + 1 + i))
	].join('\n\n');
}

/** A list of `count` items of two blocks each; item `bodyItem`'s second block onwards is `body`. */
export function listOf(count: number, bodyItem: number, body: string): string {
	return Array.from({ length: count }, (_, i) =>
		i === bodyItem ? `- item ${i}\n\n  ${body}` : `- item ${i}\n\n  a second block`
	).join('\n');
}

/** A blockquote of `count` paragraphs, paragraph 1 being `first` and every other one ending `words`. */
export function quoteOf(count: number, first: string, words = 'with a few words.'): string {
	return Array.from({ length: count }, (_, i) =>
		i === 1 ? `> ${first}` : `> Quoted paragraph ${i} ${words}`
	).join('\n>\n');
}

export interface NestedPage {
	editor: EditorPage;
	mode: ScrollMode;
	scrollTo(top: number): Promise<void>;
	/** A block's box in the scroll content, or null while it is unmounted. */
	contentBox(path: number[]): Promise<{ top: number; bottom: number } | null>;
	/** A block's top below the scroll container's, or null while it is unmounted: the harness's own
	 *  header above a self-scrolling editor re-wraps on a resize, and that shift isn't the editor's. */
	screenTop(path: number[]): Promise<number | null>;
	/** Scrolls down until `path` mounts, then puts the viewport's top 5px into it. */
	topInside(path: number[]): Promise<void>;
	/** Starts counting the editor's scroll writes; the returned read lists each write's distance. */
	countWrites(): Promise<() => Promise<number[]>>;
}

/** Opens `doc` in the editor scrolling itself (`/test/editor`) or the page (`/test/page-scroll`). */
export async function openNested(page: Page, mode: ScrollMode, doc: string): Promise<NestedPage> {
	const editor = new EditorPage(page);
	if (mode === 'self') await editor.goto();
	else {
		await gotoPageScroll(page);
		// The route mounts its images as placeholders until asked.
		await page.evaluate(() => (window as any).__pageScroll.loadDocumentImage());
	}
	await editor.loadContent(doc);
	const host = mode === 'host';

	const contentBox = (path: number[]) =>
		page.evaluate(
			({ p, host }) => {
				const el = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`);
				if (!el) return null;
				const rect = el.getBoundingClientRect();
				const editorEl = document.querySelector('.editor') as HTMLElement;
				const offset = host
					? window.scrollY
					: editorEl.scrollTop - editorEl.getBoundingClientRect().top;
				return { top: rect.top + offset, bottom: rect.bottom + offset };
			},
			{ p: path, host }
		);

	const scrollTo = async (top: number) => {
		if (host) await scrollPageTo(page, top);
		else await editor.scrollEditorTo(top);
	};

	return {
		editor,
		mode,
		scrollTo,
		contentBox,
		screenTop: (path) =>
			page.evaluate(
				({ p, host }) => {
					const el = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`);
					if (!el) return null;
					const editorEl = document.querySelector('.editor') as HTMLElement;
					const origin = host ? 0 : editorEl.getBoundingClientRect().top;
					return el.getBoundingClientRect().top - origin;
				},
				{ p: path, host }
			),
		async topInside(path) {
			for (let top = 0; top < 20_000; top += 400) {
				if (await contentBox(path)) break;
				await scrollTo(top);
			}
			await editor.waitForResizeObserverFlush();
			const box = await contentBox(path);
			if (!box) throw new Error(`${JSON.stringify(path)} never mounted`);
			await scrollTo(Math.round(box.top + 5));
			await editor.waitForResizeObserverFlush();
		},
		async countWrites() {
			await page.evaluate((host) => {
				const writes: number[] = [];
				(window as any).__nestedWrites = writes;
				const el = host
					? (document.scrollingElement as HTMLElement)
					: (document.querySelector('.editor') as HTMLElement);
				const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
				Object.defineProperty(el, 'scrollTop', {
					get() {
						return own.get!.call(this);
					},
					set(value: number) {
						writes.push(value - own.get!.call(this));
						own.set!.call(this, value);
					},
					configurable: true
				});
			}, host);
			return () => page.evaluate(() => (window as any).__nestedWrites as number[]);
		}
	};
}

/** Three resize-observer waits, each with a render, so every correction a change starts has landed. */
export async function settleAll(editor: EditorPage): Promise<void> {
	for (let i = 0; i < 3; i++) {
		await editor.waitForResizeObserverFlush();
		await editor.waitForRenderFlush();
	}
}
