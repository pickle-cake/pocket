# Pocket Style Guide

*The standard look and feel for every screen in Pocket. It applies to every new screen and every change to an existing one.*

The tokens below extend the current `:root` block in `index.html`. Nothing is renamed, so the migration can happen gradually.

## 1. Principles

1. **Timing is the hero.** The staff, the gauge and the score are the content. Chrome stays quiet so they can stand out.
2. **One meaning, one look.** A component looks the same everywhere it appears. If a variant is needed, it is added to this guide, not created inside a single page's selector.
3. **Flat by default.** Separate content with space and hairlines. A bordered card is reserved for one of the uses listed under Cards in §5.
4. **Never colour alone.** Every state that uses colour also has a second cue: a glyph, italics, an underline, a label or a position.
5. **Thumb first, then mouse.** Size for a phone held at a practice pad, then make good use of the extra width on desktop.

## 2. Colour tokens

Keep the existing palette and add the roles that are missing. **Component CSS never uses a hex value.** It always uses a token.

```css
:root{
  /* Surfaces */
  --bg:#E9EDEA;          /* page */
  --surface:#F8FAF8;     /* cards, menus, inputs-on-surface */
  --surface-2:color-mix(in srgb,var(--ink) 6%,var(--bg)); /* troughs, keys, pressed rows (mixed over --bg: over --surface it matches the page) */
  --scrim:rgb(0 0 0 / .55);
  --shadow-pop:0 8px 24px rgb(0 0 0 / .25);

  /* Ink */
  --ink:#0F1411;         /* primary text          15.7:1 */
  --muted:#505C56;       /* secondary text         5.9:1 */

  /* Lines */
  --line:#CBD3CE;        /* decorative dividers only (hairlines between rows) */
  --line-strong:#7A847F; /* NEW: control borders, tracks — 3.3:1 on bg, 3.7:1 on surface */

  /* Brand */
  --fill:#E3A93B;        /* brass fill: primary CTA, selected main tab, progress fill */
  --accent-ink:#1A1200;  /* text on --fill          8.9:1 */
  --accent:#8A5300;      /* brass as text/line: links, focus ring  5.4:1 */

  /* Timing / status (darkened to pass 4.5:1 at small sizes) */
  --early:#2A66B0;       /* 4.9:1 */
  --late:#B0304F;        /* was #C23A5C (4.38) → 5.25:1 */
  --ok:#1F6E44;          /* was #237A4C (4.49) → 5.27:1 */
  --warn:var(--accent);  /* NEW: warnings get their own role; may diverge later */
  --danger:var(--late);  /* NEW: destructive actions */
  --on-danger:#fff;
  --heat:#E5322B;        /* NEW: streak heat, replaced in the cb palette */
  --heat-low:#fff;       /* NEW: the streak meter at the first stroke, mixed toward --heat */
}
```

The dark theme and the `cb` palette must define every token above. Add `--line-strong:#66726C` for dark (3.7:1 on `--bg`, 3.4:1 on `--surface`) and `--heat:#FF8A3D` for `cb`. Dark sets `--on-danger:#0F1311`, because white on the light dark-theme `--late` is below 4.5:1, and a stronger `--shadow-pop` (.35).

**Rules for the brass accent**

| Use `--fill` for | Use `--accent` for | Never use brass for |
|---|---|---|
| The one primary CTA per view, the selected main tab, progress and meter fills, earned badges | Link-buttons, focus rings, the playhead, slider thumbs | Warnings (use `--warn`), errors, decoration, or sub-tab and segment indicators (use `--ink`, see §5) |

**Rule for status colour:** `--ok`, `--early` and `--late` mean only on time, early and late. Errors use `--danger`, which happens to have the same value, but components must use the role name.

## 3. Typography

Use only the weights that are loaded: Barlow 400–700, JetBrains Mono 400 and 600 (capped at 600, so no extra file), Big Shoulders Display 700 and 800. Nothing but Display uses 800.

```
family=Barlow:wght@400;500;600;700&family=Big+Shoulders+Display:wght@700;800&family=JetBrains+Mono:wght@400;600
```

**Type scale.** Nine steps replace the current 23 sizes. Every `font:` declaration uses one of these tokens.

