import type { Document } from '../../core/nodes';
import type { PasteStrategy } from './dispatch';

export function pickPasteStrategy(parsed: Document): PasteStrategy {
	if (parsed.children.length === 1 && parsed.children[0].kind === 'paragraph') {
		return 'inline';
	}
	return 'structural';
}
