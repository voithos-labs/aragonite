# Feature: per-instance registry enablement

Kind definitions are global to the process and registered once, but each editor instance
resolves them through its own view of the registry. Two editors sharing one process-wide memo
registration render the same document differently when one of them disables the memo kind, which
is where an instance resolves its kinds (architecture concern #1).

The editor with it disabled parses the memo syntax into a memo node, since the initial parse
uses the global grammar, but resolves no component for it, so the block falls back to the raw
editable block, the rule for an unknown kind. The editor with it enabled renders the plugin
component. Built-in kinds can never be disabled.

## Happy paths

- both editors hold the memo node: each editor's `%% memo text` seed parses into a `[data-block-kind="memo"]` block, from the global grammar at load
- the editor with it disabled falls back: its memo block renders the `.raw-block` fallback rather than the memo component
- the editor with it enabled renders the component: its memo block renders `.memo-block` and no `.raw-block` fallback
- built-ins survive: both editors render their plain paragraphs as usual, since disabling a plugin kind never touches built-in blocks