| Token | Size / line | Family · weight | Case & tracking | Use |
|---|---|---|---|---|
| `--t-hero` | clamp(56px, 16vw, 72px) / 1 | Display 800 | — | The one big number on a view: score, count-in |
| `--t-display` | clamp(26px, 7.5vw, 40px) / 1 | Display 800 | UPPER .01em | App title |
| `--t-title` | 20px / 1.25 | Barlow 600 | Sentence | Page and overlay titles, card titles |
| `--t-nav` | 15px / 1 | Display 700 | UPPER .06em | Main tabs, sub-tabs, `<summary>` group headings |
| `--t-body` | 16px / 1.45 | Barlow 400/600 | Sentence | Default text, inputs, row titles |
| `--t-small` | 14px / 1.45 | Barlow 400/600 | Sentence | Buttons, help paragraphs, menu items |
| `--t-caption` | 13px / 1.4 | Barlow 400 | Sentence | Hints, metadata, legends |
| `--t-eyebrow` | 11px / 1.2 | Barlow 600 | UPPER .1em | **All** section labels, field labels and table headers |
| `--t-data` | 14px / 1.4 (16px for stats) | Mono 600 | .04em (.08em for sticking) | Numbers, stickings (RLRL), ms, BPM, tables |

**Rules**

- **Hero numbers** (score, BPM readout, count-in, accuracy on the result card) use Display 800 with `font-variant-numeric: tabular-nums`. Mono is for *tabular* numbers in lists and tables, not for heroes.
- **Section label vs field label.** Both use `--t-eyebrow`. They are told apart by **spacing and colour**: a section label has `--ink` colour, a hairline above it and 24 px of space above; a field label is `--muted` with 6 px below.
- Uppercase is used only for `--t-display`, `--t-nav` and `--t-eyebrow`.
- **Only three tracking values:** `.01em` (display), `.06em` (nav), `.1em` (eyebrow). Stickings use `.08em`.
- Text never goes below 11 px. 10 px is retired.

## 4. Spacing, radius, sizing and elevation

```css
:root{
  /* 4-pt spacing scale */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px;

  /* Radius */
  --r-sm:4px;     /* cells, chips inside data viz */
  --r-md:8px;     /* buttons, inputs, keys, segmented items, menu items */
  --r-lg:12px;    /* cards, menus, dialogs, the tab trough */
  --r-full:999px; /* pills, progress bars, badges, avatars */

  /* Hit targets */
  --hit:44px;     /* minimum for anything tappable */
  --hit-lg:56px;  /* primary CTA, run controls on phone (72px while running) */

  /* Motion */
  --dur-1:.15s;   /* state changes: hover, press, chevron rotate */
  --dur-2:.24s;   /* layout: slide, expand, row change */
  --dur-3:.6s;    /* celebration only */
  --ease:cubic-bezier(.2,.7,.2,1);
}
```

| Rhythm | Value |
|---|---|
| Page side gutter | `--s-4` (16px), plus the safe-area inset |
| Gap between sections on a page | `--s-5` (24px; replaces 22) |
| Gap between fields in a section | `--s-4` |
| Label to control | `--s-2` (replaces 5/6) |
| Row vertical padding | `--s-3` |
| Inline gap between buttons | `--s-2` |

**Elevation** has only two levels: *flat* (no shadow) and *pop* (`--shadow-pop`). Pop is used only for menus and dialogs. Cards are flat and use a border.

## 5. Components

Each component lists its **one** canonical class. Old variants are listed under *Replaces*, so they can be removed as the code is touched.

### Buttons

| Variant | Class | Look | Replaces |
|---|---|---|---|
| Primary | `.btn.primary` | `--fill` background, `--accent-ink` text, Display 800 uppercase, `--hit-lg` tall. **One per view.** | `.btn.main`, `.advmain .btn.primary` sizing |
| Secondary | `.btn` | `--surface` background, 1px `--line-strong` border, Barlow 600 `--t-small`, `--hit` tall, `--r-md` | `.btn.small` (identical), `.bkey`/`.bcode` base |
| Tertiary / link | `.btn.link` | No border or background, `--accent` text, `--hit` tall | `.linkbtn`, `.addbtn` |
| Icon | `.btn.icon` | 44×44 px, an SVG icon at 20 px in `--muted`, an `aria-label`, a tooltip on desktop | `.ib`, `.dots`, `.iconbtn`, `#themeBtn` |
| Danger | `.btn.danger` | Secondary shape with `--danger` text. **Armed** state (`[data-armed]`): solid `--danger` background with `--on-danger` text and the label "Tap again to delete" | `.btn.arm`, `.ib.del.arm`, `.linkbtn.arm`, `.rmenu .arm` |

