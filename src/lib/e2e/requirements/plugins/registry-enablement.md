# Feature: per-instance registry enablement

Kind definitions are global to the process and registered once, but each editor instance
resolves them through its own view of the registry. Two editors sharing one process-wide memo
registration render the same document differently when one of them disables the memo kind, which
is where an instance resolves its kinds (architecture concern #1).

The editor with it disabled parses the seed in its own grammar, where the memo opener is not,
so it reads the memo syntax as a paragraph. The editor with it enabled renders the plugin
component. Built-in kinds can never be disabled.

## Happy paths

- the editor with it disabled holds no memo node: its `%% memo text` line parses into a paragraph, from its own grammar at load
- the editor with it enabled renders the component: its memo block renders `.memo-block` and no `.raw-block` fallback
- built-ins survive: both editors render their plain paragraphs as usual, since disabling a plugin kind never touches built-in blocks
