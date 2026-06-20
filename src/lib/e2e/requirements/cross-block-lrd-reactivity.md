# Feature: Cross-block LRD reactivity

A link-reference definition lives in its own block, but the references that
resolve through it live in other blocks. Editing the definition must keep those
references fresh in the rendered DOM, even though the edit never touches the
referencing block.

## Happy paths

- LRD edit re-resolves another block: turning a plain block into an LRD (a real
  keystroke edit that changes the document's LRD signature) converts an
  unresolved reference in a different block from a dimmed unresolved marker into
  a live link whose `href` matches the new definition
