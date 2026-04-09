# @open-hax/uxx

Open Hax UI kit with shared tokens plus framework bindings for React, Reagent, and Helix.

## Packages

| Package | Audience | Status | Docs |
| --- | --- | --- | --- |
| `@open-hax/uxx` | React apps | Canonical implementation | [`react/README.md`](./react/README.md) |
| `@open-hax/uxx-reagent` | Reagent apps | React-backed parity layer | [`reagent/README.md`](./reagent/README.md) |
| `@open-hax/uxx-helix` | Helix apps | React-backed parity layer | [`helix/README.md`](./helix/README.md) |
| `@open-hax/uxx/tokens` | Design token consumers | Shared source of truth | [`tokens/`](./tokens) |

## What changed

The Reagent and Helix packages now target the same public component surface as the React package by wrapping the canonical React build in `dist/`.

That gives the three bindings the same:

- public component inventory
- visual behavior
- token usage
- provider surface for theme + toast
- helper utilities for pagination

React-only hooks still exist as hooks, but they are re-exported for advanced ClojureScript consumers who know the normal React hook rules.

## Component coverage

Public parity now covers these exported components:

- Foundations: `Button`, `Badge`, `Spinner`, `Card`, `CardHeader`, `CardBody`, `CardFooter`, `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter`, `Tooltip`, `Input`, `Select`, `Textarea`, `Progress`
- Workspace UI: `ResizablePane`, `WhichKeyPopup`, `InspectorPane`, `ContextSection`, `PinnedTabsBar`, `PermissionCard`, `PromptCard`, `PermissionPrompts`, `ReactReagentSeam`, `CommandPalette`, `Chat`, `Toast`, `FileTree`, `Tabs`
- Data + structure: `SearchableSelect`, `CollapsiblePanel`, `KeyValueSection`, `SurfaceHero`, `PanelHeader`, `MetricTile`, `MetricTileGrid`, `FilterToolbar`, `ActionStrip`, `StatusChipStack`, `DataTableShell`, `Pagination`
- Content + editors: `Feed`, `Markdown`, `CodeBlock`, `DiffViewer`, `MarkdownEditor`, `RichTextEditor`

React now also exports the first composition-level component:

- Compositions: `EntityCard` (React public now; Reagent/Helix parity pending)

The new section primitives are now public across all three bindings:

- `CardHeader`, `CardBody`, `CardFooter`
- `ModalHeader`, `ModalBody`, `ModalFooter`

See [`docs/framework-parity.md`](./docs/framework-parity.md) for the detailed matrix and framework notes.

## Quick start

### React

```bash
cd orgs/open-hax/uxx
npm install
npm run build
```

```tsx
import { ThemeProvider, Button, Card, EntityCard } from '@open-hax/uxx';

export function Example() {
  return (
    <ThemeProvider theme="night-owl">
      <Card title="Status">
        <Button variant="primary">Ship it</Button>
      </Card>
      <EntityCard
        id="agent-1"
        name="Compiler Agent"
        type="worker"
        status={{ value: 'ready', variant: 'success' }}
      />
    </ThemeProvider>
  );
}
```

Built-in themes now include `monokai`, `night-owl`, and `proxy-console`. The canonical provider is `ThemeProvider`; `UxxThemeProvider` is available as a backward-compatible alias for the collaborator-proposed theme-pack surface.

### Reagent

```bash
cd orgs/open-hax/uxx/reagent
npm install
npm run build
```

```clojure
(ns app.core
  (:require [devel.ui.core :as ui]))

(defn screen []
  [ui/theme-provider {:theme :night-owl}
   [ui/card {:title "Status"}
    [ui/button {:variant :primary} "Ship it"]]])
```

### Helix

```bash
cd orgs/open-hax/uxx/helix
npm install
npm run build
```

```clojure
(ns app.core
  (:require [helix.core :refer [$]]
            [devel.ui.helix.core :as ui]))

(defn screen []
  ($ ui/theme-provider {:theme :night-owl}
     ($ ui/card {:title "Status"}
        ($ ui/button {:variant :primary} "Ship it"))))
```

## Architecture

- `react/` contains the canonical TypeScript + React implementation.
- `dist/` is the generated build artifact consumed by the ClojureScript bindings.
- `reagent/` and `helix/` translate idiomatic CLJS props into the React prop surface.
- `tokens/` remains the shared design-token source.

This means parity work lands once in React and can be surfaced in Reagent and Helix without reimplementing every component three times.

## Docs

- [`react/README.md`](./react/README.md)
- [`reagent/README.md`](./reagent/README.md)
- [`helix/README.md`](./helix/README.md)
- [`docs/framework-parity.md`](./docs/framework-parity.md)

## Build matrix

```bash
# Canonical React + tokens build
cd orgs/open-hax/uxx && npm run build

# Reagent wrapper build
cd orgs/open-hax/uxx/reagent && npm run build

# Helix wrapper build
cd orgs/open-hax/uxx/helix && npm run build
```

## Note on React-only compositions

`react/src/compositions/EntityCard.tsx` is now part of the published React API. It is still excluded from Reagent and Helix parity until explicit wrapper support is added and documented.

## License

LGPL-3.0-or-later
