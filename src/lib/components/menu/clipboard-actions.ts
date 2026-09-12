/**
 * The clipboard rows a menu offers where Ctrl+X/C/V would go: cut and copy through the
 * document's own command (so the editor's copy handlers write what they always write), paste by
 * handing the clipboard's text to the focused surface as a paste event — the same road a real
 * Ctrl+V takes — either as it is, or escaped so Markdown syntax in it lands as literal text.
 */

export type ClipboardAction = 'cut' | 'copy' | 'paste' | 'paste-plain';

/** Markdown-significant bytes, escaped so pasted text reads back exactly as pasted. */
export function escapeMarkdownLiteral(text: string): string {
	return text
		.replace(/[\\`*_[\]<>|~]/g, '\\$&')
		.replace(/^([ \t]*)([#>+-])/gm, '$1\\$2')
		.replace(/^([ \t]*)(\d+)([.)])/gm, '$1$2\\$3');
}

/** Dispatch `text` to `surface` as a paste, so the editor's paste pipeline handles it. */
export function pasteTextInto(surface: HTMLElement, text: string): void {
	const data = new DataTransfer();
	data.setData('text/plain', text);
	surface.dispatchEvent(
		new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
	);
}

export async function runClipboardAction(
	action: ClipboardAction,
	surface: HTMLElement | null
): Promise<void> {
	switch (action) {
		case 'cut':
		case 'copy':
			document.execCommand(action);
			return;
		case 'paste':
		case 'paste-plain': {
			if (!surface) return;
			let text: string;
			try {
				text = await navigator.clipboard.readText();
			} catch {
				return;
			}
			if (!text) return;
			pasteTextInto(surface, action === 'paste-plain' ? escapeMarkdownLiteral(text) : text);
		}
	}
}
