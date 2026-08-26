import { type Page } from '@playwright/test';
import { isWebKit } from './browser-engine';

/**
 * How a spec's bytes reach the editor's clipboard handlers. Chromium rides the real system
 * clipboard behind the context's permission grants. WebKit has none to grant — it rejects them at
 * context creation, and its `writeText` resolves into a clipboard the synthetic paste chord cannot
 * see — so its arm carries the bytes on a dispatched event instead, which both handlers already
 * read (`clipboardData`), and records a copy from the same event the editor writes into.
 */
export interface ClipboardArm {
	/** Page-side setup, before the first navigation. */
	install(): Promise<void>;
	seed(text: string): Promise<void>;
	read(): Promise<string>;
	paste(): Promise<void>;
	waitForContains(expected: string, timeout: number): Promise<void>;
}

export function createClipboardArm(page: Page): ClipboardArm {
	return isWebKit(page) ? eventClipboard(page) : systemClipboard(page);
}

// ── Arms ────────────────────────────────────────────────────────────────────

function systemClipboard(page: Page): ClipboardArm {
	return {
		async install(): Promise<void> {},
		async seed(text: string): Promise<void> {
			await page.evaluate((t) => navigator.clipboard.writeText(t), text);
		},
		read(): Promise<string> {
			return page.evaluate(() => navigator.clipboard.readText());
		},
		async paste(): Promise<void> {
			await page.keyboard.press('ControlOrMeta+v');
		},
		async waitForContains(expected: string, timeout: number): Promise<void> {
			await page.waitForFunction(
				async (e) => (await navigator.clipboard.readText()).includes(e),
				expected,
				{ timeout, polling: 32 }
			);
		}
	};
}

function eventClipboard(page: Page): ClipboardArm {
	let installed = false;
	return {
		async install(): Promise<void> {
			if (installed) return;
			installed = true;
			await page.addInitScript(() => {
				(window as any).__e2eClipboard = '';
				// Bubble phase, so the editor's own handler has written into `clipboardData` first.
				const record = (e: ClipboardEvent) => {
					(window as any).__e2eClipboard = e.clipboardData?.getData('text/plain') ?? '';
				};
				document.addEventListener('copy', record);
				document.addEventListener('cut', record);
			});
		},
		async seed(text: string): Promise<void> {
			await page.evaluate((t) => {
				(window as any).__e2eClipboard = t;
			}, text);
		},
		read(): Promise<string> {
			return page.evaluate(() => ((window as any).__e2eClipboard as string) ?? '');
		},
		async paste(): Promise<void> {
			await page.evaluate(() => {
				const data = new DataTransfer();
				data.setData('text/plain', ((window as any).__e2eClipboard as string) ?? '');
				const target = (document.activeElement ?? document.body) as HTMLElement;
				target.dispatchEvent(
					new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
				);
			});
		},
		async waitForContains(expected: string, timeout: number): Promise<void> {
			await page.waitForFunction(
				(e) => (((window as any).__e2eClipboard as string) ?? '').includes(e),
				expected,
				{ timeout, polling: 32 }
			);
		}
	};
}
