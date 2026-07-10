# Authoring Directives

A **directive** is a plugin's entry into the `:::name` / `::name` / `:name` syntax family — the
remark-directive model, adapted to aragonite's kind-per-component world and its byte-lossless
round-trip invariant. This guide is for plugin authors. For the block-registration machinery
directives build on, read `adding-a-block.md` first.

Directives are **opt-in**: a consumer that never activates the grammar keeps `:::` unclaimed and
parses as plain GFM.

## One opener, dispatched by name

A single shared opener owns every `:::`/`::`/`:` fence and dispatches on the **name** into the
editor's kind system. N plugins therefore never fight over opener priority — the classic failure of
a per-plugin opener, where the first registrant greedily claims _every_ `:::xxx` fence and no second
plugin can own its own name.

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
- **A name** is a leading letter followed by letters, digits, or hyphens — no underscore. It is the
  dispatch key.
- **The text tier is conservative:** `:name` claims a span only when immediately followed by `[` or
  `{`. A bare `:name`, `:smile:`, `10:30`, and `http://` stay literal.

### Fence-length nesting

A container closes on the first line that is a colon run **at least as long** as its opener and
nothing else — the same length rule fenced code blocks apply to backticks. A bare `:::` inside a
3-colon container's body closes it early; to nest a `:::` container, the outer fence must be longer:

```
::::note          outer opens with 4 colons
:::warning         inner :::… is body, not a closer
inner body
:::                inner closes (3 ≥ 3)
::::              outer closes (4 ≥ 4)
```

## Registering a directive

`registerDirective(tier, name, definition)` maps a `(tier, name)` to a kind. The tier scopes the
key, so a container and a leaf may share a name. Registration is once — a duplicate throws (the
`customElements` model the schema registries follow).

- **Registered name → the plugin's own kind.** The definition points at a kind the plugin declared
  and optionally supplies a factory that builds the node from the parsed fence. The directive layer
  replaces only the _opener_; the kind keeps everything a first-class block has — descriptor, chrome,
  collapse probe, keymap, commands.
- **Unregistered name → generic fallback.** `:::anything` with no matching registration round-trips
  through a generic kind, rendering as a plain labelled box with a dimmed marker.
- **Many names may map to one kind.** A plugin can register `note` and `warning` against a single
  kind that reads the name back from its own metadata.

### Per-tier factory contract

`fromDirective` — the factory that builds a node from the parsed fence — is required, optional, or
rejected by tier, enforced at registration so a mismatch fails loud instead of silently no-op'ing at
dispatch:

| Tier      | `fromDirective` | Why                                                              |
| --------- | --------------- | ---------------------------------------------------------------- |
| Container | **required**    | a kind-only container would orphan the generic `rebuildRaw` path |
| Leaf      | optional        | kind-only restamps the kind; a factory builds the node           |
| Text      | **rejected**    | inline nodes are kind-only — a factory is never consulted        |

### The losslessness guarantee

A document authored with a directive **whose plugin is not installed** opens, edits, and serializes
**byte-for-byte**. The generic fallback captures every fence byte — opener colons, the verbatim info,
the closer run, the body's blank-line wrap — as reconstruction inputs, and the container declares the
opaque contract (its `raw` is authoritative). This is the round-trip a plugin platform needs:
uninstalling a plugin never corrupts a saved document.

## Attributes

Everything after the name on the opener line is a **verbatim `info` string**, captured including its
leading separator. The info is the **round-trip truth** — it is never re-parsed to reconstruct bytes.

`parseDirectiveAttributes(info)` is an **opt-in, pure** reader that pulls the remark
`[label]{attrs}` convention out of the info, yielding `{ label, id, classes, properties }`. A
directive uses it only if it wants that convention; a bare-title directive (`:::note My Title`) reads
its info opaquely and ignores the helper.

**Known limitation:** the helper is `info → structure` only — there is no inverse. A directive that
_edits_ attributes rewrites its info string itself (through metadata plus its `rebuildRaw`, the proven
container path). An inverse is an additive follow-on if a consumer needs it.

## Activation

Directives ship inert. A consumer turns the grammar on by **calling `activateDirectives()`** — a
single idempotent function on `aragonite/plugin`. One call activates everything: the generic fallback
kinds and their render, the `:::`/`::` block openers, and the inline `:` recognizer. Call it once at
startup, **before the editor first parses** — the opener must register before a parse consumes the
grammar, or an already-parsed document will not re-parse (a dev-mode warn flags a late call).

Activation is a **call, not an import side effect**: importing an `aragonite/plugin` authoring symbol
does not claim `:::`. A plugin calls `activateDirectives()` _and_ registers its directives; a pure-GFM
consumer that does neither keeps `:::` unclaimed. The call is idempotent, so multiple plugins (and HMR
re-runs) can each call it safely.

## Public authoring surface

On `aragonite/plugin`, labelled **pre-freeze / unstable** (refined against real consumers until the
open-source release):

| Entry                      | Role                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `activateDirectives`       | turn the grammar on; call once at startup, before the first parse      |
| `registerDirective`        | map a `(tier, name)` to a kind                                         |
| `parseDirectiveAttributes` | opt-in `info → { label, id, classes, properties }` reader (no inverse) |
| `serializeDirective`       | lossless fence serializer a registered kind's `rebuildRaw` uses        |

with the supporting types `DirectiveTier`, `DirectiveDefinition`, `ParsedDirective`,
`DirectiveFence`, and `DirectiveAttributes`.
