# Foxlate UI Redesign Direction — 1.7.x

**Date:** 2026-07-22  
**Branch track:** e06-ui-redesign  
**Baseline:** 1.6.3 (cyan/glass `--fox-*` already shipped)

## North star

> **Daily translation tool, not a glassmorphism demo.**  
> Calm surfaces, one accent (cyan), zero competing gradients, host pages stay primary.

## What we keep

| Keep | Why |
|------|-----|
| `--fox-*` token names + semantic `--color-*` aliases | Live system since 1.6.0; parity tests |
| Content isolation (`--fl-*` / `--fs-*`, no inject `common.css` into host) | Host safety |
| Semantic classes: `.btn` `.card` `.form-control` `.switch` `.segmented` | Conventions |
| Soft append/hover + themed spinner (1.6.3) | Just fixed |
| Popup IA: lang → translate → engine/mode → toggles → footer | Works |

## What we change

| Surface | From | To |
|---------|------|-----|
| **Popup** | Multi-layer gradient bg, heavy blur cards, lift-on-hover everywhere | Flat/soft solid panels, denser spacing, one primary CTA |
| **Options** | Gradient wash + blur sidebar/cards | Quiet app shell; sidebar solid; cards with 1px border |
| **Floating chrome** (tooltip, quick-action, summary) | Strong glass + brand gradient chips | Shared panel recipe: solid-ish surface, light border, small shadow |
| **Primary actions** | Full brand rainbow gradient | Solid primary (cyan); gradient only for rare brand moments |
| **Motion** | translateY hover on many rows | Focus/border only; reduced motion first-class |
| **Density** | Tall toggles (62px), airy gaps | Compact rows; popup target width ~360–380 |

## Explicitly out

- Reimplement `plans/archive/*` indigo MD3
- New token system alongside `--fox-*`
- Lit rewrite of popup/options
- R3 differentiator UI (standalone panel) — separate epic
- PDF / store listing chrome

## Phases

| Phase | Ship | Verify |
|-------|------|--------|
| **P1 Calm chrome** | Token quieting + popup density + content floating panels | visual smoke + `npm test` + token parity |
| **P2 Options shell** | Sidebar/main quieter; modals align | options open smoke |
| **P3 Summary / enhanced** | summary.css + enhanced-style align to same recipe | open summary dialog |
| **P4 Polish** | dark-mode pass, focus rings, a11y | dual scheme checklist |

## Success (score gate)

| Dim | Target |
|-----|--------|
| Visual quiet (noise) | ≥ 8 |
| Density / scanability | ≥ 8 |
| Token consistency (popup/options/content) | ≥ 8.5 |
| Host-page non-invasiveness | ≥ 8.5 (already soft append/hover) |
| Overall | ≥ 8.0 |

## Panel recipe (shared)

```
surface:  solid or 94% opaque panel (not heavy glass stack)
border:   1px --color-border
radius:   --radius-md (10–12)
shadow:   --shadow-sm only for floating over host
accent:   primary cyan for selected / CTA; no rainbow fills
type:     Inter/system; secondary 12–13px muted
```
