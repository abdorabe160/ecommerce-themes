# E-commerce Storefront Themes

A collection of 15 production storefront themes built for the **Qumra Cloud** e-commerce platform, covering a range of retail niches with Arabic (RTL) and English support.

## Themes

ATTAR · baby-supplies · Bulk · coffee (DECAFE) · ecommerce · electronics · HADIYA · hyper · LAMSA · local · Mish-Mavin · morva · MUHARRIK · Nakha · RIYADA

Each theme ships with 20–40 merchant-configurable widgets (sections).

## Theme structure

Each theme follows the Qumra theme architecture:

```
theme/
├── layouts/     # Base page layouts
├── pages/       # Page templates (home, product, collection, cart, ...)
├── templates/   # Reusable page templates
├── widgets/     # Configurable sections merchants arrange in the editor
├── ui/          # Shared UI components (cards, buttons, forms, ...)
├── settings/    # Theme settings schema (colors, typography, layout)
├── locales/     # Translations (ar / en / fr)
└── assets/      # CSS, JavaScript, images
```

## Highlights

- **Bilingual & RTL-first** — every theme ships with Arabic and English locales (some also French) and right-to-left layouts.
- **Merchant-configurable** — sections, colors, fonts and content are editable from the store's theme editor through widget and settings schemas.
- **Responsive** — mobile-first layouts for product grids, navigation and cart.
- **Storefront features** — product pages with variants, collections, search, AJAX cart, blog and content pages.
- **Build tooling** — the `coffee` theme uses Tailwind CSS with an asset-stamping script for cache busting.

## Tech

Nunjucks (`.njk`) templates · CSS / Tailwind CSS · Vanilla JavaScript · JSON schemas · i18n (ar / en / fr)
