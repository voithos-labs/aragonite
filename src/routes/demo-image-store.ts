/**
 * The showcase's image-paste host: what an embedder supplies through `onPasteImage` and
 * `resolveImageUrl`. Pasted bytes stay in memory under a short app-internal URL, so the
 * Markdown carries `![alt](https://demo.aragonite/pasted/1.png)` rather than a data URI,
 * and the resolver maps that URL back to the bytes at render time. Page-lifetime only.
 */

import type { PastedImage } from '$lib';

export const PASTED_IMAGE_BASE = 'https://demo.aragonite/pasted/';

const bytesByName = new Map<string, string>();
let count = 0;

export async function demoPasteImage(image: PastedImage): Promise<string | null> {
	const ext = image.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
	const name = `${++count}.${ext}`;
	bytesByName.set(name, await readAsDataUrl(image.blob));
	const alt = image.suggestedName?.replace(/\.[^.]+$/, '') || 'pasted image';
	return `![${alt}](${PASTED_IMAGE_BASE}${name})`;
}

/** Everything else passes through untouched, the way a host resolver leaves the web alone. */
export function resolveDemoImageUrl(rawUrl: string): string {
	if (!rawUrl.startsWith(PASTED_IMAGE_BASE)) return rawUrl;
	return bytesByName.get(rawUrl.slice(PASTED_IMAGE_BASE.length)) ?? rawUrl;
}

function readAsDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}
