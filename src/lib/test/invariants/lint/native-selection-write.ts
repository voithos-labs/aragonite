// A write to the native selection, the shape G4.270 and G4.143 both scan for: a call, a bracket key
// or the method off `Selection.prototype`. A one-argument collapse counts only on a receiver named
// for a selection, since a Range collapses that way too.
const VERBS =
	'addRange|setBaseAndExtent|extend|selectAllChildren|removeAllRanges|empty|collapseToStart|collapseToEnd|modify|setPosition';

export const NATIVE_SELECTION_WRITE = new RegExp(
	[
		String.raw`\.(?:${VERBS})\s*\(`,
		String.raw`\[\s*['"\x60](?:${VERBS})['"\x60]\s*\]`,
		String.raw`\bSelection\s*\.\s*prototype\s*\.\s*(?:${VERBS}|collapse)\b`,
		String.raw`\.collapse\s*\([^,()]*,`,
		String.raw`(?:\bsel|\bselection|getSelection\(\)[?!]?)\.collapse\s*\(\s*[^)\s]`
	].join('|')
);
