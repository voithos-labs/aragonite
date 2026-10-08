// A write to the native selection, the shape G4.36 and G4.143 both scan for. A one-argument
// collapse counts only on a receiver named for a selection, since a Range collapses that way too.
export const NATIVE_SELECTION_WRITE =
	/\.(?:addRange|setBaseAndExtent|extend|selectAllChildren|removeAllRanges|empty|collapseToStart|collapseToEnd|modify|setPosition)\s*\(|\.collapse\s*\([^,()]*,|(?:\bsel|\bselection|getSelection\(\)[?!]?)\.collapse\s*\(\s*[^)\s]/;
