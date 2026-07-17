# Feature: per-instance registry enablement

Kind definitions are process-global (register-once), but each editor instance
resolves them through a registry view. Two editors sharing one process-global
memo registration render the same document differently when one disables the
memo kind — the instance-resolution seam (architecture concern #1).

The disabled instance parses the memo syntax to the memo CST node (the initial
parse uses the global grammar), but resolves NO component for it, so the block
degrades to the raw-editable fallback (the unknown-kind rule). The enabled
instance renders the plugin component. Built-ins are never disableable.

## Happy paths

- both instances hold the memo node: each editor's `%% memo text` seed parses to a `[data-block-kind="memo"]` block (global grammar at load)
- disabled instance degrades to raw-editable: the disabled editor's memo block renders the `.raw-block` fallback surface, not the memo component
- enabled instance renders the component: the enabled editor's memo block renders `.memo-block` and no `.raw-block` fallback
- built-ins survive: both editors render their plain paragraphs normally — disabling a plugin kind never touches built-in blocks
