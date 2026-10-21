# e06 Layout / Interaction Review (not theme)

**Date:** 2026-07-22  
**Surface:** popup · options · floating panels · buttons  
**Branch:** `feat/e06-ui-redesign`

## Findings → status

### P0 Popup — done

1. Engine / Display full-width rows  
2. One `.control-surface` instead of 4 cards  
3. Toggles as divider rows inside surface  
4. Footer: site · glossary · version  
5. CTA: `translating` → loading + spinner; `translated` → outline revert  

### P1 Options — partial

6. Nav grouped: Translate / Engines / System — **done**  
7. General vs Page merge — **backlog** (needs content move + state care)  
8. Display segmented in options — **backlog** (still `<select>` + ThemedSelect)  
9. Page max-width 760, stacked record lists, title+action headers — **done**  
10. Modal sticky footer wash — **done**  

### P1 Floating — done

11. Quick-action single pill  
12. Enhanced tooltip denser padding  

### P2 backlog

- CTA progress / element count  
- Options nav search  
- Empty states (rules/cache)  
- Options Display segmented control  
- Merge General + high-frequency Page fields  

## Layout recipe (structure)

```
Popup:
  header
  language pair (1 card)
  primary CTA (stateful)
  control-surface
    engine
    display segmented
    toggles
  footer grid

Options:
  sidebar groups
  page: title row (+ action) → cards → stacked lists

Floating:
  host-over pill / solid panel, no nested chrome
```
