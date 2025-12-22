# Design System 2.0 Specification

## 1. Design Tokens (CSS Variables)

### Colors (Based on Material 3)
We use a refined Indigo/Slate palette for a professional yet modern look.

```css
:root {
    /* Core Palette */
    --color-primary: #4f46e5;       /* Indigo 600 */
    --color-primary-hover: #4338ca; /* Indigo 700 */
    --color-on-primary: #ffffff;
    
    --color-surface: #f9fafb;       /* Gray 50 (App Background) */
    --color-surface-container: #ffffff; /* White (Card Background) */
    --color-on-surface: #111827;    /* Gray 900 (Primary Text) */
    --color-on-surface-variant: #4b5563; /* Gray 600 (Secondary Text) */
    
    --color-outline: #d1d5db;       /* Gray 300 (Borders) */
    --color-outline-focus: #4f46e5; /* Primary (Focus Ring) */
    
    --color-error: #ef4444;         /* Red 500 */
    --color-on-error: #ffffff;
    --color-error-container: #fee2e2; /* Red 100 */
    --color-on-error-container: #991b1b; /* Red 800 */

    /* States */
    --state-hover-opacity: 0.08;
    --state-active-opacity: 0.12;
}
```

### Typography
Clean, legible, sans-serif stack.

```css
:root {
    --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    
    --text-xs: 12px;
    --text-sm: 14px;
    --text-base: 16px;
    --text-lg: 18px;
    --text-xl: 24px;
    
    --font-regular: 400;
    --font-medium: 500;
    --font-bold: 600;
}
```

### Shape & Spacing
Soft rounded corners and consistent spacing.

```css
:root {
    /* Radius */
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    --radius-full: 9999px;
    
    /* Spacing */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-6: 24px;
    --space-8: 32px;
}
```

### Elevation (Shadows)
Subtle, layered shadows using Tailwind-inspired values.

```css
:root {
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    --shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
}
```

---

## 2. Component Library (CSS Classes)

### Buttons (`.btn`)
*   **`.btn`**: Base styles (flex center, pointer, transition).
*   **`.btn-primary`**: Filled primary color.
*   **`.btn-text`**: Transparent background, primary text.
*   **`.btn-icon`**: Round, icon-only button.
*   **`.btn-lg`**: Larger padding and font size.

### Inputs (`.input-group` wrapper)
*   **Floating Labels**: Labels float up when input is focused or has value.
*   **`.form-control`**: Base style for `input`, `select`, `textarea`.
    *   Border: 1px solid `outline`.
    *   Focus: Border color `primary`, subtle ring.
    *   Background: Transparent or very light gray.

### Cards (`.card`)
*   Background: `surface-container`.
*   Border: 1px solid `outline` (optional) or `shadow-sm`.
*   Radius: `radius-lg` or `radius-xl`.

### Switch (`.switch`)
*   Modern toggle switch.
*   Hidden checkbox input.
*   Track and Thumb using pseudo-elements.

### Modal (`.modal`)
*   Backdrop filter (blur).
*   Centered card content.
*   Smooth enter/leave animation.

---

## 3. Implementation Strategy

1.  **Refactor `common.css`**: Replace ALL existing content with the new tokens and component definitions. This wipes the slate clean.
2.  **Update HTML**: Go through `popup.html` and `options.html`, replacing old classes (e.g., `m3-button`, `m3-form-field`) with new semantic classes (e.g., `btn`, `input-group`).
3.  **Update Page CSS**: Rewrite `popup.css` and `options.css` to handle layout ONLY. Visual styles should come from `common.css` components.