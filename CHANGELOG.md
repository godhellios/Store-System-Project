# Changelog

All notable changes to MRIs (Mitra Ramah Inventory System).

This file starts at v1.6.8, the last version that carried a Git tag. The
v1.6.9 – v1.8.0 entries below are reconstructed from commit history: those
versions shipped and were shown in the application footer, but were never
tagged.

## v1.8.1

Bug fixes to the v1.8.0 packing-unit work, plus the tests that prove them.

### Fixed

- **Approving a staff-submitted product edit no longer applies a packing unit
  that belongs to a different base unit.** Staff submissions are stored as raw
  JSON without validation, and approval only checked that the unit *existed* —
  so a unit whose parent is not the product's base unit could be written back,
  silently reinstating the mismatch v1.8.0 was written to remove. A unit
  defined as "12 Gross" applied to a product counted in Dozen means 12 Dozen.
- **Editing an order no longer offers unrelated units.** For a product with no
  packing units the unit picker listed *every* unit in the system and applied
  its conversion factor directly, and the server trusted the client-computed
  quantity. Both sides now accept only units whose parent is the line's base
  unit.
- **Settings › Units:** changing what a unit is measured in is refused
  outright, so the confirmation prompt for a factor change is no longer shown
  for an edit that is rejected anyway.
- **Product approvals:** packing units dropped during approval are now named in
  a warning on screen instead of disappearing without explanation.
- Corrected a Playwright type error in the WebKit suite (`TestDetails` takes no
  `timeout`; use `test.setTimeout()`).

### Changed

- The displayed version now comes from a single constant (`src/lib/version.ts`)
  instead of being repeated in the app shell, the login page and four
  translated strings.
- `package.json` version now tracks the application version. It had been left
  at the `0.1.0` scaffold value since the project was created.

### Added

- `scripts/audit-stale-packing-units.mjs` — read-only check for stored packing
  units whose unit parent no longer matches their product's base unit.
- Unit and end-to-end coverage for the above: the staff-submit → admin-approve
  round trip, the order-edit picker, and the screens that render them.

## v1.8.0

- Packing units are chosen from the Unit master instead of being typed per
  product, so a unit's name and size live in one place and renaming one in
  Settings reaches every product using it.
- Migration `20260813000001_packing_unit_from_master` backfills existing rows
  by name and fails the deploy rather than dropping anything it cannot map.

## v1.7.2

- Indonesian translations brought up to date.
- Fixed: the opname freeze is re-checked when a pending order is approved.

## v1.7.1

- Stock adjustments can be backdated at entry (admin only).
- Fixed: a backdated date of "today" is accepted (compared by calendar day, not
  by instant).

## v1.7.0

- GRN, Goods Out and Transfer can be backdated at entry (admin only).
- Stock opname supports a count date, recalculating each line's book quantity
  against the stock as of that date.

## v1.6.9

- Fixed: saving a large opname no longer times out — counts save in one bulk
  update instead of one round trip per line, and approval uses bulk inserts.
- Fixed: a blank count box no longer zeroes stock.
- Opname includes all active products; the photo-scan toggle moved to its own
  tab.
- Save errors now surface the real message rather than a generic one.

## v1.6.8

- Photo-based opname scanning.

---

Releases before v1.6.8 are recorded in the Git tags (`v1.1` through `v1.6.8`)
and their GitHub releases.