**States (all variants):** hover lowers the brightness to 96%, pressed to 92%, and focus shows a 2px `--accent` outline with a 2px offset. **Disabled** uses `opacity:.4` and `cursor:not-allowed`, and **always has a visible reason** next to it, either as a caption under the button or as text on the button ("Run a mic check to start").

**Button rows** have one primary on the right on desktop or on top on a phone. Secondary buttons in a row share the same width when there are two or three of them (`grid-template-columns:repeat(auto-fit,minmax(0,1fr))`). Disabled buttons that cannot be explained are hidden, not shown.

### Selection controls

There are **two** patterns, and each has one purpose:

| Pattern | When | Look |
|---|---|---|
| **Tab bar** (`.tabs`) | Moving between the four app destinations | Phone: the current trough with a filled `--fill` pill, `--t-nav`. **Desktop: no trough.** The tabs sit in the header row, left-aligned, at their natural width, with a 3px `--fill` underline. |
| **Segmented control** (`.seg`) | Switching the view below it: sub-views (History / Scores / Achievements), sort orders, filters | One component at one size: a `--r-md` trough in `--surface-2`, items `--hit` tall, `--t-small` 600, the selected item on `--surface` with `--ink` text and a 1px `--line-strong` border. **No brass.** |

The current underline sub-tab (`.switch`) is retired in favour of `.seg`. When two segmented controls are stacked (History › By day), the second is aligned to the left at its natural width and the first stretches to full width, so the user can tell the levels apart.

### Form controls

- **Text, number and select inputs:** `--hit` tall, `--bg` background (or `--surface` when inside a card), a 1px `--line-strong` border, `--r-md`, `--t-body`. Focus: a 2px `--accent` outline. Error: a `--danger` border and a `--t-caption` message below in `--danger`, starting with "⚠".
- **Field:** an `--t-eyebrow` label, then `--s-2`, then the control, then an optional `--t-caption` hint. When a value shows next to the label (Click volume **60%**), it is set in Mono at `--t-eyebrow` size in `--ink`.
- **Slider:** the track is 4px of `--line-strong`, the filled part is `--fill`, and the thumb is 20px of `--fill` with a 2px `--accent-ink` ring. There is one brass, not two. Paired −/+ buttons use `.btn.icon` in a secondary style.
- **Two fields side by side** share a grid row, and their controls are vertically aligned regardless of label length.

### Lists and rows

One row anatomy, used for routines, runs, exercises, library items and links:

```
┌─────────────────────────────────────────────────────────┐
│ Title (t-body 600, or t-data for stickings)  [value] [⋯] [›] │
│ Meta line (t-caption, muted)                              │
└─────────────────────────────────────────────────────────┘
```

- **Padding:** `--s-3` vertical, no horizontal padding on flat pages. Rows are separated by a 1px `--line` hairline.
- **Trailing area:** a flex group with an optional value, then up to two `.btn.icon`, then a disclosure chevron. **It takes part in the layout** (`grid-template-columns: 1fr auto`) instead of being absolutely positioned over a fixed padding.
- **Current or selected row:** `--fill` at 15% with a 3px `--fill` inset bar on the left. **Hover** (on pointer devices only): `--fill` at 8%.
- **Expanded row:** the children sit on a `--surface` band with a 3px `--accent` rail on the left (the current `.rtruns` treatment, which works well). The faux box-shadow bleed on `.hrow[open]` is removed.
- **Replaces:** `.libitem`, `.lrow`, `.srow`, `.hrow .sm`, `.erow`, `.pickrow`, `.rrun`, `.lnkrow`, and `.nextp .nr` become a single `.row` with modifiers.

### Cards

A bordered card (`.card`: `--surface`, 1px `--line`, `--r-lg`, `--s-4` padding) is allowed **only** for:

1. **The run result** (score, accuracy, next step).
2. **A live readout during a run.**
3. **Menus and dialogs** (these also get `--shadow-pop`).
4. **Scrollable data** (tables, the staff in the editor).

Everything else is a flat section. A stat strip is a row of stats separated by hairlines, not a boxed card.

### Stats

One `.stat` component: the value in `--t-data` at 20px (or `--t-hero` when it is the hero of the view), then the key in `--t-eyebrow` `--muted` below. A value can carry a status colour **and** a glyph (✓, ↑, ↓). Replaces `.stat`, `.rp .stats`, `.sum .big` and `.live b`.

### Messages

