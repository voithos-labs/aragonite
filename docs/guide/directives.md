# Authoring Directives

## What a directive is

Markdown has no syntax for "a box with a name on it" — no callout, no admonition, no embed. The `:::name` family is the community's answer, and aragonite implements it: a fenced construct with a **name** the editor dispatches on.

```
:::note Heads up
Some body markdown.
:::
```

A plugin claims the name `note` and gets a real block kind for it — its own component, keymap, and commands. Any name **nobody** claims still parses, renders as a plain labelled box, and serializes back byte-for-byte. That second half is the point: **a document written with your plugin survives being opened without it.**

This guide is for plugin authors. Read the [plugin author guide](plugin-guide.md) first — directives replace the parsing half of a plugin, not the registration machinery underneath it.

Directives are **opt-in**. A consumer who never calls `activateDirectives()` leaves `:::` unclaimed and parses plain GFM.

## One opener, dispatched by name

A single shared opener owns every `:::` / `::` / `:` fence and dispatches on the name. N plugins therefore never fight over opener priority — the classic failure of the per-plugin opener, where the first registrant greedily claims _every_ `:::xxx` fence and no second plugin can own its own name.

```
:::name info…
      │  one shared opener (owns :::/::/: ; dispatches by name)
      ▼
  registry lookup by (tier, name)
      ├─ registered   → the plugin's own kind
      │                 (its full descriptor: chrome, collapse, keymap, commands)
      └─ unregistered → generic fallback kind
                        (fence bytes kept as metadata; body parsed as plain
                         children; renders generically; round-trips byte-for-byte)
```

## The three tiers

| Tier          | Syntax                 | Colons | Placement | Body / content                        |
| ------------- | ---------------------- | ------ | --------- | ------------------------------------- |
| **Container** | `:::name info` … `:::` | ≥ 3    | block     | nested block markdown, real children  |
| **Leaf**      | `::name info`          | 2      | block     | single line, no children              |
| **Text**      | `:name[label]{attrs}`  | 1      | inline    | atomic widget, source-reveal on focus |

- **Colon count is the tier boundary**, exactly: `:` = text, `::` = leaf, `:::`+ = container.
- **A name** is a leading letter followed by letters, digits, or hyphens — no underscore. It is the dispatch key.
- **The text tier is conservative.** `:name` claims a span only when immediately followed by `[` or `{`. A bare `:name`, `:smile:`, `10:30`, and `http://` all stay literal.

### Fence-length nesting

A container closes on the first line that is a colon run **at least as long** as its opener and nothing else — the same length rule fenced code blocks apply to backticks. A bare `:::` inside a 3-colon container's body closes it early, so nesting a `:::` container means the outer fence must be longer:

```
::::note          outer opens with 4 colons
:::warning         inner :::… is body, not a closer
inner body
:::                inner closes (3 ≥ 3)
::::              outer closes (4 ≥ 4)
```

## Registering a directive

`registerDirective(tier, name, definition)` maps a `(tier, name)` to a kind. The tier scopes the key, so a container and a leaf may share a name.

**Registration is once, and a duplicate throws** — the `customElements` model the schema registries follow. There is no unregister and no silent override.

- **Registered name → the plugin's own kind.** The definition points at a kind the plugin declared, and optionally supplies a factory that builds the node from the parsed fence. The directive layer replaces only the _opener_; the kind keeps everything a first-class block has — descriptor, chrome, collapse probe, keymap, commands.
- **Unregistered name → generic fallback.** `:::anything` with no matching registration round-trips through a generic kind, rendering as a plain labelled box with a dimmed marker.
- **Many names may map to one kind.** Register `note` and `warning` against a single kind that reads the name back from its own metadata.

**When two plugins want the same name, the platform does not pick a winner — it throws.** First-wins is a _convention_ you opt into, not a built-in: guard the call with `isDirectiveRegistered(tier, name)` and skip your own registration when the name is already claimed. Both plugins then load, the name stays bound to whichever registered first, and nothing errors. Skip the guard and the second plugin's `registerDirective` throws on install.

### Per-tier factory contract

`fromDirective` — the factory that builds a node from the parsed fence — is required, optional, or rejected by tier. Enforced at registration, so a mismatch fails loud instead of silently no-op'ing at dispatch:

| Tier      | `fromDirective` | Why                                                              |
| --------- | --------------- | ---------------------------------------------------------------- |
| Container | **required**    | a kind-only container would orphan the generic `rebuildRaw` path |
| Leaf      | optional        | kind-only restamps the kind; a factory builds the node           |
| Text      | **rejected**    | inline nodes are kind-only — a factory is never consulted        |

A container's `rebuildRaw` re-emits the fence after every structural edit. Don't hand-write it: `createDirectiveRebuild` owns the title→opener line, the body serialization, and the authored line ending (the byte a hand-rolled copy silently drops on CRLF input). The plugin guide's walkthrough uses it.

### The losslessness guarantee

A document authored with a directive **whose plugin is not installed** opens, edits, and serializes **byte-for-byte**. The generic fallback captures every fence byte — opener colons, the verbatim info, the closer run, the body's blank-line wrap — as reconstruction inputs, and the container declares the opaque contract, making its `raw` authoritative.

This is the round-trip a plugin platform needs: uninstalling a plugin never corrupts a saved document.

## Attributes

Everything after the name on the opener line is a **verbatim `info` string**, captured including its leading separator. The info is the **round-trip truth** — it is never re-parsed to reconstruct bytes.

`parseDirectiveAttributes(info)` is an **opt-in, pure** reader that pulls the remark `[label]{attrs}` convention out of the info, yielding `{ label, id, classes, properties }`. A directive uses it only if it wants that convention; a bare-title directive (`:::note My Title`) reads its info opaquely and ignores the helper.

**Known limitation:** the helper is `info → structure` only. There is no inverse. A directive that _edits_ attributes rewrites its info string itself, through metadata plus its `rebuildRaw` — the proven container path. An inverse is an additive follow-on if a consumer needs one.

## Activation

Directives ship inert. `activateDirectives()` turns the grammar on: the generic fallback kinds and their render, the `:::` / `::` block openers, and the inline `:` recognizer. One call activates all of it.

Call it once at startup, **before the editor first parses**. The opener must register before a parse consumes the grammar, or an already-parsed document will not re-parse (a dev-mode warn flags a late call).

Activation is a **call, not an import side effect**: importing an `aragonite/plugin` authoring symbol does not claim `:::`. A plugin calls `activateDirectives()` _and_ registers its directives; a pure-GFM consumer that does neither keeps `:::` unclaimed. The call is idempotent, so multiple plugins — and HMR re-runs — can each make it safely.

## Public authoring surface

On `aragonite/plugin`, labelled **pre-freeze / unstable** (refined against real consumers until the open-source release):

| Entry                      | Role                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `activateDirectives`       | turn the grammar on; call once at startup, before the first parse         |
| `registerDirective`        | map a `(tier, name)` to a kind                                            |
| `isDirectiveRegistered`    | probe a `(tier, name)`; the first-wins guard                              |
| `parseDirectiveAttributes` | opt-in `info → { label, id, classes, properties }` reader (no inverse)    |
| `serializeDirective`       | lossless fence serializer a registered kind's `rebuildRaw` uses           |
| `createDirectiveRebuild`   | build the `rebuildRaw` for a container whose child 0 is an editable title |

with the supporting types `DirectiveTier`, `DirectiveDefinition`, `ParsedDirective`, `DirectiveFence`, and `DirectiveAttributes`.
