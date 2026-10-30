import { test, type Page } from '@playwright/test';
import { focusWalkKey, isWindows } from './platform-keys';

/** Which browser is running, for the harness helpers whose path differs by engine (the clipboard,
 *  the IME driver, dropping the native caret). */
export function isWebKit(page: Page): boolean {
	return page.context().browser()?.browserType().name() === 'webkit';
}

/** Whether the page runs in Chromium, the one engine with a CDP session. */
export function isChromium(page: Page): boolean {
	return page.context().browser()?.browserType().name() === 'chromium';
}

/** Whether the page runs in Firefox, driven over WebDriver BiDi. */
export function isFirefox(page: Page): boolean {
	return page.context().browser()?.browserType().name() === 'firefox';
}

/** What a gesture needs from the driver or the engine, for specs that must skip where it is missing. */
export type EngineCapability =
	| 'cdp'
	| 'touch'
	| 'mediaEmulation'
	| 'caretScreenshot'
	| 'contextMenuKey'
	| 'insertWithoutScroll'
	| 'inertBackspace'
	| 'syntheticTargetRanges'
	| 'insertWithoutSelection'
	| 'nativeWordSelect'
	| 'modifierDrop';

/** Firefox over BiDi and Playwright's WebKit each lack a few gestures; `SKIP_REASONS` says which
 *  and why. */
export function engineSupports(page: Page, capability: EngineCapability): boolean {
	if (capability === 'cdp') return isChromium(page);
	if (capability === 'modifierDrop') return !(isWebKit(page) && isWindows);
	if (
		capability === 'inertBackspace' ||
		capability === 'syntheticTargetRanges' ||
		capability === 'insertWithoutSelection'
	) {
		return !isWebKit(page);
	}
	return !isFirefox(page);
}

const SKIP_REASONS: Record<EngineCapability, string> = {
	cdp: 'needs a CDP session, Chromium only',
	touch: 'Firefox over BiDi emulates no touch input',
	mediaEmulation: 'Firefox over BiDi applies no emulated media features',
	caretScreenshot: 'the Firefox caret never reaches a BiDi screenshot',
	contextMenuKey: 'Firefox over BiDi has no ContextMenu key',
	insertWithoutScroll:
		'Firefox scrolls an off-screen caret into view on every insert, keyed or not',
	inertBackspace:
		"Playwright's WebKit goes back in history on a Backspace outside an editable, which Safari no longer does",
	syntheticTargetRanges:
		'WebKit reports no target ranges for an InputEvent a script builds, whatever it was given',
	insertWithoutSelection:
		"Playwright's WebKit sends no input for inserted text while the page holds no selection",
	nativeWordSelect:
		"Firefox over BiDi fires no native double click, so the browser selects no word in text the editor doesn't select itself",
	modifierDrop:
		"Playwright's WebKit on Windows drops a held Ctrl or Alt from dragover and drop (dragstart keeps it); Linux and macOS WebKit carry it"
};

/** Skip the running test on an engine that lacks `capability`. */
export function skipUnlessSupported(page: Page, capability: EngineCapability): void {
	test.skip(!engineSupports(page, capability), SKIP_REASONS[capability]);
}

/** Whether the focus walk stops on a plain `<a href>` in this engine, asked of a bare link the
 *  page adds and removes. WebKit leaves links out unless the user's own setting puts them in. */
export async function focusWalkReachesLinks(page: Page): Promise<boolean> {
	await page.evaluate(() => {
		const probe = document.createElement('div');
		probe.id = 'focus-walk-probe';
		probe.innerHTML =
			'<button>start</button><a href="#focus-walk-probe">link</a><button>end</button>';
		document.body.prepend(probe);
		probe.querySelector('button')!.focus();
	});
	await page.keyboard.press(focusWalkKey());
	return page.evaluate(() => {
		const reached = document.activeElement?.tagName === 'A';
		document.getElementById('focus-walk-probe')!.remove();
		return reached;
	});
}
