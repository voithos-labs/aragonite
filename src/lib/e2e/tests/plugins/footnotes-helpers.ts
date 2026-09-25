import type { Locator } from '@playwright/test';
import type { PresentationMode } from '../../../presentation-mode';
import { PluginsPage } from './helpers';
import { textRunCenter } from '../../text-runs';

// The footnote specs' page object and their long document, on the `footnotes-ref` seed.

const FILLER = 140;

/** The first block of {@link navDoc}. */
export const NAV_REFS = 'Body has [^a] and [^b] and [^zz] here.';

/**
 * References in the first block, 140 filler paragraphs, then the definitions: long enough that
 * the definitions start unmounted, so a jump has to mount its target. `[^zz]` has no definition,
 * so it is the reference a jump must do nothing for.
 */
export function navDoc(): { md: string; defA: number; defB: number } {
	const parts = [NAV_REFS];
	for (let i = 0; i < FILLER; i++) {
		parts.push(`Filler paragraph ${i} with enough words to fill a line.`);
	}
	const defA = parts.length;
	parts.push('[^a]: First note.', '[^b]: Second note.');
	return { md: parts.join('\n\n') + '\n', defA, defB: defA + 1 };
}

export class FootnotePage extends PluginsPage {
	refs(block = 0): Locator {
		return this.page.locator(`[data-block-path='[${block}]'] .footnote-ref`);
	}

	/** The definition's own `[^label]` marker range: the way back. */
	defMarker(block: number): Locator {
		return this.page.locator(`[data-block-path='[${block}]'] .footnote-def-marker`);
	}

	async load(md: string, mode?: PresentationMode): Promise<void> {
		await this.gotoPlugins('footnotes-ref');
		await this.loadContent(md);
		if (!mode) return;
		await this.setPresentationMode(mode);
		await this.waitForRenderFlush();
	}

	/** Click a word of the block's text, away from any marker, then press the key once. */
	async pressFromText(path: number[], word: string, key = 'Tab'): Promise<void> {
		const point = await textRunCenter(this.page, word, { path });
		await this.page.mouse.click(point.x, point.y);
		await this.page.keyboard.press(key);
	}
}