| Type | Look |
|---|---|
| **Inline hint** | `--t-caption` `--muted`, no container |
| **Notice** (info, setup steps) | Flat; a 3px `--accent` rail on the left, `--s-3` padding, `--t-small` |
| **Warning** | Same as Notice, with a `--warn` rail and a "⚠" lead |
| **Error** | Same as Notice, with a `--danger` rail, `--danger` text in the first line and `role="alert"` |
| **Success / level-up** | The `#advBadge` card (medal, title, next goal) is the **only** celebration pattern. The brass `#advWin` strip is removed. |
| **Empty state** | Centred in the available space: a 40px muted line icon, a one-line `--t-body` 600 title, one `--t-caption` sentence and **one** `.btn` that leads to the next step |

Replaces `.notice`, `.chkmsg`, `.err` (as a block), `#advWin` and the plain-text empty states.

### Disclosure

Every `<summary>` uses one chevron (an SVG, 12px, `--muted`) that rotates 180° in `--dur-1`. Group headings in the Library use `--t-nav`. The settings disclosures inside a page ("1 min · Medium click") use `--t-body` 600. The chevron always sits at the right end of the row and is vertically centred.

### Overlays

- **Full-screen page** (Help, run detail, editor): one header component, 52px tall, with a back link-button on the left, a centred or left title in `--t-title` (16px on a phone) and optional icon buttons on the right, then a 1px `--line` divider. It replaces both `.etop` and `.pghd`.
- **Dialog:** `--scrim` background, `.card` + `--shadow-pop`, max 560px wide, with a title, body and right-aligned buttons.
- **Menu:** `.card` + `--shadow-pop`, `--s-1` padding, items are `--hit` tall, `--t-small` 600, `--r-md`, and a danger item uses `--danger` text. One class, `.menu`, replaces `.bmenu` and `.rmenu`.

### Icons

There is one SVG line set: a 24px grid, a 2px stroke, round caps and joins, and `currentColor`. It is shown at 20px in buttons and 16px inline. No text glyphs are used as icons. Use SVGs for the sun and moon, and replace the `⋯` text in `.dots` with an SVG.

## 6. Layout

| Breakpoint | Behaviour |
|---|---|
| **Phone** (< 720px) | One column. The tab bar is under the header. Run controls are fixed to the bottom while running. Content is max 760px wide. |
| **Desktop** (≥ 720px or `data-layout=desktop`) | The header and tabs share one row. The content max width is **760px for reading pages** (Help, History, Settings) and **1200px for workspaces** (Play, Library, Scores, Achievements). Workspaces use a **fixed left column of 340px** for controls or a summary and a fluid right column for content. There are no three-column text layouts. |

On desktop, Achievements uses the two-column workspace: the streak calendar and the summary on the left, and the badge list on the right. The badge list shows the title, progress and next goal, and the explanatory paragraphs move to a collapsed "How this is counted" disclosure.

## 7. Motion

- State changes use `--dur-1` and layout changes use `--dur-2`, both with `--ease`.
- Celebrations (badge pop) use `--dur-3` once, and never loop.
- The only looping animations allowed are the **live** feedback during a run (the playhead pulse and the streak flame). Everything else is still.
- Every animation sits inside `@media (prefers-reduced-motion: no-preference)`.

## 8. Content and voice

- **Case:** Sentence case for everything except the three uppercase roles in §3.
- **Labels** are nouns ("Click volume"). **Buttons** are verbs ("Calibrate left stick"). **Hints** are one sentence, and anything longer goes to Help with a "Help" link-button.
- **Numbers** always carry a unit: `60 BPM`, `±20 ms`, `92%`, `1 min`. Put a thin or normal space before the unit and use the same unit spelling everywhere.
- **Terms:** use the musical words consistently. *Early* and *late* are the only timing words. Do not use *leading*, *dragging*, *lead* or *drag* for timing (a *drag* is still the rudiment). Use *exercise* for a single pattern and *routine* for a set of exercises. Never use "pattern" in UI copy if "exercise" is the term.

## 9. Accessibility checklist (per change)

- [ ] Text contrast is at least 4.5:1, or at least 3:1 for text of 18px or larger, or 14px bold or larger.
- [ ] Control edges and focus rings are at least 3:1 against what is next to them.
- [ ] Every tap target is at least 44×44 px.
- [ ] Every status shown in colour has a second cue.
- [ ] Every icon-only button has an `aria-label`.
- [ ] The change works with `data-palette=cb` in light and dark themes.
- [ ] The change works with reduced motion.
- [ ] Every disabled control explains why it is disabled.
