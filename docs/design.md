# Foundryshop --- Product Specification and Implementation Plan

## Purpose

Foundryshop should provide a **Photoshop-like layer abstraction for live
Foundry VTT cartography**, optimized for pen/tablet use. The user draws
over a normal Foundry Scene Background---for example, a parchment/canvas
image with a printed grid. Foundryshop organizes ordinary Foundry
Drawing documents above that image into draggable, nestable, toggleable
pseudo-layers and groups.

The goal is not to replace Foundry's renderer. Foundryshop should
translate an artist-friendly layer model into supported Foundry document
operations.

## Current end state and remaining delivery

### Active rapid release: editable Paths and native Walls alignment (2026-10-09)

This section is the active delivery plan for the next Path refinement. It
supersedes older statements that Paths must not be added, and the ordering of
the earlier Rush release plan, for this bounded scope only. Prior acceptance
gates and unrelated deferred features remain unchanged. Native Walls expansion
is approved roadmap planning, not an instruction to expose unverified wall
creation in this release.

#### Current baseline

Implemented and live-tested: Plain line, Railway, Road and River; smooth curves
and straight segments; curve amount; width 0.01-10 grid squares; optional seeded
meander amount and bend spacing; waypoint placement with preview, finish and
cancel; native Drawing output; six Mining stamps; thumbnail and WEBP rendering.
Width semantics remain unchanged: railway width is rail separation; other
styles use stroke/surface width. Minecarts use existing stamp scale/rotation.
Existing finished paths have no retained authoring definition and must not be
advertised as reopenable. Do not infer original waypoints from sampled artwork.

#### Path and Drawing relationship

A Path is a Foundryshop authoring object, not a new native Foundry document
type, layer or group. One logical Path produces one or more native Drawings.
An ordinary Drawing need not belong to a Path.

- Store versioned route definitions once in a Scene flag registry.
- Put lightweight path identity/component-role flags on generated Drawings.
- Retain waypoints, automatic/manual point modes, incoming/outgoing handles,
  closed state, style/appearance, width, curve amount, meander dimensions/seed,
  component membership and integrity information.
- Finalize exact flag/schema contracts after checking native v14 updates and
  storage constraints. Bound registry size and validate all persisted input.
- Native Drawings remain authoritative for existing visible artwork. The
  recipe is authoritative for intentional editor regeneration only when
  integrity checks pass or the GM explicitly approves rebuilding.
- Never regenerate on load, resurrect deleted parts, or overwrite external
  component edits silently. With the module disabled, native artwork survives.
- Detaching removes authoring relationships without removing artwork.
- Metadata/components must be committed, duplicated, deleted and exported as
  an explicitly maintained relationship; Foundry does not maintain it for us.

#### First deployable release scope

1. Retained route creation and exact save/reload/reopen.
2. Path discovery from any component; Edit path, Select whole path, Duplicate,
   Delete whole path and Detach actions in existing selection controls.
3. Waypoint overlay: drag points, insert on segments, delete points, edit
   endpoints; insertion preserves the existing curve shape where feasible.
4. Automatic, Smooth (linked tangent directions) and Corner (independent
   handles) point modes. Optional Shift-drag tangent adjustment plus explicit
   tablet controls. Verify modifier conflicts; Shift cannot also mean snapping.
5. Shared geometry/appearance controls for every style, including recoloring
   existing routes, width, opacity, meander and New variation. Editing uses
   saved appearance, not an accidental resampling of the current brush.
6. Closed loops with continuous curve/meander seams and no duplicate railway
   sleeper. Closed plain lines remain strokes, not accidental polygon fills.
7. Whole-path translation/duplication/deletion and session undo/redo. Verify
   native committed undo support; if needed, use scoped path history so one
   operation restores both route metadata and all components.
8. Explicit Apply/Cancel: existing artwork is not mutated while drafting.
   Distinguish creating, editing, saving and damaged/conflicting routes.
9. Integrity checks for component changes/deletion, registry damage,
   incompatible membership/Levels and concurrent GM edits. Explain conflicts;
   offer cancel, detach or explicitly approved rebuild as appropriate.
10. Verified mutation/recovery: source and destination checks, validated native
    result, recovery record, writes, readback, finalization and compensation.
    Incomplete cleanup retains actionable recovery state and blocks blind retry.
11. Portable full-route JSON/subtree/selection export and import, identity
    remapping, duplication/stamp transforms and scaling of all dimensional
    settings/handles. Partial component exports remain ordinary artwork and
    report lost editability rather than retaining dangling path references.
12. Existing thumbnail, SVG, WEBP and tracing output continues to consume native
    generated geometry. No new renderer is required for this release.

#### Rapid release sequence

Implementation status (EP1 foundation, 2026-10-09):

- Added `path_schema.js`: versioned scene-pixel recipes, absolute handle
  coordinates, explicit Automatic/Smooth/Corner schema, persisted complete
  options, Scene registry and lightweight Drawing membership validation.
- Added `path_store.js`: read-only registry access, exact canonical component
  baselines and integrity diagnostics. No load-time generation or Scene writes.
  Baselines compare geometry/appearance/destination, not author, name, sort,
  visibility, locks or import bookkeeping. Locks remain an operation gate.
- Extracted `evaluatePathRoute()` and `buildPathComponents()` from existing
  generation. Base curve and final meander points, cumulative distances and
  explicit roles are reusable; existing `buildPathDrawings()` output is
  preserved. Returned tolerance describes automatic base-curve sampling, not a
  certified future Wall simplification tolerance.
- Limits: 1000 retained routes, 10000 aggregate components, 4 MiB registry,
  128 KiB per exact baseline; existing per-route geometry limits remain.
- Manual/closed recipes validate for the retained-data contract but evaluation
  explicitly refuses them until their algorithms are implemented. No UI or
  portability claims are made for those modes yet.
- Native v14 in-memory Scene/Drawing construction preserved both flag shapes;
  the live Scene was not modified. Actual persisted write/readback and reload
  remain EP2 acceptance, not certified by this constructor check.
- Existing placement still saves ordinary unretained artwork. EP2 must commit
  registry and components together before enabling retained-path creation.

Implementation status (EP2 transaction work in progress, 2026-10-10):

- Added gated `path_transactions.js` primitives for retained create, replace,
  delete, independent translated duplicate, detach and explicit recovery.
  Existing placement does not call these primitives yet.
- Operations validate native artwork, Scene permission, destination, route
  revision and integrity before writing; store a bounded Scene-specific
  recovery journal; verify each write; and compensate partial failures.
  External artwork/registry conflicts are refused rather than overwritten.
  Incomplete compensation retains the journal and blocks another path save.
- Component IDs are reused by role, not blindly by generated index. Crowded
  replacements preserve their original native stack position, re-spacing
  sorts only when necessary. Growing hidden paths keeps new components hidden.
- Recovery validates plain JSON, schema, storage budget, native sources and
  registry/component correspondence. Native optional fields and nested schema
  defaults are handled without accepting changes to supplied artwork values.
- Focused fault-injection coverage includes partial create/delete, incomplete
  registry writes, failed journal removal, cleanup retry, stale queued edits,
  external edits, damaged routes, locks, permissions, duplicate identity,
  detach, ordering and native defaults.
- Live native construction exposed nested `shape.radius` defaults and absent
  optional names; those contracts are now covered. No live artwork was changed.
  Persisted write/readback/reload acceptance remains outstanding: the running
  local installation does not serve the new transaction module.
- EP2 is **not complete**. Before enabling retained creation, integrate pending
  path-operation exclusion with other mutation/publication surfaces, verify
  native-hook and interruption behavior, and prevent partial multi-document
  artwork from being presented as committed output. EP7 portability must also
  preserve complete routes or explicitly report discarded editability.
- These transactions use a local per-Scene queue and optimistic readback, not
  a distributed atomic lock. Do not advertise cross-client atomicity.
- Verification checkpoint: 136 focused path/transaction/toolbox tests pass;
  diagnostics are clean. Both rebuilt ZIP layouts were extracted and validated
  against source, with 142 runtime files each. This is a packaged foundation
  checkpoint, not acceptance of the editable-path release.

EP2 safety and native acceptance follow-up (2026-10-10):

- Added `path_operation_guard.js`: exact, locally scoped native-write
  permissions expire after each call. Pending journals block unrelated Drawing
  and Scene writes, stamp copying/placement, JSON exchange, artwork previews,
  publication and optimization review/writes. Permissions never bypass locks.
- A pending journal suppresses changed path components on the live canvas for
  both GM and player audiences, including after reload. Unchanged paths and
  ordinary artwork are not suppressed. This is presentation suppression, not
  confidential storage or distributed transaction isolation.
- Added an explicit GM recovery notice/action to the Layers panel (including
  embedded toolbox panels). Confirmation is bound to the complete reviewed
  journal and Scene; cancellation is read-only. Malformed or externally changed
  recovery records remain in place with errors, never silent cleanup.
- Local native v14 acceptance used a disposable QA Scene: retained railway
  create/readback/reload, recipe integrity, replacement, independent duplicate,
  detach, whole-path delete, interrupted native creation/cleanup, durable
  journal reload and explicit recovery. Actual rendered staged components were
  hidden while the unchanged original route stayed visible.
- Native flag cleanup now uses v14 `ForcedDeletion`, not legacy deletion-key
  syntax. GUI acceptance also caught and fixed the required DIV dialog-content
  contract; it is covered by the recovery test.
- Automated checkpoint: 427 focused regressions pass. The full suite has 1231
  tests, 1230 passing and the same pre-existing gated Bake error-message
  assertion failure; no new failures. Runtime package validation covers 143
  files. Retained placement remains gated until EP3 editing and EP7 portability
  are integrated; these primitives do not make old sampled artwork editable.
- EP2 primitives and native acceptance are now **complete**. The final Layers
  recovery GUI passed both Cancel and Confirm after reload, with verified
  restoration, intact original path and journal/action removal. Both current
  ZIP layouts were extracted and source-validated (143 files). The disposable
  Scene was deleted, Magic Hot Springs was restored, and the original workspace
  and paused state were preserved. Next milestone: EP3 selection discovery and
  waypoint editing with explicit Apply/Cancel.

EP3 waypoint editor acceptance (2026-10-10):

- EP3 is **complete** as a retained-path authoring milestone. Selecting any
  intact component discovers its route and offers Edit path and Select whole
  path. Mixed selections, damaged routes, locked/hidden destinations and
  changed Scene/Level contexts refuse editing instead of regenerating artwork.
- The overlay supports point selection, numbered waypoint controls, numeric
  scene-pixel X/Y, pointer dragging, insertion near the evaluated route,
  deletion, explicit Apply and read-only Cancel. Draft changes leave native
  artwork untouched; Apply uses the verified EP2 transaction service.
  Tool/Scene changes and external native edits cancel stale drafts.
- Automatic insertion recalculates neighboring curves and meander; it is not
  advertised as shape-preserving cubic subdivision. Manual modes, handle
  fidelity and tablet-specific acceptance remain EP4, not silently enabled.
- Automated checkpoint: 278 focused tests pass, including toolbox numeric
  controls and Cancel. Full regression: 1241 tests, 1240 passing, with only the
  same pre-existing gated Bake error-message assertion failure.
- Native v14 GUI acceptance verified discovery from a railway component,
  whole-route selection, numeric Cancel, physical waypoint dragging, insertion,
  Apply, persistence after reload, deletion and external-edit cancellation.
  The disposable QA Scene was removed; Magic Hot Springs, the exact original
  workspace and paused state were restored and verified after reload.
- The latest checkpoint is locally deployed with an installation backup.
  Both ZIP layouts were extracted and source-validated at 145 runtime files.
  Ordinary Path placement remains unretained until EP7 portability is ready;
  old sampled paths are not inferred or advertised as reopenable.

EP4 curve handles and subdivision acceptance (2026-10-10):

- EP4 implementation and native GUI acceptance are **complete**. The shared
  evaluator now supports Automatic, linked-direction Smooth and independently
  adjustable Corner points. Manual handles are absolute scene pixels and move
  with their waypoint. Smooth editing preserves the opposite handle's length
  while linking its direction; returning to Automatic removes manual handles.
  Manual handles override the automatic curve amount/straight setting at their
  endpoint. Closed recipes remain explicitly gated for EP5.
- All four styles use the same bounded cubic evaluator for preview and output.
  Collinear loop-back handles are subdivided rather than silently flattened
  into a chord. Native Drawings still store sampled geometry, not a new native
  document type, and retained metadata is never regenerated on load.
- Insertion without meander uses evaluated segment/parameter provenance and
  exact de Casteljau subdivision. Automatic tangents are frozen as explicit
  Corner handles before insertion so neighboring recalculation cannot change
  other intervals. The inserted point uses linked Smooth handles. Meander
  insertion necessarily adds a new fixed anchor and recalculates its variation;
  the insertion help explicitly discloses this shape change.
- The editor draws draggable white incoming/outgoing handles at the selected
  manual point and provides paired X/Y controls. Modes, handles and Apply/Cancel
  need no keyboard modifier; optional Shift-drag is deliberately not assigned,
  avoiding a second snapping/modifier meaning. Other pointer IDs cannot hijack
  an active drag; pointer cancellation restores the pre-gesture draft.
- Native keyboard/numeric acceptance caught and fixed a tightly coupled focus
  bug: captured input blur must not cancel editing; only actual window blur does.
  The compact editor reuses the existing Help disclosure, pairs coordinates,
  and retains tablet-sized targets instead of adding a tall help paragraph.
- Automated acceptance: 282 focused tests pass. Cubic subdivision is checked
  mathematically across all four styles, with bidirectional generated-polyline
  deviation bounded to twice the evaluator tolerance (1 px at a 100 px grid).
  Tests also cover manual persistence, Smooth linking, Corner independence,
  translation, self-intersections, loop-backs, pen IDs, cancelled gestures,
  numeric controls and focus changes. Full regression: 1245 tests, 1244 passing;
  only the same pre-existing gated Bake assertion fails.
- Native v14 acceptance in a disposable Scene verified waypoint/mode keyboard
  controls, physical mouse handle dragging with Smooth linkage, Corner numeric
  input followed by Tab without cancellation, Apply, subdivision and saved
  manual handles after reload. This is not physical Wacom/driver certification:
  real pen hardware, viewport/theme acceptance remain explicit EP8 release gates.
  Next milestone is EP5 shared appearance/variation controls, loops and presets.
- Final native layout measurement verified all four handle inputs at 44 px
  height with Apply visible inside the current toolbox viewport. Cancel after
  a numeric handle edit preserved the exact saved registry. Both final ZIP
  layouts were extracted and validated at 145 runtime files; local deployment
  has an installation backup. The disposable Scene was deleted and the original
  Magic Hot Springs Scene, exact workspace and paused state were verified after
  reload. Retained production creation remains gated until EP7 portability.

EP5 appearance, loops and presets acceptance (2026-10-10):

- Shared controls now serve ordinary placement and the retained editor:
  style, automatic curve/smoothing, width, primary color, opacity, meander,
  bend spacing, sleeper spacing, closure and New variation. Retained settings
  always come from the saved recipe, never the current brush. Changes preview
  as drafts; Apply uses EP2 verification and Cancel preserves saved artwork.
  Invalid compound changes preserve the last valid draft.
- Primary color applies to plain lines, rails and road/river surfaces. Mapping
  edges/current accents and wooden sleepers retain their style colors; the
  help explains this distinction. New Road/River presets have mapping colors.
  Width is scene-grid scaled, with 0.03 yielding a normal 3 px plain stroke at
  a 100 px grid. Native output has a 1 px stroke floor. Opacity covers every
  component, including accent artwork.
- Closed recipes now evaluate wrapped automatic tangents and retain manual
  seam handles. Meander fades to each fixed anchor (including the seam) with
  zero fade slope and cyclic normals, preserving seam position/direction.
  Rail offsets join cyclically rather than using open endpoint caps.
  Closed sleepers are uniformly distributed with effective spacing
  `length / ceil(length / requestedSpacing)`, with no duplicated seam sleeper.
  Plain loops remain unfilled strokes; no polygon fill is introduced.
- Closing requires at least three distinct points, without duplicating the
  first point. Closing/opening, seam insertion, minimum-point deletion and
  manual handle editing use the same validated recipe/evaluator. Ordinary
  placement supports closed sampled artwork, but remains unretained until EP7.
- User-scoped path presets are separate from brush and presentation presets:
  four starters plus bounded save/apply/delete, complete validated settings,
  closure, explicit name/limit errors and delete confirmation. Applying a preset
  never replaces points, handles or the current variation seed. Reroll advances
  the seed deterministically; unrelated appearance changes leave it unchanged.
  Explicitly chosen new-path appearance is not resampled from the brush on arm.
- The editor groups these controls behind an appearance disclosure that stays
  open through refresh. It reuses existing Help and dialog patterns, retains
  tablet-sized input targets, and does not introduce player-facing controls.
- Automated acceptance: 291 focused tests pass, covering all four styles,
  seam tangents, anchored/seeded meander, cyclic rails, exact straight-loop
  sleeper spacing including the seam, reversing/acute seams, manual seam
  insertion, thin strokes, preset storage and failure paths, draft isolation,
  native persistence and GUI dialogs. Full regression: 1254 tests, 1253 passing;
  only the same pre-existing gated Bake assertion fails.
- Native v14 acceptance verified closed/color/opacity/meander controls,
  disclosure persistence, New variation, saved 3 px plain artwork, whole-loop
  railway conversion (23 distinct sleepers, both rails closed), Road/River
  primary recoloring, native Apply integrity and absent journals. Preset Save,
  Apply without seed replacement, deletion Cancel/Confirm and draft Cancel
  passed through real controls/dialogs.
- EP5 is **complete**. Final reload verified the same closed River recipe,
  seed, native component integrity and reopening. Both final ZIP layouts were
  extracted and validated at 146 runtime files; local deployment has a backup.
  The disposable QA Scene was deleted after returning to Magic Hot Springs.
  Original preset settings, exact layer workspace and paused state were restored
  and verified. EP6 whole-path operations and history are next; retained creation
  stays gated until EP7 portability and EP8 release acceptance.

EP6 whole-path operations and history acceptance (2026-10-10):

- Move whole path is a draft-only scene-pixel offset dialog: every anchor and
  absolute handle translates together. Apply commits, Cancel leaves artwork
  unchanged. Selection offers independent duplication plus explicitly confirmed
  whole deletion and detach. Detach preserves ordinary native artwork while
  removing the recipe and memberships. No rotation/scale UI is claimed here;
  portable transforms remain part of EP7.
- The editor has a separate 20-change draft Undo/Redo stack, covering coordinates,
  handles, modes, insertion/deletion, appearance, variation and translation.
  Each pointer drag is one history entry; cancelled gestures restore their
  starting recipe without consuming redo. New changes discard redo, and closing
  the draft clears draft history. Ctrl/Cmd+Z, Shift+Z and Ctrl/Cmd+Y are captured
  only while editing and outside text inputs; pen users have 44 px buttons.
- Native v14 Scene descendant hooks and Drawing undo were inspected. Native
  history restores only Drawings, not retained Scene recipes, so committed
  operations use explicit, independent Path Undo/Redo rather than replacing
  Ctrl+Z. Scoped path writes suppress native history via `isUndo: true`; native
  undo cannot modify or recreate retained members outside those exact scopes.
- Committed history is GM/Scene/browser-session-local and bounded to 20 operations
  and 24 MiB. Only changed native sources and route entries are stored. Replay
  restores exact native IDs, sources and metadata together through EP2's verified
  journal, compensation and queue, preserving unrelated current artwork.
  Replayed route revisions advance, including repeated delete/create restoration,
  so stale expected revisions cannot be reused. Reload and explicit recovery clear
  history; new committed operations discard redo.
- Changed affected sources/recipes, unavailable destinations, locked components,
  conflicting stack positions and pending recovery explicitly refuse replay.
  Failures leave the history cursor unchanged; incomplete compensation retains
  the existing recovery journal. This is optimistic local exclusion, not a
  distributed lock or cross-client history.
- Automated acceptance: 304 focused tests pass. Coverage includes bounded history,
  pointer grouping/cancellation, paired handles, settings, keyboard/text input
  ownership, GUI prompts and cancellation, exact replay to empty and back, source
  identity, stale revision rejection, native-undo membership variants, external
  edits, locks, unrelated artwork and partial replay compensation. Full regression:
  1267 tests, 1266 passing; only the same pre-existing gated Bake error-message
  assertion fails.
- Native v14 disposable-Scene acceptance passed Move Cancel/Confirm, draft
  Undo/Redo, Apply, independent railway duplication (30 unique components),
  Delete and Detach Cancel/Confirm, committed Undo/Redo without selection and
  exact source restoration. Eight-step physical mouse movement was undone as
  one draft change. All editor action targets measured at least 44 px.
  Path operations left native Drawing history empty; native undo of an external
  retained-component edit was refused, and Path history did not overwrite it.
- EP6 is **complete**. Reload preserved both intact recipes/native memberships
  and reset session history. Both ZIP layouts were extracted and validated at
  147 runtime files, and the local deployment has an installation backup.
  The disposable QA Scene was deleted after returning to Magic Hot Springs;
  exact original workspace, path presets, paused state and empty native history
  were restored. Physical Wacom acceptance remains EP8. Retained production
  creation stays gated until EP7 portability and EP8 acceptance.

EP7 portability and conflict acceptance (2026-10-10):

- Drawing project version 1 now has optional `paths` (portable version 1 routes)
  and bounded `pathWarnings`. A portable route carries its ID, name, complete
  recipe and ordered component ID/role relationships; native Drawing flags carry
  its membership. Scene-specific route revisions, destinations and integrity
  baselines are not exported. Validation rejects missing/multiply-owned
  components, dangling/foreign memberships, inconsistent destinations, malformed
  recipes/styles and unsupported metadata.
- Full, subtree, selection and Level-scoped export preserve complete intact
  routes. Partial or externally changed paths are exported as exact current
  ordinary native artwork, with recipes/memberships removed and a named reason
  disclosure. Export requires confirmation of that loss; cancellation downloads
  nothing. Library save/import review also discloses route counts and loss;
  partial stamp copy explicitly warns. Source artwork/registry are not mutated.
  Missing/malformed registries are refused, not inferred or silently repaired.
- Import remaps every route, Drawing, layer and Level relationship without
  source-ID reuse. Translation moves all anchors and absolute handles with the
  exact native artwork. New baselines come from validated imported native sources;
  existing routes and artwork remain unchanged. Single-Level filtering retains
  complete routes or strips/discloses partial authoring relationships.
- Copied stamps and editable-shape Library packages carry complete routes through
  origin normalization, grid normalization, scale and rotation. Recipe anchors
  and handles use the same scene-space similarity transform as native artwork.
  Scaling the recipe's stored dimensional reference scales width, meander and
  sleeper/bend spacing together without clamping normalized settings or copying
  the destination grid implicitly. The editor explains the stored reference,
  destination grid and resolved pixel width. Color, opacity, seed, closure and
  point modes remain unchanged; native integer stroke widths retain rounding.
- Imports/stamps involving retained paths use project-import journal version 5,
  storing exact before/after registries alongside existing native fingerprints
  and layer/sort recovery. Scoped native writes suppress partial Drawing undo.
  The registry is verified before staging release; unfinished output is hidden,
  including after reload. Compensation/discard restore only owned imported
  artwork, sorts, layers and registry, refusing changed existing artwork/paths.
  Incomplete cleanup retains actionable recovery. These imports/recovery clear
  Scene Path history explicitly, rather than offering Drawing-only undo.
- Saved paths are reachable from the existing Style workspace even when no
  component is selected or all components are missing. Duplicate names gain
  identity suffixes. Intact routes offer Edit/Select whole; damaged routes offer
  Review conflict with named issues, Cancel and explicit Detach. Conflict detach
  leaves current artwork and external edits untouched, removes only remaining
  memberships belonging to that route, and never recreates missing Drawings.
  Exact reviewed registry/source snapshots and destination locks are checked
  again before journaled writes. Failure restores the exact conflicted pre-state.
  Conflict detach clears history and is explicitly not undoable; no unsafe
  automatic rebuild or guessed recipe reconstruction is provided.
- Existing thumbnail/WEBP/SVG/native rendering still consumes generated Drawing
  geometry, not regenerated recipes. Renderer snapshots intentionally exclude
  authoring membership while portable packages preserve it. Future Walls uses
  the retained recipe/evaluator and remains separate from portability.
- Automated acceptance: 446 focused tests pass; full suite 1276 tests, 1275
  passing, with only the same pre-existing gated Bake error-message assertion.
  Coverage includes all styles, transform dimensions/manual handles and seeds,
  complete/partial/malformed packages, ID remapping, exact source isolation,
  Library/shape roundtrip, stale review, fully missing routes, locks, release
  failure compensation and interrupted cleanup with registry conflicts.
- Native v14 acceptance passed railway/manual-handle export, rotated/scaled
  stamp and grid-normalized shape placement, JSON import dry-run Cancel/Confirm
  with artwork preview, and reopening/regenerating an imported River. Partial
  export Cancel/Confirm disclosed loss and its exact serialized output contained
  one ordinary Drawing, zero routes and the named partial warning. The browser
  download handoff was instrumented to inspect its Blob without a saved QA file.
  Conflict review Cancel/Detach preserved exact externally edited native sources;
  fully missing paths were reviewed from the saved-path catalog without selection.
  A second, empty native Scene with a 200 px grid imported all 59 Drawings and
  both recipes with fresh route IDs; source 100 px dimensional references were
  preserved rather than silently adopting the destination grid.
- An intentional native staging/cleanup interruption persisted version 5 recovery
  across reload; all staged components were verified hidden once canvas refresh
  settled. Recovery Cancel made no changes; Confirm restored the original 59
  Drawings and both intact Railway/River routes, with no journal or native undo
  entries. Final reload verified retained recipes/memberships and catalog controls.
- EP7 is **complete** and locally deployed with backup. Both ZIP layouts were
  extracted and validated at 148 runtime files. Both disposable Scenes were removed
  after returning to Magic Hot Springs; original workspace, path presets, paused
  state and empty native history were restored. Ordinary new Path placement
  remains unretained until EP8's coherent production enablement, documentation
  and owner live/tablet acceptance. No commit, tag or publication was performed.

| Step | Complete deliverable | Required verification |
|---|---|---|
| EP1 | Versioned registry, membership, shared route schema and bounded geometry contracts | Native schema, metadata roundtrip, limits, identity and component ownership |
| EP2 | Retained creation; verified update/delete/duplicate and recovery primitives | Reload, partial-write compensation, interruption and concurrent changes |
| EP3 | Selection discovery, edit overlay, point insertion/movement/deletion | Apply/Cancel, layer/Level gates, no unrelated writes |
| EP4 | Automatic/manual handles, Smooth/Corner modes and tablet controls | Geometry continuity, insertion fidelity, shortcut conflicts |
| EP5 | Shared appearance/width, meander reroll, closed loops and presets | All four styles, stable seed, seam correctness, thin normal lines |
| EP6 | Whole-path operations and complete undo/redo behavior | Independent duplication, transforms and metadata/artwork restoration |
| EP7 | JSON/project/stamp portability and external-edit conflict UX | Full/partial export, remapped imports, damaged-route handling |
| EP8 | Normal retained placement, GUI polish, docs, bounded owner live acceptance and both ZIPs | Tablet/viewport, export parity, extracted package validation |

Fast delivery means this ordered, coherent scope, not skipping recovery,
portability or acceptance. Focused tests at each step; live checks at meaningful
UI boundaries; full regression and package validation at EP8. Owner deploys.
No commit, tag or publication without instruction. Do not promise elapsed time
or prompt counts before EP1/EP2 identify the native transaction constraints.

Deploy the editable-path release after EP8, independently of later rendering
extensions. Do not expose half-wired editing as production-ready.

EP8 local release-candidate acceptance (2026-10-10):

- Normal Path Finish/double-click/Enter now calls the verified retained creation
  transaction directly, storing the original anchors, complete style/seed,
  dimensional reference and closure alongside ordered native component Drawings.
  The former plain stamp save route is removed, not left as an alternate mode.
  Placement still previews without writes; invalid limits preserve points for
  correction, and cancellation creates no recipe or artwork. Scene update
  permission and captured Level elevation are checked through native completion.
  The transaction, not the placement callback, owns its in-flight journal.
- New placement participates in complete Path Create Undo/Redo, does not populate
  native Drawing history, and is immediately discoverable from Saved paths or
  selection. Exact native geometry remains the rendering/export authority; load
  never regenerates a route. Existing ordinary artwork is neither inferred nor
  migrated into recipes. No player authoring controls or Walls behavior is added.
- README, changelog and placement Help now describe the complete finished-path
  workflow: waypoint modes/handles, insertion fidelity, draft Apply/Cancel,
  appearance/closure/presets, separate histories and their reset conditions,
  whole-path actions, dimensional references, complete/partial portability,
  conflicts and recovery. A new native editor screenshot shows all four styles.
- Automated candidate acceptance: 185 focused tests pass. New integration cases
  exercise normal placement across every style with native guards enabled,
  exact export geometry/recipe parity, complete creation Undo/Redo, elevation
  and Scene permission changes before writes, and compensation after native
  creation when the destination changes. Full regression: 1281 tests, 1280
  passing, with only the same pre-existing gated Bake error-message assertion.
- Native v14 candidate QA verified actual rail-button placement and canvas
  double-click completion, automatic anchors and component membership, opening
  from Saved paths, numeric coordinate edit/Apply, and GUI Undo of both Edit
  and Create followed by Redo restoring exact native sources/IDs. All four
  styles, a closed plain loop and a seeded River were created intact. Native
  history remained empty and no recovery journal remained.
- Final lifecycle QA found and corrected two native integration issues: Enter
  on a focused button now retains native button activation instead of triggering
  the global Finish/Apply shortcut, and raw PIXI placement/editor overlays are
  siblings on the Drawings layer rather than entries in Foundry's document-only
  preview collection. Native preview cleanup therefore never calls Drawing
  drag callbacks on raw graphics. Targeted tests cover both overlays and
  deactivation without writes.
- Native brush defaults can contain Foundry Color objects. Placement now
  captures their hex-string representation before geometry/recipe validation;
  persisted path colors are strictly strings. The test fixture reproduces
  string-coercible native color input instead of testing only explicit path
  colors. Malformed object-valued recipe colors are refused.
- Final native recheck used the unmodified native brush Color default (not an
  explicit path color), saved an intact Railway with a string-valued recipe,
  and verified keyboard activation of Cancel preserves exact native sources
  and registry. Switching from an active edit to Token controls and changing
  Scenes cancelled drafts and removed overlays without native preview teardown
  errors or writes. Both placement and editor overlays stayed outside native
  document previews.
- Actual SVG and WEBP rendering consumed all 20 native components with matching
  636 x 1066 artwork bounds. SVG had 20 paths and no parse errors; the WEBP
  decoded at the same dimensions. Rendering left the Scene source unchanged.
- Browser layout acceptance covered Slate/Foundry/System themes with compact,
  comfortable and tablet density, plus all three tablet themes at 1024 x 768.
  Windows stayed inside the tested viewport, coordinate pairs did not overflow,
  tablet handle inputs measured 44 px, and Apply remained reachable via the
  existing panel scroll. This is browser layout/mouse acceptance, not a claim
  about Wacom hardware, driver cancellation, touch ergonomics or live-session
  usability.
- Reload acceptance preserved all four recipes, manual Corner handles and exact
  component sources/IDs, with empty session histories and no journal; the saved
  Railway reopened without modifying its registry. Both final ZIP layouts were
  extracted and source-validated at 148 runtime files. The final candidate was
  locally deployed with an installation backup. Both disposable QA Scenes were
  removed after returning to Magic Hot Springs; original workspace, presets,
  toolbox settings, paused state and empty native history were restored.
- Retained placement is enabled in the locally deployed candidate for the owner
  to evaluate. EP8 remains **in progress** until the bounded owner check below
  passes; no commit, tag or publication is authorized by candidate deployment.
  Future Walls work stays W1-W7, outside this release.

Owner acceptance before declaring EP8 complete:

1. On the actual Wacom/pen and usual Foundry viewport, place a short railway
   using taps and Finish/Enter, plus a closed plain loop. Confirm duplicate
   endpoint taps do not add unwanted points; Backspace and Escape are usable.
2. Reopen a saved path. Drag a waypoint and Smooth/Corner handles without a
   modifier; switch numeric fields using Tab. Confirm pen release/cancellation
   does not leave a stuck drag or an unintended saved change.
3. Exercise draft Undo/Redo, Cancel, Apply and committed Path Undo/Redo. Confirm
   Cancel leaves artwork unchanged and complete history is clearly distinct
   from native Drawing Ctrl+Z.
4. Reveal/hide a route layer during a disposable live-play rehearsal. Confirm
   the GM-only controls and saved-path catalog are understandable, tablet-sized
   targets and scroll access are comfortable, and player visibility remains the
   existing layer presentation contract (not gameplay Walls).
5. Export/import a complete route and try a rotated/scaled copied stamp. Review
   the partial-copy warning and a disposable external-edit conflict; do not
   expect automatic rebuilding or resurrection. Report any awkward workflow or
   failed hardware behavior before release approval.

Initial fork source preflight (2026-10-10):

- The owner created `Xombit/Foundryshop` as a GitHub fork of
  `operation404/boneyard-drawing-tools`, after renaming the empty standalone
  repository. Preserve the original upstream history and MIT notices; the
  first Foundryshop source commit is not a release, tag or hardware acceptance.
- Full regression is now green: 1281 tests pass. The previously recorded Bake
  failure was an obsolete test expectation shared by five different invalid
  inputs. Its test now distinguishes the folder error from the existing
  operation/destination/timeout error, retaining rejection and no-resource/no-
  approval assertions. Production Bake behavior is unchanged.
- Generated packages and dependencies remain ignored. The local 1.0.0 ZIPs
  are owner-test candidates, not GitHub auto-update release assets. EP8's
  physical pen and bounded live-play check remain open.

Exact selection-to-layer copying (2026-10-10):

- Each actual layer's actions now offers Copy selected drawings here alongside
  Move selected drawings here, through the shared detailed/toolbox Layers UI.
  Copies keep exact native coordinates, shape points, rotation, appearance,
  textures/text, author, Level/elevation and per-Drawing visibility. Only IDs,
  layer destination, native sort allocation and copy provenance change.
  Originals stay on their existing layers and the active layer is not changed.
  Hidden destination layers are supported for precisely aligned reveal overlaps.
- Uses the existing verified stamp/import journal without centering, translating,
  native geometry regeneration or grid normalization. Up to 100 Drawings per
  copy and 10,000 per Scene; native sort space/layer order must be valid. Source
  and inherited destination locks refuse copying. Full intact retained paths
  receive independent recipe/component IDs with unchanged geometry. Partial or
  damaged copies require explicit loss confirmation and become ordinary artwork;
  original memberships/recipes stay untouched. Source changes during approval
  refuse saving. Existing import cleanup restores partially created copies.
- 279 targeted tests and all 1285 full-suite tests pass. Native v14 acceptance
  used the actual toolbox destination-layer button on a hidden layer: copied
  rotated/smoothed artwork had exact native appearance/geometry, unchanged
  source apart from permitted sort renumbering, unchanged active layer and no
  journal. After revealing the layer and waiting for refresh, the copy was
  visible and its rendered bounds matched the original exactly.
- Both new 149-file package layouts were extracted/source-validated and the
  1.0.0-copy1 test candidate deployed with backup. The old 1.0.0 ZIP was open in
  another process and was not replaced. Disposable QA removed; original Scene,
  workspace, toolbox state and paused state restored. The owner approved
  committing and pushing this tested addition to the fork; no release or tag.

#### Native Walls expansion: compatible architecture now, explicit tools later

The future workflow converts selected supported Drawing geometry or an editable
Path into native Foundry Wall documents, after a GM preview and confirmation.
This is not pixel/raster auto-tracing and does not convert decorative sleepers
or stamp details into gameplay walls by default.

Architecture alignment required during EP1:

- Separate route definition/evaluation from Drawing styling and generation.
  Evaluate the base curve and final meander route as reusable scene-space
  geometry; wall conversion must explicitly choose which route it consumes.
- Supply bounded simplification/sampling contracts with measurable maximum
  geometric error. Visual sampling and wall segment counts have different
  budgets; never create one Wall for every rendered sample blindly.
- Keep coordinates independent of canvas zoom, device pixels and renderer
  objects. Transform points and handles together.
- Do not put movement/sight/door fields into drawing styles. Reserve a separate
  conversion recipe/link schema if maintained wall relationships are added.
- Use supported embedded Wall document APIs and native constants/schema.
  Foundry v14 Wall coordinates are four integer values [x0,y0,x1,y1]; native
  fields include move, sight, light, sound, direction, door/state and thresholds.
  Validate the exact installed Wall/Level model before implementation; do not
  infer wall Level/elevation behavior from Drawing fields or third-party modules.
- Quantize and simplify with verified error bounds, shared endpoints and
  removal of zero-length segments. Preserve closed-loop seams and deliberate
  gaps. Count/preview results before writes.
- Drawing workspace eyes/player gates do not enable/disable Walls. Hidden
  illustration can still have an active gameplay barrier; make this explicit.
- Path edits never silently move linked Walls. Later sync must be explicit,
  previewed, conflict-checked and respect manually edited walls/doors.

Wall roadmap:

| Step | Scope |
|---|---|
| W1 | Research native v14 Wall/Level schema, permissions, undo and refresh; define conversion profiles and limits |
| W2 | Pure conversion from supported lines/polygon boundaries/Path routes; centerline first, explicit boundary options later; error/count tests |
| W3 | GM preview with wall profile, restriction types, curve tolerance, duplicate/overlap review and segment budget; no writes yet |
| W4 | Confirmed native Wall creation with verified readback, bounded recovery and ownership tracking; leave pre-existing Walls untouched |
| W5 | Door/secret-door placement on explicitly selected segments; gaps, direction and thresholds; no automatic door inference |
| W6 | Optional explicit rebuild/sync/detach for owned Wall sets, with divergence checks and recoverable undo |
| W7 | Live GM/player LOS, movement, lighting, sound and Level acceptance; document actual supported behavior and package |

Default conversion is one-shot: native Walls remain independently editable.
Owned linkage is a later opt-in, not a requirement to use generated Walls.
The current Drawing-project JSON format does not become a full Scene/Walls
backup implicitly; wall interchange requires a separately defined scope.

Accept native Walls only when gameplay tests pass, not merely when coordinates
match the artwork. Test normal/invisible/one-way profiles, open/closed/locked
doors, permission boundaries, curve approximation, unchanged unrelated Walls,
failed writes and recovery. Automatic presentation-driven wall toggles or
door-state changes require a separate approved behavior contract.

#### Subsequent Path extensions

- Native-compatible caps, taper/fade and cleaner joins/junctions.
- Longer railway routes with verified component consolidation/performance.
- Textured routes after validating curved texture repetition, seams, resources
  and native/baked export behavior; Drawing pattern fill is not a curved ribbon.
- Endpoint continuation/joining, dashed lines, repeated objects and variable
  width as separately bounded refinements.

These do not block EP8. Retained route geometry and explicit component ownership
must remain reusable for them and for the W1-W7 native Walls workflow.

This is the maintained product specification, not a chronological conversation
log. Current decisions below supersede older exploratory UI concepts. Keep
technical contracts and unfinished acceptance gates; do not treat historical
test counts or detached checks as full release certification.

### Implemented foundations

- GM-only seven-tab toolbox, eight-button tool strip, quick controls, density/
  scale preferences, Foundryshop Slate/Foundry/Game system appearance and anchored
  quick-layer flyout.
- Nested layers/groups, stable Drawing membership/order, per-GM workspace,
  independent inherited locks, passive player presentation and full presentation
  presets. Native hidden/locked fields remain independent.
- Full-project JSON export, empty/additive import, resource mappings/checks,
  reviewed previews/embedded thumbnails, verified writes and interrupted-import
  journals. Only one source Level; retained flatten recovery is not yet supported.
- Unified named shared palettes and color selection; 15 original seamless
  materials, saved repeat scaling, creation previews and explicit selected-fill
  application.
- Mixed single-color/paired appearance swatches, tinted split previews, native
  bounded editor, right-click and equivalent creation/Manage paths. Verified
  transient appearance overrides win over layer colors/interior/materials, with
  visible Return to layer defaults and unchanged width/opacity behavior.
- 88 non-label shipped artwork prefabs (80 original plus eight textured),
  14 styled starter labels and two complete example projects. Internal text-shape
  definitions remain available for assembling example projects, not as a second
  user-facing Library label collection.
- Editable geometry copy/place, static PNG/JPEG/WEBP image stamps, cursor ghosts,
  stamp scale/rotation, optional artwork Repeat and transactional placement.
- Persistent custom-shape saving with stable package IDs, category/tags,
  file permissions/collision checks, SHA-256 read-back verification, refreshed
  Projects/Shapes browsing and fingerprinted reload/placement.
- Persistent full-project saving and optional embedded project/shape thumbnails;
  fresh identity filenames, shared verified file writes, full snapshot/context
  checks and explicit thumbnail-free fallback. Single-source-Level/recovery gates
  remain; catalog administration is described separately below.
- Portable project/shape name/category/tag edits, fresh-identity duplication and
  separately confirmed metadata replacement. Exact fingerprints and verified
  persistent repair markers block uncertain files; explicit repair review accepts
  only revalidated current bytes without upload/delete/rollback. This is not an
  atomic cross-client lock.
- Independent shared catalog removal/restoration, confirmed without file writes;
  bounded world records persist through refresh/reload, with a Removed items view.
  Changed/missing/malformed files stay removed with explicit repair/review states.
  Replacement warnings cannot be concealed by removal. File deletion is deferred
  because native v14 FilePicker provides no supported deletion API.
- Labels composer with native font options, combined styled textarea, font
  size/color/opacity, Save and explicit Apply-to-selection.
- WEBP publication with explicit player/GM audience, whole displayed-Level or
  layer/group scope, content/custom bounds, scale and quality. Optional displayed-
  Level base-color/static-image composition uses native transforms and exact map
  crop; transparent output remains the default. Dedicated render surfaces exclude
  foregrounds/other-Level imagery/other Scene objects/UI.
- Strict vector SVG publication shares scope/audience/crop/scale and source guards.
  Native curves remain vector; escaped named groups preserve stack order. Text
  fidelity requires acknowledgement; raster content/degenerate shapes are refused
  with named diagnostics.
- Subtree JSON export retains ancestor context and scoped artwork/presets/resources.
  Additive import optionally creates its hidden wrapper inside an unlocked group,
  without changing existing artwork/order or opening destination ancestor gates.
  Owner-approved active-Level export and explicit one-Level/full-project-combine
  import are implemented; best-effort Level matching is deliberately omitted.
  Deployed selected-floor/combine ordering and player presentation acceptance
  passed on disposable Scenes; disk download and broader fidelity remain unverified.
- Next owner-prioritized slice (planned, not implemented): private GM reference
  transparency in both Layers UIs for transferring/tracing an original sketch.
  True composited 50% layer opacity has a native feasibility gate; source Drawing
  opacity/player presentation remain unchanged. Preservation-first consolidation/
  cache/raster alternatives require measured fidelity/recovery evidence and scope
  approval before replacing the current faithful-Drawing contract.
- Intuos4 PTK-840 Settings guide/key diagnostic and native unassigned GM shortcuts
  for Freehand pencil and Tokens: Select / Move. Physical driver/tablet validation
  remains an owner acceptance task, not a claim of tested hardware compatibility.

### Approved preview-first UI end state

- Theme option is **Foundryshop Slate**.
- Built-in example projects and saved project files share the same browser,
  search and Projects/Shapes filter. Source badges distinguish Built-in and Saved;
  example projects are not duplicated into user storage. Project preview clicks
  open import review, never immediate Scene creation.
- Labels live in Labels, not Library. The 14 examples are default saved-bank
  entries, initialized once without replacing user entries. Explicit deletion
  persists; no separate example list and no automatic replenishment.
- Clicking a saved label arms one standalone cursor placement. Click the canvas
  once to create, then disarm; Escape or Cancel discards the ghost. Next/Repeat/
  Place label mode choices are superseded and must not be part of the main UI.
  Artwork stamps retain their explicit Repeat option.
- Shift+wheel rotates labels by 15 degrees; Ctrl+wheel adjusts font size by 1px.
  Visible rotation and existing font-size controls provide non-wheel paths.
  Cursor geometry/text follows rotation/size; rotation does not rotate the typing
  preview. Placement adjustments never overwrite saved labels automatically.
- Saved-label previews use their actual typography at 100% for 16-64px sizes,
  representative readable scaling outside that band, with disclosure/tooltips.
  Opacity is omitted only in collection samples; editor/cursor retain actual
  opacity. These are readable samples, not miniature whole-Drawing thumbnails.
- Prefab, copied/image-stamp and saved-shape preview buttons arm placement
  directly. Remove duplicate Place Prefab buttons; retain accessible button
  semantics, keyboard activation, tablet targets and Escape cancellation.

This workflow is implemented and covered by the 428-test regression suite.
Detached Foundry v14 checks verified 14 saved label previews, 88 Library artwork
preview buttons, two unified project cards, no Labels library category/no
horizontal overflow, and a native cursor ghost with changed font size and actual
45-degree rendered rotation. Escape canceled even with input focus. Scene data
was unchanged; settings writes were intercepted in the fixture. Actual live
creation/multi-client/pen/touch and owner cleanup remain release acceptance gates.

### Remaining milestones

**Release scope freeze (owner-approved 2026-10-09):** The expedited release plan
below supersedes older "next", "remaining" and mandatory milestone language
throughout this document. Retain historical contracts/evidence as reference, not
as a requirement to finish every approved feature before shipping. The project
is over budget: move to UX polish now. No new feature branch is a release blocker
merely because it appears in the longer-term specification.

### Expedited first release plan

#### Release contract

Owner clarification (2026-10-09): the immediate customer is the owner, who needs
to draw maps next game session. Target a usable internal build, not completion of
the entire public-release backlog. Prioritize exposed draw/layer/label/stamp and
save/export usability plus data/presentation safety. Public distribution polish
and expansive certification need not delay internal use; preserve honest
limitations and gates. No exact prompt-count or delivery-time promise is needed.

Ship the existing GM-first Drawing toolbox, layers/presentation, artwork reuse,
library and publication/exchange workflows that pass the checks below. Players
remain passive presentation consumers; do not add role relay for this release.
Preserve existing data and fail explicitly on uncertain writes. Do not weaken
recovery verification, permissions, visibility consent or source-preservation
checks to meet the budget.

New feature development is frozen. Permitted changes are connected UX work on
existing services, necessary defect fixes, bounded acceptance and release
documentation/packaging. Unaccepted optimization/recovery services remain
unregistered/internal and are omitted from ordinary controls and release feature
claims. Existing exposed risky paths must either pass their bounded acceptance
or be disabled clearly; do not ship a clickable unfinished workflow.

#### Storage management: minimum release scope

- Keep regenerable rendering caches in memory/GPU with their existing bounded
  admission, eviction and teardown. Do not introduce server-side temporary
  preview files. Reuse existing thumbnail/render lifetimes and correct leaks
  found during release checks.
- Add one small Settings cache/status surface only if the existing cache host
  can safely expose it without a new persistence subsystem: report known
  resource/budget state and offer clear/rebuild of module-owned disposable
  resources through the existing lifecycle. Explain that this affects the local
  client, not server assets or other clients. If safe wiring needs architectural
  work, defer the button rather than delaying release or destroying shared
  textures.
- Browser-persistent thumbnails/previews are a future option, not a release
  requirement. Any future module-owned browser cache must have a size budget,
  automatic eviction/expiry and explicit local clearing; it must never be the
  only copy of editable artwork or recovery evidence.
- Existing Library removal/restoration remains logical catalog management, not
  physical deletion. Label the distinction plainly. Recovery evidence remains
  retained; do not call it temporary or imply clearing caches frees backup space.
- Defer the new folder-wide storage/recovery catalog, backup-retirement workflow,
  cleanup-manifest generator, filesystem-access picker, server companion,
  hosting-provider integration and physical delete/move/rename. Their approved
  rich metadata/dependency/thumbnail design remains post-release scope. Do not
  bypass Foundry file protections.

#### Execution order and bounded exit criteria

1. **One scope/exposure audit, then freeze.** Inventory actually reachable
   toolbox controls against implemented services and known acceptance evidence.
   Identify a short release-blocker list: data loss, permission/player exposure,
   broken core flow, unusable layout, failed packaging. Separate cosmetic polish
   and deferred work; do not restart a general feature audit. Keep experimental
   controls gated and document exactly what ships.
2. **UX polish of current workflows.** Owner-led pass through the seven tabs,
   persistent strip and quick Layers flyout. Fix confusing labels, state feedback,
   primary-action hierarchy, spacing/overflow, disabled-action explanations and
   explicit error/cancellation messages. Preserve 44px tablet targets, readable
   Slate/Foundry/system themes and keyboard focus/Escape behavior. Reuse existing
   dialogs and components; no toolbox redesign or extra feature tabs. Prefer
   understandable user-facing summaries over raw recovery internals without
   hiding exact disclosures in guarded reviews.
3. **Small connected acceptance pass.** Use disposable Scenes and retain all
   immutable evidence. Check draw/select/edit, layer order/locks, GM workspace
   versus player presentation, label/stamp placement and cancellation, library
   save/reload/remove/restore, supported import/export and actual disk downloads.
   Verify a GM and player, ordinary reload, stale/denied writes and cancellation
   at the exposed review boundaries. Run focused tests per fix, then one complete
   repository test run and build at release-candidate freeze. New blockers receive
   fixes and targeted rechecks, not repeated full exploratory matrices.
4. **Performance and hardware smoke check.** Use one representative large
   artwork project to check responsiveness, cache-budget behavior and repeated
   open/close/Scene teardown for growth/leaks. Record browser/hardware/project
   size and observations; claim no universal performance threshold. Have the
   owner check the actual tablet if available. Untested hardware stays explicitly
   uncertified; no pen-pressure claims. Broad GPU/color/fog/elevation/fidelity
   benchmarking and actual crash/network simulation remain deferred.
5. **Package and release candidate.** Reconcile the public README/changelog with
   shipped controls, supported Foundry versions, permissions, storage-retention
   limitations and known issues. Verify bundled licenses/assets, clean-install
   activation and packaged runtime parity. Present a concise owner sign-off:
   shipped scope, passed checks, remaining blockers and deferred items. Publish,
   deploy or commit only on explicit owner instruction.

**Stop rule:** Once the exposed shipping paths pass the bounded checks and the
owner accepts remaining limitations, cut the release candidate. Nonblocking
cosmetics go into a follow-up list; do not add services "while here". If an
experimental feature would expand the acceptance matrix, leave it gated for a
later release rather than delaying this one. Do not invent an elapsed-time
estimate before the exposure audit identifies actual blockers.

#### Rush release plan (owner-approved 2026-10-09, supersedes ordering above)

Single plan for the internal release. Scope = drawing-tools readiness (Tier 1 +
Tier 2), tracing reference tile, and the release GUI reorganization below.
Everything else stays deferred.

| Step | Work | Est. prompts |
|---|---|---|
| R1 | Defects: starter labels show raw i18n keys; Layers rows overflow; help paragraphs become hints/tooltips; window ~440px | 1–2 |
| R2 | Brush bar: width slider + quick sizes, labeled opacity sliders, 8 recents, brush presets | 2 |
| R3 | Tool rail Label/Stamp tools; contextual selection bar | 1–2 |
| R4 | Layers panel on Quick-layers rows; presentation menu in header; duplicate layer; delete layer with artwork | 2–3 |
| R5 | Tracing reference tile | 2 |
| R6 | Color panel, Assets panel, header menu with file actions and Settings dialog | 2–3 |
| R7 | Angle snapping, only if Tier 1 shows it is needed | 0–1 |
| R8 | Deploy; Tier 1 live checks with owner and player view; tablet/themes; docs; package | 2–3 |

Each step: focused tests, build, short live check where UI changes. Total about
12–18 prompts; same-day completion not required. Stop rule from above applies.

#### Drawing-tools readiness plan (owner-approved 2026-10-09)

Release definition: the owner can sketch, correct, organize and reveal a map
during a live session without workarounds or lost work. This narrowly amends
the feature freeze: the four Tier 2 items below are approved release scope. No
other new features are admitted.

**Tier 1 — release-blocking hardening (verify on a disposable Scene with a pen):**

- Rectangle, ellipse, polygon, freehand, text and select tools apply toolbox
  stroke, width, opacity and fill.
- New Drawings join the active layer, respect locks and stay player-hidden
  until presented.
- Move, resize, rotate, restyle, delete and copy/paste keep layer membership.
- Native Foundry Ctrl+Z works with layer membership and does not corrupt layer
  order. A failure here is a blocker; module-level atomic undo stays deferred.
- Labels and stamps arm, place, repeat and cancel; placed text stays readable.
- Player view (Aroh) matches the presentation.
- Library save, reload and placement work; JSON export reaches disk.
- A representative map stays responsive; reload/reconnect loses no work.

**Tier 2 — approved small additions (self-contained, low-risk):**

1. Named brush presets (stroke/fill/width/opacity bundles such as wall ink,
   water fill, pencil sketch), saved per client and applied from the Brush tab.
2. Duplicate layer: copy the layer and its member Drawings to a new hidden
   layer directly above the source.
3. Delete layer with its artwork: explicit confirmation that states the
   Drawing count; skips nothing silently; locked layers refuse. The existing
   membership-only removal remains available.
4. Angle snapping for polygon/line segments (for example 15° with a modifier
   key), only if native grid snapping proves insufficient during Tier 1.

**Tracing reference tile (owner-approved 2026-10-09, release scope):** replaces
the paused live-renderer transparency for this release. A Layers action
rasterizes the selected layer through the existing WEBP export path (composited
first, so overlaps fade uniformly), uploads it via the supported FilePicker
upload, and creates a hidden, locked Tile aligned to the layer bounds at 50%
alpha beneath Drawings. The source layer is hidden in the GM workspace; its
Drawings remain untouched and editable. It is a snapshot: re-run to refresh.
Opacity is adjusted on the Tile; removal deletes the Tile document while the
uploaded file remains (no supported delete API). Verify live that hidden-tile
GM dimming yields a usable default and that players never see it.

#### Release GUI reorganization (owner-approved 2026-10-09)

Owner decision: full reorganization before release; same-day completion not
required. Floating window stays, widened to about 440px. Audit findings that
drive it: Layers-tab rows overflow horizontally (rename clipped, "Actions" on its
own line); starter labels render raw i18n keys; long help paragraphs lead most
tabs; duplicate color inputs; Library mixes stamps, ~90 prefabs, projects and
exports; Presentation duplicates Layers' eyes; disabled selection buttons
always shown. Quick layers flyout and Palettes grid are the reference style.

Target structure:

1. **Tool rail:** Select, Rectangle, Ellipse, Polygon, Freehand, Text, Label
   (arms label placement), Stamp (arms stamp/prefab placement).
2. **Brush bar:** overlapping line/fill chips with swap and no-fill; width
   slider with numeric value and quick sizes 2/4/8/16/32; labeled line and fill
   opacity sliders; brush preset dropdown; 8 recent colors.
3. **Contextual selection bar:** shown only with a selection: count, apply
   current style, move to layer, fill, label.
4. **Four panels:** Color (palettes, picker, fill type/texture); Layers (Quick
   layers row component with GM eye, player eye, thumbnail, name, count, lock,
   overflow menu holding rename/move/duplicate/delete-with-artwork/tracing tile;
   Presentation preset menu in its header); Assets (Prefabs, Labels, Stamps,
   Projects switch with one shared search and thumbnail grids, replacing the
   Library tab layout); window-header menu (save/import/export and a Settings
   dialog replacing the Settings tab).
5. Help paragraphs become one-line hints and tooltips. Keep 44px tablet
   targets, themes, keyboard navigation and existing services; this is a view
   restructure, not new persistence. Estimated 7–10 prompts.

**Tier 3 — still deferred:** module atomic undo/history, live-renderer reference
transparency, room/corridor tools, stamp brush, image adjustments, collective
transform previews, Consolidate/Bake, recovery UI, storage catalog and non-GM
editing.

**Sequence:** deploy the current build and run Tier 1 with the owner; fix
blockers; implement the tracing tile, then Tier 2 in the order above with focused
tests each; final tablet/session-realism check; package. Expected effort:
roughly 8–13 prompts, depending on Tier 1 findings. Non-GM editing is dropped
from current scope; all other Tier 3 items ship later.

#### Deferred backlog (not first-release requirements)

**First internal-build UX pass (2026-10-09):** The deployed seven-tab toolbox
opened and each tab rendered without horizontal window overflow at the current
owner viewport. Read-only tab inspection found no public recovery import or
optimization controls in the toolbox. This is a layout/exposure smoke check,
not draw/save/download or hardware acceptance. No destructive/artwork actions
were invoked. The tab strip exposed seven keyboard Tab stops; source now uses
one selected-tab stop, wrapping Left/Right and Home/End navigation, keyboard
focus restoration and explicit navigation render-error reporting. Pointer
activation does not force tab focus. 59 selected toolbox/appearance/localization
tests pass; build, packaged toolbox parity and editor diagnostics pass. The new
keyboard implementation is packaged but not yet deployed/live-certified.
Experimental cache host remains inactive: do not add a misleading cache-clear
button for a cache that is not currently serving live artwork.

The table below records longer-term outcomes, not the next implementation queue.
Private composited reference transparency, Phase 5G history/illustration tools,
non-GM role relay/distributed authority, new destructive artwork commands,
comprehensive storage administration and broader recovery/fidelity certification
are explicitly deferred. Existing internal recovery work is preserved, not
deleted or represented as publicly accepted.

| Work | Remaining outcome |
|---|---|
| Intuos4 hardware acceptance | Setup/keybindings/key diagnostic are implemented; verify the actual PTK-840 driver/browser assignments and ExpressKeys with the owner. Wacom driver configuration remains manual. |
| Persistent library acceptance / deletion | Saves, thumbnails, metadata edits, duplication, replacement repair and shared catalog removal/restoration are implemented. Real-file/multi-GM acceptance remains; file deletion needs a supported API or an explicit external-only workflow decision, not an unsupported endpoint. |
| Publication / exchange | Bounded transparent/Level-background WEBP, strict vector SVG and subtree/targeted JSON exchange are implemented. Active-Level export defaults/filtering and explicit one-Level-or-combine native import acceptance passed; actual disk download remains unverified. Best-effort Level matching is owner-rejected. Portable recovery/output-chain exchange remains. |
| History and illustration | Atomic undo/conflict handling; collective selection transforms/previews; named brush presets; snapping/angles; room/corridor tools; image adjustments; layer duplication/GM solo; bounded spaced stamp brush last. |
| Flattening | Reviewed rendering, verified durable storage, resumable apply/restore, disconnected-owner recovery handoff and an opt-in connected Tile Bake service are implemented. Fail-closed local conflict monitoring detects unexpected Scene journal updates during active review; GM dialogs/storage setup, cross-client authority relay, native display/fidelity acceptance, live apply/restore certification, Consolidate/background workflow integration and portable recovery remain. |
| Authority and destructive actions | Layer changes and Bake writes remain restricted to Foundry's designated active GM. Client-side journal conflict monitoring is fail-closed but advisory across clients; there is no distributed lock or server compare-and-swap. Validated role access/online-GM relay before non-GM editing, multi-client atomic conflict policy, and confirmed delete-layer-and-artwork option remain. |
| UI and release | Owner-led tab/main-GUI cleanup, graphical saved-color editor, connected GM/player/multi-GM and real pen/touch checks, interruption/reconnect coverage, performance benchmarks and packaging/license review. |
| Final-final documentation | After implementation, owner cleanup and acceptance, turn this reconciled specification into the public GitHub README and linked documentation. |

No migration adapters, vector import, arbitrary reference-Tile placement,
pixel painting, blend modes or automatic Walls/lighting conversion are added.
The owner-approved two-stage optimization amendment in section 15 adds baked
artwork Tiles and separately approved reversible Level-background baking.
Gamma remains a control-design example, not approved functionality.
Pen pressure is a future possibility only, excluded from current implementation,
Settings controls, diagnostics and release acceptance.

## Refined scope and confirmed decisions

This is a new Foundryshop feature. Design the layer engine greenfield where
meaningful; there is no requirement to preserve a previous layer implementation,
import Canvas Layers worlds, or maintain legacy adapters.

- Foundryshop owns the layer engine. Canvas Layers is optional research, not a
  runtime dependency or a mandatory code-adoption milestone.
- Foundryshop editing and presentation controls default to GM-only. The Phase 5F
  amendment adds an explicit GM-managed minimum-role setting and validated online-GM
  relay for authorized non-GMs. Until that gate passes, retain GM-only behavior.
  Unauthorized players receive presentation passively without editing controls.
- Players still need the client-side runtime that renders the presentation.
  GM-only controls do not mean the module runs only on GM clients.
- Player hiding is presentation-only, not confidential storage. Drawing data
  and Scene flags may be available to player clients even when artwork is hidden.
- Presentation presets affect players only. They never change a GM's workspace
  visibility, active layer, brush settings, or selection.
- Group visibility uses ancestor gates and preserves child settings. Separate,
  explicit Show All / Hide All commands overwrite descendant settings.
- New ordinary layers are visible in the creating GM's workspace and hidden
  from players until explicitly presented.
- Owner-approved Layers-tab transparency is initially a private per-GM/per-Scene
  tracing aid. It does not rewrite Drawing opacity, player gates or presentation
  presets. True composited layer opacity must pass a native renderer feasibility
  gate; multiplying individual stroke alpha is not an equivalent substitute.
- Unflatten restores retained source strokes without removing later strokes.
  Edits to consolidated artwork require an explicit conflict resolution prompt.
- Keep a schema version for future Foundryshop evolution, but do not implement
  speculative legacy migrations before an actual supported schema change exists.
- Share editable drawing maps through versioned JSON packages, not Foundry Scene
  backups. Include retained flatten recovery by default; omit it only explicitly.
- Export rendered artwork as WEBP and vector artwork as SVG. JSON is the lossless
  interchange authority. JSON is the editable-project import format.
- Add bounded PNG/JPEG/WEBP image import/paste and editable shape stamps as
  Drawing-based artwork. SVG/vector import and arbitrary reference Tile placement
  remain excluded. Section 15 separately approves reversible WEBP baking to Tiles,
  and reversible Level-background baking with original/output preservation.
  Continuous stamp-brush strokes are scheduled later
  under Phase 5G, not required for the initial stamp-placement milestone.
- Consolidate module controls into a seven-tab Drawing Toolbox with three persistent
  rows in the eight-button-wide layout. Add named shared palettes, rendered JSON previews/embedded thumbnails
  and a shared file-backed project/shape library as specified in Phase 5F.
- Add the Phase 5G mapping-workflow expansion: collective selection transforms,
  brush/tool presets, snapping/angle constraints, room/corridor illustrations,
  spaced stamp brushes, non-destructive image adjustments, layer duplication and
  workspace solo, atomic module undo, and live transform previews. Preserve the
  8button interface and native Drawing-based artwork.

## Verified Foundry v14 facts

This design was checked against the Foundry VTT v14.368
API/documentation and Canvas Layers v2.0.0.

1.  A Scene Background image is rendered at the lowest level and appears
    underneath other canvas content. Keep the parchment/grid image as
    the **real Scene Background**, not as a Foundryshop pseudo-layer.
2.  `DrawingData` in v14 includes `sort`, documented as the drawing's
    z-index relative to sibling drawings. It also exposes `hidden`,
    `locked`, `elevation`, stroke/fill opacity/color fields, etc.
3.  Foundry canvas documents provide `sortRelative(...)`, which can
    position a document relative to a sibling using Foundry's integer
    sorting mechanism.
4.  Foundry has distinct native canvas layers/groups---Drawings, Tiles,
    Tokens, Walls, Lighting, etc. A Foundryshop stack must **not promise
    arbitrary cross-type Photoshop compositing**. Initial
    rendering-order guarantees should apply to Drawing documents.
5.  Canvas Layers v2.0.0 is system-agnostic and verified for Foundry
    14.368. It groups Drawings and Tiles into named layers and lets GM
    and players individually toggle those layers.
6.  Foundry modules can request a module socket namespace
    (`socket: true`); messages on `module.<name>` are relayed to
    connected clients. This is suitable for broadcasting GM presentation
    state, with Foundryshop enforcing authority and persistence.

## Core mental model

``` text
FOUNDRYSHOP — LAYERS

        TOP
────────────────────────────
👁  ≡  Session Marks
👁  ≡  Labels
👁  ≡  Furniture & Debris
👁  ≡  Quarry Details
👁  ≡  Main Map Lines       ✏ active
👁  ≡  Under-Sketch
────────────────────────────
🔒 Scene Background
   parchment-grid.webp
        BOTTOM
```

The Scene Background entry is informational/fixed. It cannot be dragged
into the Drawing stack. Everything above it is a Foundryshop abstraction
over Foundry Drawing documents.

## 1. Pseudo-layers

A Foundryshop layer is a logical collection of Drawing documents plus
metadata. It must have a stable ID independent of its display name.

Conceptual layer record:

``` js
{
  id,
  name,
  parentId,
  kind: "layer",
  playerAllowed,
  locked,
  defaults: {
    strokeColor,
    strokeWidth,
    strokeAlpha,
    fillColor,
    fillAlpha
  }
}
```

GM workspace visibility and the active layer belong to per-GM/per-Scene local
state, not shared Scene node records. Groups also have a `playerAllowed` gate.
Local visibility has a separate gate for each node on each GM client.

Do not encode hierarchy into names such as `BlackRock/Quarry/Ink`.
Renaming a folder or layer must not break membership, presets, or
references.

## 2. Nested groups / tree

Groups are organizational containers and may contain layers and other
groups. Support arbitrary nesting.

``` text
▼ Black Rock Downs
   ├─ ▼ Surface Quarry
   │     ├─ Session Marks
   │     ├─ Labels
   │     ├─ Details
   │     ├─ Map Ink
   │     └─ Rough Sketch
   ├─ ▶ Upper Galleries
   ├─ ▶ Deep Quarry
   └─ ▶ Sharran Fane
```

Group visibility should have tri-state presentation: visible, hidden, or
mixed, derived separately for workspace and player presentation. Clicking a
group eye toggles that group's gate without overwriting descendant settings.
If the group's own gate is enabled but its descendants are mixed, clicking hides
the group; enabling it again restores the same child settings. An ancestor-hidden
group remains effectively hidden until its ancestors are enabled.

Explicit Show All / Hide All commands recursively change descendant settings.
Show All within a subtree does not silently open gates above that subtree; the UI
must indicate when an ancestor still suppresses it.

## 3. Drag-and-drop

Use familiar layer-panel behavior:

-   drag layer above/below sibling → reorder;
-   drag layer onto group → reparent;
-   drag group → reorder/reparent whole subtree;
-   reject cyclic drops;
-   preserve stable IDs.

Logical tree ordering and render stacking should remain separable
internally. Nested location trees may require an explicitly computed
Drawing stack.

## 4. Actual Drawing render order

Translate the logical Drawing stack into Foundry's native `sort`
ordering. Do not expose sort numbers in the UI.

Prefer public/supported document sorting mechanisms such as
`sortRelative(...)` where practical. If bulk reconciliation requires
direct `sort` updates, centralize them in a `DrawingOrderService`.

``` text
TOP
Labels
Details
Map Ink
Rough Sketch
BOTTOM
```

This means all Label drawings render above Details, which render above
Map Ink, while everything remains above the real Scene Background.

Within a pseudo-layer, preserve relative stroke order so newly created
strokes can naturally appear above older strokes.

Operations:

-   Bring Layer Forward
-   Send Layer Backward
-   Bring Layer to Front
-   Send Layer to Back
-   drag/drop reorder

Foundryshop may periodically normalize/reconcile underlying Drawing sort
values. Users should never manage sort integers.

## 5. Active drawing layer

Exactly one ordinary layer can be the current **active drawing layer**
for a Scene/GM once ordinary layers exist. Players have no Foundryshop active
layer. Non-GM Drawing creation outside Foundryshop is not automatically assigned
through another user's active layer.

When a new Drawing is created:

1.  assign its Foundryshop layer membership;
2.  apply layer drawing defaults if configured;
3.  position it correctly within that layer's Drawing order;
4.  refresh the layer UI.

This is central to the Wacom workflow: click `Map Ink`, draw; click
`Labels`, draw; no per-stroke configuration.

## 6. Membership storage

Prefer Foundry flags.

Suggested Drawing flag:

``` js
flags.foundryshop.layerId = "<stable-layer-id>"
```

Suggested Scene-level state:

``` js
flags.foundryshop.layers = {
  version,
  revision,
  nodes,
  presets: [{ id, name, entries: [{ nodeId, playerAllowed }] }],
}
```

Include a schema/version field from the beginning.

The node array is the canonical top-to-bottom sibling ordering. Derive root and
child traversal from `parentId`; do not persist competing `order` numbers or
`rootOrder` lists. `revision` supports stale-edit detection, not server-side
compare-and-swap or a multi-document transaction.

If a Drawing has no membership or references a missing layer, expose it in an
`Unassigned` virtual layer. Assignment is explicit; this is runtime integrity
handling, not a legacy migration feature. Ordinary unassigned Drawings retain
native visibility/order; unresolved membership remains hidden from players until
assigned. Explicit unassignment warns that native visibility may reveal artwork.

## 7. Two visibility domains; no player-facing controls

Keep these separate:

1.  **GM workspace visibility** --- what the GM locally sees while
    editing, independently for each GM and Scene.
2.  **GM player-presentation permission** --- whether players are
    shown a layer/group, shared and persisted in Scene flags.

Conceptually:

``` js
effectiveGMWorkspaceVisible =
  localLayerVisible && everyAncestorLocallyVisible;

effectivePlayerPresentationVisible =
  layer.playerAllowed && everyAncestorAllowsPlayers;
```

These expressions describe Foundryshop's gates, not an override of native Foundry
visibility rules. Define and test how native Drawing `hidden` state and other
rendering constraints compose with them; a layer toggle must not silently reveal
a natively hidden Drawing.

Players cannot modify authoritative presentation through Foundryshop. Do not
register player layer controls or accept non-GM presentation mutations.

There is deliberately no `playerWantsLayer` state. A shared GM presentation is
clearer than giving each player an independently filtered version of the map.
Player-specific filtering or drawing collaboration would need a separate future
design rather than dormant initial-release controls.

**Confidentiality boundary:** hiding artwork does not guarantee that its Drawing
documents, coordinates, text, names, or layer metadata are inaccessible to player
clients. Absence of a player UI is not a data-access boundary. Do not describe
these controls as secure storage for secrets.

## 8. GM broadcast controls

Provide:

-   Show to Players
-   Hide from Players
-   Show Group to Players
-   Hide Group from Players
-   Solo locally
-   optionally Solo for Players

Use persisted Scene updates for live synchronization where sufficient. If a
socket is needed, use Foundry's supported module socket mechanism under the
authority restrictions below. Validate that presentation mutations originate
from an authorized GM.

Persist authoritative state in Scene flags so reconnecting clients
recover the correct state rather than relying only on transient socket
messages.

Prefer persisted Scene updates as the authority. A socket payload's claimed GM
user ID is not proof of origin. If sockets are needed, use them only to invalidate
or refresh from persisted state unless the supported API provides verifiable
sender authority. Validate payloads and Scene identity; never mutate presentation
directly from an unauthenticated socket message.

## 9. Location/presentation presets

Support named presets independent of hierarchy:

``` text
[ Surface Quarry ]
[ Upper Galleries ]
[ Deep Quarry ]
[ Sharran Fane ]
[ Entire Dungeon ]
```

A preset represents desired presentation states for groups/layers and
should apply atomically from the user's perspective.

Presets are GM-only full presentation snapshots referencing stable node IDs.
Every current layer/group's own gate is captured, including child gates suppressed
by an ancestor. Applying one changes only player presentation, not GM workspace
visibility/folding, active layer, brush configuration, selection, or Drawing fields.
Saved nodes use their recorded gates; nodes added after capture become
player-hidden. Group gates still compose with individual child gates.

Validate and compute the target before committing all gates in one Scene update.
This is not a server-side compare-and-swap guarantee across simultaneous GMs:
stale revisions are rejected locally, and concurrent shared editing is unsupported.
Save uses unique case-insensitive names and stable preset IDs. Apply, snapshot
replacement, and deletion require confirmation; rename changes only the label.
The UI derives matching status from actual gates rather than a last-applied ID.

Removing referenced nodes warns before removal and preserves their preset entries.
The affected snapshot is marked incomplete and Apply is disabled until the GM
reviews the current presentation and explicitly replaces the snapshot or deletes
it. Missing references are never silently ignored or automatically removed.
The v1 tree includes an optional additive `presets` collection, normalized to an
empty array when absent; this preserves current foundation test Scenes without a
legacy migration project. Per-GM workspace data is never part of a snapshot.

Example:

``` text
Surface Quarry   OFF
Upper Galleries  ON
Deep Quarry      OFF
Sharran Fane     OFF
```

A layer withheld from players within an otherwise visible location can remain
disallowed. This is a presentation rule, not a confidentiality guarantee.

## 10. Layer locking

Layer/group locks are independent accidental-edit gates; a locked ancestor
protects every descendant without overwriting any child's own lock setting.
Native Drawing `locked` fields are never synchronized or rewritten. Effective
protection is the union of native and inherited layer locks; unlocking a layer
cannot clear native locks set elsewhere.

GM-only lock controls persist only the selected node's own gate in Scene state.
Protected members are released from selection. Public `controlDrawing` and
`preUpdateDrawing`/`preDeleteDrawing` hooks guard ordinary canvas, palette/sheet,
and toolbox edits, movement, deletion, and membership changes. Creation with
explicit locked membership is rejected, including paste/undo. Assignment into/
out of a protected subtree and removal of protected nodes are refused.

The active-layer resolver excludes all inherited locks, falling back to the first
available unlocked ordinary layer; creation is rejected when none exists. Per-GM
workspace data is not rewritten by lock changes. Layer/group reordering/reparenting,
visibility/presets, and brush-default metadata remain adjustable; only sort-only
Foundryshop maintenance is exempt from the Drawing edit guard. Reparenting
recomputes inherited protection.

These client hook guards prevent accidental editing, not privileged scripts or
server operations using hook suppression. They are not a security boundary.
Do not prototype-patch native permission checks or introduce ownership snapshots
when the independent gate preserves native state without them. Live v14 tests
must still check native selection, drag previews, sheet edits, undo, and multiple
clients; source evidence alone is not renderer/interaction verification.

## 11. Layer drawing defaults

Layers may remember brush defaults:

``` text
ROUGH SKETCH
stroke: gray
width: 2
alpha: 0.4

MAP INK
stroke: dark gray/black
width: 4
alpha: 1.0

SESSION MARKS
stroke: red/blue/etc.
width: 5
alpha: 1.0
```

Because Foundryshop evolves Boneyard-style drawing controls, layer
selection and palette/brush selection should eventually cooperate.

### Owner amendment: importing a sketch and tracing it with layer transparency

**Approved scope, not implemented yet:** The owner wants to copy a mouse-drawn
map from the corner of an existing Foundry Scene into a newly prepared map Scene,
then trace over a 50%-opacity reference with the tablet. The owner explicitly
selected private GM workspace transparency first; shared player-presentation
opacity is a separate deferred decision. This amendment is the next implementation
priority before resuming multi-Level exchange.

#### Transfer and tracing workflow

1. Preserve the source Scene and export an authoritative editable JSON backup.
   Select the map's Drawings, assign them to an `Original sketch` layer or group,
   and export that subtree. Existing full/subtree exchange includes hidden content;
   this is not a player-safe export.
2. Prepare the new Scene's dimensions, grid, background and displayed Level.
   Import empty/additively, translating the sketch from its old corner position.
   Existing targeted additive imports may put their new hidden wrapper inside a
   chosen unlocked group; fresh identity, source context and journal safeguards
   remain in force. Do not silently scale artwork to the new grid.
3. Lock `Original sketch`, set its private reference opacity to 50%, and create
   an unlocked `Clean ink` layer above it. Native and inherited locks prevent
   accidental edits; reference opacity must remain adjustable on locked layers.
4. Redraw in the clean layer, toggle the reference for comparisons, and keep source
   strokes available. Imported content stays player-hidden until explicitly
   presented; tracing controls do not change that state.
5. Preserve the imported sketch and new clean ink as separate editable layers.
   Optimize finished regions only through explicit, verified reversible operations.

Native copy/paste remains an option, not a replacement for verified portable
exchange. Foundryshop's copied-artwork cursor placement can position/rotate/scale
small selections but currently caps them at 100 Drawings and refuses hidden/
natively locked source artwork. JSON is the recommended whole-map transfer path.
Collective alignment/scaling and fit-to-destination are future transform tools:
implement after atomic history, defining stroke/text/texture scaling and preview/
commit semantics. Do not imply that changing Scene grid size already resizes ink.

#### Layers-tab reference transparency

- Provide a clearly labelled **GM reference opacity** range/percentage control for
  ordinary layer rows in the toolbox Layers tab and the full Layers panel using
  the same service. Range 0-100%, default 100%, step 5%, quick **50%** and **100%**
  actions. Use existing numeric/slider/touch/localization patterns; interactive
  targets must be at least 44px. Show a non-default percentage in the row.
- Persist separately from shared Scene layer metadata in the existing per-GM/
  per-Scene workspace store, keyed by stable node ID. Validate finite bounded
  values, prune deleted-node entries, and keep serialization bounded. Default
  absent values to 100%; invalid stored values surface an explicit error rather
  than silently substituting a successful-looking value.
- Zero opacity is not hiding, deleting, locking or excluding a layer. Preserve
  independent visibility/selection/active-layer semantics; the visible percentage
  and 100% reset make an invisible reference recoverable.
- Do not mutate native strokeAlpha/fillAlpha/textAlpha, native hidden/locked fields,
  source geometry, defaults, presentation presets or any other GM's workspace.
  Player clients receive no new control and render their presentation unchanged.
- True layer opacity means composing the included layer artwork first, then
  applying the layer multiplier once. Two overlapping opaque strokes at 50% layer
  opacity remain 50% in the overlap; independent per-stroke alpha multiplication
  would darken the overlap and is not acceptable as a silent approximation.
  Preserve native-hidden geometry's separate native attenuation and text behavior.
- First delivery targets ordinary layers. A group-wide reference control may
  follow only with tested compositing/nested-opacity semantics; do not present
  a misleading group slider or assume multiplying child strokes is equivalent.
  Ancestor visibility/locks remain authoritative. The fixed Scene Background and
  Unassigned entry are not silently made pseudo-layers.
- Reuse supported native render surfaces/lifecycle hooks; never reparent live
  native display objects destructively or globally patch PIXI extraction. Verify
  Drawing refresh, new strokes, edits/deletion, text, image/material fills, Level
  switching, drag previews, selection handles, canvas teardown and module disable.
  Dispose textures/surfaces and restore native rendering when opacity resets.
- Preserve effective stack/elevation/interface behavior. A one-surface layer
  requires compatible stacking; interleaved native sorts, mixed render modes and
  bounds exceeding GPU/memory limits are feasibility cases, not permission to
  reorder or omit artwork. If faithful supported rendering is impossible, report
  the limitation and ask the owner before changing the contract.
- JSON project/shape exchange excludes private reference opacity. Player WEBP/SVG
  export ignores it. GM-workspace publication must eventually include it, with
  stale-workspace checks, equivalent raster compositing and explicit SVG handling.
  Non-default reference opacity must block any export that cannot faithfully
  represent it rather than silently publishing a different workspace appearance.
  Preview/thumbnail audience semantics must remain explicitly documented; reusable
  library thumbnails remain source-artwork previews, not private tracing views.

#### Read-only renderer feasibility and acceptance gate

Begin with detached synthetic fixtures in native Foundry v14 through Playwright,
not edits to the owner's source map. Compare actual pixels at 100%, 50% and 0%,
including opaque overlap, translucent overlap, native-hidden geometry/text,
rotated shapes, smoothed strokes and textured/image Drawings. Verify unchanged
native documents/player view and no private state leakage through JSON or exports.
Measure initial surface allocation, refresh latency, selection/drag response and
cleanup; test small/large zoom and Level/Scene switches. Use output-axis/pixel/GPU
and decoded-memory limits derived from measured surfaces; never allocate an
unbounded Scene-sized cache merely to deliver a slider.

After feasibility passes, implement workspace validation/service, both Layers UIs,
render lifecycle, publication guards/handling and focused automated/native tests
as one coherent slice. Verify persistence after reload and independent connected
GM/player workspaces. The UI control is not complete until real compositing and
consistent export behavior are verified; document any remaining connected/
physical-tablet acceptance separately.

#### Native feasibility findings and owner-directed renderer investigation

**Current decision:** Native isolated compositing has been verified, but the
general live renderer gate has not passed. When offered a first delivery limited
to contiguous, same-elevation/render-mode layers with explicit refusal otherwise,
the owner selected **pause transparency implementation and investigate a more
general renderer first**. Do not implement that restricted slider without a new
decision. No workspace schema, live render override or opacity UI has shipped.

Read-only native v14 inspection found Drawing `PrimaryGraphics` shapes directly
under `PrimaryCanvasGroup`, not under persistent pseudo-layer containers. Native
text is a child of its shape. Native sorting compares elevation, sortLayer, sort,
zIndex and stable insertion order. Native refresh writes shape alpha for dragging/
hidden state and text alpha independently. Applying one filter to each shape
therefore remains per-Drawing fading, not composited layer fading. Reparenting
native shapes into a group would change native lifecycle/sorting ownership and
is not an approved shortcut.

Detached PIXI fixtures on the actual renderer verified:

- Two overlapping opaque red rectangles at independent 50% shape alpha produced
  alpha 127 in a single-stroke region and 191 in the overlap. An isolated
  `AlphaFilter(0.5)` over their container produced 127 in both regions: the required
  distinction is measurable, not cosmetic.
- Two originally 50%-alpha blue shapes composed at 50% layer opacity produced
  approximately 25% alpha singly and 37.5% in their overlap, preserving the source
  overlap before applying the layer multiplier. Filtered native text maximum alpha
  was 255/127/0 at reference opacity 100%/50%/0%; zero cleared the surface.
- Interleaved red-reference / green-other / blue-reference objects produced
  different pixels if the reference strokes were regrouped below or above green.
  Grouping cannot in general preserve that native interleaving. Splitting the
  reference into contiguous runs preserves order but is segment opacity, not one
  whole-layer opacity where the runs overlap.
- A candidate complete-scene endpoint crossfade preserved the original stack at
  100% and the scene with reference strokes omitted at 0%. In the synthetic
  interleaved fixture, premultiplied opaque pixels were approximately
  [0,128,128,255] with the layer, [0,255,0,255] without it, and [0,192,64,255]
  halfway. This is a scene-contribution crossfade, not isolated layer composition.
  It depends on background/other-layer occlusion and requires a distinct semantic
  contract, multi-opacity interaction and publication tests before adoption.

All fixtures created temporary detached objects/targets, disposed them and left
Scene document sources unchanged. No player-view, native lifecycle or cross-client
compatibility is claimed. The bundled PIXI canvas extractor again showed saturated
low-alpha color overflow; translucent color checks used raw premultiplied pixel
extraction with temporarily changed target alpha mode restored in `finally`,
not a global PIXI patch. Alpha values and opaque crossfade pixels remained usable.

An exploratory 512x512 synthetic submission run used 100/500/1,000 two-point
Graphics strokes, three warm-up frames and ten timed renders including a final
GPU finish. Unfiltered totals were 7.7/54.6/92.2 ms; filtered totals were
6.0/29.5/48.9 ms. These single-run, order-dependent samples are **not evidence
of a speedup**, live FPS, selection latency or release capacity. One nominal
RGBA surface at this size is 1 MiB; actual filters/targets can allocate several
surfaces and depend on renderer resolution. Randomized repeated runs and measured
allocation/invalidation are required before setting a performance budget.

**Next bounded general-renderer investigation:**

1. Define interleaved-layer semantics explicitly. Compare isolated layer opacity,
   contiguous-run opacity and complete-scene contribution crossfade; verify
   0/50/100 endpoints over transparent and opaque backgrounds, multiple reference
   layers, partial occlusion, native hidden/text alpha and non-normal blend modes.
   Do not describe different operations with the same unqualified layer label.
2. Examine supported PrimaryCanvasGroup render/depth/occlusion interfaces and
   interface-Drawing rendering. A replacement/cache must preserve depth/lighting/
   visibility behavior as well as color; ordinary detached PIXI success alone
   does not justify inserting a plain Sprite into the primary pipeline.
3. Prototype a bounded derived-render service on detached native fixtures with
   borrowed read-only inputs or independent geometry. Do not reparent originals,
   delete sources, overwrite native refresh properties, patch global render
   prototypes or intercept live player rendering to make a prototype appear done.
4. Measure viewport/region versus layer-bounds caches, zoom/resolution changes,
   asset/font readiness and source invalidation. Multiple independently adjustable
   layer contributions may require more passes than one cache; quantify memory
   and render cost instead of assuming constant work.
5. Only after an approach has a coherent contract and native evidence, ask the
   owner to approve any changed semantics or restrictions. Then deliver persistence,
   both Layers UIs, lifecycle, publication equivalence/explicit guards and tests.
   Until then keep native rendering unchanged and transparency implementation
   blocked by this general-renderer gate.

#### General renderer investigation: bounded caching evidence

**October 7, 2026; detached investigation, not a shipped optimization.** The
owner prioritized using fewer resources without compromising quality or editing
functionality. Added a repeatable developer probe at
`tools/drawing-render-probe.mjs`, with bounded workloads, randomized condition
ordering, warm-ups, repeated samples, explicit target accounting and cleanup.
Invoke its `runDrawingRenderProbe` export with the native renderer, PIXI,
`foundry.canvas.primary.PrimaryGraphics` and
`foundry.canvas.primary.PrimaryCanvasContainer`. Do not install it as a runtime
hook. Unit tests cover surface arithmetic, work limits and partial allocation
failure disposal.

Native API findings:

- Foundry's primary group already extends `CachedContainer`, with `autoRender`
  enabled. Its existing render target is viewport-sized, not Scene-sized. At the
  inspected viewport it was 1,485 x 787, resolution 1, RGB, no multisampling.
  Adding another full primary cache is not automatically an optimization.
- Native Drawing `PrimaryGraphics.renderDepthData` is empty and the inspected
  Drawing reported `shouldRenderDepth: false`. This narrows the Drawing-only
  problem; it does not prove that Tiles, tokens, custom children, lighting or
  occlusion can be flattened equivalently.
- `PrimaryGraphics` rejects an ordinary PIXI Container parent.
  `PrimaryCanvasContainer` is the supported native parent and also enforces
  common elevation and its own sort keys. Detached fixtures used that container,
  without adding anything to `canvas.primary`. It does not remove the previously
  established interleaved-layer opacity problem.

Pixel evidence on native PIXI 7.4.3:

- A screen-aligned 512 x 512 cache, rebuilt at the actual transform, exactly
  matched the direct detached fixture at zoom 0.2, 1 and 2: zero differing
  channels. The fixture includes curved strokes, translucent overlap, outlined
  text and a rotated RGBA image. This is the same raster resolution as the
  direct target; it is not reduced-resolution preview rendering.
- Reusing and enlarging the old zoom-1 bitmap instead of rebuilding at zoom 2
  changed 20,985 pixels beyond one channel level, with maximum channel error 255.
  Rescaling stale caches is therefore not an acceptable final-quality shortcut.
- Sixteen 128 x 128 screen-aligned tiles reproduced the zoom-2 fixture with
  maximum channel error 1 and no pixels differing by more than 1. This passes
  only this no-MSAA fixture; shadows, filter padding, other resolutions and
  native clipping must pass before claiming seam-free general tile rendering.
- Caching a complete backdrop plus multiply/add artwork matched exactly.
  Isolating that artwork on transparent pixels and replaying it as one normal
  Sprite changed 4,560 pixels, maximum channel error 72. Backdrop-dependent
  blends must stay native or include a correctly invalidated backdrop. A
  layer-only bitmap is not generally blend-equivalent.

Repeated timing evidence (milliseconds per frame, synthetic 512 x 512 targets,
seven rounds of eight frames per condition, three warm-up frames per condition):

| Curved strokes | Direct median | Reused cache median | Rebuild + replay median |
|---|---:|---:|---:|
| 100 | 0.700 | 0.0125 | 0.587 |
| 500 | 2.412 | 0.0125 | 2.388 |
| 1,000 | 5.125 | 0.0125 | 5.238 |

These are CPU submission plus `gl.finish` timings, not live FPS, GPU timer-query
measurements or guarantees. Cache replay is near the browser clock's measurement
floor. An earlier independent run produced different direct/rebuild medians;
in particular, rebuilding the 1,000-stroke cache is not reliably faster than
native-style direct rendering. The useful opportunity is **reusing unchanged
content**, not recompositing every frame.

A separate read-only reconstruction used all 47 current Scene Drawings, 13,602
path coordinates and two borrowed native textures at viewport 1,485 x 787 and
zoom 0.2. Replaying its viewport cache matched all channels exactly, with 54,371
nontransparent reference pixels. Nine balanced rounds of eight frames measured
medians of 0.275 ms direct, 0.0125 ms reuse and 0.213 ms rebuild plus replay.
There were substantial outliers (direct maximum 9.875 ms); this is not a native
live-canvas benchmark and does not establish this map as a rendering bottleneck.
The first reconstruction attempt explicitly refused unhandled texture resources;
the successful attempt borrowed already-valid native textures without loading or
destroying them. Scene sources and live primary child identities/order remained
unchanged in successful runs.

Memory accounting and implementation direction:

- Two RGBA surfaces for an 8,000 x 6,000 Scene cost 384,000,000 nominal bytes
  (366 MiB), before source assets, geometry, fonts, filters and driver storage.
  The equivalent two viewport surfaces here cost 9,349,560 bytes (8.92 MiB);
  resolution 2 raises this to 37,398,240 bytes (35.67 MiB).
- The detached synthetic probe's output/cache plus sixteen tiles accounted for
  3 MiB across eighteen explicit targets. Tiling alone does not reduce the byte
  cost of storing the same visible pixels; its potential benefit is localized
  invalidation and bounded residency. Geometry/text/assets/native targets remain
  separate costs.
- Prioritize an opt-in, Drawing-only, bounded viewport/region cache with native
  fallback, source originals authoritative, explicit memory admission/eviction,
  and no duplicate full-Scene surfaces. Do not change global primary
  `autoRender` or cache non-Drawing children to make a benchmark look faster.
- Rebuild at current zoom/resolution/subpixel transform. Dirty regions must
  include both old and new bounds, strokes, text, rotation and filter padding.
  Keep actively edited/dragged content native; conservatively invalidate any
  affected ordered/backdrop dependency. Pan/zoom must not expose stale pixels,
  blank edges or permanently blurred resampling.
- Cache admission must account for rebuild frequency and amortization; use no
  cache for small/high-churn workloads when its overhead outweighs savings.
  Measure cache hit rate, rebuild time, total resident bytes and interaction
  latency, not merely the best static replay sample.
- Derived caching reduces repeated raster work, not native document count,
  synchronization or hit-testing. Preserve all originals. Actual stroke
  consolidation/recovery remains a separate preservation-first investigation.

**Next gate:** Prototype dirty-region/invalidation and native Drawing-only
integration on detached supported containers; verify selection/drag, text/assets,
viewport transforms, Level changes, depth/interface order and cleanup. Require
pixel comparisons and resource admission tests before enabling any live cache.
General true-layer opacity remains unresolved for interleaved artwork; these
cache findings do not approve segmented fading or scene-contribution crossfade.
No reference-opacity UI or live renderer override has been enabled.

#### Implemented detached dirty-region cache foundation

Added `tools/drawing-region-cache.mjs` and a native acceptance fixture at
`tools/drawing-region-probe.mjs`. These are developer-only modules, not runtime
imports or hooks, and are not shipped by the module build. The cache owns bounded
derived resources only; no native document or live shape is transferred to it.

Implemented contracts:

- Plan physical-pixel tiles using current viewport resolution, including partial
  edge tiles and fractional-resolution logical coordinates. Admission checks
  RGBA bytes plus explicit caller-reserved output memory, maximum tile count and
  GPU axis limit **before** allocating. Limits are prototype controls, not yet
  measured release budgets. Reject over-budget plans explicitly for native fallback.
- Invalidate old **and** new screen bounds on moves/geometry changes; old bounds
  on deletion; new bounds on insertion. Supplied padding covers stroke/effect
  expansion. Invalid batches fail atomically; unknown bounds require full
  invalidation rather than a silent empty region.
- Explicit bounded context keys invalidate every tile on Scene/Level, transform,
  source order, visibility or asset/font readiness changes. The caller must
  include all render dependencies; the cache does not discover native lifecycle
  changes. Viewport dimensions/resolution changes require recreating the plan.
- Rebuild only dirty tiles; unchanged frames rebuild zero. Rebuild callbacks
  must produce the complete ordered pixels for each region. Failures block
  replay of partially updated frames and leave all tiles dirty for recovery.
- Report planned/reserved/resident bytes, resident/dirty/total tile counts and
  readiness. Explicit eviction releases every resident tile and permits later
  rebuilding; destruction is idempotent. Callback reentrancy and asynchronous
  allocation/render/replay/disposal are rejected. Disposal failures are reported,
  not swallowed, and remaining resources still receive cleanup.

Native acceptance on v14.365 / PIXI 7.4.3 compared direct versus cached pixels
for thirteen cases at resolutions 1, 1.5 and 2: initial build, unchanged frame,
move/rotation, deletion, insertion, geometry/source-alpha change, sort change,
label change, rotated image alpha, simulated source hidden/drag attenuation,
pan/zoom, actual image replacement/font-size change and eviction/rebuild.
**All 39 comparisons matched every channel exactly.** This covers normal blend,
no filters, no MSAA; it does not establish all native Drawing styling or
selection/drag lifecycle behavior. In particular, simulated source alpha changes
are not a physical drag test.

At resolution 1 the 256 x 256 fixture used sixteen tiles: a move rebuilt eight,
deletion four, geometry/alpha two, label change three and an unchanged frame zero.
At resolutions 1.5/2 the full plans contained 36/64 tiles. Derived tile residency
was 256 KiB / 576 KiB / 1 MiB, respectively, with an equal explicit output reserve.
All targets were disposed, and Scene sources and live primary child
identities/order remained unchanged.

Focused automated coverage includes budget rejection, fractional edge coverage,
old/new dirty bounds, padding, context invalidation, eviction/recovery, partial
allocation/render failures, reentrancy and one hundred deterministic randomized
intersection comparisons. No live override, player-view change, persisted
workspace value or opacity UI is installed.

**Remaining optimization gate:** This correct prototype renders the full ordered
root once per dirty tile. It therefore reduces rebuilt pixels and unchanged-frame
work, but can multiply geometry submissions during churn; no timing improvement
is claimed. Next implement and pixel-verify conservative spatial candidate
selection without changing order, accounting for text/rotation/stroke bounds and
backdrop dependencies. Filters, unsupported blends and cross-elevation/interface
content require native fallback until proven. Benchmark dirty-tile versus
whole-viewport rebuild cost and use the cheaper admitted path. Only afterward
wire supported native lifecycle and interaction handling.

#### Implemented ordered spatial candidates and measured rebuild admission

Added developer-only `tools/drawing-spatial-index.mjs` and
`tools/drawing-spatial-probe.mjs`. The region acceptance fixture now uses
conservative spatial candidates instead of submitting all source children to
every tile. No runtime import, live primary hook or player-render change is enabled.

The spatial snapshot preserves the exact input order, stores padded screen-bounds
membership per physical tile and caps source objects at 1,000, display-tree
inspection at 4,096 nodes and candidate references at 65,536. Snapshot bounds
are copied, query arrays are immutable, and invalid bounds/duplicate IDs/
capacity overruns refuse explicitly. Metadata is bounded by counts, not included
in the RGBA surface byte budget. Recreate snapshots after source transforms,
geometry, visibility, text/assets, ordering or context changes; no automatic
native invalidation is implied.

The detached adapter temporarily suppresses only noncandidate fixture children,
never reparents or reorders them, and restores all original `renderable` states
in `finally`, including render failure. It rejects live primary roots, masks,
filters, cached bitmaps and non-normal blends throughout the inspected subtree.
Membership/order changes refuse stale snapshots. Normal PIXI/PrimaryGraphics/
text/Sprite fixtures are verified; arbitrary third-party renderers with geometry
outside reported bounds are not supported. Two physical pixels of candidate
padding conservatively include tested raster edges; this is not a filter-padding
contract.

Extended native acceptance includes a thick curved translucent stroke spanning
several tile boundaries. **All 39 spatially filtered comparisons matched every
channel exactly**, again at resolutions 1, 1.5 and 2. Across the thirteen cases:

| Resolution | Candidate submissions | Full-root submissions |
|---|---:|---:|
| 1 | 217 | 638 |
| 1.5 | 338 | 1,328 |
| 2 | 460 | 2,238 |

These are candidate child counts, not GPU draw calls. Scene sources and primary
child identities/order remained unchanged; every fixture target was disposed.
Automated coverage now includes ordered/boundary/offscreen candidates, immutable
snapshots, limits, exception restoration, unsupported-effect refusal, stale order,
fractional-resolution intersection checks and conservative timing admission.

Benchmarked 500 curved strokes on 512 x 512 targets, both distributed and
crowded, using seven randomized rounds of eight rebuilds per path plus warm-up.
Bounds refresh, complete index recreation and suppression/restoration overhead
are included in spatial samples. Allocation, final cache replay and native
lifecycle costs are **not** included, so this is not an end-to-end admission
measurement or live FPS claim. Latest median milliseconds per rebuild:

| Workload | Viewport | Four tiles, full root | Four tiles, spatial | All tiles, spatial |
|---|---:|---:|---:|---:|
| Distributed | 2.550 | 1.800 | 1.625 | 5.200 |
| Crowded | 1.975 | 4.500 | 4.600 | 5.688 |

Four distributed tiles reduced candidate submissions from 2,000 to 257;
crowded tiles required 1,166. An earlier repeated run measured distributed
full-root/spatial medians of 1.725/1.762 ms: savings are not consistently better
than full-root tile rendering. Full tiled rebuilds were much slower than a
single viewport pass in both tested workloads. Do not choose tiled/spatial
rendering merely because it submits fewer candidate children.

Implemented `chooseMeasuredDrawingRebuild` as a developer gate: require seven
to sixty-four positive timing samples per candidate path; retain viewport
rendering unless a regional path's worst measured sample plus 10% headroom beats
the viewport's best measured sample. The 10% margin is a conservative prototype
policy, not a statistical confidence claim or fixed release tuning. Use
comparable end-to-end measurements and refresh them when workload/context changes;
otherwise keep native/viewport fallback. No live auto-benchmark is installed.

In the latest samples this gate kept viewport rendering for both four-tile
workloads. A single top-left tile admitted full-root regional rendering (median
0.375 ms distributed, 0.200 ms crowded), instead of spatial rendering (0.712/
0.325 ms). The crowded fixture contains no artwork in that corner, so its
single-tile result is an empty-region case, **not** a crowded edit speedup.
The measurements support adaptive path selection and retaining a simple
regional full-root option; they do not support always-on spatial culling.

**Next gate:** Avoid recreating all memberships for each small edit; investigate
incremental bounds/index maintenance and larger/coalesced dirty regions, then
measure end-to-end rebuild plus replay costs. Prototype the supported native
integration boundary with detached objects, preserving depth/elevation/interface
order and keeping selection/drag controls native. Do not activate a live cache
until these costs and lifecycle/fallback behavior pass. The unresolved
interleaved whole-layer-opacity semantics remain a separate gate.

#### Implemented incremental membership and exact dirty-region coalescing

Added `IncrementalDrawingIndex` to the developer spatial service and
`coalesceDrawingRegions` to the region service, plus
`tools/drawing-incremental-probe.mjs`. These remain detached developer modules,
not production renderer hooks.

- Incremental bounds batches recompute memberships only for changed existing
  IDs, preserve authoritative source order, retain unaffected tile arrays and
  report the union of old/new tiles as dirty even when membership is unchanged.
  Batches validate and check final reference capacity before committing any
  mutation. Empty batches are no-ops; duplicate/unknown IDs and invalid bounds
  refuse explicitly. Structural changes, source ordering, viewport/context or
  unsupported effects still require a fresh index and appropriate invalidation.
- Coalescing merges horizontal runs and vertically identical adjacent runs in
  physical pixels, without including clean tiles or crossing gaps. Partial edge
  tiles and fractional resolution retain exact coverage. This is a region plan,
  not a runtime allocator: larger target axis/memory admission must be checked
  before allocating coalesced surfaces. No additional surfaces are silently
  included in the existing tile byte budget.
- Automated tests compare one hundred deterministic incremental moves against
  fresh snapshots, verify unaffected array identity, atomic batch/capacity errors,
  ordered batch moves and exact coalesced coverage. Existing spatial/cache tests
  remain passing.

Native detached evidence used 100 translucent curved strokes and twelve
move/rotate/source-alpha edits at each resolution. Incremental membership matched
a fresh complete snapshot at every edit. Tile replay and separately composed
coalesced-region replacements passed **97 pixel comparisons**: exact channels at
resolution 1, maximum channel error 1 at 1.5 and 2, and zero pixels differing by
more than 1. Source documents and live primary child identities/order remained
unchanged; fixture resources were disposed.

| Resolution | Dirty tile updates over 12 edits | Coalesced regions |
|---|---:|---:|
| 1 | 50 | 18 |
| 1.5 | 70 | 19 |
| 2 | 100 | 21 |

An edit-and-replay benchmark includes a repeated localized source-alpha change,
its native bounds read, index maintenance, dirty-tile rendering and complete
tile-cache replay. Nine balanced rounds of eight edits follow warm-up. Direct
rendering submits the source once to the output; allocation, native event hooks,
interaction/hit-testing and coalesced target costs are not included.

| Resolution | Direct median ms | Fresh index + tiles + replay | Incremental index + tiles + replay |
|---|---:|---:|---:|
| 1 | 0.338 | 0.100 | 0.0875 |
| 1.5 | 0.337 | 0.175 | 0.1375 |
| 2 | 0.338 | 0.2125 | 0.150 |

These are encouraging **specific localized-edit** samples, not live FPS or
general release speedup. Incremental maxima (0.1125/0.1875/0.150 ms) were below
direct minima (0.300/0.300/0.325 ms) in this run. The earlier crowded and whole-
viewport results still require native/viewport fallback. Coalescing has pixel/
coverage evidence, but no measured cost advantage yet.

**Next gate:** Integrate incremental dirty tracking with a detached native
Drawing-derived lifecycle fixture, including structural insert/delete/order
changes, old/new selection/drag bounds and full reset on Level/context changes.
Measure coalesced versus tiled rebuilds including scratch memory and replay;
admit only the proven cheaper bounded path. Then establish a supported live
insertion/suppression boundary that preserves native editing/depth/interface
behavior without reparenting sources or globally overriding native rendering.
No live cache, source consolidation or reference-opacity UI is enabled.

#### Implemented detached lifecycle coordinator and scratch admission

Added `tools/drawing-cache-lifecycle.mjs`. It coordinates complete ordered
metadata snapshots with the incremental index and pending dirty tiles. It owns
no native documents, hooks or GPU resources. Runtime integration is still gated.

- Stable-ID/order changes (insertion, deletion, reorder) and changed render
  context rebuild the index and invalidate the full viewport. Same-identity
  local bounds/style changes use incremental old/new memberships. Pending dirty
  tiles accumulate until a successfully rendered frame is acknowledged.
- Every source record requires a bounded explicit content signature and boolean
  editing state. The host must include all source/render dependencies; the
  coordinator cannot discover native events or asset/font changes automatically.
  Viewport dimension/resolution changes require a new coordinator/cache plan.
- Issued frame revisions become stale after subsequent changes, including
  offscreen edits with no dirty pixels. Acknowledgment requires the current
  issued revision; callers must acknowledge only after successfully rendering
  all its tiles. The coordinator does not itself verify GPU completion.
- Editing requests whole-cache native fallback rather than attempting to
  overlay an edited stroke at the wrong stack position. Entry/exit and movement
  preserve accumulated dirty bounds; ending the edit permits a fresh frame.
  This is a state contract, not live drag/selection behavior.
- Invalid snapshots fail closed, invalidate issued frames and block publication
  until a valid full reset. Caller metadata is copied. Explicit invalidation
  handles cache eviction/context loss; destruction is idempotent.
- Coalesced scratch admission includes all tile residency, caller-reserved output
  memory and the largest sequential regional scratch surface, plus GPU axis
  checks. If scratch does not fit, return explicit tile fallback and reason;
  if existing residency is already over budget, refuse. This assumes scratch is
  disposed/reused sequentially, not accumulated across regions. Scratch cost is
  not silently omitted from the budget.

The native region fixture now takes invalidation exclusively from this
coordinator, removing its previous manual edit hints. All **39 pixel comparisons
matched exactly** at resolutions 1/1.5/2. Initial/insertion/deletion/reorder/
pan-and-zoom transitions reset; local image/text/alpha/geometry changes used
incremental dirty tracking. Coalesced-region probing now checks scratch admission
before allocation; its **97 comparisons** remain within one channel level with
zero pixels beyond that tolerance.

Read-only native Scene snapshots added a metadata-level compatibility check:
47 Drawings, source SHA-256 signatures and native shape screen bounds formed an
84-tile viewport plan. Unchanged snapshots dirtied zero tiles; a copied source
style edit dirtied eight. Copied drag metadata requested native fallback, with
old/new movement affecting ten tiles. Copied insertion/deletion/order/Level
changes each reset all 84 tiles. These operations altered detached metadata
copies only: source documents and live primary children stayed unchanged.
This is **not** an actual native drag, Level switch or selection acceptance test.

Related focused coverage totals **32 passing tests**, including stale/unissued
frame rejection, queued dirty updates, offscreen revision changes, editing
fallback, invalid-input recovery and exact scratch budget/axis boundaries.

**Next gate:** A supported native rendering boundary and actual interaction/
teardown/Level integration remain unverified. Compare coalesced regional cost
including scratch allocation/copy/replay against admitted tile/viewport paths;
do not infer a speedup from reduced region counts. Keep all source strokes
authoritative and keep live primary rendering unchanged until integration and
fallback evidence passes. No reference opacity UI or live optimization is enabled.

#### Implemented GPU coalesced copyback and complete regional-cost probe

Added `tools/drawing-coalesced-rebuild.mjs`. After explicit scratch admission it
allocates one regional surface at a time, renders the ordered spatial union,
copies exact cropped views into the existing cached tile targets through PIXI
rendering, and disposes scratch before continuing. No CPU extraction/readback,
source mutation, reparenting or additional persistent texture is needed.
Copy wrappers never destroy the shared scratch base texture. Allocation/render/
copy failures propagate and cleanup runs; combined operation/cleanup failures
remain visible through `AggregateError`. The host must keep the whole frame
unpublished after any failure.

Native fractional-resolution testing found a real floating-point frame-edge
overflow at resolution 1.5. Copy coordinates now derive from physical-pixel
offsets, validate source containment and compute final extents against the
actual base texture dimensions rather than permitting overflow or silently
cropping an out-of-range tile. A focused regression test covers that boundary.

The expanded probe passed **133 comparisons** at resolutions 1/1.5/2, including
twelve regional scratch-to-tile copybacks at each resolution. Maximum channel
error was 0/1/1, respectively, with zero pixels beyond one channel level.
Scene sources and primary child identities/order remained unchanged.

The same localized 100-stroke edit benchmark now includes coalesced scratch
allocation, spatial union rendering, cropped copyback, disposal and complete
cache replay. Direct/tile paths include source-alpha edit and bounds/index work;
initial persistent cache allocation and native lifecycle/interaction remain
outside this detached timing. Latest medians:

| Resolution | Direct ms | Incremental tiles ms | Coalesced copyback ms |
|---|---:|---:|---:|
| 1 | 0.375 | 0.0875 | 0.1625 |
| 1.5 | 0.3875 | 0.1375 | 0.1875 |
| 2 | 0.3625 | 0.150 | 0.200 |

Coalescing was **slower than incremental tile rebuilding** for these localized
edits despite fewer geometry-region passes. Keep it as a bounded alternative
requiring workload-specific measured admission; do not make it the default.
These measurements do not establish actual live editing speed.

Native boundary inspection reconfirmed that Drawing refresh clears/rebuilds its
owned shape and visibility refresh writes shape visibility. Primary CachedContainer
continually renders its children through its native private framebuffer paths.
An extra cached Sprite alone duplicates native raster work. Skipping originals
requires an explicit verified ownership/lifecycle boundary; global primary
autoRender changes or unverified replacement render methods are not approved.
Detached correctness is not proof of this missing live integration step.

**Next gate:** Implement a detached supported-primary replacement/sorting fixture
that models suppression, restoration and fallback at native sort positions, then
verify depth/elevation/interface contracts and active edit behavior. A general
Drawing cache cannot combine interleaved primary objects into one arbitrary
sprite without changing order. Preserve native per-object slots or verified
ordered compatible runs; this is cache granularity, not approval for segmented
layer opacity. No live cache or reference-opacity control is enabled.

#### Implemented detached native sort-slot cache replacement

Added `tools/drawing-cache-runs.mjs` and
`tools/drawing-cache-runs-probe.mjs`. The planner consumes a **complete already
native-sorted stack**, including every non-Drawing barrier, and selects only
contiguous compatible Drawing runs. Editing, unsupported style, depth contribution,
elevation, sort-layer and interface changes split runs; minimum run size and
maximum run count are explicit bounded admission inputs. No silent removal of
interleaved primary objects is allowed.

The detached replacement executor inserts a cache container immediately before
the first original source slot, copying its sort-layer/sort/zIndex. Native
`PrimaryCanvasContainer.sortChildren` preserves stable ties. Only selected
fixture source `renderable` states are temporarily suppressed; originals retain
their native parent, identity and order. Every state is restored and every
replacement removed after rendering, including intentional render failure or
an insertion event that throws. Reentrancy, stale/overlapping runs, live roots,
interface runs and elevation incompatible with the detached parent are refused.
Restoration failures are explicit aggregate errors.

Native v14.365 / PIXI 7.4.3 evidence covers seven cases at resolutions 1/1.5/2:
equal-sort stable ties and interleaved synthetic barriers, excluded editing
source, simulated hidden/drag attenuation, preexisting suppression, source sort
change, inserted barrier and deleted barrier. Artwork includes translucent
overlaps and text nested in a shape. **All 21 pixel comparisons** had maximum
channel error 1, zero pixels beyond one level, and successful parent/order/state
restoration both normally and after deliberate render exceptions. All fixture
targets were disposed. Scene sources and live primary child identities/order
remained unchanged.

Important limits: the fixture uses common elevation and synthetic non-Drawing
Graphics barriers, not actual Tile depth/occlusion; it renders detached native
containers, not the live primary private framebuffer. Whole-viewport textures
per run are deliberately small fixture allocations, **not** a permitted runtime
memory strategy. Runtime admission must sum surfaces across all admitted runs;
fragmented stacks may be cheaper left native. Cache runs do not represent
whole-layer opacity, so this does not approve segmented layer fading.

**Next gate:** Establish a Foundry-owned/Foundryshop-owned rendering adapter
boundary preserving source lifecycle without global prototype patches or live
reparenting. Validate primary and interface paths, mixed elevation/depth barriers,
selection/drag/new stroke refresh, source updates, context loss and teardown.
Start with independent derived objects and explicit native fallback; do not
replace the owner's live Scene merely because the detached fixture passed.
No runtime render override or transparency control is installed.

#### Runtime admission foundation (not live activation)

Added `scripts/render_cache_admission.js`, a side-effect-free packaged service,
and moved the compatible-run planner there; developer fixtures re-export the
same implementation rather than duplicating it. No startup import or hook
activates this service.

Read-only primary capture retains every native slot/barrier, admits only exact
native Graphics instances owned by a Drawing, excludes custom subclasses and
descendant filters/masks/non-normal blends, and defers dirty native sorting.
Native primary barriers legitimately use infinite elevation/sort values; capture
preserves them, planning accepts them for non-Drawing barriers only, and invalid
NaN metadata still refuses. Slot IDs describe a snapshot, not persistent Drawing
identity; lifecycle code must continue using native document IDs.

Aggregate admission verifies sorted metadata, counts every run's physical RGBA
viewport surface plus explicit output reserve and scratch allowance, checks GPU
axis limits and safe arithmetic, and returns a named native fallback for editing,
unverified interface/mixed-elevation runs, no compatible runs or excessive memory.
Successful admission is labelled **candidate**, requiring renderer and measured
performance validation; it is not a permission to suppress native shapes.
This full-viewport-per-run estimate is conservative and may refuse fragmented
stacks that a future regional planner can handle more cheaply.

`DrawingCacheBudget` reserves bytes before allocation across all cache owners,
limits reservations to 256, rejects overcommit and requires exact lease release.
The future allocator must release only after actual resource disposal; the
accounting service does not destroy GPU resources or excuse cleanup failures.
Geometry/fonts/assets and native targets outside the explicit allowance are not
claimed as measured total browser/GPU memory.

Read-only native inspection of the current 60-object primary stack captured
47 eligible Drawings and 13 barriers. One compatible run plus one RGBA output
reserve required 9,349,560 nominal bytes at the current viewport. A 16 MiB
prototype allowance returned candidate; a 1 MiB allowance returned aggregate
memory fallback. Scene sources and primary identities/order stayed unchanged.
Editing metadata detection is conservative, not proof of physical drag handling.
Public README/changelog disclose that no live optimization or opacity UI is active.

**Next gate:** Wire an independent derived-object renderer to this admission
contract and the verified lifecycle/cache services, with shared reservation
ownership, native-slot restoration and teardown. Live source suppression and
actual primary/interface/depth/interaction validation remain blocked; do not
count packaged admission as a completed live renderer.

#### Implemented owned runtime run-cache service

Added `scripts/render_run_cache.js`. `DrawingRunCache` connects the packaged
admission service to shared budget reservations and owned derived resources.
It neither creates native placeables nor attaches/suppresses live canvas shapes.
Allocation/render/disposal/replay adapters are explicit synchronous callbacks.
Allocate callbacks must clean up any internal partial allocation before throwing.

The service reserves the complete admitted allowance before allocation, owns one
derived resource per compatible run, reuses unchanged fingerprint/stack/options
without forcing a redraw, and evicts before allocating changed content to avoid
double residency. The host-supplied bounded source/context fingerprint must
include geometry/style, assets/fonts, visibility, viewport transform and Level
dependencies; admission metadata alone is not a content fingerprint.

Partially allocated failures dispose successfully created resources. Failed
resource disposal retains ownership **and the full reservation** for explicit
retry; successful resources are not disposed twice. Destroy marks completion
only after cleanup succeeds. Render/replay failures, invalid preparation,
wrong source keys and reentrancy block cached output. Editing/native admission
fallback releases the existing derived cache. Multiple owners cannot exceed
their shared byte limit. No success-shaped resource fallback or blanket silent
catch is introduced.

The native sort-slot fixture now allocates/renders/replays/disposes through this
runtime service rather than directly managing cache targets. All **21 comparisons**
at resolutions 1/1.5/2 stayed within one channel level, with zero pixels beyond
that tolerance. Source order/parents/states restored after normal and deliberately
failed render paths; all shared reservations returned to zero. The editing case
used whole-cache native fallback instead of selectively caching remaining runs.
Scene sources and live primary child identities/order remained unchanged.

This connects admission to **resource lifecycle**, not to automatic native source
event tracking: the earlier incremental metadata coordinator is still developer-
only, and the host adapter must supply source revisions/dirty changes. Current
owned resources are whole-viewport-per-run, conservatively admitted; incremental
tile resources remain an alternative awaiting runtime wiring. Runtime source
suppression, primary framebuffer/depth/interface integration and physical drag/
selection/teardown are not validated by this detached fixture.

**Next gate:** Implement an independent derived-artwork adapter with source/
context fingerprinting and explicit native lifecycle invalidation, then verify
pixel equivalence and bounded ownership on the complete native primary path.
Do not activate live suppression until depth/interface, editing, Level/context
changes and restoration are verified. No layer opacity behavior has changed.

#### Implemented independent derived-artwork cache adapter

Added `scripts/render_artwork_cache.js`, connecting the owned runtime run cache
to existing `prepareArtworkSnapshot` / `buildArtworkDisplay` helpers instead of
duplicating native-style geometry/material/image construction. Derived geometry
is temporary, rendered to owned admitted textures and then disposed. Borrowed
texture objects are never destroyed. No native shape or document is reparented,
modified or suppressed.

The adapter validates source modes against admitted stack runs, restores supplied
native order after publication snapshot validation (which otherwise sorts equal
ties by ID), and caps aggregate source data at 1,000 Drawings, 100,000 coordinates,
4 MiB serialized artwork and sixteen bounded textures/16 million decoded pixels.
Source and context inputs are copied; source geometry/style, stack, viewport
transform, Scene/Level/asset/renderer revisions, hidden attenuation and borrowed
texture identity/update/dimensions feed a SHA-256 key. Borrowed texture readiness
and revisions are rechecked after hashing. Concurrent preparation/use/invalidation
is rejected explicitly; future hook callers must serialize or retry, not ignore
such errors.

Unchanged keys reuse rendered textures. Changed keys rebuild independently;
explicit invalidation evicts owned resources. Allocation/render/validation
failures block readiness and clean up, surfacing combined cleanup errors.
Text artwork is explicitly refused until native font bitmap resolution and
ownership are validated; it is not rendered at thumbnail/publication quality as
a silent substitute. A future host can mark text as a native barrier before
admission; no live host does this yet.

Read-only native source reconstruction used 42 geometry-only Drawings from the
current Scene, excluding five text/interface entries. Direct detached
reconstruction versus adapter cache replay matched **all channels exactly**.
Unchanged preparation reused resources; invalidation returned the shared
reservation to zero; borrowed textures remained valid. Scene sources and live
primary child identities/order stayed unchanged. This verifies cached
reconstruction, **not full native primary screenshot equivalence**, correct
interleaving of the omitted five entries or actual live editing.

The adapter exposes explicit prepare/use/invalidate/destroy operations, not
automatic native hooks. The developer-only incremental lifecycle/tile services
are not automatically wired into it. Whole-viewport-per-run ownership and text
refusal are deliberate validation boundaries, not final optimization scope.

**Next gate:** Implement a serialized native event/context invalidation host
without activating suppression, including refresh/create/update/delete, control/
drag, canvas teardown and asset readiness; prove that no source revision can
replay an old frame. Validate text ownership/resolution before considering it
cacheable. Complete native primary/depth/interface and real interaction evidence
before activating any replacement. Whole-layer reference opacity remains pending.

#### Implemented serialized opt-in event host

Added `scripts/render_cache_host.js`. `DrawingCacheHost` owns adapter execution
and source revision guards, not native shapes. No module startup code creates or
binds it. Its capture callback must supply a complete synchronous source/context
snapshot; a future native snapshot builder is still needed.

Invalidation immediately clears host readiness and increments the revision,
even while asynchronous hashing/preparation is pending. Cleanup waits until the
adapter is idle. Concurrent prepare requests share one promise; preparation
changed by events discards the old result, evicts, recaptures and retries serially,
at most four attempts. Continuous churn surfaces an explicit native-fallback
error rather than an unbounded loop. Failed captures/preparations/cleanup block
output and require an explicit successful retry. Replay requires the current
published key/revision; adapter failures clear host readiness.

Optional binding scopes Drawing create/update/delete/draw/refresh/control and
Scene/Level updates to the displayed Scene. Canvas ready/pan/layer-state changes,
font completion/error, WebGL context loss/restoration and up to sixteen explicit
borrowed asset emitters (update/error/dispose) invalidate. Native hook names and
event timing require further real-interaction acceptance; events not covered by
these subscriptions remain the host caller's explicit invalidation responsibility.
No auto-rebuild timer, animation loop or world setting is introduced.

Teardown closes replay immediately, removes hooks/listeners, waits for in-flight
preparation and destroys adapter resources only when idle. Errors are reported,
not swallowed; failed disposal remains retryable via the adapter ownership
contract. Borrowed asset emitters receive subscriptions only, never destruction.
The supplied reporter must handle rejected event cleanup promises explicitly.

Automated tests cover shared preparation, mid-hash invalidation, four-attempt
churn bounds, failure/retry, off-Scene scoping, event cleanup reporting, teardown
ordering and font/context/asset listener removal. In the native browser a
synthetic asynchronous adapter with real opt-in Foundry hooks rejected stale
replay, performed two serial preparations, published only key 2 and disposed.
Hook counts restored, no errors were reported, and Scene sources/live primary
children remained unchanged. This was a registration/race test, not actual
Drawing edits, live replacement, context-loss recovery or physical drag.

The real `DrawingArtworkCache` adapter is also exercised under mid-digest source
mutation in automated tests: host recapture occurred twice, the discarded target
was destroyed, the new frame replayed, and teardown returned budget reservations
to zero. The targeted host/adapter/admission/ownership/artwork-renderer suite has
52 passing tests; staged 0.1.0 includes the host with matching source/package
SHA-256. No deployment or live activation was performed.

**Next gate:** A real synchronous native source/context capture adapter must map
slot IDs to Drawing package IDs, handle effective visibility and text barriers,
and invalidate every native transform/asset dependency. Then integrate the
derived adapter with this host in read-only shadow mode and verify real events
without suppression. Live primary replacement, text quality and whole-layer
reference opacity remain unenabled and unresolved acceptance gates.

#### Implemented native snapshot capture and shadow fidelity probe

Added `scripts/render_native_snapshot.js` and the developer-only
`tools/drawing-native-snapshot-probe.mjs`. Capture keeps the complete sorted
primary stack, including all non-Drawing and text barriers; maps snapshot slot
IDs to authoritative Drawing IDs; and supplies detached prepared artwork,
borrowed textures, and explicit Scene/Level/asset/renderer/viewport context.
It does not load assets, register hooks, suppress sources or activate caching.

Capture refuses pending native refresh, active control/preview editing,
identity mismatch, context loss, viewport mismatch and unsupported ancestor
transforms. Custom Drawing classes, text/descendants, effects, hidden alpha,
non-rendered/other-Level/staged artwork and modified display transforms remain
uncached. Snapshot bounds are 1000 eligible Drawings, 100000 coordinate values,
4 MiB artwork and sixteen texture identities; the adapter retains its additional
validated geometry/texture limits. Ancestor masks/filters are not reconstructed;
this remains shadow-only and is not proof of full primary framebuffer equivalence.

The native Scene has 60 sorted slots: 47 Drawings, 13 other barriers, 42 eligible
geometry Drawings and five text exclusions. Text barriers split the candidate
into 39- and three-Drawing runs, reserving 14024340 bytes including the viewport
output allowance at 1485 x 787/resolution 1. Unchanged preparation reused targets.
A real native `refreshShape` render flag triggered the opt-in host's
`refreshDrawing` listener, blocked readiness and allowed explicit re-preparation.
Teardown restored hook counts, released all reservations and preserved borrowed
textures, Scene sources and primary child identity/order.

The first native-geometry comparison found 7870 differing pixels in the larger
run. Per-Drawing isolation traced this to one polygon with stored Y -2332.5
versus prepared Y -2037.5: native rendering uses prepared coordinates.
`exportProjectDrawing` now has an explicit prepared-values option for cache
capture only, normalizing Foundry Color objects to their hex strings. Its default
stored-source export behavior is unchanged. Final detached comparisons of both
runs against borrowed native Graphics geometry had zero changed pixels and
zero channel error at the current zoom 0.2/resolution 1. Original sources were
not rewritten, sources were never reparented, borrowed geometry references
restored, reuse passed and reservations returned to zero.

This validates current geometry reconstruction, not full-stack replay,
ancestor effects, depth, physical drag, new stroke, pan/Level event completeness
or live replacement. The probe uses bounded scalar reports rather than
serializing renderer/style objects. No startup wiring or deployment occurred.
The targeted native-capture/cache/artwork/project-transfer regression run passed
134 tests. Staged 0.1.0 includes the native capture with matching source/package
SHA-256; changed JavaScript files have clean editor diagnostics.

**Next gate:** Validate full ordered-stack replay in detached native containers
with text/other-object barriers and native parent effects, plus actual
selection/drag/pan/Level behavior before any live render suppression. Whole-layer
reference opacity still requires its separate true-compositing solution.

#### Implemented ordered replay acceptance fixture

Added `tools/drawing-ordered-replay-probe.mjs`. This bounded complete **synthetic
detached** fixture connects `DrawingArtworkCache` to the existing temporary
sort-slot replacement executor. It includes three two-Drawing derived runs,
equal-sort ties, uncached native PreciseText, an uncached multiply-blend barrier
and an uncached color-filtered barrier. Screen-aligned cached sprites cancel the
fixture viewport transform exactly once; the original detached geometry retains
its native container sort behavior. Replacement restoration is exercised after
both successful rendering and injected render failure.

Seven cases at resolutions 1, 1.5 and 2 cover ties, fractional pan, zoom 0.2/2,
a post-composition parent color filter, inherited alpha 0.5 and editing fallback.
Premultiplied framebuffer readback uses the same extraction convention as the
existing native-region/run probes. Straight-alpha extraction is reported
separately rather than silently normalizing or widening the one-channel gate:

| Case | Premultiplied max error at res 1 / 1.5 / 2 | Straight-alpha max error |
| --- | --- | --- |
| Equal-sort complete stack | 1 / 1 / 1 | 1 / 1 / 1 |
| Fractional pan | 1 / 1 / 1 | 1 / 2 / 1 |
| Zoom 0.2 | 1 / 1 / 1 | 2 / 3 / 1 |
| Zoom 2 | 1 / 1 / 1 | 2 / 1 / 2 |
| Parent color filter | 1 / 1 / 1 | 2 / 2 / 1 |
| Parent alpha 0.5 | 59 / 59 / 59 | 59 / 59 / 59 |
| Editing fallback | 0 / 0 / 0 | 0 / 0 / 0 |

All fifteen normal-opacity cached cases have no framebuffer pixels differing
by more than one channel level. Straight-alpha readback differs by up to three
levels on small pixel sets; this is disclosed and does not establish straight-
alpha export equivalence. The three inherited-alpha cases differ at 7023,
15677 and 27636 pixels respectively: parent alpha attenuates individual native
contributions, while cached-group alpha attenuates their already-composited result.
Native snapshot capture already refuses non-unit ancestor alpha; explicit
regression coverage now preserves that rejection. This is not permission to
implement group or whole-layer opacity.

All 21 cases restored detached child identities/order/parents and original
renderable states, including injected failures. Editing used native fallback.
All reservations returned to zero; the Scene and live primary were unchanged.
Automated tests cover fixture run/barrier contracts, failure cleanup, extraction
alpha-mode restoration, resource disposal, work bounds and the shared exact
one-channel comparison threshold. The renderer benchmark and ordered probe
reuse the same comparison helper.
The combined targeted replay/capture/cache/artwork/project-transfer run passed
147 tests. Staged 0.1.0 rebuilt successfully; developer probes remain excluded
from the package and changed JavaScript files have clean editor diagnostics.

**Native completeness limitation:** Inspection of the actual primary found
Foundry ambience filtering, a primary mask, PrimarySpriteMesh token/background
shaders, WeatherEffects masks/filters and a system-specific D35ELayer. These
must not be flattened into generic sprites or silently omitted. The fixture
validates neither these native parent/framebuffer effects nor weather/depth.
Full primary equivalence, supported insertion/suppression and physical
selection/drag/pan/Level interaction remain gates. Live optimization stays off;
the next step must address those native render contracts, not raise fidelity
tolerances or treat fewer source submissions as a performance win.

#### Implemented guarded native currentness and interaction shadow check

`DrawingCacheHost` now accepts an optional synchronous `isCurrent` guard from
its snapshot provider. It checks before preparation, after asynchronous
preparation and immediately before replay. A changed guard result discards
publication with the existing four-attempt bound, or blocks replay and marks
cleanup pending for the next serialized preparation/invalidation/teardown.
Guard exceptions are surfaced and block readiness; non-boolean/async contracts
are refused. Revision is rechecked after guard execution so a guard firing an
invalidation cannot authorize the revision it invalidated. Providers without
guards retain the existing explicit event/revision contract.

Added opt-in `createNativeDrawingCacheCapture(readInput)` in the native snapshot
module. It compares a private baseline of source/options/context serialization,
Scene/Level/renderer/stage/primary identities, complete primary child order,
Drawing/document/geometry identities, geometry dirty revisions, and borrowed
texture/base identity and view revisions against bounded recapture. Editing,
pending refresh and context loss surface the native refusal rather than falling
through to cached output. Custom shape shader/tint states now remain uncached.
Caller asset/renderer revisions must still be explicit and current; this guard
does not prove unknown shader uniform, ambience, weather or depth equivalence.

Shared `scripts/render_cache_assets.js` now fingerprints borrowed texture view
update IDs and frame/orig/trim/rotation as well as base upload revisions and
dimensions. Both derived preparation and shadow guard use it. Same-base,
same-size atlas frame changes now rebuild; changes during asynchronous digest
or malformed rectangles reject before publication. This closes a dependency
gap without loading or destroying borrowed assets.

Added `tools/drawing-native-interaction-probe.mjs`: an explicit developer-only
experiment with actual native Drawing control/release and `canvas.pan`, plus a
temporary stage pivot change without a hook. It refuses a busy/selected canvas,
never edits document sources, restores the original active layer, pivot/scale
and client `_viewPosition`, and destroys/unbinds the host before restoration.
Native refreshes must settle before subsequent capture; an initial immediate
chained fidelity check correctly refused pending refresh, so restoration now
waits briefly and explicitly rejects if refresh remains pending.

Final browser run blocked selection, pan and unhooked transform replay, then
successfully reprepared. Hook counts restored, error reports were empty,
reservations returned to zero, Scene sources and live primary remained unchanged,
and client layer/view restored. The subsequent native geometry comparisons
again matched both 39- and three-Drawing runs exactly.
The related guard/capture/replay/cache/artwork/project-transfer suite passed
156 tests. Staged 0.1.0 built successfully with matching source/package texture
revision helper hashes; all changed JavaScript files have clean diagnostics.

**Resource/performance finding:** Seven full-recapture guard samples were
5.0-6.1 ms (an earlier run 4.9-7.2 ms) for this 47-Drawing Scene. These CPU
capture timings are materially more expensive than the earlier small rendering
benchmarks. Full serialization/recapture is a correctness oracle for **shadow
mode only**, not an acceptable per-frame live optimization. No polling loop or
module startup activation is added. A future fast guard needs verified native
revision/lifecycle contracts and inexpensive identity/transform checks,
validated against this oracle rather than silently dropping dependencies.

Actual physical drag, new stroke, Level switch (the Scene has one Level), renderer
context recreation and complete-primary effects remain untested. Whole-layer
reference opacity and live suppression remain off. Next implementation must
address the native render/lifecycle integration and fast-path overhead before
activation; this slice does not claim a live speedup.

#### Owner-directed pivot: selected-map transfer before live caching

Native API inspection found `addDrawing` creates/registers a Drawing-owned
PrimaryGraphics; `removeDrawing` destroys its shape and children. The primary
render pass owns private framebuffer work, and no atomic ordered-run replacement
API was established. Generic insertion and renderable flags alone do not prove
safe lifecycle integration. The owner explicitly chose **keep live caching
blocked and implement map transfer/consolidation workflows next**, rather than
approving a Drawing-scoped adapter or primary render wrapper. Do not resume
live render suppression by assumption.

Implemented selected-map JSON transfer through the existing validated version-1
package and export/import workflow, not a second clipboard or transaction system:

- `exportDrawingSelection(scene, ids)` exports only explicitly selected existing
  Drawing identities, including ordinary Unassigned artwork. Their native stored
  geometry, style, transforms, hidden/locked state and supported flags remain
  unchanged. Source Drawings are never edited or deleted.
- Packages retain only the selected Drawings' layers and ancestor chains, plus
  scoped presets with nonempty included entries. Other artwork in those same
  layers, sibling nodes and unrelated resource dependencies are excluded.
- Selection is packaged using existing `scope: "subtree"` semantics; no new
  schema/migration is needed. Empty/duplicate/missing identities, unresolved
  selected membership, pending imports, recovery-bearing sources and unsupported
  selected data explicitly refuse. Unsupported outside artwork does not block it.
- The export scope menu offers **Selected Drawings only** when native Drawings
  are controlled in the current Scene. The selected identity set is captured
  before the dialog and rechecked before/after thumbnail work and download.
  Preview/foreign Scene identities refuse; changing selection requires retry.
- Existing additive import applies explicit X/Y pixel offsets, maps to the
  displayed Level, assigns fresh IDs and places content in a player-hidden
  wrapper while preserving destination artwork. Tests round-trip both managed
  and Unassigned selected strokes and compare original geometry/styles/state.

A read-only native check exported exactly three requested Drawings, preserving
coordinates and geometry, with one required layer and one scoped preset.
Scene sources remained unchanged; no selection changes, downloads or import
writes were performed in that browser check. Real import/offset/cancellation
behavior is exercised in the existing transaction test harness.
The related transfer/localization/native-snapshot/artwork-renderer run passed
120 tests. Staged 0.1.0 built successfully with matching source/package transfer
service SHA-256. Changed files have clean editor diagnostics and tracked
documentation/localization changes passed whitespace checks. No deployment
or live Scene import was performed.

**Owner decision: live caching deferred.** The owner explicitly confirmed that
live caching can be skipped for now. Retain the inactive experimental foundations
without startup wiring; do not continue cache integration, fast guards or native
effect probes unless the owner reopens that work. Prioritize selected-map
transfer and preservation-first consolidation. This does not authorize an
approximate layer-opacity substitute.

**Next workflow slice:** Preservation-first consolidation needs an explicit
recovery representation and restore transaction before removing any source
Drawing documents. Do not join disconnected strokes, rasterize destructively,
or equate JSON transfer with consolidation. Private 50% reference opacity stays
blocked by its true-compositing gate; selected-map transfer currently supports
copy/placement and layer visibility comparisons, not translucent tracing.

## 12. Greenfield ownership and optional upstream research

The **layer system itself is a core Foundryshop feature**. Implement a
Foundryshop-owned engine directly against supported Foundry v14 APIs. There is
no external Canvas Layers runtime dependency, legacy importer, coexistence
adapter, or obligation to preserve an upstream architecture.

Canvas Layers can be consulted when a concrete implementation question benefits
from prior art. If useful code is reused, pin its exact release/revision, inspect
the relevant dependencies/assets, preserve required MIT copyright and license
notices, and record provenance. Audit third-party material independently.
Optional research must not become a mandatory adoption project.

Greenfield freedom applies to the new subsystem, not to breaking unrelated
existing Foundryshop drawing tools or Foundry's native document behavior.

## 13. Tiles and other object types

Canvas Layers supports Drawings and Tiles, but Foundry has distinct
native canvas layers. Therefore **v1 should guarantee Photoshop-like
render ordering only among Drawings**.

Do not imply that this can literally be rendered:

``` text
Drawing
Tile
Drawing
Token
Drawing
```

Future versions can organize other object types in the tree, but tree
position must not imply cross-native-layer z-order unless specifically
implemented and verified.

## 14. Real Scene Background

Keep the user's parchment/canvas/grid image configured normally as the
Foundry Scene Background. Display it as a fixed entry at the bottom:

``` text
────────────────────────
🔒 SCENE BACKGROUND
   Shadow Slate Map.webp
```

It is not a pseudo-layer and is not draggable.

## 15. Drawing consolidation and layer flattening

Foundryshop should support explicit **Drawing consolidation / flattening** as a
performance feature for pen-heavy maps. A finished hand-drawn layer may contain
hundreds or thousands of individual Drawing documents even though the artist
conceptually treats them as one layer. Foundryshop should be able to reduce that
document count without changing the visible layer abstraction.

### Core rule

`Flatten Layer` means:

> Reduce the selected layer to the minimum practical number of underlying
> Foundry Drawing documents while preserving its rendered appearance, layer
> membership, ordering, visibility behavior, and presentation state.

Do **not** define flattening as necessarily producing exactly one Drawing. Foundry
Drawing geometry and style constraints may require several consolidated Drawings.
The implementation must first verify which Drawing types/geometries can safely
represent multiple disconnected paths and which style properties require separate
documents.

Conceptually:

``` text
MAP INK — before
├─ stroke 001
├─ stroke 002
├─ stroke 003
├─ ...
└─ stroke 847

MAP INK — after
├─ consolidated black-ink geometry
├─ consolidated gray geometry, if required
└─ other incompatible geometry/styles, if required
```

The Layer Panel still presents this as the same `Map Ink` layer. The consolidation
is an implementation/performance detail rather than a new user-facing hierarchy.

### Commands

Provide explicit operations where applicable:

- **Merge Drawings** — consolidate selected compatible Drawings while retaining
  normal editing semantics as far as practical.
- **Flatten Selected** — aggressively consolidate the selected Drawing set.
- **Flatten Layer** — consolidate all compatible Drawings in one pseudo-layer.
- **Flatten Group** — recursively consolidate eligible layers beneath a group.
- **Unflatten Layer** — restore source Drawings when a retained recovery snapshot
  is available.

Flattening must never silently alter another pseudo-layer or cross a layer boundary.

### Compatibility partitioning

Before consolidation, partition source Drawings into sets that can be merged
without changing appearance or semantics. At minimum investigate compatibility by:

- Drawing/shape/path type;
- stroke color, width, alpha, and other stroke properties;
- fill color, alpha, and fill behavior;
- text versus path/shape content;
- transforms and geometry semantics;
- elevation and native render-order requirements;
- any Foundry v14 Drawing property that changes rendering or interaction.

A layer containing black ink, translucent gray sketch lines, filled polygons, and
text may therefore flatten to several optimized Drawing documents rather than one.
Correct rendering takes priority over minimizing the document count.

### Preserve visual order

Flattening must preserve the effective appearance of the original Drawing stack.
Where overlapping source strokes depend on intra-layer order, consolidation may only
combine them when the resulting compound geometry produces the same visible result.
Otherwise retain separate ordered Drawing documents.

The consolidation engine must cooperate with `DrawingOrderService`; it must not
assume that all Drawings in a layer are order-independent.

### Reversible flattening

Initial releases should prefer reversible flattening. Before replacing source
Drawings, retain enough data to reconstruct them exactly or as faithfully as the
Foundry schema permits.

Conceptual metadata:

``` js
flags.foundryshop.flatten = {
  version,
  flattened: true,
  sourceCount,
  sourceSnapshot,
  flattenedAt
}
```

The exact storage location and format should be chosen after measuring realistic
snapshot sizes. Large recovery payloads should not be copied into every consolidated
Drawing if a Scene-level recovery record is more efficient.

The owner's current workflow requires original brushstrokes to remain preserved
regardless of the map's optimized representation. Originals are authoritative;
derived composites are replaceable, not the sole surviving artwork. Do not
automatically discard recovery. **Discard Flatten Recovery Data**, if ever
offered, is a separate explicitly approved destructive exception to that preservation
policy, requiring a verified independent source backup and confirmation; it is
not required for the tracing/performance workflow.

### Work performed after flattening

Flattening does not make a layer read-only. Record which replacement Drawings
belong to each recovery operation and fingerprint their relevant state.
Unflatten restores that operation's source strokes while retaining new strokes
added afterward, preserving their intended relative order through
`DrawingOrderService`.

If a consolidated Drawing was edited, deleted, or reassigned after flattening,
report the conflict and require an explicit resolution before replacing it.
Do not discard post-flatten work or duplicate edited geometry silently. Define
the available resolution choices before implementation. Repeated flattening must
retain an unambiguous recovery lineage or require explicit resolution; it must
not overwrite the only remaining original snapshot.

### Transactional safety

Flattening is a destructive multi-document transformation even when recovery data
is retained. Treat it transactionally:

1. validate all source Drawings and compatibility partitions;
2. compute consolidated geometry before deleting anything;
3. create/update replacement Drawings;
4. verify membership, sort, visibility, lock, and render-relevant state;
5. persist recovery metadata;
6. only then remove superseded source Drawings;
7. recover/reconcile after partial failure.

Never delete the source set first and hope reconstruction succeeds afterward.

### Performance workflow

The intended artist workflow is:

``` text
ACTIVE AREA
  individual editable pen strokes

FINISHED AREA
  Flatten Layer
      ↓
  small optimized Drawing set
```

This allows old map geometry to become inexpensive while current work remains fully
stroke-editable. A large dungeon may therefore contain flattened finished location
layers alongside live `Session Marks`, `Labels`, or current sketch layers.

Layer/group flatten commands should report the optimization result, for example:

``` text
Map Ink optimized
847 Drawings → 6 Drawings
Recovery snapshot retained
```

Do not promise a specific reduction ratio.

### Automatic suggestions, not automatic destruction

Foundryshop may detect unusually large Drawing counts and offer an optimization
suggestion, but it should not automatically flatten user artwork without an explicit
command. Any future auto-optimization mode must be separately designed and opt-in.

### Owner amendment: preservation-first consolidation investigation

#### Best-effort power-user scope and first implementation evidence

The owner approved reversible raster **image Drawing** consolidation and clarified
that this is a best-effort power-user optimization, not a universal renderer.
Keep the first UX explicit: select strokes, analyse/review resolution and reduction,
consolidate, then restore original strokes when needed. No live caching, automatic
expansion or background document deletion is required. At that point Tile backing
was excluded; the later two-stage amendment below separately approves baked
artwork Tiles. The owner chose image Drawings as the first practical
implementation after the narrow connected-line experiment below.

Implemented `scripts/layers/line_consolidation_analysis.js` as analysis only.
It validates a bounded source package and explicit complete ordered identity
stack with null native barriers. It considers consecutive selected two-point
open paths, exact touching/collinear non-backtracking endpoints, no smoothing or
rotation, opaque matching stroke style, and matching layer/Level/elevation.
Hidden/locked/interface/textured/text/metadata-bearing or disconnected content
is retained with reasons. Candidate geometry is detached from sources. Source
metadata is not silently discarded, and no Scene writes or merge UI is installed.

`tools/line-consolidation-probe.mjs` compared three horizontal, vertical and
diagonal segments versus one proposed segment across zoom 0.2/1/2 and resolutions
1/1.5/2 (27 comparisons). Individually rasterized endpoints differ even for
collinear touching opaque paths at fractional screen positions: affected pixel
sets were small (up to 48 pixels in this fixture), but maximum premultiplied
channel error reached 64. Some aligned cases matched exactly, not all.
Do not advertise this as lossless or ship destructive joining based only on style
compatibility. Read-only analysis of the owner's 47- Drawing project found no
eligible two-point paths and no reduction; source data remained unchanged.
This supports prioritizing reversible image Drawings for disconnected freehand
linework rather than extending the vector spike indefinitely.

The owner subsequently accepted **best-effort vector merging as an opt-in
experiment, provided it can be walked back**. Endpoint rasterization differences
are therefore a disclosure/review concern, not a blanket veto on a reversible
merge. Exact originals, durable verified recovery, explicit confirmation and
conflict-checked restoration remain prerequisites. Image Drawings remain the
first chosen practical implementation; do not silently simplify or automatically
merge artwork.

Implemented `scripts/layers/consolidation_recovery.js` as a separate originals
archive, not a new active project-package recovery schema. It stores a validated
selected project plus full native stored sources (including IDs/authors and layer
flags), exact expected image Drawing replacement, operation identity and
Scene/Level context. Limits are 1000 originals / 5 MiB. Canonical SHA-256 covers
the entire payload; persisted-byte readback validates the envelope, original/
project agreement, replacement and checksum. The checksum detects accidental
corruption, not authenticity of an untrusted file. Optional source values that
cannot survive JSON round-trip refuse preparation. Authority and source changes
during asynchronous hashing also refuse.

Restoration preview checks Scene/Level, GM authority, pending import, original ID
collisions, missing original membership layers and edited/missing/reassigned
composites. It supplies exact original sources and one owned composite ID,
leaving newer/unrelated strokes untouched. This original foundation was
preview-only; the follow-up below adds archive storage but not source deletion,
restoration transactions or UI. Existing general JSON
exchange still refuses recovery-bearing projects; these archives must remain
available separately until portable recovery integration is implemented.
The targeted archive/analyser/transfer/artwork/localization run passed 122 tests.
Staged 0.1.0 built successfully with matching archive-service source/package
SHA-256 and clean changed-file diagnostics. No deployment or live document
replacement was performed.

**Durable storage foundation follow-up:** `scripts/verified_file_storage.js`
provides persistent byte references with root/path, exact byte count and SHA-256,
collision refusal, same-client in-flight path exclusion, explicit GM file
permissions/currentness/cancellation checks and no-store/no-redirect server
readback. Reads enforce the expected decoded byte count even for compressed
HTTP responses and verify the fingerprint. Uncertain uploads retain a path in
an explicit error; no automatic file deletion or success-shaped fallback.
Read deadlines are configurable (including disabled) rather than image-size
admission limits. Storage preserves arbitrary original-format bytes without
claiming those formats can be decoded/composited.

`scripts/layers/consolidation_storage.js` prepares a lightweight reference before
upload so a future caller can journal intent, verifies exact original source/
project currentness during persistence and revalidates archive payload/checksum/
identity on fresh reads. Recovery references survive JSON round-trip without
in-memory upload state. The caller supplies an existing approved data folder,
unique operation token and explicit journal/context guard; no implicit folder
creation, setting change or live-world operation is installed. The current
Drawing-only v1 archive remains bounded to 1000 sources/5 MiB. It is not the
typed Bake archive or a Bake image-size limit.

These are tested storage services, not a crash-safe operation journal or atomic
multi-GM lock. FilePicker browse/upload does not supply an atomic conditional
create; production must use unique owned operation paths plus journal/authority
coordination. No source deletion or native replacement is enabled.

**Operation journal foundation follow-up:** `scripts/layers/optimization_journal.js`
stores a versioned Scene flag with revisions and append-only operation records.
Each retains a token, Scene/Level/owner, apply or restore action, verified phase,
archive/output file references, archive checksum, original source count/digest,
typed Drawing/Tile/Level-background replacement identity/state digests and parent
lineage. Large original payloads stay outside Scene flags. Completed records
remain immutable through these APIs; new outputs require distinct paths, and
restore intents retain the exact prior applied recovery descriptors.

Apply phases are intent, assets-verified, replacement-staged, sources-removed and
complete. Restore phases are intent, assets-verified, originals-staged,
replacement-reverted and complete. For background destinations,
replacement-staged means the verified background application, not a second live
Level. Persist intent before uploading or changing documents. A phase transition
requires an explicit asynchronous evidence verifier; production verifiers must
read actual assets/native states, not trust a prior phase or return true without
checking. Interrupted/partial deletion leaves the last verified phase available
for reconciliation; it must not jump to complete.

Writers share the existing Scene layer-operation queue, check the exact expected
journal before and after asynchronous evidence, verify server update readback
and refuse uncertain writes with an error carrying Scene/token. A successful
write with a lost response is recoverable by a fresh read, not blind reapply.
Only the running Foundry designated active GM may write; owner takeover requires
the prior owner to be disconnected and explicit recovery review, without phase
advance. Read-only live inspection confirmed `game.users.activeGM` exists in
14.365 and differs from this browser's operator GM. Operator-to-authority routing
and election/in-flight-write coordination still need acceptance before enabling
commands. Local queue/revision checks are not an atomic cross-client/server CAS.

The journal services do not upload files, change Drawing/Tile/Level documents,
install hooks or expose UI. Typed descriptors are not yet the typed recovery
archive payload. Real apply/restore adapters, interruption reconciliation,
portable recovery/export integration and UI remain pending.

**Typed archive and reconciliation follow-up:** the separate
`foundryshop-optimization-recovery` version-1 format in
`scripts/layers/optimization_recovery.js` stores exact raw native originals,
reviewed Layer/Selection/All scope, full layer context, Scene dimensions/padding/
grid, the complete native Level source, typed before/staged/after replacement
sources, output reference, verified-original-background-copy reference and
immutable parent-archive reference. It does not widen the older consolidation
format or normalize sources through a project package. JSON-lossy values,
duplicate IDs, mismatched membership, changed sources and invalid staging refuse.
Background state may change only background/textures, retaining unrelated Level
settings; an original image URL is not accepted as its own preserved copy.
No fixed archive source-count, image-axis or megapixel gate is inherited here.
These files retain integrity checks, not trust/authenticity of arbitrary imports.

Preparation supplies a deterministic archive path/fingerprint for journal intent.
Persistence rechecks exact native source/context currentness through upload/
readback; fresh reads verify both file SHA-256 and payload checksum. Journal
descriptors are derived from canonical source and replacement-state hashes.
Original/derived bytes and parent references remain separately addressable.

`scripts/layers/optimization_reconciliation.js` binds a persisted typed archive
to journal Scene/Level/token, source count/digest, replacement digests, output
reference and lineage; reads back output and original-background backup bytes;
then inspects current native state. Exact present originals and missing originals
are distinguished so partial deletion is visible. Occupied/edited original IDs,
edited replacements or changed Scene/layer/Level context throw explicit review
conflicts. Unrelated/new strokes are not part of the manifest.

The evidence adapter requires a caller-supplied persisted-output decode/render
acceptance verifier, then checks actual native conditions for each apply/restore
phase. It integrates with the journal's ordered transitions rather than an
always-true placeholder. A phase/currentness/source conflict does not advance
the journal. Read-only inspections explicitly disclose that they neither write
documents nor, without the decoder callback, establish image acceptance.
Archive tests cover 1001 originals and 20000px-axis metadata, not successful
large-image rendering/encoding. No live-world assets/documents were changed.

Still pending: native schema/placement and pixel acceptance, original-copy
fallback restoration when an original URL disappears, staged-original restoration
visibility, real idempotent apply/remove/restore execution, multi-GM operator
routing/election coordination, portable recovery integration and UI.

**Native executor foundation follow-up:** `scripts/layers/optimization_executor.js`
resumes only an existing durable operation intent. Each native step runs through
the shared Scene layer queue, verifies archive/output/original-backup bytes and
current native state, requires explicit persisted-output decode and native
schema/placement/audience acceptance callbacks, then rechecks a native source/
context snapshot after asynchronous acceptance. Designated-GM ownership,
Scene/Level/update permission, cancellation, journal currentness and affected
Drawing-layer locks gate mutations. No always-true production acceptance
fallback is installed.

Apply creates an exact hidden Drawing/Tile replacement or updates only native
Level background/textures, verifies staging, removes only still-present exact
archived originals, then verifies final replacement visibility. Restore creates
only missing originals with original IDs/authors and hidden staging, verifies
that every original exists in its exact or staged-hidden form, removes/reverts
the replacement, then restores recorded original visibility and verifies exact
sources. Staged hidden originals are recognized only for restore inspection;
apply never treats modified sources as removable originals. Newer unrelated
strokes are outside the manifest. `keepId` and the layer-operation option prevent
our native creation hooks from assigning a new active-layer style/order.

Partial writes and lost create/delete/update responses throw an interrupted
operation error carrying Scene/token, retain all recovery records/files and
leave the last verified phase for fresh reconciliation. Resume examines native
state before writing, skipping already-created/reverted/exposed results instead
of blindly replaying. Completed operations also reverify evidence, rather than
returning success over edited native state. Same-client overlapping executors
are refused. These services are not atomic native transactions or a server lock;
cross-client authority/election coordination remains required.

Fixture tests exercise all three destination apply/restore paths, exact source
IDs/authors, hidden staging, partial source deletion, lost staging/removal/
exposure/background responses, idempotent resume, newer-stroke survival,
normalization/conflict rejection, cancellation and authority/context changes.
No live-native writes or deployment occurred. Whole-project/subtree/selection
Drawing JSON exporters now explicitly refuse any optimization journal until
portable baked-output/recovery exchange exists, including malformed records.
They cannot silently produce an incomplete map after optimization.

Still pending: real native schema/placement/pixel acceptance, original-copy
fallback restoration, bounded large-operation batching, persisted-media decode
adapters, preparation/scope/audience UI, operator-to-authority routing/election
coordination, large-image rendering/encoding and portable recovery exchange.

**Persisted-media acceptance follow-up:** `scripts/optimization_media.js`
reuses dimension-header detection with independent Bake error reporting and
JavaScript representation limits, not stamp/publication pixel budgets. It
validates static PNG chunk structure/end markers and WEBP RIFF/chunk boundaries/
animation markers, rejects incomplete JPEG output, verifies persisted file
size/SHA-256 and filename format, checks reviewed integer pixel dimensions and
decodes using `createImageBitmap` with no orientation transform. Browser decode
failure, mismatched dimensions, changed authority/context or cancellation refuse
acceptance; returned bitmaps always close. The review-bound output callback
integrates with journal phase/native executor evidence and cannot accept another
file reference. Unknown/animated media refuse; broad background-format capability
and JPEG orientation-safe source composition remain separate work.

Read-only validation ran the actual source adapter in the shared Chromium client:
generated 8000 x 6000 PNG (914226 bytes, acceptance about 602 ms), WEBP (520 bytes,
183 ms), JPEG (282010 bytes), and 20000 x 1000 PNG (372320 bytes, 121 ms) all
encoded/decoded at exact dimensions. These were uniform-color offscreen fixtures,
not map bakes, image uploads, native texture/placement tests, detailed fidelity
tests, resource ceilings or general maximum-size guarantees. Each offscreen
surface was released and the temporary local source server stopped. No live
Scene/source asset changed. This supplies concrete 48-MP/long-axis browser
encode/decode evidence without claiming full bake pipeline acceptance.

**Bake scope preparation follow-up:** `scripts/layers/optimization_scope.js`
implements read-only Layer (default), Selection and All candidates on the
displayed Level. Layer targets a leaf only, never silently expands groups;
Selection snapshots live selected IDs, supports Unassigned and explicitly lists
foreign/multi-Level exclusions; All never includes other Levels. Included and
excluded IDs/reasons, source layers, Unassigned status and exact removal counts
are exposed for preview. Native hidden, locked, interface, staged, invalid order/
identity/membership, ancestor workspace-hidden/player-private and unsupported
renderer states are reported, not silently dropped. Renderer inspection is a
required explicit capability callback, not guessed support or a default success.

Exact exclusion acknowledgement and explicit Drawing-to-ground-depth acceptance
are mandatory before approval. No eligible sources, mixed elevations or a
GM-private Level-background destination block approval. Displayed Scene/Level,
grid/dimensions, full source collection, Tiles, layer tree/workspace, selection
and existing journal/import state are currentness-checked, so new strokes cannot
enter a previously reviewed deletion manifest. Public preview objects are
detached; altering their IDs/counts does not alter authoritative captured IDs.
An approved manifest creates the typed recovery archive directly from those
captured originals and scope with pre/post asynchronous currentness checks.

This is scope/recovery preparation, not native placement or pixel acceptance,
resource/media preflight, bounds/resolution preview or enabled UI. Unassigned
drawings remain Unassigned; excluded originals remain live. No Scene changes or
uploads occurred. Later drawing changes invalidate pre-operation preparation;
after durable intent, the executor's exact manifest still leaves later strokes
untouched.

**Native schema acceptance follow-up:** `scripts/layers/optimization_native.js`
constructs detached strict native Foundry Level/Drawing/Tile documents and
requires exact canonical stored-source round-trips. It verifies originals,
hidden restore-staged originals and typed replacement before/staged/after
states. Constructor failures or schema normalization throw, not silently revise
the reviewed/archive sources. The executor-compatible verifier binds the full
archive checksum and requires explicit placement/stacking/audience acceptance
plus reviewed context checks before/after asynchronous verification. Operation
action/phase pairs are validated. Schema validity does not establish pixels,
native GPU capability or safe stacking, so placement verification has no default
success fallback.

Tests cover strict options/parent, all document types, normalization/failure,
archive-binding/currentness and executor integration before source deletion.
Read-only live v14.365 checks confirmed exact stored Level/Drawing reconstruction
and a detached 8000 x 6000 Tile reconstruction with native defaults. No embedded
document creation, upload or deployment occurred. Native pixel/stacking review
and actual placement adapter remain pending.

**Ground placement acceptance follow-up:** `scripts/layers/optimization_placement.js`
binds reviewed scene-pixel bounds/audience to the exact typed archive. Initial
ground Bake requires originals at the native Level background's exact bottom
elevation, visible and non-interface, not an arbitrary cross-elevation conversion.
Player output refuses private layer ancestry. Tile output requires exact crop
placement dimensions, neutral tint/scale/anchor/fit, rotation zero, alpha one,
locked state, no occlusion/light/weather restrictions and explicit final hidden
state (GM hidden, player public); it must not retain Drawing-layer membership.
Tile output therefore cannot silently apply appearance transforms twice.

Background output requires the complete native Scene rectangle and player
audience, unchanged identity Level texture transforms, neutral derived tint/color
and retained alpha threshold. Nonidentity/shared Level transforms are explicitly
refused with Tile/export alternatives until inverse-mapping is supported, rather
than resetting shared settings or moving foreground/fog. This gate is deliberately
narrower than general Foundry background rendering.

The review reports conservative rotated-Tile bounds overlaps and requires exact
overlap acknowledgement plus the Drawing-to-ground depth change. Native Tile
context/Scene rectangle changes invalidate approval; the operation's owned staged
Tile is excluded from that comparison to permit resume. Detached caller preview
edits cannot change authoritative bounds/overlap acceptance. The callback
composes with the strict archive-bound native schema verifier for apply/restore.
It does not claim pixel-exact overlaps, detailed fidelity, output crop coverage,
GPU support or a universally faithful stack replacement. Large/long-axis logical
placement has no module image-size admission cap.

Tests cover neutral placement settings, private audience/ancestors, ground
elevation, full-background identity-transform refusal, overlap approval,
tampering/currentness, owned staged output, native verifier integration and
20000px-axis placement. Read-only native Tile defaults were inspected in v14.365;
no live asset upload, embedded document write or deployment occurred.

**Full-resolution raster backend follow-up:** `scripts/bake_raster.js` renders
an explicitly owned detached neutral scene-coordinate graph using sequential
GPU render-target tiles, extracts premultiplied pixels with the existing clamped
alpha conversion, and assembles exact full-resolution output on a browser canvas.
GPU texture, renderbuffer and viewport limits constrain working tiles, not output
axes/megapixels. Reviewed output pixel dimensions must be exact positive integers;
no implicit scale, rounding/downsample or encoder MIME fallback is accepted.
PNG/WEBP output requires exact header dimensions/format and browser decode.

Memory estimates are advisory output/tile RGBA sizes, not a resource-admission
gate or peak-memory claim. Full-image browser canvas and encoder allocations
remain; this is tiled GPU extraction, not streamed encoding. Client-local jobs
serialize with an explicit busy refusal. Per-tile yields allow progress and
cancellation/context checks. Owned target/graph/bitmap/canvas cleanup occurs
on success/failure; an attached live graph is refused without destroying it.
This backend does not widen publication/stamp caps or claim large input texture
support merely because output can be tiled.

Actual read-only Chromium/PIXI validation generated 8000 x 6000 PNG across 48
1024px working tiles in about 2545 ms (914259 encoded bytes) and 20000 x 1000
PNG across 20 tiles in about 905 ms (372320 bytes). GPU limits reported texture
and renderbuffer axes 16384, viewport 32767 x 32767. Samples across the 1024px
seam matched opaque blended pixels; samples across 16383/16384 matched transparent
RGBA [129,64,32,127]. Simple rectangle/alpha fixtures only, not source-map/
background bake fidelity, universal allocation limits or detailed stroke/text
acceptance. No asset uploads or native Scene/document changes occurred. Temporary
source server stopped after validation.

Still pending: owned Drawing/background graph preparation, crop/edge/detailed
seam acceptance, renderer context-preservation acceptance, native output display
capability/placement checks, operation orchestration/authority routing and UI.

**Full-size input resource follow-up:** `scripts/bake_resources.js` reads static
PNG/JPEG/WEBP with no stamp/preview/publication size caps. It retains exact source
Blob bytes and their SHA-256 independently of a privately owned decoded bitmap,
so background backup preparation need not re-fetch a mutable URL. These are
in-memory originals, not durable recovery until verified storage/journal wiring
persists them. Decoded RGBA estimates are advisory; browser allocation, decode
and actual GPU failures remain explicit platform constraints.

Local reads use same-origin credentials; external contact requires explicit
consent and omits credentials. Redirects refuse. Streamed byte lengths are
checked against uncompressed Content-Length only; encoded lengths are not
mistaken for decoded stream size. Static container/header and decoded dimensions
must match. Unsupported/animated media refuses rather than using a first frame.
An explicit reviewed-context guard and GM authority apply through asynchronous
reads/decode/crops. Configurable read/decode timeout defaults to 30000 ms; 0
disables it. Cancellation closes stream readers/owned partial bitmaps.

An exclusive sequential crop visitor decodes GPU-bounded subimages from the
full source bitmap and creates a temporary owned PIXI texture per visit. The
texture lives only for the awaited callback and is destroyed before the next
crop; callers must render/extract during the callback, not retain its texture
in a later graph. Source dimensions are never resampled. Resource identity/
ownership is private and frozen public metadata cannot forge a valid resource.
Closed images, concurrent visits, context loss and changed renderers refuse.

Actual read-only Foundry GPU testing fetched a synthetic 20000 x 1000 PNG
(372320 bytes) from a loopback memory-only fixture, decoded it, and visited 20
1024px crops in about 245 ms on the 16384px-axis GPU. Extracted samples at x=16383
and x=16384 both yielded RGBA [128,64,32,128]. No world assets/uploads or native
document changes occurred; temporary source/fixture server stopped. Uniform
alpha geometry only: this does not establish rotated/scaled/bilinear seam
fidelity, tiled/repeating Drawing material mapping or large native output
texture acceptance. Cropped input rendering still needs wiring into the bake
compositor, with seam sampling tests and appropriate edge gutters as needed.

**Background compositor follow-up:** `scripts/bake_background.js` accepts a
captured publication-style background snapshot only at identity shared Level
texture transforms and exact full-scene integer output dimensions. The retained
owned image must match its exact source path; color-only backgrounds require
no image. It samples the full original bitmap into CPU canvas output tiles with
the global image-to-scene mapping, avoiding cropped source edges or a single
oversized GPU texture. Noninteger source-to-scene scaling is permitted without
downscaling the reviewed output resolution.

Per-tile RGB tint multiplies unpremultiplied image channels, preserving source
alpha. Native background color is then filled destination-over. The raster
backend has an explicit optional underlay painter; it restores canvas state
before blending separately extracted GPU Drawing pixels source-over and copying
the completed tile into the full output. Transparent Drawing pixels therefore
do not erase the background. Two extra tile canvases are owned/cleaned, and their
RGBA sizes are included in advisory estimates. Original source resource/blob
ownership is retained by the caller, not consumed or uploaded by rendering.

Read-only synthetic browser tests used a 10003 x 503 striped alpha PNG stretched
to 20000 x 1000 and 8000 x 6000, with nonwhite tint, background color and a
half-alpha GPU rectangle crossing the 1024px boundary. Comparison against a
separate full-canvas CPU reference sampled complete vertical lines on both
sides of the 1024/2048 boundaries and, for the long output, 16384. Maximum
channel differences were 3/255 across 24000 compared channels (long output) and
1/255 across 96000 channels (48MP). Combined render/encode/decode/reference/
comparison times were about 7.9 and 19.3 seconds respectively; these are not
isolated bake-render benchmarks. PNG outputs were 383112 and 922772 bytes.
Best-effort measured fidelity, not exact pixel/native shader equivalence.
No world assets or native document changes; memory-only fixture server stopped.

The final readback-oriented tile-canvas version was rechecked against the same
synthetic reference, retaining those 3/255 and 1/255 maxima. Separate final
render/encode/decode runs (excluding resource loading/reference comparison)
took about 6807 ms for 20000 x 1000 (382562 bytes) and 18764 ms for
8000 x 6000 (922046 bytes). This tinted scaled-pattern workload is intentionally
more demanding than earlier uniform raster-only fixtures; no performance
guarantee or silent lower-resolution alternative is implied.

Still pending: actual source Drawing geometry/text/material graph preparation
without preview admission limits, native background shader comparison (including
sampling/color management), repeating/scaled artwork texture mapping, render
context preservation, operation archive/upload/restore orchestration and UI.

**Drawing geometry/text preparation follow-up:** `scripts/bake_drawings.js`
provides a scope-compatible `inspectBakeDrawing` callback and privately captures
exact raw sources for an owned detached `buildDisplay` function. It does not call
the bounded preview/project validators or normalize originals, and imposes no
preview Drawing/point/text-length/coordinate budgets. It validates the fields
consumed by the renderer, one visible world Level/elevation and unique native
identities, then preserves native sort/ID order. Rectangle, ellipse and native
smoothed polygon/path construction, centered rotation, stroke insets and alpha
reuse `buildArtworkDisplay` at publication/full-resolution text mode.

Font availability is checked through the native available-font list and browser
font readiness. Native text styles/metrics are measured before construction;
text bitmap axes including padding must fit actual GPU texture capability.
Constructed native PreciseText is explicitly rasterized at resolution 1 and its
actual bitmap axes are verified again. Unsupported/missing APIs fail explicitly,
not via fallback fonts, lower-resolution text or success-shaped substitutions.
Authority/cancellation/renderer/currentness and font readiness recheck at build.
Build errors clean owned graphs; raw recovery data is never stripped or mutated.

Foreign module metadata, unrecognized native fields, malformed geometry/styles,
hidden/interface/multiple-Level originals and unavailable fonts produce explicit
scope exclusions. Only known nonvisual membership/provenance metadata is
accepted in this initial slice. Texture-backed fills, image stamps and material
repeat flags produce `bake-texture-fill-preparation-required` until their exact
resource/tile/repeat mapping is wired. Inactive native texture paths do not cause
network requests. Actual All-scope integration requires exact exclusion approval
and renders only the captured eligible source manifest.

Read-only native v14 detached-source fixtures for rectangle, ellipse, smoothed
path and a loaded-font label rendered 8000 x 6000 PNG (932971 bytes, about
2160 ms including probe decode) and 20000 x 1000 PNG (391013 bytes, about 636 ms).
Probe at the rectangle seam yielded RGBA [255,129,64,127] for both outputs.
A separate 1001-source native rectangle graph rendered a 1024 x 512 PNG
(24629 bytes), beyond the preview count budget. A rotated-rectangle/ellipse/
smoothed-path/text fixture at 512 x 320 compared 128px tiled rendering against
a single GPU target: all 655360 RGBA channels matched exactly. These are
synthetic same-renderer comparisons, not native live Drawing Placeable fidelity
or long-session performance guarantees. No world assets/embedded documents
created; temporary source server stopped.

Still pending: texture-backed Drawing/stamp/material resource mapping, native
Placeable/shader comparisons, crop coverage and bounds preview, renderer context
preservation, persistent backup/upload/apply/restore orchestration, authority
routing and UI activation. Existing publication/import budgets are unchanged.

**Texture-backed Drawing preparation follow-up:** the awaited
`withBakeDrawingResources` wrapper in `scripts/bake_drawings.js` captures and
validates all sources before networking. `inspectBakeDrawing` accepts an explicit
`allowTextureFills` opt-in for scope review; this establishes only supported
metadata/mapping, not decode, GPU or pixel acceptance. Geometry-only callers
retain their prior explicit texture exclusions. Malformed image-stamp/material
metadata and invalid paths refuse; external consent for the whole asset set is
required before any local or remote contact.

Each exact shared active texture path loads once through the uncapped static
image loader. `acquireBakeImageTexture` binds an owned bitmap to a full-image GPU
texture only when its original axes fit actual GPU capability and its dimensions
remain exact. It never rescales oversized inputs. GPU/resource/currentness and
font checks remain bound through the awaited render. Graph builders use the
same ordinary fill, independent-axis stamp stretch and material-repeat matrices
as native Foundryshop rendering. No network requests for inactive texture paths.

The wrapper awaits the caller's complete raster/background rendering callback.
All constructed owned graphs are destroyed before shared textures, then original
decoded resources close. Errors clean partial loads and construction, and
retained builders refuse after the wrapper closes. Cleanup attempts every owned
resource and surfaces aggregate failures; originals are never live documents.
This does not persist textures/backups or authorize source deletion.

Read-only native v14 fixtures used one 32 x 16 alpha/color texture for an ordinary
rectangular fill, a rotated independent-axis stamp and a 64px repeating ellipse
material. Comparing 128px output tiles against a single target over 512 x 400
found 2 differing channels out of 819200, maximum delta 2/255, with 20366
nontransparent pixels. An initial exact-equality assertion failed, and the
measured best-effort difference was explicitly retained rather than reported
as pixel-identical. No world assets/native documents were written; memory-only
source/fixture server stopped.

Remaining limitation: Drawing material/stamp textures beyond actual GPU axes
still explicitly refuse until exact tiled-input mapping is implemented. This
is a platform/mapping capability gap, not an arbitrary module size budget.
Large background inputs continue to use the full-bitmap CPU compositor. Native
Placeable/shader comparisons, crop coverage, resource/resolution preview,
persistent backup/upload/apply/restore orchestration and UI remain pending.

**Reviewed render transaction follow-up:** `scripts/bake_render_review.js`
connects exact captured Drawing resource preparation to a review callback and
final PNG/WEBP rendering. Per-source owned graphic world bounds include centered
rotation, stroke and constructed full-resolution text. Source IDs come from the
captured native sort order, not mutable caller metadata. Bounds are explicitly
conservative renderer extents, not a count or proof of occupied pixels.

Without a supplied Tile crop, the transaction floors the minimum coordinates
and ceils maximum endpoints to enclose all measured sources at scale 1.
Custom crop axes must be exact positive integers; fractional origins remain
explicit scene coordinates. No source-count/axis admission budget is added.
Background output always uses the captured full Scene rectangle, refusing a
different crop. Review reports partly cropped and fully outside identities,
source bounds, dimensions, format/quality, capabilities and advisory output
RGBA bytes. Exact affected-ID, dimensions and encoding approval is mandatory;
duplicate/missing IDs, declined review or edited public review cannot bypass it.
Explicitly approved cropping can lose output ink, not silently drop originals.

After asynchronous approval, authority/currentness recheck, resource-bound graph
rebuild and exact measured-bound comparison precede rendering. Stale resources,
changed font bounds, cancellation and renderer loss refuse; owned graphs and
input textures/bitmaps clean up on all paths. Final output is still header/decode
verified. This transaction returns pixels/review only: no journal intent,
upload, native replacement or source deletion. Approved scope/placement and
durable archive/output/backup orchestration remain separate mandatory gates.

Read-only native v14 rotated rectangle with a label at x=-10.5,y=20.2 measured
bounds (-41.3094,-42.3979,201.6188,185.1958). Automatic output bounds were
(-42,-43,203,186), yielding a 31049-byte PNG without cropping. A custom 20 x 20
crop with missing source acknowledgement refused before encoding. No world
assets/native documents written; temporary source server stopped. Unit coverage
also checks positive/negative/fractional bounds, 48MP/long axes, exact crop
approval, stale review, changed reconstructed bounds and color-only background
composition. A visual preview dialog is not yet implemented.

**Durable bake operation preparation follow-up:** `scripts/layers/bake_operation.js`
binds the reviewed raster Blob to exact archive originals. `renderReviewedBake`
now returns a SHA-256 of canonical sorted raw sources; archive source digest and
review source identities must match. Reviewed crop/dimensions/destination and
encoded MIME/format/quality must agree with the native replacement. Mandatory
native schema/placement acceptance is explicit; prepare does not treat a rendered
image as permission to mutate native documents.

Separate deterministic token paths identify derived output, recovery JSON and
original background bytes in an existing validated data folder. The archive
contains the original-background-copy reference before any uploads, preserving
exact original native settings and immutable parent lineage. Retained background
bytes/fingerprint and reviewed background settings must match; the mutable source
URL alone is insufficient. Original snapshot data and returned public intent
copies cannot redirect privately captured upload plans.

`persist()` begins the durable apply intent first, then writes recovery JSON,
original image copy when present, and derived pixels with exact byte/hash
readback. Existing paths are never overwritten: a retry reads and verifies them
against the intended immutable identity. Lost upload, intent or assets-phase
acknowledgements stop the operation and retain evidence. Retry re-reads its
exact intent/assets-verified phase and reconciles files, without duplicate
uploads. Edited/missing originals, native acceptance failure, changed authority/
journal/context, source edits during upload and occupied mismatching paths
refuse rather than advance. Persisted typed archive/output/backup evidence and
browser output decode are verified before assets-verified.

Preparation returns the durable assets-verified journal only, without creating
native replacements or deleting source Drawings. Integration tests passed
prepared uploads into the existing resumable apply executor, then a restore
intent/executor; exact originals returned and a later unrelated stroke remained.
Tests cover Tile and preserved-background asset paths, partial uploads, lost
journal/phase responses, byte conflicts, source/review mismatch and callback
mutations. Native writes in this slice were mocks only; no live Scene or world
assets changed.

Only the designated active GM owns preparation/persistence. Passing the earlier
scope snapshot guard unchanged deliberately becomes stale after intent creation.
The approved-scope binding described below now preserves that native review
across its exact preparation journal revisions. Authority routing remains
pending. Local queue/revisions are still not server CAS or cross-client locks.
In-memory retry closures are not reload recovery: persisted archives remain
reconcilable, but absent blobs after reload need explicit re-preparation or
recovery review, never invented bytes. No automatic cleanup/expiry or blind
rollback. Large-native-write batching and deleted original-URL restoration
fallback remain pending.

**Approved scope/intent binding follow-up:** approved manifests from
`scripts/layers/optimization_scope.js` can bind one exact apply intent and
recovery archive through `bindOperationIntent`. Binding validates canonical
archive bytes/file fingerprint, checksum and typed descriptors, exact captured
originals, scope, Scene/Level, parent lineage, destination, reviewing user and
Tile hidden/public audience. Public manifest mutation cannot redirect these
private captured sources or alter approved audience/exclusions. Another intent
cannot reuse the same approval, even before either intent is persisted.

`prepareBakeOperation` accepts `approvedScope`, uses its strict pre-intent guard
through preparation, then privately obtains the bound context guard after the
exact intent/archive exists. It permits only three whole-journal states: the
reviewed baseline, baseline plus the exact intent at revision +1, and that same
intent at assets-verified at revision +2. Every retained prior entry must remain
unchanged. Unrelated revisions, owners, descriptors, phases or appended records
refuse. The original manifest/assertCurrent remains strict and deliberately
becomes stale once intent persists; no global exception for optimization flags
is installed.

Native state snapshots remain exact throughout bound asset preparation,
including all Drawing/Tile sources, Level, Scene/grid, layer metadata/workspace,
import state and selected IDs. New strokes, changed placement context, workspace
visibility, selection or reviewer identity refuse before further upload/phase
advancement. Selection reorder alone remains equivalent. External context
callbacks still guard displayed Scene/Level and client authority; they should
not themselves duplicate the strict journal snapshot. Binding does not allow
native execution changes, source removal, owner takeover or restore mutations;
those continue through separately reviewed executor/recovery checks.

Integrated tests pass scope approval through durable intent/upload/assets
verification and retry while the original guard remains strict. Tests reject
second-intent reuse, tampered audience/public manifest, native/grid/workspace/
selection changes during upload, changed operator and unrelated journal writes.
No live world or Scene writes were performed for this slice. Authority routing,
reload asset recovery, execution-stage scope/placement reviews and UI remain
pending.

**Reload asset recovery follow-up:** `scripts/layers/bake_asset_recovery.js`
provides a fresh review for retained Tile/background apply intents at intent or
assets-verified. It requires the owning designated active GM and explicit
context/native/output acceptance. A verified archive must match exact journal
identity, file fingerprint, typed source/replacement/output descriptors and
immutable parent lineage. All original Drawings must still match, and the native
replacement must be untouched; advanced/partially executed native operations
are deliberately referred to the existing reconciliation/executor path.

The read-only inventory uses validated data-folder listings to identify absent
paths and exact byte/hash reads to verify present ones. Invalid listings, failed
HTTP reads and mismatching files throw explicit errors, never become missing
classifications or overwrite permission. A missing archive returns a blocked
review because lightweight Scene journal digests cannot reconstruct raw sources.
Supplying an exact original archive Blob can reopen inventory after immutable
byte/hash and archive-content validation; invented/similar archives refuse.

The recovery callback requires approval of the exact missing paths and original
byte-identical Blobs for all missing assets before any upload. Archive bytes
already supplied for inspection may be reused. Output decode/render acceptance
is required for supplied and persisted output. Existing matching files are
re-read, never uploaded again; a previously verified file disappearing requires
a fresh review rather than guessed bytes. Mutable background URLs are never
auto-fetched as backup replacements. Original format bytes are preserved.

Review captures all native Drawing/Tile sources, Level, Scene/grid, layer and
workspace context plus the whole journal. Async callbacks, file reads and
uploads recheck these snapshots, exact original sources and native acceptance.
Unrelated strokes/Tile changes, workspace changes, altered originals, journal
changes or lost owner/authority invalidate review. Recovery touches files and
the assets-verified phase only, never creates native replacements or deletes
Drawings. Upload or phase acknowledgement uncertainty retains evidence for
fresh inventory/reconciliation; no blind rollback or automatic file deletion.
Successful review callbacks are consumed and must be re-inspected for reuse.

Mock tests cover fresh reload after lost uploads, missing output/archive/original
background copy, exact-byte repair, mismatches, altered public review, changed
native/journal/context, invalid listing/HTTP failure and files disappearing
after review. Both an already assets-verified intent and an incomplete intent
can be reverified; only the latter advances its phase. No live uploads/native
Scene changes occurred in this slice. This is recovery infrastructure, not UI,
automatic regeneration or a guarantee that missing original bytes are available.

**Detached native replacement construction follow-up:**
`scripts/layers/bake_replacement.js` shares deterministic output descriptors
with durable preparation and builds exact native Tile/Level-background sources.
`prepareBakeOperation` can now omit `replacement` and supply explicit `audience`
and, for Tile output, an unoccupied 16-character native `replacementId` and
integer `sort`. Explicit replacement and construction options cannot be mixed.
Existing lower-level reviewed replacement callers retain their behavior.
No IDs or stack ordering are guessed, and no live document/Placeable is created.

Tiles use the reviewed scene-pixel crop and Level ground elevation, neutral
texture mapping/tint/opacity, no light/weather restrictions or occlusion, no
layer/foreign renderer metadata, and a locked final source. Staged Tiles are
hidden; the final hidden state matches GM/public audience. Strict native
construction captures schema defaults, then refuses changes to requested
values and requires an exact second native round trip. Requested input is
cloned before constructors because Foundry mutates its constructor input.
Both native states become immutable archive sources through normal preparation.

Background construction requires the current full Scene/background snapshot,
identity shared transforms and public audience. It copies the complete Level,
changes only background source/color/tint, preserves alpha threshold, elevation,
foreground/fog, visibility, flags and unrelated native settings, and requires
exact strict native round trips. Normal durable preparation still verifies the
retained original image bytes and creates their separate immutable backup.
Source digest, scope/lineage, native/placement callback and persisted decode
acceptance remain required; this constructor is not permission to execute.

Read-only Foundry 14.365 acceptance constructed 20000 x 1000 and 8000 x 6000 Tile
sources and a full-Scene background update with exact unchanged Scene JSON.
This validates native schema only, not oversized image GPU display capability.
It also exposed native integer-coordinate normalization: a -42.5 Tile origin
rounds to -42. The adapter refused that reviewed crop rather than accepting
silent movement; an integer-origin crop must be explicitly re-reviewed and
rendered. Unit tests model this rounding and cover both audiences, defaults,
identity collisions, snapshots, normalization and immutable settings.
Mock integration persisted generated Tile/background archives and verified
schema/placement and exact original backup paths without native source removal.
No live uploads or Scene changes occurred; production UI remains disabled.

**Execution-stage review follow-up:**
`scripts/layers/optimization_execution_review.js` reviews the final unfinished
apply/restore record using verified persisted archive/output/background-copy
evidence, unchanged native snapshots and explicit output acceptance. Owner,
operator and designated active GM must still match. Detached public reports
list exact source IDs, present/missing/hidden-staged originals and replacement
state; approval requires all archived IDs and an explicit resume decision.
Approval is bound to the exact Scene object/token, not reusable for another
executor operation. `resumeOptimizationOperation` accepts `approvedExecution`
and composes it with the caller's context guard. Native schema/placement and
persisted-output callbacks remain mandatory. Lower-level callers retain their
existing explicit-guard behavior; this is not a global relaxation.

The guard retains every earlier journal record and immutable descriptor, permits
only this entry's ordered phase advances at the corresponding revision, and
rejects phase regression once an advancement is observed. Exact native original
sources can be absent only during the appropriate removal phases; hidden copies
can be introduced only for restore. Replacement state must be compatible with
the phase, including native writes whose acknowledgement was lost before their
journal transition. Public Tiles cannot become exposed before source removal;
GM Tiles with identical staged/final hidden sources remain valid. Background
changes must match the exact before/after Level source, never a permissive
background-field wildcard.

Native snapshots exclude only operation-owned Drawing/Tile identities and the
before/after background fields checked separately. Every unrelated Drawing,
Tile, other Level, Scene dimension/grid, layer/workspace and import state stays
exact. Changes inside asynchronous native or output callbacks are detected
before further native steps. Optional selection binding allows Foundry to
deselect deleted originals while refusing unrelated selection changes.
After interruption, a fresh evidence review may capture later artwork as
unrelated baseline and resume only the immutable archived operation; the old
approval remains stale. Missing/corrupt files require asset recovery, not
execution-shaped fallback.

Mock integration validates complete apply/restore for Tile and Level background,
preserves later strokes, resumes partial source deletion and lost hidden-original
creation acknowledgements, and rejects unrelated native changes after staging
before source deletion. Tests also cover exact approval, changed callbacks,
phase/revision/owner/token conflicts, cancellation, selection and GM-hidden
outputs. This review performs reads only. No live uploads, native writes,
authority routing or production UI activation were performed in this slice.

**Connected Tile Bake workflow follow-up:**
`scripts/layers/bake_workflow.js` connects the existing adapters without runtime
activation. `prepareReviewedTileBake` requires the designated GM operating the
same Scene/Level and explicit scope/render/placement approvals plus native
display acceptance. It validates storage/identity/sort options before resource
work, reviews source capability with texture preparation enabled, renders the
approved exact sources and constructs the deterministic native replacement.
Schema/placement checks and the explicit display callback are composed rather
than substituted for each other. Decode alone never authorizes native display.

Preparation returns a detached report and immutable encoded Blob for preview,
not an exposed executor or mutable source graph. No journal, file or native
writes occur during preparation. `persistAssets` requires exact archive/output
path approval and delegates journal-first writes, SHA-256 readback, decode and
bound-scope verification to durable preparation. It then captures a strict
execution review. `apply` requests separate exact-source resume approval and
passes the bound execution, output and native guards to the existing executor.
Changes while waiting for apply approval invalidate the retained review; they
are not silently captured as a fresh baseline. Rejected approval can be retried
without native work. Native-write failure clears the pre-write review so the
next apply attempt explicitly reviews current partial state before resuming.
Successful closures are consumed.

Workflow preparation and persistence/apply share a per-Scene same-client busy
lease with explicit errors, released on failure. This is not an atomic server
or cross-GM lock, and does not replace authority coordination. A different
operator/active-GM combination refuses before rendering; no automatic relay
or handoff is installed. The application must supply current displayed-context
guards, real review dialogs and actual native image-display capability evidence.
No permissive default accepts oversized native textures.

Fixtures connect the real reviewed render adapter to scope, native construction,
file/journal persistence, apply and a fresh reload-style restore retaining later
strokes. Browser/GPU/storage/native APIs are mocks, not live pixel certification.
Tests cover denied callbacks/display, corrupt approval, changed context before
write/apply, simultaneous work, uncertain upload retry, partial native deletion
and re-review, immutable public reports and consumed operations. Native display
acceptance is rerun before staging, not only during preview. No live uploads or
Scene mutations were performed. Production UI/runtime registration, storage
configuration, authority coordination and authorized disposable-Scene acceptance
remain the next delivery gates. This initial connected workflow is Tile-only;
background and Consolidate integration remain separate.

**Concrete native Tile display acceptance follow-up:**
`scripts/bake_display.js` supplies the connected workflow's default
`verifyDisplay` implementation. It validates exact archived-output bytes and
browser dimensions, verifies both native Tile sources use the matching image
and dimensions with neutral mapping, and refuses axes exceeding the actual
live GPU texture capability. No arbitrary pixel/memory budget or downsampling
is introduced. Unsupported single-texture dimensions are native display
constraints, not export/encoder constraints.

The adapter creates an isolated owned PIXI renderer with a one-pixel target,
uploads the complete decoded image as one texture, samples it and reads back
the target. Texture validity/dimensions, GL initialization/upload/readback errors,
context loss and stale authority/cancellation refuse explicitly. All owned
sprite/texture/renderer/bitmap resources are cleaned even on failure. The live
renderer's GL state is not borrowed, avoiding disruptive texture/framebuffer
state changes. Native constructor input and Scene sources remain untouched.

Read-only Foundry v14 testing accepted a synthetic 8000 x 6000 image in about
778 ms and refused 20000 x 1000 against the observed 16384px texture axis.
Scene JSON remained exact. This is concrete full-image GPU allocation/sampling
evidence on the operating client, not actual Tile Placeable/shader/color/occlusion
fidelity, proof of every texel, guaranteed allocation under future pressure, or
player-client capability certification. External injected display callbacks
remain available for specialized acceptance but may not be permissive fallbacks.
Fixtures test the default adapter in the connected workflow through apply.
Production UI and authorized live acceptance remain disabled/pending.

**GM review dialog follow-up:** `scripts/layers/bake_dialogs.js` provides opt-in
localized DialogV2 callbacks through `createBakeReviewDialogs({isCurrent,signal})`.
Scope lists included/excluded IDs and explicit capability/blocking reasons;
resolution review shows exact crop origin, dimensions, encoding, cropped/outside
IDs and advisory RGBA bytes; placement lists exact overlapping Tiles and ground
depth/audience warnings. Native operation review lists operation token/action/
phase and present/missing/hidden-staged recovery information. Durable file review
lists exact output/recovery paths and explicitly distinguishes file/journal writes
from native apply. Presentation hiding is not described as secure storage.

Every dialog is modal with an initially unchecked required acknowledgement.
Closing/declining returns an explicit `BakeReviewCancelledError`, never fabricated
approval. Authority/context/cancellation are checked before and after the dialog.
Inputs are captured before await; mutation of external reports cannot change the
returned exact identities. Dynamic IDs/paths/diagnostics use DOM textContent,
never interpolated HTML. A blocked scope refuses without asking for permission
to bypass its blocker. Localization uses the module's existing English catalog.

Encoded preview uses an owned Blob URL, decodes the actual PNG/WEBP image and
requires exact natural dimensions before displaying it against a checkerboard.
Only its on-screen presentation is scaled; bytes/output resolution are unchanged.
URL cleanup occurs on success, cancellation, decode/context or dialog failure.
Passing `approvePreview` to `prepareReviewedTileBake` adds a read-only post-encode
gate that rechecks the strict source snapshot before returning the prepared
workflow. Dialog callbacks do not render, upload, update settings or create native
documents by themselves. File approval and final apply are separate explicit
calls, not automatic consequences of preview acceptance.

Tests cover exact decisions, unsafe-looking source text, unchecked acknowledgement,
close/cancel, authority/context loss, captured immutable approvals and preview
URL lifecycle, alongside workflow preview refusal/stale-source tests. Real
DialogV2 layout/tablet acceptance remains pending; no live dialogs or world writes
were invoked in this slice. Storage setup, registered production controls,
authority coordination and authorized disposable-Scene acceptance remain unwired.

**Recovery storage configuration follow-up:**
`scripts/layers/bake_storage.js` registers the world `bakeRecoveryFolder` setting
with an empty default and native `filePicker: "folder"` through existing settings
initialization. Foundry 14.365 SettingsConfig supports that folder-picker type;
read-only native data browse returned exact target, files/dirs and privacy state.
No live setting was registered/saved during the read-only check. The folder is
chosen by the GM and created manually using supported storage tools, never guessed
or auto-created by Bake.

`reviewBakeStorage` validates the existing local data-folder path, designated
operator/active-GM identity and FILES_BROWSE/FILES_UPLOAD permissions before and
after asynchronous browse. It requires exact returned target, valid files/dirs
arrays and explicit nonprivate listing. This policy ensures outputs are intended
for shared presentation; privacy flags are not treated as confidential storage.
Invalid/redirected listings, private folders, server errors and authority changes
refuse explicitly. The adapter does not upload a probe or promise server write
access from a successful browse; real persistence still validates returned path,
exact byte count and SHA-256 readback.

The connected Tile workflow uses the configured setting when root is omitted,
or an explicit reviewed root for lower-level callers. Preflight precedes scope
approval/resource/render work, and availability is rechecked before durable
intent/persistence. Pending workflows bind the configured path: changing it
invalidates preparation/persistence/apply instead of redirecting writes. Prior
operation journals continue using immutable stored paths; settings changes never
move/delete their files and fresh reload recovery may use the retained references.
Tests cover registration shape, configured vs explicit roots, stale settings,
permissions, cancellation, malformed/private/redirected listings, server errors
and no automatic directories/uploads, plus connected preflight refusals.
Production Bake commands and authority relay remain disabled/unimplemented.

**Opt-in GM dialog entry follow-up:** `scripts/layers/bake_entry.js` provides
`promptReviewedTileBake(scene, options)` as an explicitly invoked service, not
a registered toolbar/runtime command. It binds the operating designated GM and
displayed ready Scene/Level, composes optional caller currentness with that
display guard, generates fresh native/operation identities when omitted, and
uses configured storage by default. Audience, scope/layer and integer Tile sort
remain explicit caller inputs, not guessed presentation or stack policy.
Journaled tokens refuse new preparation and route callers toward recovery.

The command runs default localized scope, resolution, placement and encoded
preview dialogs during read-only preparation. Only after those approve does it
ask for exact durable paths, persist verified assets and ask separately for
native execution approval. Options cannot override the command's mandatory
review callbacks. An injectable complete dialog adapter is available for
fixture/host testing, not a permissive missing-dialog fallback. All six default
dialogs are exercised together with real scope/render/preparation/execution
adapters under mocked browser/storage/native APIs.

A per-Scene same-client review lease covers the entire modal lifecycle, including
time between preparation and file/apply decisions, and is released on all exits.
Cancellation is recognized only by `BakeReviewCancelledError`: before durable
writes it reports cancelled/no recovery; after persistence it reports cancelled
with the exact retained journal descriptor and explicit warning to inspect/resume
before starting another operation. Neither files nor journals are rolled back.
Unexpected errors, context/authority loss, storage failures and partially
successful native writes propagate, never become success-shaped cancellation.
Completion notification occurs only after verified complete-phase persistence.

Tests cover default dialog order and no writes before file approval, generated
IDs, cancellation at every early dialog, retained evidence after apply-dialog
cancellation, displayed-context loss, overlapping entry calls, unexpected/partial
native failure, GM denial and completed-token reuse. No live settings/files/
Scene writes or real modal layout acceptance were performed. Production entry
registration, scope/options UI, authority coordination and authorized live
apply/restore acceptance remain pending; the service is opt-in only.

**Tile scope/options UI follow-up:** `scripts/layers/bake_options.js` provides
the read-only options dialog used by `promptReviewedTileBake` when audience or
sort is omitted. Layer is the default; a current active leaf may be preselected,
but no missing layer is invented. Selection and All are explicit choices and
may leave the layer selector empty. Selection requires a nonempty live set of
existing Drawing IDs. Audience starts blank and must be chosen; native integer
Tile sort starts blank and is never guessed from Drawing sort or existing Tiles.
Code-supplied complete options retain their previous behavior.

Encoding supports WEBP/PNG and reviewed quality from zero to one. Automatic
enclosing crop remains the default; custom Tile crops require integer origin
and positive integer dimensions, finite safe endpoints and representable RGBA
size, not arbitrary axis/pixel budgets. External texture contact is opt-in
through an initially unchecked consent control. Actual resources, GPU limits,
cropped IDs, bytes, placement and display are still checked later. No silent
movement, format substitution or output downsampling is introduced.

The options dialog captures exact source/Tile, Level, dimensions/grid, layer/
workspace, journal and selected-ID context. Changes during user input invalidate
the options instead of silently capturing a new baseline. Dynamic layer names
use textContent. Closing yields explicit no-write cancellation at the options
stage and releases the command's review lease. Invalid inputs raise localized
errors; subsequent exact scope/render/placement/preview/file/native approvals
remain mandatory. Options do not change world settings or Scene documents.
Tests cover displayed defaults, safe names, empty layer for Selection/All, valid
negative custom bounds, invalid/blank inputs, stale context and connected command
completion/cancellation through the options dialog. Real DialogV2 layout and
tablet acceptance, authority coordination and production registration remain
pending. No live UI or Scene writes were invoked in this slice.

**Reload-safe resume entry follow-up:** `promptResumeTileBake` in
`scripts/layers/bake_entry.js` operates on the final unfinished Tile apply/restore
record. It requires the owning designated active GM on the displayed Scene/Level.
It reads the exact stored archive/output and verifies journal descriptors,
lineage, source states and output decode through existing evidence adapters.
Output dimensions come from the immutable native replacement, not new UI inputs.
An actual persisted-byte preview, ground placement and exact-source execution
approval are reconstructed independently of the original preparation closure.
No new intent, output rendering or file upload occurs; missing/corrupt assets
require exact-byte asset recovery rather than guessed replacement images.

Full native/workspace/journal context is captured before asynchronous file reads
and held through every review dialog. The shared execution-context helper avoids
duplicating snapshot logic. After exact execution approval, native/output guards
switch to the phase-aware guard, while displayed authority/context remains fixed.
The pre-write snapshot is not reused as the executor's external context callback:
that would incorrectly reject its own staged replacement/journal advancement.
All unrelated changes still refuse. Previously existing later strokes become
the fresh unrelated baseline and remain untouched.

Native schemas and placement are reverified against the exact archive per native
step. Apply rechecks full-image display acceptance using fresh retained bytes.
Restore does not allocate the Tile texture being removed: GPU allocation failure
must not prevent original Drawing recovery. It retains exact byte/decode/schema/
placement checks and requires an already journaled restore intent when resuming;
restore-intent creation is a separate entry point. `promptRestoreTileBake` now creates a
separately approved durable restore intent only for the latest completed Tile
apply. It re-reads and verifies the exact parent archive/output, requires every
original identity to remain absent and the exact applied Tile to remain
unchanged, then reuses the normal preview, placement and execution approvals.
The restore entry copies the immutable parent descriptors and has a fresh token
and parent link; no replacement files are written. Cancellation before intent
creation is no-write; interruption after intent creation uses the ordinary
reload-resume path. Retained file references are independent of the current
storage setting. New Bake, resume and restore share the same per-Scene
same-client dialog lease; no cross-client authority lock or relay is claimed.

**Disconnected-owner handoff:** `promptTakeOverTileBake` is an explicit
recovery-only entry for the final unfinished Tile operation when the former
journal owner is verifiably disconnected. Only the current designated GM with
Scene update permission on the displayed Scene/Level may request it. The path
reads and validates the typed archive, output bytes/decode and current native
recovery state, then asks for explicit ownership-transfer approval. It checks
the former owner's connection and the reviewed journal/native/workspace context
again before the journal transfer. Following a verified transfer it invokes the
ordinary reload-safe resume, which still requires its independent preview,
placement and execution approvals. Cancellation before transfer is a no-write;
interruption after transfer leaves a new-owner recovery record for normal resume.
Missing/invalid former-owner presence is not treated as disconnection. This
handoff is not a distributed lock, socket relay, or server-side compare-and-swap:
concurrent-GM conflict policy and authority relay remain pending, and no
production UI or live Scene operation was enabled.

**Active-review conflict monitoring:** Bake, resume, restore-intent and takeover
entry points install a temporary `updateScene` monitor while their review and
execution lifetimes are active. It compares the persisted optimization journal
against the captured baseline, refuses unknown operation tokens or changes to
existing immutable recovery descriptors/owners, allows only the entry token
already bound to the current review, and treats a changed Scene document identity
as stale. Conflict remains latched for that review even if the journal later
appears to return to its prior value. The monitor is removed on every exit.
This is client-side invalidation, not a lock: separate clients can race before
their document updates arrive, clients using the same GM identity cannot be
distinguished, and Foundry Scene updates do not provide compare-and-swap.
The persisted journal and active-GM checks remain the mutation authority;
conflict monitoring never authorizes a write.

Fixtures cover resume after final-apply cancellation, partial source deletion,
an existing restore intent, changed storage setting, default localized persisted
preview/placement/execution dialogs, cancellation at each review, missing/corrupt
output, denied display, native callback/context changes, owner/token/complete
conflicts and overlapping command lifetimes. Restore tests cover lineage and
duplicate refusal, exact-file/native preconditions, interrupted-path handoff,
dialog cancellation/staleness and retention of later Drawings. Native errors propagate; cancellation
returns the retained recovery descriptor without rollback. No live UI, files or
Scene changes were performed. Production registration, authority coordination
and authorized live acceptance remain pending. Takeover tests cover disconnected/
reconnected owner checks, active-GM election, evidence failures, review staleness,
pre-transfer cancellation and post-transfer resume interruption.

**Real Foundry DialogV2 client check (2026-10-08):** With the built-in
Gamemaster account verified as the actual designated active GM, imported the
deployed `bake_dialogs.js` module in the live Foundry client and exercised
scope, resolution, placement, execution, restore-intent, takeover, persistence
and image-preview dialogs using synthetic review records. Every dialog rendered,
required its acknowledgement, and returned the expected approval shape. The
preview image loaded and decoded at its exact 256 x 256 dimensions. A separate
unacknowledged scope approval returned `BakeReviewCancelledError`; an HTML-like
Drawing name rendered as literal text with no injected image element. Before
and after the exercises, the active Scene retained 47 Drawings, zero Tiles and
no optimization journal. No Bake, Restore, persistence or Scene mutation entry
point was invoked. This validates the deployed DialogV2 desktop browser path,
not tablet/pen ergonomics, real artwork rendering, storage permissions, native
Tile fidelity, or destructive apply/restore; those acceptance gates remain.

**Disposable Scene live acceptance (2026-10-08):** Under the actual designated
Gamemaster account on Foundry 14.365 / PIXI 7.4.3, exercised locally rebuilt
modules in the authorized sandbox. The deployed copy still needs these fixes.
The first attempts refused before uploads/journal/native writes, exposing native
grid instances without `toObject`, boxed Foundry Color serialization, undefined
Tile names and mismatched locale/code-unit ordering in source hashes. Fixed each
cause without weakening exact archive validation and added regressions.

The first completed two-source Bake uploaded a 290 x 180 PNG (5821 bytes) and
its recovery archive, removed both originals and created one hidden, locked GM
Tile with a valid native mesh texture. Restore completed with exact original
IDs and complete native sources, removed the Tile, and retained a later Drawing
unchanged. Screenshot comparison then exposed a half-image placement offset:
v14 Tile x/y locate the texture anchor, not an implicit top-left corner.
Corrected Tile construction, placement review and display checks to require
zero anchors; Level-background transforms remain unchanged.

A second cycle baked three sources to a 470 x 280 PNG (8212 bytes). The actual
Tile shape/mesh had x80/y90 and zero anchors, and screenshots aligned the red
rectangle, blue ellipse and green rectangle with their restored positions.
Restore again returned every original source exactly, removed the Tile and
preserved a fourth, later Drawing unchanged. Hidden GM Tiles are visibly dimmed
by Foundry; this is not pixel/color-fidelity certification. These destructive
cycles used automated exact-shape review callbacks, not replacement GPU/native/
file checks; the real DialogV2 path was separately checked above.

A third run deliberately cancelled execution after persistence at journal phase
`assets-verified`. All four originals remained exact, with no Tile. Reloaded
the browser (clearing imported modules and in-memory entry state), read the
existing journal/archive/output, and resumed with fresh preview, placement and
execution approval. Resume reused the same file descriptors and completed with
one zero-anchored Tile and no originals. Restore returned all four native
originals exactly, removed the Tile, and retained a new fifth Drawing unchanged.
All six apply/restore journal entries reached `complete`. This covers one
pre-native-write cancellation/reload boundary, not network loss or interruption
inside every native-write phase.

Retained sandbox evidence lives in
`worlds/melody-of-the-weirding-mover/assets`, with pairs named
`recovery-<token>.json` and `bake-<token>.png`:
`BakeAccept6FUnc4EFrFJZHbXf` (first cycle, displaced Tile),
`BakeAcceptsGyxjTzR6z8du7Zi` (anchor-corrected cycle),
`BakeReloadKucGYoAFx8d6IZYF` (reload/resume, 9827-byte PNG).
Do not treat the first output as placement acceptance. Public FilePicker has
no supported deletion API; keep the exact recorded files rather than invent
a cleanup endpoint.

Cleanup removed only the recorded disposable Scene after final exact-source
verification. The original Scene was restored as active/displayed and retained
47 Drawings, zero Tiles and no optimization journal. The six recorded recovery/
output files remain in the sandbox assets folder.

**Existing Tile geometry follow-up:** Overlap review now snapshots native
`TileDocument.shape.bounds` alongside each exact source, rather than assuming
x/y are the top-left corner. Missing/nonfinite/overflowing bounds refuse;
source or derived-bounds changes invalidate the approval. Other-Level Tiles
and the operation's own staged Tile remain excluded. A read-only live check
used detached native Tiles: a centered 100 x 40 Tile at x140/y100 produced
bounds x90/y80 and overlapped the reviewed x10/y20, 100 x 200 crop; an 80 x 40
Tile at x150/y50 with anchors 0.25/0.75 and rotation90 produced bounds
x140/y30, 40 x 80 and did not overlap. The original Scene retained 47 Drawings,
zero Tiles and no journal. This is native shape-envelope intersection, not
pixel coverage or shader/texture-overflow certification.

**Artwork graph fidelity acceptance (2026-10-08):** Explicit developer harness
`tools/bake-fidelity-acceptance.mjs` creates a disposable Scene and compares
480 x 320 PNG pixels from Bake's reconstructed graph against owned Graphics
referencing actual native Drawing geometry and Sprites referencing actual
native text textures. Both pass through the same raster/extraction/PNG pipeline.
Native geometry reference counts are checked after each comparison. This
isolates graph construction from primary-group/Tile shader differences; it
does not prove that the shared extraction pipeline is itself fidelity-neutral.
No output/recovery files were uploaded for these comparisons.

The first six fixtures found one real defect: rotated multiline text with alpha
0.65 differed in 4187 pixels (maximum channel delta62, mean channel delta0.14493
over the entire image). Foundry 14.365 PreciseText defaults to resolution2;
the Bake graph incorrectly forced resolution1. Bake now preserves native
PreciseText resolution and verifies the actual generated bitmap against GPU
limits; bounded previews and existing publication defaults remain unchanged.
Rerunning all six and adding three texture fixtures yielded zero changed pixels,
maximum channel delta0, and no cropped sources in all nine:

| Fixture | Nonzero-alpha union pixels | Changed pixels after fix |
|---|---:|---:|
| Opaque rectangle | 12600 | 0 |
| Rotated ellipse | 10092 | 0 |
| Transparent overlapping rectangles | 19200 | 0 |
| Smoothed open path | 1506 | 0 |
| Rotated smoothed filled polygon | 10647 | 0 |
| Rotated multiline translucent text | 24530 | 0 |
| Rotated ordinary texture fill | 13998 | 0 |
| Rotated image stamp | 13023 | 0 |
| Rotated repeated material | 31162 | 0 |

Texture fixtures reused the existing sandbox PNG from the earlier acceptance
cycle, not third-party artwork or newly uploaded files. Native texture readiness
is awaited with a bounded explicit failure. These checks use locally corrected
source modules; deployment needs the new text fix. Live primary/Tile shader
comparison, occlusion, zoom/resampling, alternate fonts and player presentation
remain separate gates.

**Live screen/Tile fidelity measurements (2026-10-08):** The explicit
`tools/bake-screen-acceptance.mjs` harness created six native Drawings in one
640 x 480 gridless Scene: transparent overlaps, rotated ellipse/polygon,
smoothed path and rotated multiline translucent text. Captured the actual
renderer's framebuffer immediately after normal app rendering, cropping only
the Scene screen rectangle (DOM UI excluded). Two native reference captures
matched exactly at every measured view. Then ran the real reviewed Bake,
including default GPU/native/file checks and automated approval callbacks,
and sampled the real public Tile with no occlusion or light/weather restriction.

The first requested 75% view was clamped by Foundry to 100%; it is not evidence
for 75%. The corrected harness fails if actual zoom differs from requested.
Repeated the cycle at measured 100% (integer and half-pixel screen translation),
125% and 150%. Renderer resolution 1, viewport 1485 x 787, Foundry 14.365/PIXI 7.4.3:

| View | Compared pixels | Changed pixels | Pixels with any channel delta >2 | Maximum channel delta | Mean absolute channel delta |
|---|---:|---:|---:|---:|---:|
| 100%, integer translation | 307200 | 6816 | 65 | 32 | 0.01146 |
| 100%, half-pixel translation | 307200 | 18224 | 11765 | 50 | 0.22344 |
| 125%, half-pixel translation | 480000 | 29528 | 18368 | 51 | 0.23453 |
| 150%, half-pixel translation | 691200 | 41580 | 25789 | 66 | 0.27294 |

Delta2 is a reporting bin, not an approved acceptance threshold. Integer-view
outliers occurred around rotated polygon/text/ellipse edges, including one
text-region channel delta 32. The earlier exact graph/reference result does not
imply exact live vector/Tile output. Fractional placement and scaling add
resampling differences, but the remaining integer-view differences require
further characterization; no production fidelity pass is claimed.

GM-hidden Tile rendering was also measured at integer 100%: 61100 changed pixels,
maximum delta 63, mean 3.67118 versus visible originals. Hidden dimming is expected
presentation behavior, not color-equivalence acceptance. The test restored the
public Tile source before normal Restore; both cycles restored exact original
documents. Final restored framebuffer matched its original reference exactly
at all four views (zero changed pixels). No actual player client, token
occlusion or lighting interaction was tested.

Retained evidence uses pairs `recovery-<token>.json` / `bake-<token>.png` in the
same sandbox assets folder: `ScreenBake9Mm8kuxLeGbSvUyk` (first/clamped-view run),
`ScreenBakesKOd7SjqkpzD1VsE` (corrected measured views). Both PNGs are 522 x 368,
47479 bytes, SHA-256
`3cbc9c1bc55d2675a3f52ca319f1a8717b8be5ac41a059a754070fc983df2e95`.
The review disclosure now explicitly mentions fixed-raster edge/text sampling
at zoom/fractional placement. No downsampling or arbitrary error-tolerance
policy was introduced.

Cleanup restored the original Scene/view, verified its complete native source
unchanged (47 Drawings, zero Tiles, no journal), deleted only the recorded
disposable Scene, removed test globals and stopped the temporary harness server.
The four recorded archive/output files remain as sandbox evidence.

**Aligned fidelity isolation (2026-10-08):** Repeated the same six-source
fixture with no uploads/native optimization writes, extending the screen
harness. Temporary owned graphs/Sprites were inserted in the actual primary
group while native shapes were hidden only in runtime visibility; every
experiment restored the native screen exactly in `finally`.

| Control against native primary screen | Changed pixels | Delta >2 pixels | Maximum delta |
|---|---:|---:|---:|
| Reconstructed plain vector graph in primary group | 0 | 0 | 0 |
| PNG Sprite in primary group | 6816 | 65 | 32 |
| Raw transparent GPU raster Sprite in primary group | 6816 | 65 | 32 |
| Transparent raster with matching viewport projection | 6798 | 65 | 32 |
| Opaque RGB raster with matching projection/backdrop | 0 | 0 | 0 |

PNG Sprite versus raw transparent GPU raster had zero differences, ruling out
the PNG round trip as the source for this fixture. The plain Sprite reproduced
the earlier actual Tile metrics, so no Tile-specific shader is needed to
produce those differences. Matching viewport projection did not remove the
65 outliers. Foundry's primary target uses RGB, nearest sampling and no MSAA;
the diagnostic opaque RGB target used the pre-ambience primary backdrop
[153,153,153,255] and matched native output exactly. An initial control that
sampled the final displayed backdrop [143,143,143,255] was invalid because
it would undergo ambience processing again; that result is not acceptance
evidence.

Separate graph/PNG controls at different integer target translations found
5 differing pixels (maximum6) between tight and scene-origin crops, and
23 differing pixels (maximum13) between tight and screen-projected crops.
These expose small target/projection sensitivity but do not explain away
the aligned compositing result.

The evidence isolates the transparent intermediate/compositing path, not
incorrect native graph construction or PNG corruption. It does not prove
that every error is irreducible, or certify all GPU/backdrop/font combinations.
No opaque backdrop was added to Tile Bake: doing so would break transparency
and subsequent background/stacking behavior. Exact-original recovery remains
unchanged. The owner accepts reviewed best-effort raster conversion with
explicit warnings and exact-original recovery, subject to judging actual
general-use quality in real life. This is not a numeric error-tolerance policy,
a blanket visual certification or approval to enable production controls.
Cleanup restored the original Scene/view and complete source exactly, deleted
only the disposable fixture, and uploaded no new evidence files.

**Desktop Bake options acceptance (2026-10-08):** Exercised the real v14
DialogV2 on disposable Scene `S8KusB38cZBvmYEz`, with one synthetic Drawing
and one leaf layer named literally `<b>Acceptance Ink</b>`. Approved Layer/
GM/WEBP/automatic with explicit sort0, Selection/Players/PNG with sort-10
and exact custom bounds `{-42,30,8000,6000}` plus external-resource consent,
and All/Players and All/GM automatic WEBP scopes. Literal labels contained no
injected `b` element. Each approval retained the entire fixture Scene source
exactly; no renderer, uploads, Tile creation, journal or workspace/settings
writes were initiated by approval.

The deployed dialog exposed a real usability defect: blank required inputs
threw in the DialogV2 callback, after Foundry disabled the approval button.
Added capture-phase native `reportValidity()` and shared semantic validation
before click/submit handling, with localized notification and propagation
blocked on invalid input. Required fields follow Layer/custom scope.
Inactive layer/custom-crop inputs are disabled: switching to automatic crop
must not remain blocked by an obsolete fractional custom coordinate. Service
validation and source/currentness checks remain fail closed after approval.
The corrected built module was served locally and imported into the actual
Foundry client without deploying or changing other module state. Live checks
confirmed blank required fields, fractional sort and fractional custom crop
remain editable with approval enabled; correcting/switching to automatic
successfully approved All/GM/WEBP/sort0 despite retained fractional crop input.

Close Window and Escape both produced `BakeReviewCancelledError`. Changing
the supplied selection reader during the dialog rejected as stale; a controlled
local native Drawing `updateSource` change also rejected, and undoing only that
change restored the fixture source exactly. These are real-dialog service
checks, not certification of native controlled-Drawing selection wiring or a
second client's persistent/socket updates. Physical tablet/touch ergonomics
and comprehensive keyboard submission remain outstanding.

Cleanup verified the fixture baseline, restored the original Scene view,
deleted only the recorded disposable Scene, and verified the original full
Scene source exactly:47 Drawings,0 Tiles,no journal. No test dialogs remained,
the options-test global was removed, and the temporary local server stopped.
No additional recovery/output files were uploaded. Targeted options/Bake
regressions, build and editor diagnostics passed. Production controls remain
unregistered.

**Two-client GM acceptance (2026-10-08):** The owner logged into DM
`poF3Bx3nfbDP2Oqw` in a second browser page while Gamemaster
`ey4M44lhE2Viewu8` remained connected. Both clients independently reported
Gamemaster as Foundry's designated active GM. Created only disposable Scene
`FiOX6Tjd9AoepbVE` with one synthetic native Drawing; both clients viewed it.

- DM's public reviewed Bake entry refused even with the correct displayed
  Scene/Level. Direct `beginOptimizationOperation` refused at designated-GM
  authority before invoking its evidence callback, with Scene source unchanged.
- A persisted native Drawing X edit from DM arrived in Gamemaster's open options
  review and caused stale-artwork rejection on actual dialog approval.
  DM reverted only that controlled coordinate edit; full Drawing source matched
  the initial baseline exactly.
- DM deliberately bypassed optimization services with native `setFlag` on this
  fixture to simulate competing journal updates. These were structurally valid
  **synthetic descriptors**, with placeholder hashes/paths and no backing files,
  not verified recovery assets or actual Bake operations. A new competing token
  stopped Gamemaster's monitor; removing it did not clear the recorded conflict.
- An explicitly allowed token/owner and unchanged descriptor phase update were
  accepted. Synthetic `assets-verified` tested only monitor phase handling:
  it did not certify files or execution.
- Remote ownership and source-digest changes were each reverted remotely before
  the first subsequent `assertCurrent`. Both still failed with the appropriate
  sticky conflict, proving actual socket/updateScene-hook observation rather
  than only final-state comparison.
- Exercised the **public reviewed Bake entry** with its normal options dialog
  and monitor lifetime. A remote competing token rejected approval with the
  monitor's conflict error before preparation/render/uploads. Only the injected
  synthetic entry remained; no operation intent, replacement or source removal
  was created by the rejected entry.
- The designated GM's direct takeover service refused a synthetic intent owned
  by still-connected DM, before invoking recovery verification and without
  changing the Scene.

This verifies live designated-GM admission and fail-closed remote conflict
detection, not atomic CAS, distributed locking, or prevention of an authorized
GM bypassing module services. Disconnected-owner transfer/resume with real
durable assets, reconnect during handoff, and interruption during native writes
remain separate acceptance requirements. No user roles, permissions or
authentication were changed by test code.

Cleanup removed the synthetic journal, verified full fixture Drawing source,
restored both original views, and deleted only the recorded disposable Scene.
Native journal writes changed the fixture's modification metadata and left an
empty module flag container; no claim of full fixture Scene byte equality is
made. Both clients verified the **original** complete Scene source exactly
unchanged:47 Drawings,0 Tiles,no optimization journal. Test monitors were closed
and test globals removed; accounts remain connected for later acceptance.
No uploads or new recovery files were created. No runtime change was needed.

**Real recovery handoff and native-write interruption (2026-10-08):**
Reloaded both deployed clients first. Shared browser authentication made both
reloads use DM; the owner logged the original page back in as Gamemaster.
Created only disposable Scene `R5CiUSlERBpQkRrj`, two synthetic native Drawings,
and real operation `HandoffCzII666d63nMFfxT`.

Gamemaster prepared PNG Bake through the public reviewed service with explicit
fixture-specific review callbacks, uploaded and verified immutable archive/output
bytes, then deliberately cancelled execution approval at `assets-verified`.
Both full original Drawing sources remained exact and no Tile existed.
DM received the durable journal via the real client connection.

DM's takeover entry refused while Gamemaster remained connected/designated.
Navigating the owner page away disconnected its socket and Foundry designated
DM automatically. Recovery evidence checks read and verified real retained
files. Cancelling takeover approval returned `ownershipTransferred:false` and
retained the old owner/phase unchanged. A second attempt waited at takeover
approval after evidence verification; reconnecting Gamemaster's actual page
made it active/designated again. Approving the waiting callback then rejected
before transfer, with the old owner and two originals unchanged.

Disconnected the owner page again. DM reviewed the actual native DialogV2
ownership-transfer disclosure and checked its acknowledgement. Public takeover
transferred ownership to DM, reverified/reviewed resume, and completed apply:
0 Drawings,1 accepted Tile,one completed apply entry. The native handoff dialog
was real UI; fixture preview/placement/execution approvals used explicit developer
callbacks with exact source-ID checks, not a claim of end-to-end manual UI use.
No second upload or replacement recovery intent was created.

For Restore, registered a narrowly scoped temporary `createDrawing` hook on
this fixture and optimization operation only. The hook aborted the supplied
signal immediately after native creation of hidden originals. Both originals
were persisted hidden; executor threw `InterruptedOptimizationError` before
journal advancement, leaving Restore token `dW8njmlDWwd90EnQ` at
`assets-verified` and the existing Tile intact. The hook was removed in finally.
Explicit public resume re-inspected actual document/file state, avoided duplicate
creation, removed the replacement, exposed the originals, and completed Restore.
Both full original Drawing sources matched exactly. This is a tested native-write
boundary interruption in the same client, not a browser crash/reload at that
boundary or coverage of every apply/restore mutation.

Retained real immutable evidence under
`worlds/melody-of-the-weirding-mover/assets`:
- `recovery-HandoffCzII666d63nMFfxT.json`:3377 bytes, SHA-256
  `f979ba8d8f79ebd6c55a0901a63cefb4710cb5fc6579999af704b93cc7e9c56c`.
- `bake-HandoffCzII666d63nMFfxT.png`:5981 bytes, SHA-256
  `66822a6c3b4a32297789da18af18e3ec1041458a339872d5536858e316c5c839`.

Cleanup restored the original Scene/view, deleted only the recorded disposable
Scene after exact Restore, and verified the original complete Scene source
unchanged:47 Drawings,0 Tiles,no journal. Test globals/hooks were removed.
Gamemaster's page was reconnected after cleanup. No runtime fix was needed.
This passes the tested disconnected-owner, cancellation, reconnect-before-transfer
and hidden-original-write interruption cases; it is not a distributed-lock claim
or blanket interruption certification.

**Native-write/reload acceptance (2026-10-08):** Reloaded both deployed browser
pages first; shared authentication loaded both as Gamemaster, so the second
page was a read-only same-account witness, not another independent GM identity.
Created only disposable Scene `A96b0BVzSsR38S6O`, two native Drawing fixtures
`jIQxlJpz5VFoqypg` and `hSSw0EGQ83xubzVp`, and operation
`BoundaryQh2h4UzLM7G3Bfwq`.

Used temporary document hooks scoped to this Scene and optimization token to
abort the operation signal immediately after successful native writes, before
journal advancement. Each hook was removed in finally; each interruption raised
`InterruptedOptimizationError`. Reloaded the executing page after each stop,
confirmed its test global was absent, reimported deployed services, and explicitly
reviewed/resumed from the existing durable journal/files. No test replaced or
weakened the native/output/execution verification guards.

| Interrupted native write | Durable journal phase retained | Actual document state | Reload/resume result |
|---|---|---|---|
| Apply creates hidden Tile | `assets-verified` | Two exact originals and one hidden Tile | Reused Tile `D1Zjly4YfAy98IaK`; did not duplicate it |
| Apply deletes source Drawings | `replacement-staged` | No originals; same hidden Tile remains | Reconciled already-removed sources, completed apply with the same visible Tile |
| Restore deletes replacement Tile | `originals-staged` | No Tile; two archived originals remain hidden | Reconciled already-removed replacement, exposed originals, completed Restore |

Restore token was `DO1ppC4NIFaFeC6N`. Final journal contained exactly one
completed apply and its completed Restore. The read-only witness independently
compared both full restored Drawing sources to its pre-deletion originals and
found exact equality. Developer review callbacks approved only the explicit
fixture scope, uncropped render and expected source IDs; this is service/native
recovery acceptance, not a manual review-dialog or player-appearance test.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
- `recovery-BoundaryQh2h4UzLM7G3Bfwq.json`:3381 bytes, SHA-256
  `0df119f6452e28a81679e162bf49a83f376859ff06defc15f144b38061eb64c4`.
- `bake-BoundaryQh2h4UzLM7G3Bfwq.png`:5981 bytes, SHA-256
  `66822a6c3b4a32297789da18af18e3ec1041458a339872d5536858e316c5c839`.

Cleanup restored the original Scene view, deleted only the recorded disposable
Scene after exact Restore, and verified the original complete source unchanged:
47 Drawings,0 Tiles,no journal. Test globals/hooks were removed. No runtime
fix was needed. These cases exercise actual persisted native writes followed by
graceful signal interruption and subsequent browser reload, not an abrupt browser
crash mid-request, a failed/partial native batch, or final visibility-write
interruption. Those distinctions remain explicit acceptance gaps.

**Final visibility-write/reload acceptance (2026-10-08):** Reloaded both deployed
clients first; both loaded Gamemaster through shared authentication. The second
client remained a read-only witness, not independent GM authority. Created only
Scene `gO8Kh00hTFErwYeu` and two native Drawing fixtures
`760PFuHKp4eWpZLZ` / `sRSlKRmZqxhreOZg`. Public reviewed Bake operation
`ExposureOpn8NsH100a8UL87` used explicit fixture review callbacks and normal
durable/native/output checks.

- A fixture/token-scoped `updateTile` hook aborted immediately after native
  `hidden:false` exposure. Executor raised `InterruptedOptimizationError`;
  journal retained `sources-removed`, originals were absent, and exact Tile
  `tqfIZQsLab8SJjgy` was already visible. Removed the hook in finally. Verified
  retained archive originals against the full pre-Bake sources before reload.
  Reload cleared the executing client's test state. Public resume re-read
  durable files and native state, retained the same visible Tile, and completed
  apply without duplicate creation or exposure regression.
- Restore token `1AoVJSEIY2EJ594c` used a scoped `updateDrawing` hook to abort
  immediately after original exposure. Both originals became visible before the
  final journal advancement; executor raised `InterruptedOptimizationError`,
  journal retained `replacement-reverted`, and no Tile remained. Hook removal
  was confirmed. The witness compared full originals to the verified archive
  and found them exact before reload. After reload, public resume reconciled the
  already-restored state and completed Restore without duplicate originals.

The final journal contained exactly one completed apply and completed Restore.
The second client independently verified exact full original Drawing sources;
its reference came from the verified archive, which the executing client had
already compared to pre-Bake sources. Tests cover persisted visibility updates
followed by graceful signal interruption and subsequent reload, not abrupt
process termination within a pending network request or partial batch failure.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
- `recovery-ExposureOpn8NsH100a8UL87.json`:3381 bytes, SHA-256
  `03b49a0876381bbda50e444026fc4df93aea3fb4de6b2c7cd0687319a330d716`.
- `bake-ExposureOpn8NsH100a8UL87.png`:5981 bytes, SHA-256
  `66822a6c3b4a32297789da18af18e3ec1041458a339872d5536858e316c5c839`.

Cleanup restored the original view, deleted only this disposable Scene after
exact Restore, removed test globals/hooks, and verified the original complete
Scene source unchanged:47 Drawings,0 Tiles,no optimization journal. No runtime
fix was needed; production controls remain unregistered.

**Live ordinary-player audience/admission acceptance (2026-10-08):** Reloaded
both deployed clients first. The owner logged the second client in as Aroh
(ordinary player role 1), leaving the initialized Gamemaster client connected.
No user permissions or existing Scene data were changed.

Shared HTTP authentication differs from the established game-socket identity:
the player login changed the upload session too. The first GM-client attempt,
`PlayerGMF5wqlaFp6MZjoq3g` in disposable Scene `j7IwJovNmluT9mwh`, received
Foundry's player upload-permission refusal and surfaced `UnverifiedFileError`.
Its journal remained at `intent`, both original Drawings were exact and no Tile
was created. Disconnected the original GM client by returning it to Join; the
owner logged it back in as Gamemaster while leaving Aroh connected. An unused
third join window was parked without changing accounts. Later native FilePicker
browse confirmed no files for the failed token. Deleted that disposable Scene
only after checking intact originals; this was fixture cleanup, not a claim of
successful recovery from missing files.

The replacement fixture, Scene `pULSED0oPGASZYv9`, contained two opaque colored
rectangles. Only this disposable Scene had default observer ownership and
`tokenVision:false` / `fogExploration:false` for an unobscured audience test.
Both clients viewed it without activating it for other users. Public reviewed
Bake/Restore services used explicit fixture callbacks, real immutable files,
and ordinary placement/native/output verification.

- GM-only operation `AudienceGM7NPiBSoAUHLCBl4I` completed with hidden native
  Tile `7r08ACSkudSlhPKh`. On Aroh, native `isVisible` was false and the settled
  mesh was invisible. Removing that mesh locally changed **0 framebuffer
  pixels**; repeated reads and restoration also changed 0 pixels.
- Restore `K7RWIdu9IBBtfpaw` completed and recovered both full Drawing sources
  exactly before the next Bake.
- Player-audience operation `AudiencePlayerFaszGgnJx7meUkJ8` completed with
  visible native Tile `wHjqxjl7vmeCZuob`. On Aroh, `isVisible` and mesh visibility
  were true. Local mesh suppression changed **21690 of 1168695 framebuffer
  pixels** (maximum channel delta 102); repeated reads and reinstating the mesh
  changed 0 pixels. This proves actual native Tile contribution to the player's
  displayed canvas, not pixel equality to original vector artwork.
- Player calls to public Bake and Restore rejected the designated-GM context.
  On the unfinished failed-upload fixture, public resume and takeover also
  rejected authority before evidence reads or writes. Full Scene sources were
  unchanged by those calls. Layer-panel embedded context rejected with the
  localized GM-only error. The live player control registry contained tokens,
  regions and notes only; no Foundryshop management/Bake/recovery tools appeared.
- Final Restore `tsou7vSrZM2DA5ci` completed. Gamemaster compared full sources
  to its pre-Bake baseline, and Aroh independently compared them to its retained
  originals: exact, two Drawings and no Tile. The journal had two completed
  apply/restore pairs.

**Rendering-method limitation:** the integrated Aroh tab suspended animation
frames, leaving native Tile refresh flags queued after document synchronization.
An initial unsatisfied animation-frame wait was discarded at cleanup. Used
native `applyRenderFlags()` to flush the queued Tile work, then the ordinary
canvas render and framebuffer extractor for measurements. Before that flush,
mesh state was stale despite the native visibility getter; those preliminary
pixels are not acceptance evidence. No document or visibility getter was
modified to produce the accepted result. This verifies settled native rendering,
not automatic refresh timing, foreground browser behavior, vision/fog, token
stacking, occlusion, lighting/weather or color fidelity.

Retained two immutable pairs under `worlds/melody-of-the-weirding-mover/assets`:
- `recovery-AudienceGM7NPiBSoAUHLCBl4I.json`:3383 bytes, SHA-256
  `fbedfcfaadfa647d01a0bf05d101ad9f07f6e89155c31becef4aaaa1384092d4`.
- `bake-AudienceGM7NPiBSoAUHLCBl4I.png`:978 bytes, SHA-256
  `d424663a3c17086cfa60d38bc7b207863d7b41e5575581325d16c1db0edd2207`.
- `recovery-AudiencePlayerFaszGgnJx7meUkJ8.json`:3400 bytes, SHA-256
  `f946a4b3f8a0188d2e451a14d9aa8daf6f8281c80d955ca8e668b603c7da8edb`.
- `bake-AudiencePlayerFaszGgnJx7meUkJ8.png`:978 bytes, same PNG SHA-256.

Restored both original views and verified the original complete Scene source
unchanged:47 Drawings,0 Tiles,no optimization journal. Deleted only the two
recorded disposable Scenes, removed test globals and returned the player tab
to Join to destroy the suspended evaluation context. Gamemaster remains on the
original Scene. No runtime fix or production control registration was needed.

**Native token stacking / no-vision player acceptance (2026-10-08):** Reloaded
the executing client first; it returned to Join and the owner logged Gamemaster
back in. Prepared all files before the owner logged Aroh into the second window,
avoiding the previously observed shared-session upload refusal. Created only
disposable Scene `Ezfh4vH5wFU2qph9`, one opaque red Drawing and native Token
`YcChEyQXE8Lm75Er` using Foundry's built-in mystery-man SVG. No Actor was created
or modified. The fixture Token had no Actor and no enabled sight. D35E's native
createToken hook logged an unrelated missing-Actor `conditions` error; the Token
persisted, its native mesh/texture was valid, and the tests below inspected its
actual rendered state rather than treating the hook as successful.

Public reviewed player-audience Bake `TokenStack87HoyXDGJXfESvUf` completed with
Tile `BMzXaVgz1qgWFriA`, using explicit fixture review callbacks and the ordinary
durable/native/output checks. Both Token and Tile were at elevation 0, sort 0.
Native primary sort layers were 700 for the Token and 500 for the Tile. The Tile
retained empty occlusion modes and disabled light/weather restrictions.

On Aroh's client, flushed queued native placeable render flags before rendering.
Captured four native framebuffer states in the Token's 100 x 100 screen crop:
both meshes, Tile only, Token only and neither. Suppressed only local mesh
visibility, restored it in finally and did not write document visibility.

- Repeated both-mesh reads and final restoration differed by 0 pixels.
- Token contribution changed 4434 pixels; Tile contribution changed 7779.
- 4330 pixels had contributions from both isolated references. At 2221 of those,
  the combined image exactly matched the Token-only reference (opaque Token
  wins); none matched the Tile-only reference. Partially transparent Token
  pixels legitimately blend with the Tile and are not counted as opaque wins.
  This verifies same-elevation native Token-over-Tile stacking for this fixture,
  not a claim covering other elevations, dynamic rings or token effects.

Enabled `tokenVision` only on this disposable Scene. Aroh had zero native vision
sources. The Tile's placeable/mesh remained eligible for drawing, but native
visibility compositing masked it: local mesh removal changed **0 framebuffer
pixels**, with stable repeated reads and exact restoration. Disabled token
vision again as a positive control; the Tile then contributed **59379 pixels**
and restoring its mesh again changed 0 pixels. Native placeable/perception
refresh flags were flushed before measurements; no visibility source, mask or
shader was overridden. This verifies the zero-vision masking boundary, not
actor-backed sight, wall blocking, fog exploration or ambient-light behavior.

The player-facing recovery file reader separately refused with its standard
GM-file-permission error; did not bypass that check. Gamemaster verified archive
originals against its pre-Bake baseline, then public Restore
`Ph8h31LzS7c4yMtu` completed. Full Drawing source and the fixture Token source
were exact. Aroh witnessed one Drawing, no Tile, one Token and both completed
journal phases; unlike the preceding audience run, this player did not perform
an independent full-source archive comparison.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
- `recovery-TokenStack87HoyXDGJXfESvUf.json`:2890 bytes, SHA-256
  `d45a67a9b0c492d836a394ef0394fee5a225288bd0a584d6210e1a5c68e04749`.
- `bake-TokenStack87HoyXDGJXfESvUf.png`:2108 bytes, SHA-256
  `5be317988bf384478732855739b7bc66e03efd3a66b8725498d7b08077930abe`.

Restored both original views, deleted only the recorded disposable Scene after
exact recovery, removed test globals, and verified the original complete Scene
source unchanged on both clients:47 Drawings,0 Tiles,no optimization journal.
Both Gamemaster and Aroh remain connected. No runtime fix was needed; production
controls remain unregistered.

**Actor-backed wall / static-light acceptance (2026-10-08):** Created only
disposable Scene `g00cDp05VYvet5Cf` with native Drawings `zgSBsV488mNlAUIT` and
`Z5pCVMSF6w0CaIQj`, full-height native wall `ZjFfcOyUR2i683Us` at x=320, and
linked Token `BGSbmSjGm8D8Ov9C` referencing Aroh's assigned Actor. Gamemaster
prepared real player-audience Bake `VisionWallYHJpg9fphA3SNlvt` before further
player testing; resulting Tile was `ZlC7n3jkJfx0zdGP`. Aroh controlled the owned
Token and had one active native vision source. D35E's vision automation normalized
the Token's requested range to the Actor's native basic vision configuration;
acceptance used the actual source, not the requested range.

With global light enabled and darkness 0, native visibility tests returned true
for the near/left patch and false for the far/right patch. Local Tile mesh
suppression changed all 10000 pixels of the near 100 x 100 sample and none of
the far sample. Setting only the disposable wall's sight/light restrictions to
0 was a positive control: both patches became visible and both contributed
10000 pixels. Repeated reads and local mesh reinstatement differed by 0 pixels.
Restored the wall's normal sight/light restrictions before lighting tests.

Disabled global light and set disposable Scene darkness to 1. Both visibility
tests were false, but faint artwork still contributed pixels. Did not treat
that as either proof of a Bake visibility leak or proof of fully hidden ink.
Added native ambient light `QRlHv6WPXK5WcRem` at (150,240), bright radius 20
Scene distance units, no animation/color, wall blocking enabled, vision granting
disabled. Sampled colors were uniform throughout each 100 x 100 patch:

| Player sample | Darkness, light hidden | Ambient light enabled |
|---|---|---|
| Near red patch | RGB (19,4,4), visibility false | RGB (204,41,41), visibility true |
| Far blue patch | RGB (4,12,19), visibility false | RGB (4,12,19), visibility false |

Hiding the light recovered the exact dark sample colors. Public Restore
`H21CxMaaQdztKMFZ` recovered both full original Drawing sources exactly, compared
by native identity (archive order differs from original collection order).
On the player, flushed restored Drawing flags and measured the same patches:
native Drawings matched the baked samples exactly in both dark and lit states.
Thus the faint dark samples also occur with native originals in this deployed
Foundry/system setup; this is not a Bake-specific difference in these samples.
The Token source was unchanged across Restore. Native placeable/perception
flags were flushed before rendering as in prior acceptance; no mask, shader,
vision source or visibility result was overridden. This verifies opaque
interior patch behavior, not whole-image fidelity or automatic refresh timing.

**Linked-Actor fixture side effect:** D35E's installed createToken hook calls
`actor.refresh()` on the creating client. For a linked Token, that invokes an
empty Actor update which recalculates and persists equipment-derived values on
the world Actor. The retained pre-fixture baseline showed 158 leaf changes
including modification time: the already-equipped +3 crown was applied to all
abilities, derived statistics recalculated, and D35E adjusted current HP/wounds
with their changed maxima. Base abilities, items, effects, ownership, flags and
prototype Token remained unchanged. Persisted nonlethal maximum was stale
while prepared runtime maximum was correct. Paused testing, traced the installed
system code and reported this before proceeding. The owner explicitly directed
leaving this minor system issue alone and continuing. No Actor rollback or
system code change was made. The original claim that referencing an existing
linked Actor would leave it untouched was incorrect; future actor-backed
fixtures should use a disposable Actor rather than a production linked Actor.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
- `recovery-VisionWallYHJpg9fphA3SNlvt.json`:3386 bytes, SHA-256
  `5596a0cf70e7dc9907de20b759a0cf7d9dc7424bf6e7adcb47ba21736db3e89c`.
- `bake-VisionWallYHJpg9fphA3SNlvt.png`:1932 bytes, SHA-256
  `27027418161101fb2da8b533adf2c10a171d2f75dc6280c69928d947d5d3a2ac`.

Restored both original views, deleted only the recorded disposable Scene after
exact Restore (including its fixture Token, wall and light), removed test
globals, and verified the original complete Scene unchanged on both clients:
47 Drawings,0 Tiles,no optimization journal. Both clients remain connected.
No module runtime fix was needed; production controls remain unregistered.
Weather, animated/colored/negative lights, fog persistence, other vision modes
and diverse geometry/elevations remain separate gates.

**Native rain presentation acceptance (2026-10-08):** Used the existing deployed
Gamemaster and Aroh clients without reloading or changing authentication. Created
only Scene `CN2lUsbzx8FT0RHD`, with one opaque red native Drawing, no Tokens or
Actors, token vision disabled and native weather `rain`. Public reviewed Bake
`WeatherCH2jS817zlZwqcFq` completed with Tile `vfpg5YI7E43g3Yt1` and ordinary
durable/native/output checks. Aroh viewed the fixture; native RainShader was
visible, occlusion enabled with weights (0,0,1,0), and the Tile mesh retained
`restrictsWeather:false`.

Measured an interior 440 x 320 player framebuffer crop at resolution/zoom 1.
Before each synchronous render, set the native rain shader time to 12; its
ordinary pre-render time increment still ran. Saved/restored the previous time
and local visibility values; no shader implementation or mask was replaced.
Rain changed **10451 of 140800 pixels**, maximum channel delta 4. Repeated
rain-on reads and local visibility reinstatement changed 0 pixels. Native
placeable flags were flushed before measurements. This is a controlled native
rain frame, not natural animation-rate/foreground timing acceptance.

An initial depth-texture readback showed no weather-channel change when the
Tile mesh was suppressed. However, locally enabling its weather restriction
as a positive control also produced no channel change, even after requesting
depth-buffer redraw. Restored that local property in finally. The probe was
therefore **inconclusive**, not evidence certifying weather-mask/roof behavior;
do not infer correct restriction handling from its unchanged buffer.

Retained rain-on and rain-off crop bytes before Restore. Gamemaster verified
archive originals against the pre-Bake source by identity, then public Restore
`TNhuYCCQ4lE1YGLV` recovered the complete original Drawing source exactly.
Aroh flushed the restored Drawing's flags and captured the same fixed-time
native rain frame: both rain-on and rain-off samples matched the baked samples
with **0 differing pixels**. Native Drawings also had 10451 rain-contribution
pixels. This directly verifies rain presentation equivalence over the opaque
interior fixture without relying on the inconclusive mask readback.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
- `recovery-WeatherCH2jS817zlZwqcFq.json`:2872 bytes, SHA-256
  `747fb533627e340126ab000129afaea478a13188ecea7c81ab1c9f0c44b13637`.
- `bake-WeatherCH2jS817zlZwqcFq.png`:4783 bytes, SHA-256
  `20880fc1b0d9bd99451e06158df1ad350ff757c61c34b91d807d4665be5321aa`.

Restored both original views, deleted only the recorded disposable Scene after
exact recovery, removed test globals and verified the original complete Scene
unchanged on both clients:47 Drawings,0 Tiles,no optimization journal. No Actor
was referenced or changed by this fixture. No runtime fix was needed.
Other weather types, roof/weather-mask restrictions, natural animation timing
and transparent/edge artwork remain unverified; production controls stay
unregistered.

**Native selection / options keyboard acceptance (2026-10-08):** On the existing
deployed Gamemaster client, created only disposable Scene `IvIwIehswp3bmcLr`
with Drawings `GNMwkRg4iE4CoZvh` and `NUtfB3ABZ83RPA5l`. Activated native
Drawing select mode. Public Bake entry used its default
`canvas.drawings.controlled` reader, not injected selection IDs. An explicit
fixture scope callback retained the manifest and cancelled before scope
approval, rendering, uploads or durable intent creation.

- One controlled Drawing followed by real Enter from the sort input produced
  exactly its one-ID player-audience manifest.
- Two controlled Drawings followed by Space on the focused approval button
  produced exactly the two-ID player-audience manifest.
- Actual canvas pointer click selected the first Drawing; Shift-click added
  the second. Enter in the real options dialog produced exactly both IDs with
  GM audience. No synthetic control list or DOM-submit event replaced these
  native pointer/keyboard interactions.
- Fractional sort 0.5 plus Enter left options open and approval enabled, with
  the localized validation warning. Correcting sort to 0 and pressing Enter
  returned valid options.
- Releasing one native controlled Drawing while the review was open caused
  post-approval `OptionsStale` rejection instead of using a changed selection.
- Empty controlled selection plus Enter remained blocked and editable.
- Escape from a focused sort input cancelled with `BakeReviewCancelledError`,
  including after invalid empty-selection submission.

The initial entry attempt omitted an explicit recovery root and correctly
refused the empty configured storage folder before scope preparation; repeated
the scope checks with the approved existing world assets root. No setting was
changed. Full disposable Scene source after all tests exactly matched the
post-creation baseline: no uploads, Tiles or journal. Restored the original view
and Token controls, deleted only this fixture, removed test globals and verified
the original complete Scene unchanged:47 Drawings,0 Tiles,no journal. The player
client stayed on the original Scene. No runtime fix was needed. This establishes
desktop options keyboard and default native selection wiring, not physical
tablet/pen/touch acceptance or keyboard behavior of every later destructive
review dialog. Production controls remain unregistered.

**Live injected partial-batch recovery acceptance (2026-10-08):** Created only
disposable Scene `Qs66DG6Ix9L0NkeY` with three opaque rectangular Drawings.
Public Tile Bake apply token `PartialBatchW8QX8IwSjv0f1k4z` and public Restore
token `a08bm7MpchTwuo1k` used explicit test review callbacks returning the
ordinary approval shapes. Real rendering, native acceptance, verified storage,
execution review, journal and public resume remained in use. This was executor
acceptance, not a repeat of review-dialog interaction acceptance.

Fault injection was confined to an own method on this disposable Scene instance.
At each targeted optimization token/type, the wrapper called the real native
embedded-document method with only the first item of the expected three-item
batch, awaited persistence, then threw a clearly marked test error. All other
calls passed through unchanged; `finally` removed the own method. No global
prototype, installed system code, permissions or production code was changed.
Reload after each interruption discarded the executor/approval objects;
session storage retained only fixture identities, comparison baselines and test
evidence, not a saved workflow or substitute recovery archive.

| Injected subset write | Durable state before reload | Public resume result |
| --- | --- | --- |
| Apply deletes one original | `InterruptedOptimizationError`, `replacement-staged`; two originals remain and one replacement Tile is hidden | Review reports one missing and two present IDs; deletes only remaining originals, exposes the same single Tile and completes |
| Restore recreates one hidden original | `InterruptedOptimizationError`, `assets-verified`; one original staged, two missing, replacement still present | Review reports one staged and two missing IDs; recreates remaining originals before removing replacement |
| Restore exposes one original | `InterruptedOptimizationError`, `replacement-reverted`; all three originals exist, two still hidden, replacement absent | Review reports one exact original and two staged IDs; publishes remaining hidden states and completes |

Added later Drawing `tYP1lni1sDt4wGMa` after the first interruption and before
reload. Its complete source remained exact through apply resume and both Restore
interruptions. Final public resume completed both journal entries; all three
original full sources matched their fixture baselines and the independently
reread verified archive by identity. No duplicate IDs or Tiles remained.
Restored the original view and Token controls, verified its full Scene source
unchanged, deleted only the disposable Scene and cleared test globals/session
storage. Aroh stayed on the original Scene and independently saw fixture removal:
47 Drawings,0 Tiles,no journal. No runtime fix was needed.

Two preliminary preparation attempts failed closed before persistence: explicit
selection scope requires a supplied live reader when audience/sort skip the
options prompt; the initial fixture omitted optional name/text values and their
native source contained `undefined`, which exact-JSON recovery correctly refused.
Supplied the real controlled-selection reader and explicit fixture name/text,
then captured new source baselines before the successful workflow. No lossy
source normalization was introduced.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
`recovery-PartialBatchW8QX8IwSjv0f1k4z.json` (3950 bytes, SHA-256
`ebc0df699952f742f462a6982225396d545831af59bedcff1a2b346ba8390888`) and
`bake-PartialBatchW8QX8IwSjv0f1k4z.png` (1630 bytes, SHA-256
`b2ac83d33194bc25d42f040640f6bec653727af8cdccd5e2727abb822e6bae90`).
These tests establish reconciliation of genuinely persisted subsets under
controlled injection. They do not demonstrate a server-generated partial batch,
network-response loss, crash during an outstanding native request or process
termination before its outcome is known.

**Live withheld-completion / pending-caller reload acceptance (2026-10-08):**
Created only disposable Scene `LW2X51HqnUbpns1O`, with three explicitly named
opaque rectangles and exact source baselines. Apply token
`PendingReplykF4kG4uhuTVCB8EC`, Restore token `QKvipKQ7Dlp0olwA`, and replacement
Tile `BLUKikLe5ncwCDm6` used the ordinary public Bake/Restore/resume workflows
with explicit test approval callbacks, real rendering, native acceptance,
verified archive/output reads and durable journals.

For each transition below, wrapped only the matching disposable Scene instance
method and optimization token/type. The wrapper awaited the complete real native
batch, removed its own method override, recorded the resulting native state and
journal phase, then returned a never-resolving Promise. Verified the workflow
caller remained unsettled before reloading. No graceful cancellation, exception,
abort hook or executor cleanup ran to produce the persisted state. Reload
discarded the waiting workflow and its approval objects; session storage retained
only test identities/baselines/evidence. Fresh public resume reread durable
recovery evidence and reviewed the current native state.

| Persisted write with completion withheld | Journal still at | Native state retained across reload |
| --- | --- | --- |
| Create hidden Tile | Apply `assets-verified` | Three originals and exactly one hidden replacement |
| Delete originals | Apply `replacement-staged` | Originals absent; same hidden replacement and later artwork remain |
| Expose Tile | Apply `sources-removed` | Same single replacement visible; originals absent |
| Recreate hidden originals | Restore `assets-verified` | All three originals hidden; visible replacement remains |
| Delete replacement | Restore `originals-staged` | Replacement absent; all three originals still hidden |
| Expose originals | Restore `replacement-reverted` | Replacement absent; all original hidden states restored |

All six states were explicitly verified before and after reload. Aroh's
independent initialized client also confirmed the first hidden Tile creation and
`assets-verified` journal while the GM workflow caller was still unresolved.
Public apply resume completed the same replacement identity without duplicates;
Restore resume completed the same original identities without duplicates.
Added a later unrelated Drawing after the first reload. Final complete sources
matched both original fixture baselines and independently reread verified archive
sources by identity; later artwork remained exact. Both journal entries completed.
Restored original view and Token controls, verified its complete Scene unchanged,
deleted only the fixture, and removed test globals/session storage. Aroh remained
on the original Scene and confirmed fixture removal:47 Drawings,0 Tiles,no journal.
No runtime fix was needed.

Retained one immutable pair under `worlds/melody-of-the-weirding-mover/assets`:
`recovery-PendingReplykF4kG4uhuTVCB8EC.json` (3941 bytes, SHA-256
`ddadf18b1f841588754a8194bdff1ca5a3474dae368349e331a4879252ac3f4b`) and
`bake-PendingReplykF4kG4uhuTVCB8EC.png` (1630 bytes, SHA-256
`af60ae4e386c0bc21305bb7a1358028e53061d30c376974e3798cffdbfc8de3a`).
This verifies interruption while the module awaits a simulated lost completion,
after the native request has actually resolved to the wrapper. It does not
certify real socket-response loss, a request whose server outcome is still
unknown, renderer-process termination, Foundry-server crash or restart.

**Owner acceptance amendment (2026-10-08):** The owner explicitly deferred actual
network interruption and process-crash scenarios to field testing. Do not
simulate further outages/crashes or treat those unperformed cases as release
blockers. Retain the precise limitations above: controlled partial writes and
withheld completions passed; real unknown-outcome network/process failures are
not certified. Designated-active-GM-only authority remains unchanged, with no
distributed-lock/CAS claim.

**Reviewed Level-background workflow integration (2026-10-08):** Added
`prepareReviewedBackgroundBake` beside the existing Tile preparation service,
sharing scope, renderer, placement, byte intents, persistence approval and
execution rather than adding another rasterizer. Public background-only
apply/resume/Restore/disconnected-owner takeover commands share the existing
entry implementation, review lease and conflict monitor; Tile commands still
reject background operations and vice versa. Selection defaults to the native
controlled Drawing reader even when explicit audience/sort bypass options.

Background preparation requires public audience, full Scene bounds, identity
shared Level transforms and no Tile identity/sort. Existing background image
resources retain exact original bytes for backup, are composited before ink,
and release their decoded bitmap after rendering. The verified original backup
path is included in exact persistence approval together with the archive/output;
color-only backgrounds need only the latter two. Detached native schema,
placement/audience and isolated full-resolution GPU acceptance are mandatory.
Localized scope/placement dialogs disclose replacing the Level background and
moving ink below Tiles. No production command is registered.

Public Restore verifies original background URL bytes against the retained
immutable descriptor before intent creation and before native background
reversion. If the URL is missing or changed, refuse and retain recovery evidence
instead of reverting to different pixels; manually recover that original file
from its immutable backup before retry. External originals require renewed
explicit external-resource acknowledgement. Restore does not depend on GPU
display acceptance. Resume and disconnected-owner takeover support the same
typed background archives, original-byte verification and strict native context.

213 targeted tests pass across the connected workflow, public entry/recovery,
GPU adapter, dialogs, renderer/resources, storage, replacement construction,
scope, placement, native schema and execution review. New tests cover
color-only/full-Scene apply, retained-image composition and backup-path approval,
exact native Restore with later artwork, original URL changes before intent and
after execution review, lost background-update response and disconnected-owner
takeover. Transparent Tile behavior is regression-tested through the shared
pipeline. Test browser/native/storage APIs are mocked; this does not establish
live Level-background fidelity. Live acceptance of the newly deployed code is
next, followed by Consolidate integration and portable recovery-bearing exchange.

**Live color-only background acceptance / redraw correction (2026-10-08):**
On the deployed code created only disposable Scene `c8Khc7KMcHtX2NXK`,640x480,
gridless, global light enabled, token vision disabled, and two visible opaque
red/blue rectangular Drawings at Level ground elevation. Level background
color `#335544`, no original image. Public background apply used token
`BackgroundColorad0gYeFcgnIuGmgY` with default native controlled-selection
reader, exact test approval callbacks and real rendering/storage/native/GPU
acceptance. Full-Scene PNG and verified recovery archive persisted.

Foundry's native Scene `#handleDescendantLevelChanges` invokes `canvas.draw()`
without awaiting it when a visible Level's background/textures change.
This temporarily clears `canvas.ready` and the controlled Drawing set. The
workflow correctly refused subsequent work after the background update, retaining
both originals at `assets-verified`; once canvas readiness returned, fresh public
resume reviewed the exact after-background state and completed source removal.
Restore similarly stopped after background reversion at `originals-staged`.
Fresh public resume then exposed all original hidden states and completed.
No rollback, overwritten sources or manual journal/permission changes were used.

Aroh viewed the fixture after completed Bake. Three20x20 player-framebuffer
patches centered at Scene coordinates(160,160),(400,260),(560,400) sampled
RGBA(221,51,51,255),(51,51,221,255),(51,85,68,255). After exact Restore those
patches had zero differing bytes. First restored sampling still showed staged
hidden presentation in this nonvisible browser tab; flushing each native Drawing
render flag before sampling produced the exact comparison. As with prior
acceptance, automatic hidden-tab refresh timing is not certified.

Complete restored Drawing sources matched both fixture baselines and an
independently reread verified archive by identity. Complete Level settings matched
the pre-Bake native source. Later Drawing `lfPfefIk6QAaEa3V` remained exact.
Returned both clients to their original views, restored GM Token controls,
verified the original complete Scene unchanged (47 Drawings,0 Tiles,no journal),
deleted only this disposable Scene and removed test globals. Retained:
`recovery-BackgroundColorad0gYeFcgnIuGmgY.json` (3286 bytes, SHA-256
`14804ce89230d9cc9eed8e990a46d0d71ccb3b20f92a82ddee80f5f0a143d09f`)
and `bake-BackgroundColorad0gYeFcgnIuGmgY.png` (8044 bytes, SHA-256
`49dd98103484e42c58c520feecf02b8f386d6583eaeabf135168c47f43420483`)
under the approved world assets recovery folder.

Corrected the executor to settle only its own native background update before
continuing, checking authority, exact journal/native state and Scene identity
during the readiness wait, with explicit timeout/cancellation failure. Execution
approval reconciles the expected empty or unchanged native selection after that
owned redraw, revalidating all other reviewed context; arbitrary selection
changes still invalidate approval. New regression cases model delayed redraw on
both apply and Restore, timeout, unrelated edits, unexpected selections,
cancellation and designated-GM changes. All217 targeted Bake/rendering/storage/
recovery regression tests pass, with no editor diagnostics. This fix is not yet deployed/live
certified. Existing-image-background tests were deferred until after redeployment
so the automatic redraw path can be validated rather than bypassed.

**Live uninterrupted background and immutable image-backup acceptance (2026-10-08):**
Reloaded both clients and verified the deployed executor contains the guarded
background-redraw helper. Shared HTTP authentication initially initialized both
tabs as Gamemaster; rejoined the second as Aroh before player sampling.

Disposable color-only Scene `zzaJS2rgJMXgiZGE`,640x480,gridless, background
`#335544`, held two opaque red/blue rectangular Drawings. Public selection Bake
`RedrawLivekMIa5aPXfkF6SUrb` and Restore `LbhthEnmGoAyN46B` used every real
localized review dialog, including exact persistence and native execution
approvals, with no substituted callbacks or native method wrappers. Both
completed uninterrupted through the background redraw, without reload/resume.
Drawing selection cleared as expected; source count became0 after Bake and3
after Restore. Complete original sources, complete Level settings and later
Drawing `ZXolyXRmghhOtakr` were exact. Deleted only this fixture.

Disposable image-background Scene `vghjEFxdGvgdLUZy`, also640x480/gridless,
used the retained color-case PNG as its existing static local background,
with native tint `#cccccc`, color `#335544` and identity shared transforms.
Added opaque green/yellow rectangular Drawings `zhBqfrN2ZopPHw1z` and
`MNfxq2rz5iXqTFdC`; global light enabled and token vision disabled.
Public selection Bake `ImageLiveYl23P8IfO7zOROSz` completed uninterrupted with
all six standard approvals. Persistence explicitly listed and approved the
archive, output and separate original-image backup. Independently fetched
original and backup were byte-for-byte identical (8038 bytes).

Aroh viewed the baked image and sampled five20x20 native player-framebuffer
patches at scale1, centered at Scene coordinates:

| Center | RGBA |
|---|---|
| (100,360), green ink | (51,221,51,255) |
| (550,100), yellow ink | (221,221,51,255) |
| (160,160), original tinted red | (177,41,41,255) |
| (400,260), original tinted blue | (41,41,177,255) |
| (560,400), original tinted background | (41,68,54,255) |

All baked patches were uniform. Aroh's direct apply/Restore/resume/takeover
entry attempts refused and left the complete Scene unchanged; resume/takeover
refused because this operation was already complete, so those attempts are not
additional unfinished-operation authorization evidence.

Added later Drawing `gfizSyRHb6Zr3Jt1`. Public Restore `a53yz1qPQgobjX5Z`
completed uninterrupted with all four standard approvals. Restored Drawings
matched complete baseline sources and an independently reread verified archive;
complete original Level settings and later artwork matched exactly. A hidden
player tab initially showed the native hidden-staging presentation. Making
Aroh's tab visible allowed native refresh; all five patches then matched Bake
with zero differing bytes, without manually flushing Drawing render flags.
The GM review-dialog animation also required making its tab visible. Automatic
hidden-tab animation/presentation timing remains uncertified; these samples do
not establish full-frame edge fidelity or diverse-artwork equivalence.

Returned both clients to `Welcome!`, restored Token controls, deleted only the
two disposable Scenes and removed test globals. The original complete Scene
was unchanged:47 Drawings,0 Tiles,no optimization journal. Retained under the
approved `worlds/melody-of-the-weirding-mover/assets` folder:

| File | Bytes | SHA-256 |
|---|---:|---|
| `recovery-RedrawLivekMIa5aPXfkF6SUrb.json` | 3273 | `9f7ffa19c4d32da261806bd08021835743974dc95db3bcf56e3ec0193c14af1f` |
| `bake-RedrawLivekMIa5aPXfkF6SUrb.png` | 8038 | `afa50ca6c611f00adeac731b91a51eeca354b66bf4ea3c5f4728aff0f2105467` |
| `recovery-ImageLiveYl23P8IfO7zOROSz.json` | 3807 | `2d65b2196e042a1c4caec9e4cdb3eb6d1c04cf811dd074737393637f0cba85aa` |
| `bake-ImageLiveYl23P8IfO7zOROSz.png` | 8090 | `2d5c0b0ec7e4085af24c166aa84b8526832645a6b7a51d3b7b6161cac47d774b` |
| `background-original-ImageLiveYl23P8IfO7zOROSz.png` | 8038 | `afa50ca6c611f00adeac731b91a51eeca354b66bf4ea3c5f4728aff0f2105467` |

No runtime correction was needed. This closes the uninterrupted background
and existing-image/backup gates above; Consolidate integration is next.

**Reviewed Consolidate workflow integration (2026-10-08):**
Added opt-in `prepareReviewedConsolidation` and public apply/resume/Restore/
disconnected-owner takeover commands alongside the existing Bake entries.
They share bounded transparent rendering, full-resolution isolated GPU
acceptance, exact native schema validation, immutable archive/output persistence,
conflict monitoring and durable partial-write reconciliation. No toolbar or
startup registration is enabled.

The first connected slice creates one editable image Drawing from Selected
Drawings or one leaf layer. It preserves the source membership (including
Unassigned), exact elevation and contiguous native stack run, using the existing
neutral full-image rectangle/image-stamp renderer. Layer player gating remains
on the retained membership; private layers are not made player-visible or
converted to native-hidden replacement Drawings. Image files remain
presentation assets, not secure secret storage. Original hidden/interface/locked sources
remain explicit exclusions. Mixed memberships/elevations, intervening artwork,
ambiguous sort ties and out-of-order managed layers refuse. The workflow does
not re-space unrelated sorts or merge disjoint runs. All/groups and custom
crop/sort are excluded from this slice, not silently interpreted as a leaf.

All six standard review surfaces remain mandatory. Consolidate scope/placement
disclosures explicitly distinguish retained Drawing ownership/stacking from
ground Bake. Rendering uses the complete conservative extent without custom
cropping. Durable archive/output approval precedes separate native execution;
hidden replacement staging and exact originals removal use the existing
resumable engine. Restore does not depend on GPU display acceptance and preserves
later independent artwork. Edited/deleted/reassigned composites fail closed;
there is no automatic overwrite or unreviewed conflict resolution.

Repeat consolidation and Tile/background Bake from a tracked image Drawing
automatically retain one immutable Drawing ancestor. Multiple composites refuse
until originals are expanded, avoiding a single-parent archive losing a branch.
Each retained Drawing ancestor must be an earlier completed same-Level apply in
the Scene journal, with exact verified archive/output bytes; chronological
ancestry bounds traversal and prevents cycles. Reverification occurs before
rendering and native transitions. Explicit Consolidate Restore can expand an
earlier completed apply after a newer generation has been restored, provided its
exact replacement remains, every operation is complete and no restore intent
already exists. Expansion remains one generation per reviewed operation.

Mocked integration covers native non-ground Drawing ownership, private leaf
membership, mixed-layer/stack-barrier/tie rejection, custom-option refusal,
stale selection, partial source deletion and original staging, exact Restore
with later artwork, edited-composite refusal, player refusal, disconnected-owner
takeover, repeat consolidation with successive expansion, missing ancestor
refusal before preparation and after execution approval, and Consolidate-to-Tile
lineage with both Restore stages. Isolated GPU and localized-dialog regressions
cover the new Drawing mapping/disclosures. Newly changed runtime files are not
yet deployed; live schema, Drawing/player presentation, layer gate and
uninterrupted apply/Restore acceptance are next.
All234 targeted rendering/storage/placement/recovery tests pass; editor
diagnostics, localization JSON and changed-file whitespace checks are clean.

**Live public-selection Consolidate / exact Restore acceptance (2026-10-08):**
Verified deployed public Consolidate APIs on the ready Gamemaster client.
Created only disposable Scene `OpXJXcpDcD0tqqn0`,640x480/gridless, global light
enabled, token vision disabled and color background `#335544`. One public leaf
`acceptanceInk` held opaque red rectangle `O1PXYXq7HFvP3h6o` and translucent
blue rectangle `VgnJAsBeIyKD1XAv`, at elevation5 and native sorts1024/2048.
Captured complete original Scene, Drawing, Level and layer-tree sources.

Public selection Consolidate `ConsolidateLive81f3IYorpTzByy6t` used the default
native controlled-selection reader, all six real standard dialogs and real
rendering/storage/native/full-resolution GPU acceptance. No test approval
callbacks or native method wrappers were substituted. Completed uninterrupted,
replacing the two originals with editable image Drawing `YH7cxJ1UVRANfPhw`,
280x280 at(100,100), elevation5, sort1024 and the same leaf membership.
The Drawing was visible/unlocked and used neutral image-stamp mapping. No Tile
or Level changes occurred; complete Level and layer-tree sources stayed exact.

At Scene zoom1, four20x20 native framebuffer patches centered at(160,160),
(240,240),(330,330),(560,400) sampled RGBA(221,51,51,255),
(137,52,137,255),(52,69,145,255),(51,85,68,255). GM original and composite
patches had zero differing bytes, including the translucent overlap. Opened
one second client and had the owner log Aroh in; initial texture presentation
was not yet refreshed, then normal visible-tab native refresh produced the
same four composite samples. Aroh's direct public apply and Restore attempts
refused on active-GM authority with the complete fixture Scene unchanged.

Added later independent green Drawing `QcRN0nxejnzT2enq` at sort3072.
Public Restore `3ez41vC3OLPCESoA` completed uninterrupted with all four standard
approvals. Restored originals matched their complete baseline sources and an
independently reread verified archive; the later Drawing, complete Level and
complete layer tree matched exactly. Composite was absent and source count3.
GM original/composite/restored patches and Aroh composite/restored patches all
had zero differing bytes after native visible-tab refresh. No manual Drawing
render-flag flushing or source normalization was used.

Returned both clients to the original Scene and Token controls, deleted only
the fixture and removed test globals. Original complete Scene unchanged:
47 Drawings,0 Tiles,no optimization journal. Retained under the approved world
assets recovery folder:

| File | Bytes | SHA-256 |
|---|---:|---|
| `recovery-ConsolidateLive81f3IYorpTzByy6t.json` | 3871 | `5b81acaa91e1b80dcc50397478278cb656604c5bce9f87618e506c204fec2b2a` |
| `bake-ConsolidateLive81f3IYorpTzByy6t.png` | 2709 | `71f6e9de7132af3a9a877a77659beee1cdf2e031b61dc7638e7daf835f4508db` |

The placement dialog incorrectly reused "Ground elevation" for the retained
Drawing elevation5. Corrected that localized label and added a regression;
no native placement/recovery correction was needed. This label-only change
needs deployment. Samples do not certify full-frame edge fidelity, arbitrary
artwork, repeat-consolidation/Tile lineage,
keyboard or hardware acceptance. Those remain distinct follow-ups.

**Live private leaf-layer Consolidate / presentation / exact Restore (2026-10-08):**
Created only disposable fixtures using the existing GM-private leaf `privateInk`,
elevation5, native sorts1024/2048 and two opaque red/blue rectangles. The initial
attempt on `9DPSofyFS8rkxglP` failed explicitly at journal intent because Aroh's
login had replaced the browser's shared HTTP upload cookie. Both originals stayed
exact; no replacement or native deletion occurred. Deleted only that fixture.
After Aroh was fully connected, the owner rejoined Gamemaster last to restore
upload authority without rejoining/reloading the player during file persistence.

On `KcXZosPlPbwqNTaO`, public leaf-layer Consolidate
`PrivateConsolidateXq3jOq9W4VGFLYyd` completed all six real standard approvals,
including real rendering, verified persistence and native execution. Composite
`nUcV4eK3ec7YKj7p` retained membership, elevation5, sort1024, unlocked state and
`hidden:false`; GM-only presentation remained a layer gate, not native hiding or
secure asset storage. Aroh's two uniform20x20 patches at(160,160),(400,260) showed
only RGBA(51,85,68,255). The standard manager player-presentation API enabled the
gate, revealing RGBA(221,51,51,255) and(51,51,221,255) on the visible player tab.
Disabling the gate again concealed both patches to the same background. The
complete composite source remained unchanged.

**Observed recovery limitation, not a passed combined toggle/Restore gate:**
those two intentional presentation edits advanced the tree revision from0 to2.
Restore refused with `Scene dimensions/grid or layer context changed` before any
restore intent. Journal still contained only the complete apply and composite
source stayed exact. Current recovery compares the entire archived tree,
including revision; restoring a gate's semantic value does not restore that
context. No revision reset, archive edit or validator bypass was used. A
reviewed policy for recovery after presentation changes remains a production
usability follow-up; the strict refusal is safe but not seamless recovery.

Separate fixture `kgnjaJMJVzEHPTUJ` kept its private tree unchanged. Consolidate
`PrivateRestore9aYq7ZdnHZ1dtymc` completed six standard approvals and produced
composite `j2C8DL9PjFuefwiI`. Added later independent Drawing
`VETliaDoI5yPi1vT` at sort3072. Restore `wm1N8o2oRtxAly7q` completed all four
standard approvals uninterrupted. Both original complete sources matched their
baseline and an independently reread verified archive; complete Level/tree and
later artwork stayed exact, composite absent, both journal operations complete.
Aroh's visible native player view showed both uniform patches as background;
all three restored/later Drawing shapes were concealed. No manual render-flag
flushing or source normalization was used.

Returned both clients to the original Scene and Token controls, deleted only
the two successful fixtures and removed test globals. Original complete Scene
matched its baseline:47 Drawings,0 Tiles,no optimization journal. Retained
immutable assets under the approved world assets recovery folder:

| File | Bytes | SHA-256 |
|---|---:|---|
| `recovery-PrivateConsolidateXq3jOq9W4VGFLYyd.json` | 3852 | `3b8419a575f49d2182a67dc8fc575fd79c4134c3940b5e3bf4a4202aee5b7d7a` |
| `bake-PrivateConsolidateXq3jOq9W4VGFLYyd.png` | 2530 | `0cec958ca265f93b7d37df911e0a976d5ddcd9b369942b4a044814a831143775` |
| `recovery-PrivateRestore9aYq7ZdnHZ1dtymc.json` | 3836 | `d3180051021f6f15eef316140ac9ff75fc937e2a0513f7b6ef1810d174349d30` |
| `bake-PrivateRestore9aYq7ZdnHZ1dtymc.png` | 2530 | `0cec958ca265f93b7d37df911e0a976d5ddcd9b369942b4a044814a831143775` |

This closes sampled private presentation and unchanged-context private Restore
acceptance, not changed-context recovery, full-frame fidelity or live lineage.
The earlier retained-elevation label correction is still not confirmed deployed.

**Owner-approved revision-only Restore refinement (2026-10-08):**
After the live refusal above, the owner selected allowing revision-only
differences with fresh Restore review. Implemented Restore-only inspection for
a strictly newer revision when the entire validated tree otherwise matches the
immutable archive. Gate values, hierarchy/order, locks, presets, defaults and all
other values remain exact; revision rollback refuses. Apply preparation,
persistence and reconciliation retain exact revision matching.

Restore intent and native execution approvals disclose archived/current revision
numbers. The fresh entry/evidence/execution snapshots retain the complete current
tree and revision, so any further context change during asynchronous evidence,
approval or execution still invalidates the review. Restore never rewrites layer
flags or immutable archive bytes. Journal-bound Restore reconciliation and each
native/phase verification use the same policy, including fresh reviewed resume
after interruption. No recovery format or journal migration is required.

90 targeted recovery/workflow/dialog tests pass, including Drawing, Tile and
background revision-only Restore with exact original/settings/later-artwork
preservation; actual presentation changes and rollback refusal; Apply refusal;
revision changes during intent/execution review; interrupted Restore resume with
fresh revision disclosure; and localized intent/execution warning rendering.
This refinement is on disk, not yet deployed/live accepted. Next deployed test
must exercise private hide/show/hide followed by Restore with the current
revision retained. The historical refusal above is not evidence for the new
runtime's live behavior.

**Deployed revision-only Restore and live ancestry acceptance (2026-10-08):**
Confirmed the ready Gamemaster client loaded the deployed revision policy.
Disposable private fixture `okzQTNPcDMmrW6jr` used two red/blue rectangles on
`privateInk`, elevation5, sorts1024/2048. Consolidate
`RevisionLiveBvaSDtRjeJ9qp2XQ` completed all six standard approvals. Aroh's visible
native player view sampled uniform20x20 patches at(160,160),(400,260): private
RGBA(51,85,68,255), enabled red(221,51,51,255)/blue(51,51,221,255), then disabled
background again. Standard manager gate changes advanced revision0 ->1 ->2;
complete composite source stayed exact.

Added later independent artwork. Restore `1D41CRUw9zoy7Squ` completed all four
standard approvals uninterrupted. Both intent and execution dialogs disclosed
archived revision0/current revision2. The deployed placement dialog showed
"Retained Drawing elevation: 5", closing that earlier label-only deployment gate.
Complete originals matched baseline and an independently reread verified archive;
later artwork, complete Level and current private tree/revision2 matched exactly.
Composite absent, both journal operations complete. Aroh's visible native view
showed both patches as background and all three Drawing shapes concealed.

Disposable public Unassigned fixture `RbCxk8o3rUzGYBQD` then exercised the full
single-branch chain at elevation0, using native controlled selection:

| Apply | Replacement | Retained parent |
|---|---|---|
| `LineageOnehgQeR4kl4mimcmWu` | Drawing `0jON6rTpdtQerSix` | None |
| `LineageTwoWLREQMEKQBUoBBdo` | Drawing `Y7EDLDdvwLnjsHzQ` | First Consolidate |
| `LineageTile0o5Wf5rEGJjZR30s` | Tile | Second Consolidate |

Each apply completed its six real standard approvals, rendering, verified storage
and native display/execution acceptance. Independently reread archives confirmed
exact preceding composite sources and immutable parent paths matching the retained
journal chain. Added later independent Drawing `KSs3GfgN4oJZNZyL`, sort3072.
Tile Restore `4B8tiaxoT7yXruJ0` recovered the exact second composite and removed
the Tile. Consolidate Restore `gs8apxsUwE1Sp5CC` expanded that composite into the
exact first composite. Earlier Consolidate Restore `eJv7lFe4klXHR2Gl` expanded
the first composite into both exact original strokes. Each Restore completed its
four real standard approvals uninterrupted; the later Drawing stayed exact at
every step. Final originals also matched the independently reread root archive;
complete Level unchanged, both composites absent,3 Drawings,0 Tiles,all six
journal operations complete. No test approval callbacks or native wrappers were
substituted. This is lineage/exact-source evidence, not player or full-frame
pixel fidelity certification for the chain.

Returned both clients to the original Scene/Token controls, deleted only these
two fixtures and removed test globals. Original complete Scene matched baseline:
47 Drawings,0 Tiles,no optimization journal. Immutable files retained in the
approved world assets recovery folder:

| File | Bytes | SHA-256 |
|---|---:|---|
| `recovery-RevisionLiveBvaSDtRjeJ9qp2XQ.json` | 3800 | `7334502e4e1eec07c4bf32e032c70a9e00a9e870cc2ee3cd6382f391508782b2` |
| `bake-RevisionLiveBvaSDtRjeJ9qp2XQ.png` | 2538 | `60dade4590ae426e9760c8c1fcea5b98424e49ca3cb3ef8ef019cdb9f566528c` |
| `recovery-LineageOnehgQeR4kl4mimcmWu.json` | 3544 | `616821df97a5bf7164825d4ac849180e3bb8592f8a09771ce71b66c66d7ca8a0` |
| `bake-LineageOnehgQeR4kl4mimcmWu.png` | 2538 | `60dade4590ae426e9760c8c1fcea5b98424e49ca3cb3ef8ef019cdb9f566528c` |
| `recovery-LineageTwoWLREQMEKQBUoBBdo.json` | 3491 | `d2c6e23a987ba2792736a7c82dafd0a3acafa4e88eb8767f3c9e5a70b1468a07` |
| `bake-LineageTwoWLREQMEKQBUoBBdo.png` | 2538 | `60dade4590ae426e9760c8c1fcea5b98424e49ca3cb3ef8ef019cdb9f566528c` |
| `recovery-LineageTile0o5Wf5rEGJjZR30s.json` | 3336 | `dc1409f4863fd4151908f1a2655b69b9f78da4104d88002f56b2c8f485352297` |
| `bake-LineageTile0o5Wf5rEGJjZR30s.png` | 2538 | `60dade4590ae426e9760c8c1fcea5b98424e49ca3cb3ef8ef019cdb9f566528c` |

**Deployed diverse Consolidate/full-Scene fidelity characterization:**

Disposable Scene `N73gGdBDxc8CUQ6I`, 640 x 400, contained eight native Drawings
in one public leaf `ink`, elevation5, unique sorts1024 through8192: translucent
rectangle overlap, rotated ellipse, rotated smoothed polygon, open smoothed path,
rotated multiline Signika text, repeated timber-plank ellipse and rotated
flagstone image stamp. No lights, tokens, vision or other native stack barriers
were introduced. Aroh stayed on the original Scene throughout; this is GM-only
evidence, not another player acceptance run.

Public `promptReviewedConsolidation` completed all six real approvals with the
default rendering/storage/native verifiers. Review reported uncropped537 x333
PNG, origin(42,24), no excluded sources or blockers. Replacement Drawing
`70PzPjDdYZdNIkIQ` retained `ink`, elevation5 and sort1024. Both native-reference
captures at each view matched exactly; both composite captures were also stable.
Readback covered the whole displayed Scene rectangle, not selected interior
patches, using the normal native renderer with no borrowed/hid native graph.
Actual requested zooms were checked, viewport1485 x787, renderer resolution1,
Foundry14.365/PIXI7.4.3.

| View | Compared pixels | Changed pixels | Pixels with channel delta >2 | Maximum channel delta | Mean absolute channel delta |
|---|---:|---:|---:|---:|---:|
| 100%, integer translation | 256000 | 7131 | 77 | 51 | 0.010720 |
| 100%, half-pixel translation | 256000 | 28507 | 13075 | 56 | 0.278578 |
| 125%, half-pixel translation | 400000 | 41356 | 19445 | 59 | 0.278709 |
| 150%, half-pixel translation | 576000 | 63413 | 30560 | 60 | 0.342214 |

Integer-view diagnostic windows found maximum1 in rectangle/ellipse regions,
zero differences in the open-path region, maximum8 in the smoothed polygon
region, maximum51 in rotated multiline text, and maximum15 in material/image
regions. Those windows can overlap; they are not disjoint source attribution.
Delta2 remains only a reporting bin, not an approved tolerance. Results extend
the earlier transparent raster/Tile findings to the native image Drawing and
two texture modes; they do not establish identical sampling, general visual
certification or a cause specific to text/material rendering.

`promptRestoreConsolidation` completed all four real approvals, Restore token
`jz7J7O6wxLun2dYF`. All eight complete native sources matched both the captured
baseline and independently reread/verified archive; complete native Level and
layer tree stayed exact. Restored Scene framebuffer matched the original at all
four views with zero changed pixels. No manual render-flag flush, archive edit,
replacement normalization or validator bypass was used.

Retained immutable evidence in `worlds/melody-of-the-weirding-mover/assets`:

| File | Bytes | SHA-256 |
|---|---:|---|
| `recovery-DiverseInk1WS1wehoWYOAnaOJ.json` | 7213 | `03201feb9d1445f4a02f2bf526fadb3cb62345f85fde79fee1103b50927a0b70` |
| `bake-DiverseInk1WS1wehoWYOAnaOJ.png` | 57845 | `4a6cd68c19499b1f1f95e8be677e114cb2bb163de06a1d17ce9615152f478755` |

Returned GM to the original Scene/Token controls and prior view; Aroh remained
there. Removed only the identified disposable Scene and live test global;
complete original Scene equality passed. This completes this bounded laboratory
characterization and exact recovery test. Reviewed best-effort visual quality
still needs field judgement under the owner's existing policy; no production
controls were enabled or error-tolerance policy changed.

**Desktop native review keyboard acceptance (read-only):**

Exercised the deployed `createBakeReviewDialogs` with bounded synthetic review
values, not optimization workflows: scope, resolution, Drawing placement,
decoded16 x16 PNG preview, file paths, native execution, Restore intent with
revision0 ->2 disclosure, and disconnected-owner takeover. These callbacks only
returned decisions; no consumer persisted files, journals or native changes.

All eight dialogs initially focused their approval button with acknowledgement
unchecked. Shift+Tab reached the native checkbox, Space checked it, Tab returned
to approval and Enter returned the exact expected typed decision. Escape from
checkbox/button focus explicitly rejected all eight with
`BakeReviewCancelledError`, never a success-shaped decision. Unchecked Enter on
the initial scope approval also cancelled explicitly rather than approving;
the host did not keep that dialog open with form validation feedback.

Full forward-tab traversal did not pass: Tab from approval reached the header
`toggleControls` button and repeated Tab stayed there. Repeated with150ms between
keys and reproduced identically in a plain modal native DialogV2 prompt with
one checkbox and one approval button, without module review classes/content.
This bounds the observation to shared host/session behavior, not a proven
Foundry-core cause. No host keybinding/focus patch or automatic acknowledgement
was introduced. The working reverse-tab approval path does not certify the
complete tab cycle, caller focus restoration, screen readers, physical tablet
interaction or end-to-end keyboard optimization execution.

Complete original Scene equality passed after the eight-type checks. All probe
dialogs and globals were removed; the GM remained on the original Scene with47
Drawings/zero Tiles and Aroh was not moved. This slice wrote only documentation.

**Remaining gates before production controls:** full review-dialog tab-cycle
resolution/end-to-end keyboard and physical tablet acceptance; player foreground refresh,
fog persistence, other vision modes and token elevations/effects; native Tile
shader, occlusion and color-fidelity verification; broader field judgement of
Consolidate's measured best-effort raster quality; and portable recovery-bearing
project exchange. Deployed one-Level/explicit-combine import acceptance passed
within section 16's documented sampled-artwork scope.
Automatic multi-Level matching is owner-rejected as recorded in section 16.
Real network interruption
and process-crash simulation are owner-deferred to field testing, not remaining
laboratory blockers. Keep
production controls disabled until those gates pass. Preserve native stack
barriers and require resolution review. A saved JSON string is not proof of
durable recovery, and a prepared restore list is not permission to delete.

#### Progressive drawing-session profiling evidence

**Follow-up correction:** the first run below had `CONFIG.debug.hooks` enabled.
Its seconds-long interaction stalls are not normal-use capacity thresholds.
The directory investigation and recovery-backed comparison immediately after
this historical record isolate that logging overhead and supply corrected
measurements with logging temporarily disabled.

The owner authorized disposable profiling Scenes, synthetic stroke creation,
deletion of only those Scenes, and restoration of the original view. The
developer-only `tools/drawing-session-profile.mjs` creates one 1600 x 1000,
gridless fixture at a time, adds up to 100 Drawings per transaction, measures
90 animation-frame intervals, and repeats native control/shape refresh/release
five times with two frame waits per trial. Coverage is the union of nonzero-alpha
stroke pixels in the actual viewport, measured outside timing with borrowed
native geometry and verified reference-count cleanup. It is not the fraction
of the Scene occupied by bounding boxes or a measure of overlap/overdraw.

Measured on Foundry 14.365, PIXI 7.4.3, Windows, D35E, VS Code's integrated
Chromium 150 / Electron 43.7.3 browser. The browser reported 20 logical processors
and 32 GB memory. Viewport was 1485 x 787, resolution 1, zoom 1. Other installed
modules/system/UI remained active; this is evidence for this client, not a
hardware-independent benchmark or isolated core-Foundry attribution.

Map strokes span 180 px, contain 12 points and use width 6. Detail strokes span
24 px, contain 32 points and use width 2 within a roughly 400 x 350 region.
Both are smoothed paths; one fifth use alpha 0.5. Detail means small screen-space
linework, not a claim about a particular system's person/token unit scale.

| Workload | Strokes | Actual viewport ink | Idle median / p95 (ms) | Control/refresh/release median (ms) | Batch creation ms / Drawing |
|---|---:|---:|---:|---:|---:|
| Map | 100 | 19.31% | 16.7 / 16.8 | 288.4 | 3.69 |
| Map | 500 | 57.90% | 16.7 / 16.8 | 1199.1 | 7.16 |
| Map | 1000 | 73.10% | 16.7 / 16.8 | 2743.9 | 27.42 |
| Detail | 25 | 0.69% | 16.7 / 16.8 | 130.6 | 4.21 |
| Detail | 100 | 2.57% | 16.7 / 16.8 | 297.7 | 4.42 |
| Detail | 500 | 7.92% | 16.7 / 16.8 | 1270.2 | 11.53 |
| Detail | 1000 | 12.08% | 16.7 / 16.8 | 2385.6 | 20.28 |

Baseline empty fixtures measured 16.7 / 16.8 ms. A settled repeat at 1000 map
strokes had no frames above 25 ms (max 16.9 ms), but the initial post-creation
window included four such frames with a 1766.7 ms maximum. Detail at 1000 had
three such frames, max 1116.7 ms. Good median/p95 values do not excuse these
large intermittent stalls. Growth stopped at 1000 rather than force an
already-stalling client through the tool's 2000-stroke safety cap.

At 1000 strokes, 90-frame moving-pivot probes remained 16.7 / 16.8 ms with no
frames above 25 ms for either workload. Repeatedly refreshing one existing
32-point detail shape also remained 16.7 / 16.8 ms. This latter proxy does not
simulate a growing freehand preview or real pen events. A single additional
detail Drawing at the 500-stroke checkpoint took 82.2 ms for its document
creation promise, followed by a sampled 583.4 ms frame stall. Batched creation
averages are not individual pen-stroke completion times.

**Diagnostic isolation:** at 1000 map strokes, temporarily suppressing only the
toolbox's `requestRefresh` left three control/refresh/release trials at
2406-2454 ms. Synchronous native control and release were each about 1-2 ms;
most time was in the following frame waits. Closing the toolbox was not a valid
isolation because it reopened during the test. Temporarily suppressing
`render` on the native `placeables` and `drawings-tab` applications reduced
one map trial to 57.9 ms. The same diagnostic on the 1000-stroke detail fixture
measured 46.7, 50.3 and 49.3 ms. All temporary overrides were restored in
`finally` and the directories were rendered again. This strongly implicates
the directory-render path in this setup; it is not a production bypass or
proof that every installation has the same bottleneck.

**Interpretation and next priorities:** no sustained rendering/coverage ceiling
was reached through 1000 strokes / 73% map ink. Interaction was already slow
at 100 strokes and exceeded a second around 500 despite only 8% detail ink.
Stroke/document count and directory/UI work matter more than a universal screen
coverage percentage in this experiment. Investigate the native directory path
before treating this as a GPU problem or enabling live caches. Reversible
document-count consolidation may help this path, but an actual before/after
consolidation benchmark is still required; hidden originals retained in the
Scene may keep document/UI costs even if rendering improves.

This was progressive synthetic accumulation over minutes, not hours of real
drawing, a physical tablet latency test, or a memory-leak/long-session soak.
Do not claim a guaranteed maximum or use these counts for automatic merging.
A future soak should measure growing pen previews, single-stroke creation,
move/undo/delete, heap/resource growth and latency after repeated Scene reloads.
Live caching remains deferred.

Both disposable Scenes were deleted, the original Scene source JSON matched
before/after, and its Scene/pan/zoom/active layer were restored. The profiling
toolbox was closed after restoration; temporary source server 31924 was stopped.
The reusable tool now guards concurrent checkpoints, invalid/altered fixtures,
partial batch progress and single-use startup, preserves client view-position
identity on cleanup, and attempts owned-Scene deletion even if view restoration
fails. Eight targeted safety tests pass; they test ownership/restoration and
guards, not real renderer performance.

#### Directory rebuild investigation and recovery-backed comparison

The owner requested investigation of directory costs before more caching and
authorized two uniquely named, retained profiling files. The library setting
was empty; the owner chose a new `assets/foundryshop-profiling` folder without
changing module settings. The developer-only
`tools/drawing-directory-profile.mjs` times native parent/child render stages,
drains measured renders and compares default control/release with Foundry's
existing `renderSidebar: false` option. It restores every temporary instance
method descriptor and releases the test selection on failure. This option is
a diagnostic, not an installed workaround: suppressing directory renders in
production would require correctly updating selection rows, filters and palette.

Native code inspection established the chain:

1. `PlaceableObject.control` and `release` request `ui.placeables.render()`.
2. `PlaceableDirectory._renderTab` force-renders the active Drawing tab even
   when the outer placeables sidebar is not the visible sidebar tab.
3. `PlaceableTab._prepareDirectoryContext` visits and sorts all visible document
   entries. `_onRender` binds entry listeners and calls `_applyFilters`.
4. `_applyFilters` calls `layer.setAllRenderFlags({refreshState: true})`, which
   schedules state/visibility refreshes and `refreshDrawing` hooks for all
   Drawings. This produces 1000 refreshes per control/release cycle at 500
   Drawings, not just an HTML row update for the selected stroke.
5. With `CONFIG.debug.hooks === true`, `Hooks.callAll` logs both a message and
   large argument objects for every refresh. In a timed 500-stroke cycle,
   Drawing `applyRenderFlags` totalled 1170.1 ms, while the underlying
   `_applyRenderFlags` work was about 8.5 ms in a separate trial. The one
   Foundryshop visibility hook also ran 1000 times (~131.6 ms in that diagnostic).
   These were separate/inclusive measurements, not additive CPU accounting.

At 500 Drawings with hook logging on, the instrumented default interaction
median was 1206.8 ms. Parent render promises themselves had a median of 31.6 ms,
and child render promises 16.6 ms: the dominant cost happened after those
promises, during the all-Drawing refresh pass. Disabling hook logging temporarily
reduced default interaction to 112.1 ms; `renderSidebar: false` measured 32.7 ms.
The directory remained functional and its filtering work was not suppressed.
Logging was restored in `finally`, not changed permanently.

At 1000 map Drawings / 73.10% viewport ink, with logging off, the subsequent
500-document batch took 1517.1 ms (3.03 ms/created Drawing); its 90-frame window
had median/p95 16.7/16.8 ms, max 17 ms and no frames over 25 ms. Normal
control/refresh/release measured 203.4 ms in the session tool, and 197.8 ms in
the instrumented directory probe versus 33.6 ms with `renderSidebar: false`.
There remains count-dependent native directory/all-object refresh overhead, but
the previous multi-second figures were heavily inflated by debug logging.
No native renderer/sidebar prototype patch, live cache or production behavior
change was installed.

`tools/drawing-consolidation-profile.mjs` then completed a separate 500-stroke
map benchmark with logging off for all three timing phases. It rasterizes only
the disposable fixture's geometry into a transparent 1600 x 1000 PNG, uploads
the PNG and standalone originals archive, reads back and verifies their bytes,
decodes the image at its expected dimensions and validates the archive checksum.
The fixture uses explicit optional name/text values so full stored sources
survive JSON unchanged; original user artwork is never normalized or edited.
The staged image Drawing is checked before deleting the archived fixture
strokes. A fixture-only Scene flag records paths, checksum, original IDs,
composite ID and verified/staged/composite/restoring/restored checkpoints.
It is not a production crash-recovery journal or a resumable interrupted-swap
implementation; no consolidation command is enabled.

| Phase, hook logging off | Native Drawings | Control/refresh/release median | Drawing tab render median |
|---|---:|---:|---:|
| Original map strokes | 500 | 110.5 ms | approximately 9 ms in comparable 500-stroke runs |
| Image Drawing composite | 1 | 33.4 ms | 0.8 ms |
| Restored original strokes | 500 | 111.7 ms | 8.6 ms |

Each interaction median uses five trials with two animation-frame waits. The
33 ms composite result is near this probe's two-frame floor, not a claim about
physical input latency. Consolidation reduced this measured cycle by ~70%
(~3.3x faster). The swap took 707.7 ms and restoration 1161.4 ms in this
disposable workload; these timings exclude prior image encoding/upload/archive
preparation. Restoration re-read the archive from the server, used its
conflict-checked preview, recreated all 500 sources with their original IDs and
authors, and verified exact native stored-source equality before deleting
the composite. The return to the original timing range supports a real
document-count effect beyond the logger confound.

Retained evidence:

- `assets/foundryshop-profiling/profile-UGIFo4A37J9hhfq7.png`:
  997158 bytes, transparent 1600 x 1000 composite.
- `assets/foundryshop-profiling/profile-UGIFo4A37J9hhfq7-originals.json`:
  906051 bytes, 500 exact stored Drawing sources plus selected project and
  expected composite. Payload SHA-256:
  `c6a7e911f44550c130001da6186747119271f65638b14cb102b18940ed883206`.

These files represent synthetic artwork in an intentionally deleted profiling
Scene, not a backup of the owner's map or an archive directly restorable into
an arbitrary Scene. No claim of universal raster fidelity, arbitrary styles/
barriers support or tablet/long-session capacity follows from this benchmark.
The first upload was rejected because the server did not recognize the
authenticated user despite client GM permission. No swap proceeded. Its Scene
was cleaned up; the owner's requested refresh/rejoin restored normal upload
authorization and the second run completed without bypassing server permission.

Both new disposable Scenes were deleted, the original source JSON/view/pan/zoom/
active layer were verified restored, all temporary methods/debug values were
restored, the profiling toolbox was closed and source server 31925 stopped.
Two verified files remain as explicitly authorized; the failed upload created
no file. Twenty-four targeted tests cover directory descriptor restoration,
disposable ownership/cleanup, denied uploads, image changes, verified recovery/
swap/restore, conflict refusal and archive validation.

**Updated next priority:** implement the simple, explicit recovery-backed image
Drawing workflow with a production persistence/operation journal and interruption
recovery, based on the measured count-reduction benefit. Do not promise a huge
normal-use speedup from the earlier logger-inflated stalls, suppress native
sidebar updates silently or resume live caching. Selection-only directory
updates or refresh coalescing are possible separate future optimizations, but
would need full filter/visibility/palette behavior coverage rather than a
blanket render bypass.

#### Owner amendment: two-stage optimization, Consolidate and Bake

The owner now wants two clearly differentiated reversible options, and is open
to baking being the more useful final representation. After native/API research,
the owner chose **transparent locked Tile over the existing background first**;
Level-background replacement was initially a later advanced option; the following
direct-background amendment approves it explicitly. This supersedes the
blanket Tile exclusion for this narrow finished-artwork workflow, not for
arbitrary image import/reference Tiles or general mixed-object layer management.

| Command | Intended use | Result | What remains editable |
|---|---|---|---|
| Consolidate | Reduce finished strokes while continuing work in Foundryshop layers | One or a few image Drawings; reversible best-effort vector merge may be a separate later experiment | Composite placement/appearance and new Drawing strokes; individual archived strokes require Restore originals |
| Bake to Tile | Hand finished map artwork to native Foundry map presentation, leaving new ink above it | Uploaded transparent WEBP and a native locked Tile | Native Tile placement/appearance through Tile controls after unlocking; fresh Drawings remain independent |

Both raster options reduce active document count. Consolidate is not a promise
that a raster composite's individual lines stay vector-editable. Bake is not
necessarily faster than one image Drawing: that comparison remains unmeasured.
The distinction is native object ownership, stacking, map handoff and Drawing
workflow integration, not a claim of magical additional raster optimization.
WEBP is an output format choice shared by reusable rendering/storage machinery,
not the definition of the second phase.

Bake may run directly on eligible selected strokes/a layer **without requiring
Consolidate first**, or on an existing consolidation. Share bounded rendering,
scope/audience checks, verified file persistence and the recovery engine rather
than implementing two unrelated rasterizers. Two buttons have clear purposes:
"keep working in Drawing layers" versus "finish as native map artwork".
Do not make users perform an unnecessary intermediate rasterization.

**Verified Foundry v14 placement model:** official Tile documentation describes
Tiles as composited images affected by lighting/vision, with no player Tile
controls. Read-only inspection of the running 14.365 client confirms:

- Native primary ordering compares elevation first, then native sort layer,
  sort, z-index and stable insertion order. Sort layers are Scene 0, Tiles 500,
  Drawings 600, Tokens 700. At the same elevation, an ordinary Tile therefore
  renders above the Level background and below live Drawings/Tokens.
- Tile fields include `texture`, x/y/width/height, rotation, elevation, Levels,
  sort, alpha, hidden, locked, restrictions and occlusion. Default occlusion
  modes are empty; light/weather restrictions are false. Use ordinary map
  artwork, not an overhead/roof effect.
- Background/foreground fields are on native embedded **Level** documents in
  this client, not on the Scene schema. Level `background` contains src/color/
  tint; its `textures` fields define fit, anchors, offsets, scale and rotation.
  Scene dimensions/padding/grid are separate and must not change during baking.
- A Level background is a replacement slot, not another transparent-overlay
  slot. Foreground is overhead artwork and is not the ground-ink destination.
  Direct background baking must compose the old Level background plus chosen
  ink into one asset, preserve the old background/transform settings in recovery,
  and explicitly replace the slot. Never simply replace parchment with a
  transparent ink-only file or overwrite a foreground to simulate ground ink.

These findings are schema/source evidence, not completed native Tile placement/
pixel/player acceptance. Public articles may describe older Scene/overhead
controls; actual v14 Level fields and elevation behavior take precedence.

**Tile placement and scope gates**

1. Expose Layer (default), Selected Drawings and All eligible Drawings on one
   displayed Level according to the reviewed scope contract below.
   Mixed Levels/elevations, interface artwork, missing resources and
   unfinished operations refuse with an actionable reason. Group/multi-layer
   baking needs an explicit flatten-to-ground review rather than a silent scope
   expansion.
2. Render transparent artwork only, retaining exact Scene-pixel bounds. Crop
   coordinates become Tile x/y; logical bounds become Tile width/height.
   Pixel resolution may be larger without changing placement dimensions.
   Preserve stroke edges with bounded padding. Do not bake Foundry's grid,
   selection outlines, lighting, Tokens, Walls or unrelated artwork.
3. Place on the source Level at an explicitly validated map/ground elevation.
   Require placement above its background and safe stacking relative to
   existing Tiles/Drawings/Tokens. Elevation comes before native sort layer:
   do not claim the same-elevation ordering holds across arbitrary elevations.
   Preview the change from Drawing stack to Tile stack, including existing
   Tiles that would now occlude baked art. Refuse unsupported interleaving or
   require a clearly disclosed finish-as-ground-art decision before writing.
4. Use alpha 1, neutral tint, no occlusion modes, no light/weather restriction,
   and lock the Tile by default. The Tile's native opacity is not a substitute
   for the unresolved true GM-private Drawing-layer tracing opacity.
5. Stage player-hidden and expose only after verified replacement and explicit
   audience confirmation. Layer `playerAllowed`/workspace-hidden state does not
   automatically apply to Tiles. Snapshot approved audience/native hidden state
   and refuse mixed presentation scopes that cannot be represented safely.
   Hidden documents/assets are not a secure secret-storage mechanism.
6. Once baked, the object is native Tile artwork, **not a movable Drawing-layer
   member**. Keep a clear baked-output/recovery entry with Locate Tile, Restore
   previous representation and Restore original strokes; do not promise that
   dragging a Drawing pseudo-layer rearranges the Tile among Drawing layers.
   Selection export/publication must report baked artwork or deliberately
   include it through a supported schema, never silently omit it.

**Recovery contract shared by both phases**

**Owner-approved bake scopes and removal contract**

Offer three explicit scopes for either bake destination:

- **Layer (default):** one chosen Drawing layer on the displayed Level. Do not
  silently include child layers; groups/descendants require an explicit scope
  review. Keep the layer itself so fresh strokes can continue there.
- **Selected Drawings:** the exact reviewed selection on that Level, including
  Unassigned strokes. Layer membership is not a prerequisite.
- **All eligible Drawings:** the displayed Level only, including Unassigned
  strokes and multiple layers, after explicit flatten-to-ground review.
  "All" never means the entire Scene or every Level.

Freeze an exact source-ID/state manifest before rendering. Preview included and
excluded counts, source layers, audience, destination, output bounds/resolution
and the number of live Drawings that will be removed. List exclusion reasons;
do not silently omit hidden/private, unsupported or incompatible artwork.
Refuse unresolved mixed audience, Level/elevation or stacking conflicts.
Concurrent selection, source or membership changes invalidate the preview.
Never expand the deletion set to later strokes or newly added layer members.

Successful Bake must remove the operation's verified source Drawings from the
live collection, not merely hide them or keep offscreen copies. Export-only
remains a separate command and is not a performance optimization. Archive exact
stored native sources, IDs/authors, layer membership and necessary project
context in a versioned internal recovery file in persistent shared Foundry
storage. This is an internal pseudo-export, **not a disposable temporary file**,
browser cache, browser-only download or duplicate live Drawing collection.
Keep a lightweight journal/index reference in the project; large archived
Drawing payloads must not remain loaded as active documents.

Persist and read back both the recovery archive and baked asset before any
source deletion; verify checksums, decode/dimensions and exact source coverage.
Then stage/verify the replacement, recheck authority/currentness and remove only
the manifest's originals through the journaled apply protocol. A denied upload,
invalid readback or changed source leaves originals intact. After partial
document writes or deletion, mark the operation incomplete and reconcile from
durable state; never report success or discard recovery. Reload/interruption
tests must cover each write boundary and partial deletion.

Recovery remains available from a visible baked-output entry even when the
source layer contains no live Drawings. Undo Bake restores the previous
representation; Restore original strokes restores archived originals and their
membership, with conflict review where needed. Both preserve later independent
strokes. Retain archives and original/derived assets by default; any future
cleanup must explicitly disclose lost recovery and protect references from
other operations. Never automatically expire these files as temporary assets.
Acceptance must verify actual live Drawing-count reduction for Layer, Selection
and All, exact restoration after reload, and survival of unrelated/new strokes.

Retain verified exact stored original Drawings and their project/layer/Level
context outside the live Drawing collection so optimization actually reduces
document count. Never automatically discard originals. Verify uploaded WEBP
bytes, decoding/dimensions and archive readback before removal. Use a durable
operation journal, staged replacement, currentness/authority checks and
idempotent interruption reconciliation for production commands.

Baking a consolidated Drawing must retain its original-stroke archive lineage
and the exact pre-bake composite source/asset reference. "Undo Bake" restores the
previous representation; "Restore original strokes" restores the authoritative
stroke set. A direct bake has originals as its previous representation. Do not
overwrite older recovery on repeat consolidation/baking. Later independent
strokes survive either restore.

The current version-1 archive validates an **image Drawing** replacement only.
Do not put Tile/Level records into it under the same version. Design a versioned,
typed replacement/recovery schema and adapters for Drawing, Tile and later
Level-background destinations. Track owned document IDs, exact expected
replacement state, asset fingerprints, lineage and previous presentation.
Edited/moved/resized/deleted Tiles, occupied original IDs or changed Level/
membership/settings require conflict review; do not silently discard a user's
Tile edit or apply its transform to archived stroke geometry. Define such
resolution choices before enabling affected commands.

Avoid degrading quality by encoding an existing composite again when originals
and all transform/appearance history can be faithfully reconstructed. If edited
composite state cannot be reconstructed from originals, preserve/render the
current reviewed representation and disclose resampling. Existing browser WEBP
quality controls do not guarantee lossless output even at quality 1. Retain
resolution/quality preview, alpha/edge tests and bounded pixel/asset budgets;
JSON/native originals remain the recovery authority.

**Delivery order and acceptance**

1. Complete durable shared persistence, typed recovery/lineage and production
   journal/reconciliation foundations.
2. Deliver Consolidate selected/single layer and Restore originals, reusing the
   measured image-Drawing approach.
3. Add Bake to Tile with direct-from-originals and consolidated-input paths;
   Layer-default/Selection/All scope previews, native placement/order, crop,
   WEBP decode/alpha and player authority tests.
4. Verify Undo Bake and original-stroke restoration after reload/interruption,
   repeated operations, edited replacement conflicts and later new strokes.
5. Benchmark equivalent original Drawings, consolidated image Drawing and baked
   Tile with debug logging off, including selection, creation, pan/render,
   resource/asset costs and multi-client behavior. Both alternatives need a
   demonstrated use; do not infer a Tile speedup from the Drawing benchmark.
6. Add explicitly approved Level-background baking according to the direct-
   background amendment below, with reversible background/transform restoration.

Research sources: [Foundry Tiles](https://foundryvtt.com/article/tiles/),
[Scenes](https://foundryvtt.com/article/scenes/) and
[Canvas layers](https://foundryvtt.com/article/canvas-layers/), together with
read-only schema/primary-order inspection in 14.365. No Tile or background was
created/changed during this research. Live caching remains deferred.

#### Owner amendment: bake artwork directly into a preserved background copy

The owner explicitly approved planning **Bake into background** in addition to
Consolidate and Bake to Tile. This is no longer an unapproved/deferred destination.
It combines chosen map artwork with the displayed Level's background, saves a
new Foundryshopped image, and optionally applies that image to the Level through
the same verified, reversible operation. Consolidation is not a prerequisite.
Keep both the original background copy and derived Foundryshopped output, as well
as the exact source strokes and pre-operation native settings. Never overwrite
the source asset, silently remove older output versions, or equate keeping a
mutable/remote URL with retaining an original copy.

Use **Bake** as the finished-map command with two reviewed destinations:

| Destination | Best use | Native result |
|---|---|---|
| Tile overlay | Retain an independently movable/replaceable ink overlay and unchanged parchment/background | Transparent image Tile at validated ground placement |
| Level background | Finished ink becomes part of the map image, with no extra overlay document | New combined image in the displayed Level's background slot |

Consolidate remains the Drawing-layer optimization. Background Bake is not a
generic permission to reconfigure the Scene or combine arbitrary native objects.
Do not change Scene dimensions, padding, grid, Walls, Tokens, other Levels,
foreground or illumination. No player-facing baking controls are required.

**Input format is independent of output format.** The original background need
not be WEBP. Prefer WEBP output with reviewed resolution/quality, and offer PNG
as a lossless raster encoding alternative when budgets allow. Browser WEBP
quality 1 is not a guaranteed lossless encoder. JSON/native original recovery
is exact even when derived image encoding is intentionally lossy.

Official media guidance lists AVIF, JPEG/JPG, PNG, SVG and WEBP images, and
WEBM/MP4/M4V videos. Read-only inspection of the running v14.365 client's
`CONST.IMAGE_FILE_EXTENSIONS` also lists APNG, BMP, GIF and TIFF; its video list
includes OGV. Registration/file-picker acceptance is not proof a given browser
can decode and safely export every such file. SVG support as an existing
background asset does not reopen arbitrary SVG/vector import into editable
Drawings.

**Capability preflight and honest initial support**

- Initial assured inputs are bounded, static PNG, JPEG/JPG and WEBP, reusing
  the existing byte/header/decode validation and animation refusal.
- Extend existing-background support to static AVIF and other browser-decodable
  raster formats only after format-aware dimensions/animation inspection,
  bounded byte/decode tests and browser-specific fixtures. Static BMP/GIF/TIFF
  are capability candidates, not promised first-release support.
- Existing SVG backgrounds require a separate bounded, self-contained asset
  acceptance path: explicit dimensions, approved resources and verified raster
  decode. External resources/fonts, scripts or animation cannot be silently
  omitted or treated as a self-contained static map. Unverifiable SVGs refuse
  background replacement; the untouched native background can still sit under
  ordinary Drawing strokes or a baked transparent Tile.
- Video and animated APNG/WEBP/AVIF/GIF/SVG are not static background-bake inputs.
  Detect animation/container features or explicitly report unsupported/unverified
  input. Never use a decoder's first frame as an implicit whole-media conversion.
  Offer Bake to Tile for the static ink while preserving the native moving
  background; animated compositing/video encoding is separate scope.
- Inspect actual bytes/container signature and decoded dimensions, not just
  suffix or server MIME. Query the running Foundry extension registry for
  diagnostics, then report a specific supported/unsupported/unverified result.
  Unknown formats refuse rather than guess they are static. Loading on canvas
  alone does not establish a safe export capability.
- Local server files should use verified readable bytes. Remote/CORS-restricted,
  inaccessible/private, unsupported redirects or actual client/server size
  limits fail before mutation
  with an actionable reason. Merely confirming external-resource consent cannot
  bypass browser CORS. A remote original requires a permitted, verified local
  copy; if it cannot be copied, refuse background replacement and retain the
  native background/offer transparent Tile output.

Ordinary Drawing overlays already work independently of the background format
Foundry renders. A refusal here concerns **combining/exporting** that source,
not a prohibition on drawing over it.

**Alignment and fidelity**

The implemented `publicationBackgroundSnapshot` and `buildPublicationBackground`
capture/render Level background color/image/tint plus fit/anchor/offset/scale/
rotation into Scene coordinates. Existing WEBP publication already composes
that with artwork and has native transform fixtures; reuse it rather than
inventing a second coordinate system. It remains export-only today.

For direct replacement, render the entire logical Scene map rectangle, not
artwork-only bounds or a viewport screenshot. The output is the displayed
background appearance plus selected ink. Apply it using a verified identity
fit to that same rectangle, with neutral tint and no duplicate rotation/offset/
scale. Preserve the original background fields and texture transform fields
exactly in recovery. Increasing image pixel resolution must not enlarge the
Scene or move its grid/placeables. Test nonzero padding/Scene origin, flips,
rotation, all fit modes, offsets, tint, transparency and fractional positions.

Level texture transform fields are shared context for other Level imagery.
Do not reset them in a way that moves an existing foreground/fog overlay.
The first background-application slice must either prove the exact
inverse-transform/texture-mapping replacement while leaving that shared context
intact, or refuse non-identity transforms when other imagery would be affected,
offering Tile/export-only alternatives. A background-only safe normalization
requires verified absence of affected imagery and explicit recovery of settings.
No guessed transform normalization or unnoticed foreground/fog movement.

Baking Drawings into a Level background changes their native depth: artwork now
lies behind Tiles and potentially other Level imagery instead of in the Drawing
stack. Require eligible ground/map artwork and a preview/refusal for overlapping
native barriers, different elevations or intended above-Tile ink. The result
does not promise identical arbitrary cross-object stacking. Do not include
lighting, vision, grid or Tokens in the image to simulate native composition.
Player-private/hidden strokes must not be embedded into a player-visible map.
Filter preview exclusions explicitly and require approved audience; never
silently publish a GM-private sketch as background pixels.

**Preservation and production operation**

1. Snapshot selected native sources, layer/project membership, Scene/Level
   identity, exact Level background/texture settings and affected presentation.
   Capture asset fingerprints plus logical bounds, output resolution and codec.
2. Copy original image bytes into a uniquely named durable operation asset,
   preserving its original format; verify upload/readback hash. Keep an existing
   original source file untouched too. If there is only a background color,
   retain settings and clearly record that there is no original image file.
3. Render/preview the combined map, including codec quality and stacking warnings.
   Save a uniquely named Foundryshopped output; verify encoded type, dimensions,
   decode and persisted bytes. Retain both assets and an exact originals archive.
4. Persist the typed Level-background operation journal/recovery references
   before changing the Level. Recheck GM authority, source fingerprints,
   original sources/settings and Scene/Level context through asynchronous work.
5. Apply only the exact reviewed background/necessary transform patch, verify
   native alignment/settings, then remove only this operation's archived source
   Drawings. Retaining strokes onscreen as well as baking them would double ink;
   archiving rather than live hiding enables actual document reduction.
6. Reconcile interrupted apply/remove steps idempotently. If sources remain or
   partial removal occurs, surface pending state rather than report success.
7. Undo Bake restores pre-bake background/transform settings and prior artwork
   representation, leaving independent later strokes alone. Verify original
   backup bytes first; if the original URL was changed/deleted, restore the
   verified backup with disclosure instead of silently using changed content.
   Restore original strokes follows the retained consolidation lineage.
8. A user-changed Level background/transform, edited replacement or occupied
   source ID requires conflict review; do not overwrite later changes. Repeat
   bakes keep immutable lineage, baseline originals and every needed previous
   output. Re-render from baseline plus tracked edits where reconstructable to
   avoid progressive lossy re-encoding; otherwise disclose resampling.

Use the planned versioned typed recovery schema, not the current Drawing-only
v1 archive. Store original and derived asset references/hashes, typed before/
after Level settings, source-stroke recovery and repeated-operation lineage.
Background restoration changes native map configuration and needs production
failure/reload/multi-GM tests, not only the disposable Drawing benchmark.

**Large-map policy and difficulty**

The owner requires **full-resolution support up to the running Foundry client's
image capabilities**, including large and long-axis maps, and explicitly assigns
resource management to the operator. This supersedes the earlier policy of
refusing jobs above conservative module pixel/memory budgets. Do not impose
arbitrary bake axis, megapixel, decoded-byte or encoded-file caps below actual
platform capabilities. Do not silently shrink a map; any optional downsampling
requires an explicit preview and approval.

The existing publication renderer currently limits output to 8192 px per axis
and 16 million pixels, and background decode to 8192 px per axis / 64 million
pixels. These are current implementation constraints, not the approved Bake
policy. Existing publication/import limits remain unchanged unless separately
revised; Bake needs a size-capable path rather than inheriting their limits.
The owner's 8000 x 6000 / 48-MP map is a required full-resolution acceptance
case, not an optional later budget increase.

Show dimensions, estimated working memory and actual capability constraints
before starting. Estimates are advisory, not a memory-admission gate or a claim
to know available RAM. One 48-MP RGBA surface is approximately 183 MiB; textures,
render targets, extraction buffers, browser canvases and encoders may multiply
that usage. The operator chooses whether to proceed with a resource-intensive
job. Preserve progress/cancellation where feasible, release owned resources on
completion/failure and avoid unnecessary full-size duplicate buffers.

System RAM alone does not establish support: browser canvas/decoder/encoder
limits, GPU texture/render-target dimensions, WebGL context availability and
server upload/storage limits can differ. Detect/report actual constraints and
use tiled rendering or other compatible processing paths where needed to avoid
a single-target limit below Foundry's supported image dimensions. Tiling GPU
rendering alone does not solve full-image canvas/encoding limits. Verify the
final output dimensions, decode and upload readback; report unsupported paths,
allocation/encoding failures or context loss explicitly without downscaling,
partial output substitution or source deletion.

Test full-resolution 8000 x 6000 output, long-axis cases and representative
sizes near the actual tested client limits, plus failure/cancellation/recovery.
Do not promise unlimited dimensions or universal hardware support: target the
native client's real capabilities and disclose any remaining implementation
gap rather than presenting a conservative module budget as a Foundry limit.

Rendering supported static backgrounds is the relatively straightforward part
because a compositing engine already exists. Safe native application,
immutable backup/lineage, shared-transform handling, broad media detection,
large-map output and interruption restoration are the substantial work.
Plan staged delivery: verified static PNG/JPEG/WEBP export/copy and recovery;
safe background apply/undo with full-size acceptance; then additional
static format capabilities. Keep Tile Bake as an alternative for unsupported
backgrounds or incompatible stacking. No background file or Level was modified
during this planning/research.

Research: [Foundry media formats](https://foundryvtt.com/article/media/),
running v14.365 extension registries and Level schema, and the existing bounded
publication renderer. Universal Foundry-media baking is not promised; universal
honest capability reporting is required.

Do not assume faithful document-count reduction is possible with native Drawing
paths. Investigate these options separately and report what each actually reduces:

| Option | Potential benefit | Required fidelity/preservation checks |
|---|---|---|
| Longer/fewer redrawn lines | Fewer new documents | Intentional manual redraw, original sketch retained; not lossless consolidation |
| Point simplification | Fewer coordinates/geometry work | Defined pixel-error tolerance, smoothing/corner/zoom tests and exact original recovery; document count unchanged |
| Connected compatible path merging | Fewer documents | No artificial joins, changed smoothing, alpha overlap or reordered content; retain separate partitions when incompatible |
| Layer render cache | Less repeated rendering | Originals stay editable; native document/network overhead remains; bound cache/invalidation/cleanup and measure actual improvement |
| Raster image Drawing composites | Fewer active Drawing documents | Explicit rasterization/resolution decision, layered ordering/opacity, verified assets and durable source recovery; expands current faithful-vector flatten contract only with owner approval |
| Baked Tile composites | Native finished-map handoff and fewer active Drawings | Owner-approved narrow Bake to Tile scope above; verify authority, native stacking, WEBP asset and typed recovery/lineage before activation |

The current editing core remains Drawing-based. Arbitrary reference Tile placement
is excluded; raster image stamps are already supported as Drawings. The two-stage
amendment permits native baked Tile outputs, not a general mixed-object Tile
backend or cross-native-layer stacking promises. Redrawing and
simplification are editing tools, not automatic proofs of faithful consolidation.

An initial read-only native observation of the owner's open `Magic Hot Springs`
Scene found 47 Drawings (42 paths, 5 rectangles), 13,602 point coordinates and
about 248 KB of serialized Drawing data. Detached native schema validation rejected
null path separators. This is evidence against naively concatenating disconnected
strokes, not proof that every compound rendering/storage technique is impossible.
Do not expose this synthetic observation as performance benchmarking or alter
the source map to collect it.

**Editable source plus derived representation:** Recovery stores original strokes
once per operation/lineage with geometry, styles, membership, sort, native flags
and relevant Level context. Choose durable Scene/world/file storage only after
measuring size, availability, permissions, reload/backup and client synchronization.
Large payloads must not be duplicated into every replacement document. Hidden
original documents provide convenient interim archival access but still incur
native document/network overhead; hiding them is not full count consolidation.
Deleting originals from the active collection requires verified durable recovery,
verified replacement assets/documents and a recoverable operation journal first.
Retain source identity/provenance and avoid source-count-dependent flag duplication.

Explicit **Consolidate** and **Edit original strokes / Expand** commands come
before automation. Expansion restores the owned originals while retaining newer
strokes and order. Replacement fingerprints and recovery lineage detect edited,
deleted, reassigned or repeatedly consolidated composites; require conflict review
before touching them. Never overwrite the only original snapshot or silently merge
post-consolidation work into it. Failure/interruption/reload must leave sufficient
verified state to finish or compensate without deleting unrelated content.

Playwright/native detached fixtures should compare render caching and image-
Drawing composites alongside the faithful-Drawing geometry feasibility gate.
Measure synthetic pen-heavy workloads (for example 100/500/1,000 strokes within
existing bounds), with independently varied coordinate counts/styles/overlaps.
Record native document count, draw/render cost, input/selection latency, cache
refresh time, upload/decode size and recovery size. Compare pixels at representative
zoom levels and test later edits, reload, cancellation/interruption and resource
failure. Real-file tests and connected multi-client tests need separate approval/
fixtures; synthetic offscreen checks do not establish a guaranteed speedup.

Automatic expand/recomposite-on-edit is a deferred, opt-in design possibility,
not current implementation. It requires proven recovery, atomic history,
concurrency authority, stable selection/drag behavior and bounded regional
invalidation. No background automatic destructive document replacement. If
feasibility fails, present measured alternatives and obtain a scope decision
rather than disguising rasterization or geometry loss as faithful vector flattening.

### Suggested service

Add a dedicated service:

``` text
DrawingConsolidationService
├─ analyzeCompatibility(drawings)
├─ buildConsolidationPlan(drawings)
├─ mergeSelected(drawings)
├─ flattenLayer(layerId)
├─ flattenGroup(groupId)
├─ unflattenLayer(layerId)
├─ preserveRecoverySnapshot(...)
└─ discardRecoverySnapshot(...)
```

`DrawingConsolidationService` should depend on the membership/order abstractions
rather than duplicating them. Foundry-specific geometry conversion should remain
behind a narrow adapter so changes in Foundry Drawing internals do not spread
through the Layer Panel.

### Flattening acceptance scenarios

#### H. Compatible stroke consolidation

Create hundreds of compatible pen strokes in one layer. `Flatten Layer` substantially
reduces the underlying Drawing document count while producing no observable visual
change at normal and high zoom. Layer visibility, locking, reorder, and player
presentation continue to operate on the layer normally.

#### I. Mixed-style layer

Create a layer containing multiple stroke styles, fills, and incompatible Drawing
types. Flattening partitions them safely and produces the minimum practical compatible
sets; it does not normalize their styles merely to force them into one Drawing.

#### J. Order-sensitive artwork

Create overlapping Drawings whose appearance depends on source order. Flattening
either preserves that appearance exactly or leaves the order-sensitive Drawings
separate. No visible reordering is permitted.

#### K. Reversible flatten

Flatten a layer, reload the Scene, then run `Unflatten Layer`. The original Drawing
set, membership, relative order, and relevant Drawing properties are restored from
the retained recovery data.

#### L. Large finished map

Populate a map with several thousand simple pen-stroke Drawings distributed across
finished and active layers. Flatten finished layers and measure document count,
canvas responsiveness, Scene load behavior, layer reorder, and visibility operations
before and after. Record the actual performance gain rather than assuming it.


## 16. Portable drawing packages and artwork exchange

### Product goal and scope

A GM should be able to share a drawing map like an editable art project: export
it, give it to another GM, and populate an otherwise empty Foundry Scene from it.
Foundry's own Scene export already handles Scene backups. Foundryshop packages
must not duplicate that responsibility.

All import/export commands are GM-only. Export is an explicit disclosure action:
a full editable package can contain player-hidden artwork, text, layer names,
presentation settings, and original sources retained in recovery snapshots.
Show the selected scope and this warning before sharing. Player hiding does not
redact a JSON package automatically.

| Format | Purpose | Fidelity / editability |
| --- | --- | --- |
| JSON | Portable Foundryshop drawing project | Lossless for the declared supported document/schema version |
| WEBP | Finished artwork for use elsewhere | Raster output; no layers or editable stroke recovery |
| SVG | Vector exchange with external art tools | Supported paths/shapes/text/groups; explicit limitations |

### JSON export contract

The default export contains the full editable drawing map. A selected
layer/group export can reuse the same package format once the full-map path is
working. Record scope explicitly; include required ancestor gates/context or
materialize them so a subset does not accidentally change visibility semantics.

Include:

- layer/group nodes, stable package IDs, canonical hierarchy/order, names, locks,
  brush defaults, and authoritative player-presentation state;
- full supported Drawing geometry and styles, text/font properties, transforms,
  native hidden/locked state, elevation, rendering mode, Level associations, and
  within-layer order;
- ordinary Unassigned artwork as well as managed artwork in full-map exports;
  report unresolved membership rather than silently dropping it;
- named presentation presets and all portable references they need;
- retained flatten snapshots, replacement/source linkage, integrity information,
  and recovery lineage by default;
- export bounds, coordinate-space/origin information, source Foundry/schema
  versions, and an asset/font dependency inventory.

Exclude per-GM active layer, selection, local visibility/collapse preferences,
user credentials, and unrelated Scene content such as Tokens, Walls, Lights,
Sounds, combat, or system data. Do not serialize an entire Scene as a shortcut.
Author/user IDs must be treated as nonportable references, not transplanted user
identity. Preserve drawing-related extension metadata where safely possible,
report required missing modules, and never execute imported flags or code.

Keep external images/textures as asset references, not embedded binary files, in
the initial JSON format. Inventory missing assets and fonts before import and
offer explicit replacement mappings; a package must not claim self-contained
visual fidelity when its assets are unavailable. Background references and
dimensions may be recorded as project context, but importing JSON never replaces
the destination's background or Scene configuration.

An optional compact export may omit recovery snapshots only after explaining
that the recipient cannot unflatten those sources. Never discard recovery from
the original project just because an export omits it.

### JSON import contract

Import is a new supported interchange feature, not a legacy-world migration.
Prioritize the empty-Scene sharing workflow, then additive import into existing
artwork. Do not silently replace existing drawings or layer state.

1. Parse and validate the complete package, version, node tree, document fields,
   references, geometry, recovery records, and configured resource limits.
2. Show a dry-run summary of nodes/Drawings, bounds, assets/fonts, and retained
   recovery, with actionable unsupported-field or missing-dependency reports.
3. Choose placement explicitly: preserve coordinates or apply a translation.
   Uniform scaling can be added only with defined handling of stroke widths,
   text sizing, textures, and recovery geometry; do not resize Scene dimensions.
4. Map source Level/elevation/render constraints to the destination explicitly.
   Use the owner-approved one-Level/explicit-combine contract below; no
   best-effort source-to-destination Level matching is implemented.
5. Generate fresh destination Drawing/node/preset/recovery IDs and consistently
   remap membership, parent links, preset entries, and recovery references.
   IDs stay stable after import, but package IDs are not forced onto existing IDs.
6. Remap author identity to the importing GM and retain provenance separately.
7. Build the complete target state and order plan before writing anything.
8. Create and verify imported documents and metadata through an operation journal.
   Track exact IDs created by this operation; compensate only its own changes on
   failure and report unrecoverable partial state. Never delete existing artwork.
9. Keep imported artwork hidden from players until the GM explicitly applies the
   package's presentation. Preserve that presentation intent, but do not flash
   new artwork or reveal it midway through document creation.

**Owner-approved portable recovery exchange and first foundation:**

The owner explicitly chose preserving the baked form and full Restore chain,
not expanding originals on import or dropping destination recovery history.
Container choice is ZIP with a versioned manifest and original binary image
bytes, not base64 JSON. Baked Level-background import initially requires an empty
destination project and separate explicit background replacement approval; it
must not silently replace a prepared map or pretend a native background belongs
inside the hidden import wrapper.

Implemented `scripts/layers/recovery_file_bundle.js` as an opt-in, read-only
immutable-file foundation, not a public project exchange workflow. Its version1
`foundryshop-recovery-files` manifest lists exact verified-file references and
content-addressed ZIP entry names. Stored ZIP32 entries avoid image recompression
and compressed-expansion allocation. Before library extraction, validate the
complete single-disk central/local directory agreement, contiguous byte ranges,
safe unique filenames, no trailing/unlisted data, and caller-specified positive
ZIP32 byte/entry budgets. Compression, encryption, descriptors, extended/ZIP64
entries and comments are deliberately unsupported in this first codec.

File verification checks exact byte counts/SHA-256, typed archive envelopes and
checksums, static image containers/extensions, complete output/original-background
backup references, and ancestor checksum/Scene/Level/Drawing-composite agreement.
Omitted ancestors, duplicate operation identities, unreferenced images and
conflicting descriptors refuse. Identical image bytes may share one ZIP entry
while keeping distinct original verified path references in the manifest.
These hashes detect corruption; they do not authenticate an untrusted sender.

`prepareRecoveryFileBundle` collects completed same-Level apply records and their
retained evidence (including operations already restored). It verifies archive
descriptors against the journal, preserves original sources/paths unchanged,
checks the entire source Scene snapshot during reads and refuses any unfinished
optimization or project import. It performs no upload, download, journal or
native writes. This foundation neither judges the current live root replacement
nor turns an archived source-context file into destination-valid recovery.

Pinned MIT-licensed fflate0.8.3 is staged locally in `scripts/vendor` with its
license; build packaging already includes that folder. `npm run sync-vendor`
regenerates it from the lockfile dependency after explicit dependency restoration.
The initially selected0.8.2 reported a malformed-ZIP64 advisory during installation;
it was replaced with0.8.3 before validation, which reported zero known advisories.
No CDN, external code upload or runtime package fetch is introduced.

**Next required implementation, before public unblocking:**

1. Connect the source manifest described below to an enclosing project ZIP and
   collect ordinary texture/resource bytes. The recovery-files manifest alone is
   not a self-contained portable project.
2. Preserve the implemented current-root/retained-history validation below while
   adding enclosing-bundle validation; never require every historical composite
   to be live simultaneously or silently discard ancestors.
3. Prepare fresh Scene/Level/node/document/author/operation/path identities and
   geometry/order mappings consistently across every generation. Preserve source
   provenance without making destination Restore promise original source IDs.
4. Build destination-context archives/checksums with the intended hidden wrapper,
   presets, native ground/elevation policy and background before/after values.
   Review additive/combined-floor constraints; refuse unsupported composition
   rather than losing stack positions or weakening existing recovery validators.
5. Persist and independently read back all destination evidence under a durable
   import intent before native replacements; compensate only owned work and
   retain explicit unresolved recovery after ambiguous failures.
6. Wire ZIP export/import/resource/preview/background approvals and library policy,
   then verify native destination Restore of every retained generation, exact
   imported-original recovery and existing-artwork preservation.

Until those steps pass, ordinary JSON recovery-bearing export/import remain
blocked, no public recovery ZIP controls are registered, and production
optimization controls stay disabled. This is implementation groundwork, not
completed portable recovery acceptance.

Validation: ten new ZIP/collector regressions and147 combined recovery/exchange/
localization tests pass. Local0.1.0 build succeeds with the browser dependency
and its license packaged; changed-code editor diagnostics are clean. No deployed
world writes or native destination-import acceptance occurred in this slice.

**Source manifest/history follow-up:**

Implemented `scripts/layers/recovery_project_manifest.js` with version1
`foundryshop-recovery-project` source manifest, not an import command. Includes
explicit source Scene dimensions/grid/Level, canonical one-Level live Drawing
project/tree/presets, separate native author inventory, tracked baked Tiles and
complete chronological same-Level journal. Original IDs/authors remain internal
remapping inputs; this is not a promise to reuse source identities at destination.
Other native Scene content and untracked source Tiles are not included.

Every journal archive and output descriptor is checked against verified bytes.
The validator reverses complete history from the captured live state: undoing a
Restore recreates its exact historical replacement, and undoing an Apply expands
its exact archived originals. This verifies active roots, already-restored history
and Drawing -> repeat Drawing -> Tile chains without requiring every historical
composite to remain live. Later independent Drawings stay in the captured project.
Edited/missing/reassigned roots, occupied original IDs, changed restored originals,
untracked supplied Tiles, incomplete operations, file corruption/missing evidence
and semantic Scene/Level/layer-context conflicts refuse. Strictly newer revision-
only context uses the existing approved Restore comparison; no validator weakening
or archived-context rewrite is introduced.

Cross-generation resource inventory derives from the live project and every
archive's original Drawing texture/font and layer-default texture references.
Outputs map to included verified bytes; original background source paths map to
their preserved byte copies. Conflicting background-byte aliases refuse. Ordinary
textures without bundled bytes are explicitly marked missing, including textures
used only by now-archived originals; font families remain explicit requirements.
No ordinary resource fetch or font embedding occurs in this slice.

Read-only source collection guards the complete Scene snapshot through file reads,
manifest/hash validation and return. Live Drawings must round-trip exactly through
the canonical project/native-author representation; unsupported optional metadata
refuses rather than silently normalizing recovery state. Multi-associated live
Drawings refuse in this first single-Level recovery manifest. Source collection
does not persist, download, upload, create journals or mutate native documents.

Eleven new manifest/collector regressions cover live Drawing/Tile/background,
lineage at each successive Restore, restored-background then fresh Apply history,
later artwork, root/source/context conflicts, corrupt evidence, cross-generation
textures/fonts and background aliases. Initial test failure was a fixture returning
its mutable journal array; cloned fixture histories before mutation. Final combined
bundle/recovery/exchange/localization validation passes158 tests; editor diagnostics
are clean. Native destination import and deployed source collection remain untested.
Public recovery exchange remains blocked until enclosing ZIP/resource collection,
destination-context remapping, durable import and native Restore acceptance pass.

**Enclosing source ZIP and bounded texture collection follow-up:**

Implemented `scripts/layers/recovery_project_bundle.js`, with version1
`foundryshop-recovery-project-bundle` enclosing manifest. The manifest contains
the validated source project/history plus exact recovery-file and ordinary-image
descriptors. Archive/output/background-copy bytes and ordinary textures share
content-addressed stored-ZIP32 entries; byte-identical images share a ZIP entry
while retaining independent original source paths. This reuses the existing
strict ZIP admission/codec, not an opaque nested ZIP or a second unzip parser.

Read-only source collection includes archived-generation textures, not just
current baked roots. Only same-server ordinary images are supported in this
foundation. All ordinary paths are classified before any ordinary image request;
external/invalid ones refuse, without external contact or inferred consent.
Verified output/background copies retain their existing references, including
original background aliases; no refetch of the original background URL occurs.
Same-origin credentials, redirect refusal, HTTP/length checks, static image
container inspection and exact native bitmap/header dimensions reuse
`loadBakeImage`. Its optional byte budget checks declared lengths and each stream
chunk before retaining it; existing bake callers remain unrestricted unless they
explicitly supply this option. Recovery bytes count against the remaining
resource budget. Retained input bytes and final ZIP entries/overhead also fit
explicit caller budgets; this is not a claim of an exact JavaScript heap cap.
Owner/current Scene snapshot/abort checks persist through reads and ZIP return,
and decoded owned bitmaps close on completion/failure.

Pure ZIP decode validates exact enclosing keys/version, file inventories,
content hashes, image dimensions and the source/history validator before returning
data. Unknown/missing files, changed/truncated images and invalid history refuse.
No browser decode, GPU fidelity, font installation or destination writes occur
during pure decoding. Fonts/modules remain destination requirements; no blanket
embedding or remote fetch policy is introduced.

Six enclosing-ZIP/collector regressions and one optional stream-budget regression
cover Drawing/Tile/background roots, restored then reapplied ancestry, textures
present only in archived originals, font inventory, shared image entries, caller
input immutability, missing/extra/corrupt files, cumulative budgets, bitmap cleanup,
abort/stale context and refusal before ordinary external requests. Deployed source
collection and actual disk download remain untested. Public recovery-bearing
JSON exchange and production optimization controls remain unchanged/disabled.
Combined recovery/image/exchange/localization validation passes218 tests; build
succeeds with exact packaged runtime hashes and clean editor diagnostics.

Next: destination-context identity/path/author remapping across every retained
generation, rebuilt archives/checksums/journals, then durable reviewed import with
owned compensation and the separate empty-project/background approval policy.
Native import and successive Restore acceptance must precede public controls.

**Destination-bound recovery remapping follow-up:**

Owner explicitly chose rebuilding recovery against destination Scene dimensions,
padding and grid while preserving scene-pixel artwork coordinates and numeric
elevations. No scaling, translation or elevation-to-ground conversion is implied.
Native sort values remain unchanged in this evidence-only slice; additive stack
placement is a later reviewed import concern. Changed background fitting/grid/
Scene context does not establish pixel-equivalent visual presentation.

Implemented pure `scripts/layers/recovery_project_remap.js`. It first validates the
whole source ZIP, then allocates fresh layer/group/preset, Drawing/Tile and operation
identities across live artwork and every archived generation. Reserved destination
IDs/paths, source identities/paths, allocator reuse and malformed IDs refuse.
Ordinary textures, outputs and preserved copies move to fresh destination-root
paths; original-background aliases have distinct upload paths from immutable
backup copies, using preserved bytes without contacting the original URL.

All original/staged/after states, scope/membership/parent/preset references and
native Level associations map consistently. Drawing authors and operation owners
become the importing GM; source author provenance is returned separately.
Shared typed archive serialization rebuilds source/replacement digests, envelope/
file hashes and parent checksums; completed Restore entries retain exactly their
rebuilt Apply descriptors. Source Drawings/styles/coordinates/elevations remain
unchanged except the explicit identity/texture/context transformations. Arbitrary
third-party metadata is retained, not recursively guessed to contain IDs.

Drawing/Tile-only histories adopt the destination's complete native Level without
changing its background. Histories containing background operations import source
background/texture-transform states while preserving unrelated destination Level
settings (elevation range, foreground and flags). This carries the full source
background Restore chain, not an implicit promise to restore the destination's
pre-import background. The later import must separately review background effects,
preserve its own destination baseline for compensation and enforce an empty
destination project. The planner returns that destination baseline and upload
inventory but performs no file/native writes.

The rebuilt manifest passes the existing exact history validator and a rebuilt
enclosing ZIP encode/decode round-trip. Six regressions verify multi-generation
Drawing -> repeat -> Tile, completed Restore/reapply histories, fresh hierarchy/
preset/scope/texture references, original-background aliases, unchanged unrelated
destination settings, ID/path/budget refusals, input immutability and each successive
pure destination-bound Restore state down to exact remapped originals.
Combined recovery/image/exchange/localization validation passes224 tests. Build
succeeds, packaged runtime hashes match, and editor diagnostics/scoped whitespace
checks are clean. Initial new-test failures were fixture membership-context
ordering and an incorrect expected localization key, corrected in the tests.

This is not a native import or Restore acceptance result. Destination-tree merge,
hidden presentation/temporary staging, additive native ordering, strict native
schema round-trip, available fonts/modules, authority/currentness review, durable
intent before upload, verified readback and owned compensation remain necessary.
Reserved paths are supplied planning inputs, not an existing-file disk check.
No automatic Level matching, cross-floor recovery merge, public control enabling,
original Scene mutation or remote resource fetch was introduced.

**Hidden/native import preparation follow-up:**

Owner explicitly chose separate native Tile/background visibility approval rather
than limiting exchange to Drawing-only history. These native resources do not obey
Foundryshop's Drawing presentation wrapper. Temporary Tile staging must be hidden,
and final native visibility requires a separate reviewed decision. Background
replacement/visibility retains its separate approval and empty-project policy;
a Drawing preset must not be presented as controlling native Tiles/backgrounds.

Implemented `scripts/layers/recovery_import_preparation.js` as guarded, detached
empty-destination planning. Requires designated active GM, Scene update and file
browse/upload permissions, explicit Level, current-context/abort guard and complete
Scene snapshot equality. Existing import/optimization/recovery journals refuse.
Both Drawings and Tiles must be empty; retained layer/preset metadata requires
explicit replacement consent, with baseline returned. Additive recovery planning
is intentionally not implemented in this first preparer.

The remapper's optional hidden-presentation transformation builds one fresh closed
wrapper, inherited hierarchy/presets and Imported Presentation reveal intent.
Unassigned membership is determined across all historical originals/replacements,
not just the live project; every such Drawing maps to the same fresh Unassigned
leaf. Every archive uses the destination layer revision and complete wrapped tree,
with rebuilt exact descriptors/ancestry. Native Drawings remain separate from
temporary staged clones carrying hidden=true and the import-staging token.
Tiles get hidden staging clones but retain their reviewed final native hidden state.

Existing detached strict native schema validation is reused for every archive's
originals, hidden Restore originals, staged/after replacements, native Levels,
live artwork and import-staging clones. Native normalization refuses. Reverse
history checks existing Drawing stack rules in every state: tied/non-increasing
sorts needing repair or mixed elevation/interface modes refuse instead of silently
rewriting source sorts. Available fonts include archived originals; metadata module
checks include imported live/historical Drawings/Tiles, not unchanged destination
Level flags. Native resource/render/audience acceptance is still distinct from
detached schema validation.

Seven new preparation regressions and expanded hierarchy coverage verify hidden
live/archived Unassigned and managed layers, preset intent, restored/reapplied
history, separate visibility decisions, Tile staging, empty-project/metadata/journal
policy, historical modules/fonts, native normalization refusal, cancellation/stale/
authority changes and historical sort/renderer-mode refusal. Test-native classes
are detached fixtures, not deployed Foundry acceptance. One initial fixture exposed
the dependency scan including unrelated destination Level flags; restricted it to
imported native artwork instead of requiring unrelated existing namespaces.
Combined preparation/recovery/image/exchange/localization validation passes237
tests, including existing native acceptance contracts. Build succeeds with exact
packaged runtime hashes; editor diagnostics and scoped whitespace are clean.

No approval consumed, remote request, file/disk collision check, upload, durable
intent or native Scene write occurs in this slice. Next required work is reviewed
approval bound to the prepared plan, durable import journal before uploads, verified
asset readback, owned staged document/tree/Level execution and compensation with
ambiguous outcomes retained. Native import and successive Restore acceptance,
player audience testing and actual ZIP download remain required before controls.

**Exact approval and durable import intent follow-up:**

Implemented `scripts/layers/recovery_import_intent.js`. Preparation now retains a
private genuine-plan registration; fabricated clones or changed plan data/bytes
refuse review. Review captures the complete plan digest and destination snapshot,
rechecks active-GM/permissions/current Scene/Level/abort, and rechecks available
historical fonts and imported metadata modules. Approval must name the exact plan
digest and all required decisions, including separate native Tile visibility,
background replacement/visibility and retained empty-metadata replacement where
applicable. This is an internal approval capability, not a public dialog or a
caller-supplied boolean that bypasses review.

The retained evidence project ZIP has its own fresh planned verified-file
descriptor. Total reviewed upload budget includes that ZIP plus all intended
image/archive uploads; a collision with supplied reserved paths refuses. No disk
collision probe or file upload occurs yet.

`beginRecoveryImportIntent` consumes the approval and writes only version4
`foundryshop-recovery-import` intent under the existing `projectImportJournal`
flag using the per-Scene operation queue. Stores import token/owner/Scene/Level,
plan and destination digests, ZIP/upload references, staged/final Drawing/Tile
digests, complete baseline/target layer trees and Levels, exact optimization
history and required decisions. Intent shape/history/file references validate
before the write. Exact journal readback and unrelated complete Scene equality
are checked afterward, including authority/currentness/abort after the await.
This is not atomic compare-and-swap or a guarantee against other clients.

Any update failure, divergent readback, unrelated mutation or lost authority/
currentness after the write becomes an explicit unverified-intent error. No
uploads/native changes follow; the approval stays consumed even when no write
was observed. Intent is retained when present and must be re-read/reconciled,
never blindly retried or automatically cleaned up. Its planned ZIP is not yet
durable evidence if upload never occurred.

Ordinary version1-3 Drawing-only cleanup continues to refuse version4; the discard
dialog now gives an explicit localized explanation instead of reading nonexistent
Drawing IDs. Ordinary staging ownership hooks guard their expected ID-array shape
and do not grant bypass for this different intent format.

Five new regressions exercise approved Tile/background/metadata decisions,
byte/plan tampering, forged capabilities, unavailable resources, caller budgets,
evidence-path collision, JSON-roundtripped journals, malformed references and
uncertain updates before/after persistence, changed readback, unrelated mutations,
lost authority, cancellation and stale context. They assert exactly one journal
write, no uploads/native creation and consumed approval. Write tests use fixtures;
deployed journal persistence has not been exercised.
Combined intent/preparation/recovery/image/exchange/localization validation passes
242 tests. Build succeeds with exact packaged runtime/localization hashes; editor
diagnostics and scoped whitespace checks are clean.

Remaining: public reviewed dialog, guarded existing-file checks, verified evidence/
asset upload and readback, journal phase progression, native staging/tree/Level/
history execution, release after exact final-state checks and owned compensation/
reload reconciliation. Native successive Restore/player acceptance and actual ZIP
download remain gates. Production controls and public recovery exchange stay off.

**Verified recovery asset stage follow-up:**

Implemented the internal `uploadRecoveryImportAssets` stage alongside the
approval/intent boundary. Requires that exact capability's intent write to have
passed readback; fabricated, unverified or reused asset capabilities refuse.
This stage is session-owned, not a reload resume endpoint. New stages may not
blindly adopt existing files or retry an uncertain previous upload.

All evidence-ZIP and image/archive paths preflight together against a valid
destination folder listing before any upload, rejecting URI-decoded case-insensitive
collisions and malformed listings. Planned bytes must match durable intent.
Shared `persistVerifiedFile` repeats each path's collision check immediately before
upload, retains possibly written paths on ambiguous results and verifies exact
byte size/hash/path readback. The evidence ZIP uploads first, so a later asset
failure can retain the reviewed project/history evidence. Folder checks are not
atomic server reservations and cannot eliminate races with external writers.

After the last upload, every file is independently re-read and verified again.
The retained ZIP passes full container/manifest/resource/history decoding and
matches the reviewed manifest. Only then does the version4 journal transition
from intent to `assets-verified`, with exact readback and complete unchanged
non-journal Scene state. Owner/active-GM/permissions/currentness/abort, exact
journal and historical fonts/modules are checked throughout asynchronous reads.
No Drawing/Tile creation, tree/Level/background change or optimization-history
installation occurs. Byte verification does not establish native renderer/
placement/audience acceptance.

Any preflight/read/upload/phase failure retains the journal and all present files,
consumes that asset attempt and raises an explicit interrupted-assets error.
Uncertain phase writes carry their exact phase and forbid native continuation.
There is no deletion, success-shaped fallback, automatic retry or ordinary JSON
cleanup. Reload-safe fresh evidence reconciliation, owner handoff and explicit
retry/compensation policy remain required.

Six new regressions exercise evidence-first ordering, exact final inventory/
JSON-roundtripped assets phase, initial encoded/case collisions, late collision
preservation, upload acknowledgement loss, immediate/final-byte corruption,
authority/permissions/cancellation/stale/journal/source/font changes and uncertain
phase updates. Assert no native changes and retained evidence/no retry. Tests use
fixture storage, not live browser uploads. Initial failure exposed a wrong phase
argument in the newly added error path; corrected it and rechecked the stage.
Combined asset/storage/preparation/recovery/exchange/localization validation
passes260 tests. Build succeeds with exact packaged runtime bytes; editor
diagnostics and scoped whitespace checks are clean.

Next: reviewed reload reconciliation and phase/native execution with exact owned
staging/release and compensation. Public approval UI, deployed file persistence/
native successive Restores/player acceptance and actual ZIP download remain
unfinished; controls remain disabled.

**Fresh pre-native reconciliation follow-up:**

Implemented `scripts/layers/recovery_import_reconciliation.js`, a fresh read-only
inspector of version4 intent/assets-verified journals. It consumes serialized
durable intent and disk evidence only, not the old preparation registration,
approval capability or upload-session flags. Explicit total evidence byte/entry
budgets are checked before file reads. Current owning designated active GM,
file-browse permission, Scene update permission, explicit currentness/abort,
complete snapshot and exact journal equality guard asynchronous work.

The destination must remain the exact pre-native baseline digest and empty
Drawing/Tile state without other recovery history. Removal of the inspector's
own journal accounts only for absent/empty namespace containers introduced by
flag persistence; no native or unrelated context change is normalized away.
Partial native states and different owners refuse in this first inspector.

Folder listing admits exact paths only; duplicate encoded/case aliases or
conflicting case variants refuse. Missing references are explicitly inventoried,
not swallowed HTTP failures. Present files are independently size/hash verified;
missing-after-listing, corrupted or redirected reads refuse. A retained evidence
ZIP passes strict full decode/history validation, then exact target tree/Level/
chronological journal and complete planned upload-byte closure are compared.
Original-background aliases derive from preserved byte copies, not original URL
requests. Live and temporary staged Drawing/Tile digests are compared to intent,
detached native schemas recheck all generations, and historical fonts/modules
must remain available.

An intent with no ZIP reports missing-project-evidence; a verified ZIP with
missing uploads reports partial-assets; full verified evidence reports
all-assets-verified regardless of whether the journal is still intent. The latter
does not authorize phase advancement. An assets-verified journal with missing
files is an explicit inconsistency and refuses. No retry/adoption, handoff,
approval, native write, phase update or cleanup occurs.

Six regressions use fresh JSON-roundtripped journals and fixture storage without
passing approval capabilities. Cover no/partial/complete evidence, Drawing/Tile/
background alias closure, corrupt/missing/path-conflicting files, target/upload/
native-digest mismatches, pre-read budgets/baseline, schema/dependency loss and
asynchronous journal/authority/cancellation/currentness changes. This proves
session-independent data inspection, not deployed browser reload or physical
network/crash acceptance (still owner-deferred).
Combined reconciliation/storage/recovery/exchange/localization validation passes
266 tests. Build succeeds with exact packaged runtime bytes; editor diagnostics
and scoped whitespace checks are clean.

Next: explicitly reviewed native execution and partial-native reconciliation/
owned compensation, plus any recovery retry/owner-handoff policy. Public controls,
actual ZIP download, deployed import and native successive Restore/player
acceptance remain gated.

**Reviewed hidden native staging and partial-state inspection follow-up:**

Implemented `scripts/layers/recovery_import_execution.js` for the bounded hidden
staging step, not final import execution. Review freshly inspects complete retained
evidence at assets-verified, captures exact destination state, and requires explicit
import token/plan digest plus hidden-staging consent. Staging consumes this capability,
re-reads every immutable file before native writes, installs the exact closed tree,
verifies/journals tree-installed, creates exact hidden Drawing/Tile staging sources,
and verifies/journals native-staged. Background-only projects install the tree and
phases with no document creation; the selected Level remains the destination baseline.

Locked historical Drawing layers use `recovery_import_native_guard.js`: create options
are registered only around the awaited create, against the exact Scene, owned
tree-installed intent and exact staged source. The original implementation required
options object identity; the later live locked-layer follow-up replaces this with
a scoped token because Foundry copies options. Changed sources, foreign owners/
intents and fabricated/revoked permissions still cannot use that create bypass.
Normal editing/update/delete gates are unchanged. This does not release staging
or permit arbitrary changes on locked layers.

Native transitions verify complete owned Drawing/Tile collections, expected tree/
journal and unchanged chosen Level, plus unrelated full Scene/other-Level context.
Authority/permissions/currentness/cancellation and historical fonts/modules remain
guards. Existing imported optimization history is not installed in this slice.
Partial creates, divergent readback, unrelated changes or uncertain tree/phase
updates stop explicitly with tree/files/documents/journal retained, approval consumed
and no automatic cleanup or retry. These journal writes are not atomic CAS.

Fresh reconciliation now admits exact hidden owned staging at assets-verified,
tree-installed or native-staged, including a tree or create write that completed
without a verified phase update. Missing/present native IDs are reported. Before
baseline digest comparison only exact owned staged collections and exact before/
after tree differences are removed; unrelated Scene and Level changes still refuse.
Native-staged requires every staged document present. Edited/foreign-stage objects,
unowned artwork, incompatible Level/tree and falsely completed phase refuse.
No partial-state report itself authorizes retry, release or destructive cleanup.

Six new regressions cover Drawing/Tile/background staging, phase ordering, exact
native snapshots and revoked create permission, fresh hidden partial inspection,
forged/incorrect approvals, changed byte evidence, uncertain tree/phase/create
writes, unrelated/authority/dependency changes, edited/unowned documents and missing
completed staging. Initial fixture failure came from its Scene serialization exposing
mock methods instead of plain native sources; corrected fixture serialization.
These are fixture document writes, not deployed Foundry/player/native Restore
acceptance.

Next required final execution must separately bind native Tile/background visibility
decisions, install exact recovery history, verify final native states, release owned
staging and remove intent only after complete validation. General handoff/retry policy remains pending. Public controls, actual ZIP download and
live successive Restore/player acceptance remain disabled/unverified.
Combined native-staging/reconciliation/storage/recovery/exchange/localization
validation passes272 tests. Build succeeds with exact packaged runtime hashes;
editor diagnostics and scoped whitespace checks are clean.

**Reviewed hidden-staging compensation follow-up:**

Implemented `scripts/layers/recovery_import_compensation.js` as a bounded,
separately approved destructive cleanup, not an automatic staging error handler.
Review uses fresh retained ZIP/files and serialized journal inspection, requires
exact untouched destination/owned state, and lists the documents to delete and
files to retain. Explicit token/plan digest, hidden-deletion consent and file-retention
consent grant a single-use capability. Execution re-reads every immutable file and
persists/verifies `compensating` before any deletion.

Only exact hidden staged Drawing/Tile sources from that review may be deleted.
The Drawing delete hook accepts a scoped options-identity/exact-source permission
only during the awaited delete under the exact owned compensating intent; copied
options, edited sources and revoked permissions cannot bypass locks. Both owned
collections must be verified empty before restoring prior layer metadata.
The selected Level/background and unrelated full Scene/other-Level state remain
exact; optimization history is neither installed nor deleted.

Partial/uncertain deletes, phase/tree acknowledgement loss, divergent state or
authority/currentness loss stop explicitly with files, receipt and remaining
documents retained. Fresh read-only inspection recognizes exact partial
`compensating` states and complete `compensated` state. A later cleanup is possible
only through a new exact review/approval of remaining documents, not an automatic
retry. Edited/unowned artwork, unrelated edits, missing/corrupt evidence or
inconsistent completed receipt refuse.

Completion retains all uploaded files and the `compensated` journal receipt:
it deliberately does not clear the import block or authorize a new upload attempt.
Receipt clearing/general retry/owner handoff and final native visibility/history
release remain separate gates. Seven added regressions cover exact Drawing/Tile/
background cleanup, pre-native and partial staging, approval/byte/context refusal,
uncertain phase/delete/tree writes, fresh remaining-state review, scoped permissions
and retained files/receipt. These are fixture writes, not deployed Foundry
compensation, crash/network testing, player concealment or native Restore acceptance.
Public recovery exchange remains disabled.
Combined recovery/storage/layer/exchange/localization validation passes 383 tests.
Build, packaged runtime hashes, editor diagnostics and scoped whitespace checks
pass.

**Reviewed final recovery-import release follow-up:**

Implemented `scripts/layers/recovery_import_finalization.js` for fresh complete
native-staged imports only. Review re-inspects retained evidence/native schemas
and dependency availability, captures an exact snapshot, and requires token/
plan digest plus finalization consent and separate repeated native Tile/background
visibility decisions. Native Tiles/backgrounds can become immediately player-visible;
the Drawing wrapper does not control them. Source historical backgrounds, not the
destination baseline background, remain the imported Restore targets.

Execution consumes that capability and freshly inspects all evidence before writes.
It verifies `releasing` before installing exact optimization history, and verifies
`history-installed` before native release. Exact hidden-to-final Drawing patches
use an options-identity/source/patch-scoped permission only during awaited update;
copied options, changed sources/patches and revoked permission refuse lock bypass.
Final native hidden values are preserved; only owned staging markers (or the
temporary module namespace if absent from the final source) are removed.
The closed Drawing wrapper is not revealed. Only reviewed background/textures
change on the chosen Level; other settings and other Levels stay exact.

Complete native collections, tree/history/journal/Level and unrelated full Scene
state verify after every write, with authority/currentness/cancellation and
historical dependency checks. Fresh final disk/ZIP/native verification precedes
completion and import-journal removal, followed by complete receipt inspection.
All immutable files remain retained; exact complete receipt is returned.

Partial/uncertain release, history/phase acknowledgement loss, divergent readback
or context/dependency loss stop explicitly without automatic retry or compensation.
Fresh read-only inspection accepts only exact owned staged/final source digests,
exact baseline/final Level and exact absent/imported history at supported phases;
native-released/complete require all final sources and final Level/history.
The pre-release hidden-staging compensator explicitly refuses release phases.
`inspectCompletedRecoveryImport` accepts an explicit serialized complete receipt
only when import journal is absent and verifies final native/history/evidence and
the original unrelated baseline. It handles uncertain cleanup read-only, not
receipt discovery, native resume, retry, ownership handoff or further writes.

Ten added regressions cover exact Drawing/Tile/background completion, native
visibility approvals, byte/schema/font checks, uncertain intent/history/phase/
native/Level/cleanup writes, partial mixed staged/final collections, unrelated/
owned edits, final receipt refusal and multi-generation history binding. Earlier
validator test now uses an unknown phase instead of the newly supported complete
phase. Fixture Scene serialization includes native Level collections, allowing
exact chosen-Level baseline normalization. These are fixture document writes,
not deployed rendering/player or successive native Restore acceptance.
Public exchange, release-phase recovery, compensated-receipt clearing and owner
handoff remain gated. Owner-deferred real crash/network tests were not performed.
Combined recovery/storage/layer/exchange/localization validation passes 393 tests.
Build, seven packaged runtime hashes, editor diagnostics and scoped whitespace
checks pass.

**Initial deployed portable recovery acceptance and persistence corrections:**

Verified all seven deployed import runtime hashes and refreshed GM authority before
testing only disposable Scenes. Two actual successive Consolidate operations
completed with real rendering, immutable PNG/archive persistence and exact native
apply; source collection returned a self-contained 15,871-byte ZIP with both Apply
generations and explicit parent ancestry. Destination used different dimensions
and grid distance, retained explicit unrelated Scene/Level metadata, and passed
detached remapping/history/order/native-schema preparation.

Initial source fixture had undefined native name/text defaults; exact archive
admission correctly refused. Explicit fixture name/text values fixed that input.
The initial selection reader erroneously included its newly created replacement;
execution stopped with hidden replacement/intent retained. Fresh ordinary
Consolidate resume then completed using an exact owned-source selection reader.
No real crash/network outage was simulated, and neither refusal was bypassed.

First destination intent write exposed host `_stats.modifiedTime` changing during
the importer's own Scene update. Added `recovery_import_scene_state.js` to exclude
only host-maintained modification time and modifier identity from post-write
semantic comparisons; all substantive fields/stable metadata remain checked.
Intent destination digest, intent/assets baseline, unrelated staging/release/
compensation comparisons and fresh/completed inspection use the shared helper.
Pre-write approval snapshots remain exact, including modification bookkeeping.
Mocks now change host stats during native writes; three regressions check preserved
stable metadata, non-mutating comparison and stale approval refusal. After deployment
of this fix a fresh live destination intent write verified successfully.

Foundry v14 FilePicker then explicitly refused `.zip` upload. Evidence upload stopped
before any file or destination artwork was written; approval was not retried.
The owner selected a genuine supported JSON evidence envelope rather than requiring
server ZIP-upload support. Added `recovery_import_evidence.js` with format
`foundryshop-recovery-import-evidence`, version 1: JSON contains labeled base64 bytes,
exact size and SHA-256 of the unchanged portable ZIP. The server intent references
`import-<token>.json` with the JSON's own exact size/hash; upload uses application/json.
Portable exchange remains the original strict self-contained ZIP. This is not a ZIP
renamed to evade policy and does not modify server upload permissions.

Encoding checks exact full envelope/base64 budget before allocating encoded data.
Decoder bounds JSON and decoded bytes, verifies exact version/schema/canonical
base64/inner hash, then invokes shared strict ZIP and complete recovery validation.
Approval budgets include JSON overhead plus all planned files; asset final readback,
fresh reconciliation and complete receipt inspection use the same decoder.
Three added regressions cover multi-chunk exact round-trip, exact budget thresholds,
malformed/altered envelopes/inner ZIP, entry bounds and supported upload MIME.
No automatic uncertain-file retry/adoption or legacy journal migration is added.

All three disposable source/destination Scenes were removed under the existing
fixture cleanup authorization. Complete original Scene remained exact (47 Drawings,
0 Tiles); four immutable source archive/output files remain retained. No Aroh/client
visibility or imported native finalization/Restore acceptance occurred. The new
JSON evidence build awaits deployment and a fresh disposable import acceptance run.
Real crash/network testing remains owner-deferred; public exchange remains disabled.
Combined related regression validation passes 399 tests; build, packaged runtime
hashes, diagnostics and scoped whitespace checks pass.

**Deployed Drawing-only portable recovery acceptance follow-up:**

Verified deployed JSON-evidence/intent/reconciliation hashes and designated GM
authority after refresh. Created a fresh disposable two-stroke source, performed
two real successive Consolidate operations using exact owned-source selection
readers, and collected both completed generations/parent ancestry into a strict
15,862-byte portable ZIP. Source operations rendered and persisted through real
native Foundry and FilePicker APIs; internal review callbacks explicitly approved
each bounded fixture step, not public exchange-dialog UX.

Destination used 1000x700 rather than 800x600, and grid distance 10 rather than 5.
Explicit retained Scene/Level metadata, coordinates, numeric elevation and source
sorts survived detached remapping/native/order/history checks. Durable intent,
23,801-byte versioned JSON evidence envelope and four immutable PNG/archive assets
uploaded successfully and were independently reread/verified. Fresh inspection
reported all-assets-verified before any artwork. Hidden staging installed the
closed tree, created the exact native-hidden/importStaging Drawing and reached
native-staged; selected Level stayed unchanged and optimization history was absent.

Separate final release installed the two complete rebuilt Apply entries and parent
reference, released only owned staging to exact final native source, kept the Drawing
wrapper closed, verified final evidence/native/history, removed import journal and
returned complete receipt. Fresh completed-receipt inspection passed; selected
Level remained exact. Foundry emitted its existing legacy forced-deletion syntax
compatibility warning on staging removal, but exact removal and final readback passed.
No speculative syntax/API rewrite was made as part of this acceptance-only slice.

Successive native Restore of the imported latest Apply then its parent passed.
Complete native sources were compared against each imported archive: first composite
exactly reappeared, then both original strokes exactly reappeared, including fresh
identities/GM authorship, layer membership, geometry/styles/native metadata.
All four Apply/Restore journal entries completed; complete selected Level and closed
tree stayed exact. This validates two retained Drawing generations, not every
combination of Tile/background/multi-Level history.

Aroh stayed connected under its player identity without rejoin during persistence.
After owner made its tab visible, it viewed the disposable destination. Restored
strokes remained native hidden=false but actual Drawing/shape presentation suppressed;
two renderer pixels sampled destination background [51,68,85,255]. Explicit GM
application of Imported Presentation opened root and Imported Unassigned gates.
Player pixels then sampled red [255,51,0,255] and blue [0,68,255,255], and both shapes
were visible. This is bounded restored-stroke conceal/reveal evidence, not full-frame
fidelity, fog/vision/elevation certification or baked-composite player sampling.

A separately prepared/uploaded hidden-staging fixture passed reviewed compensation:
only its owned hidden Drawing was deleted, prior empty tree and selected Level were
exact, compensated journal remained, and all five evidence/assets verified. A normal
GM page reload discarded preparation/approval capabilities. With GM tab visible,
fresh serialized-journal/disk inspection again reported compensated-retained-evidence.
All 14 newly created source/import/compensation evidence/output/archive files passed
bounded byte/hash rereads. This tests reload-independent compensated inspection,
not release recovery or completed-receipt persistence across reload.

Returned both clients to the original Scene and removed only the three named
disposable fixtures after verifying completed/compensated ownership state. Full
original Scene matched its pre-test canonical snapshot (47 Drawings, 0 Tiles).
Every immutable file remained retained; transient acceptance sessionStorage was
removed. No runtime edits in this slice; prior 399-test/build/hash validation remains.
Tile/background imported visibility/Restore, native locked-layer permissions,
full-frame artwork fidelity, actual ZIP disk download, public exchange UX and
release-phase recovery remain gated. No real crash/network outage was simulated.

**Deployed native Tile portable recovery acceptance follow-up:**

Disposable source `EmLnXXIxMzNDSunS` baked two explicit strokes into a real player
Tile (`FSOAmilCJnbg8Mdx`). The strict 9,772-byte portable ZIP remapped into empty
destination `zGzq2WHbLsy5YEx3` with different dimensions and unrelated native Level
metadata. Import `gZQzVYb81kDcr3Yn` uploaded a 14,645-byte JSON evidence envelope,
image and remapped archive; fresh hidden staging and exact final release passed.
Both preparation and finalization required separate native-Tile visibility approval.
Final native Tile, Level, history and closed Drawing wrapper were exact.

Aroh's visible client sampled background [51,68,85,255] while staged; after release,
the Tile was visible and sampled red [255,51,0,255] and blue [0,68,255,255], despite
the closed Drawing wrapper. These are bounded baked-image pixel checks, not
full-frame fidelity, fog/vision/elevation or hidden-tab transition certification.

Restore `GRaYVAi45eZ7uDab` initially retained an intent without native changes because
the placement adapter erroneously required private imported originals to be public
for a player Bake, even while removing that Bake. Placement now binds an explicit
Apply/Restore action. Apply retains existing exposure, ground and background mapping
checks; Restore uses separate archived-placement approval, exact archive identity,
native schema/recovery checks and unchanged Scene/Tile context. Drawing run checks
remain. Native Tile/background Restore no longer imposes a new public Bake or
full-scene background mapping. Localized review explains original native visibility
and presentation gates, and source historical-background rather than destination
baseline semantics. Three regressions cover private restored originals, exact archive/
context binding and action-specific dialogs.

After owner deployment and normal GM reload, fresh reviewed resume completed that
retained intent. Both original remapped Drawing sources matched the full archive;
the Tile was removed, both journal entries completed, and destination Level/closed
tree remained exact. Settled visible-player samples showed background and invisible
Drawing shapes. An initial sample immediately after waking the hidden tab failed
the expected sample; subsequent explicit samples passed. No transition-frame or
full-frame claim is made. Completed-receipt inspection after reload refused the
subsequent Restore intent/history, as intended; unchanged complete-receipt reload
acceptance is not established by this run.

All five source/import files passed bounded byte/hash rereads and remain retained.
Both named disposable Scenes were removed, both clients returned to the original
Scene, and its full snapshot remained exact (47 Drawings, 0 Tiles). Temporary
acceptance sessionStorage/globals were removed. Selected placement/native/workflow/
dialog/recovery/localization validation: 148 pass, 0 fail; build/editor diagnostics
pass. A wider run including the existing Drawing workflow tests reports one unrelated
invalid-options error-wording mismatch; it is not changed by this fix.
Native background import/Restore, locked-layer hooks, unchanged completed-receipt
reload, full-frame fidelity, public exchange UX and release-phase recovery remain
gated. No real crash/network interruption was simulated.

**Deployed native background portable recovery acceptance follow-up:**

Disposable source `PBASvgF39brgoVub` performed a real 800x600 full-scene background
Bake `BIIiz1r1ZhI7zagG` over an existing retained PNG, preserving an exact original
byte-copy. Its 23,002-byte portable ZIP remapped to empty 1000x700 destination
`jjXOW0W0ktfSMXI5`. Import `1Zg2npInOF2Slpzo` uploaded 32,293-byte JSON evidence
and four assets: baked image, preserved original image, distinct original-background
URL alias and archive `l62Q76VzuJT8m4p5`. Staging left the complete destination
Level unchanged. Finalization separately approved background replacement/visibility;
exact final Level/history, closed wrapper and completed-receipt inspection passed.

Aroh's visible client sampled destination background [51,68,85,255] before release.
After release, sampled baked green [0,204,68,255] and yellow [255,204,0,255] appeared
despite the closed Drawing wrapper. Both artwork pixels moved with native background
mapping; unchanged image bytes do not imply pixel-identical cross-dimension placement.
A normal GM reload discarded capabilities. Fresh unchanged complete-receipt
inspection reported completed-import with no import journal; fresh disk/native/
baseline verification passed. This closes the bounded complete-receipt reload gate.

Initial Restore refused before intent/native writes because the entry adapter
required source bitmap 800x600 to match destination Scene 1000x700. Shared recovery
output verification now obtains background dimensions from exact hash-bound persisted
static image bytes and verifies browser decode against those dimensions. Native
placement review separately retains destination rectangle/context. Preview/display
inputs use actual bitmap dimensions. Drawing/Tile image-to-geometry dimension checks
remain exact. The helper covers Restore, resume and disconnected-owner takeover;
no archive schema migration, image resampling, missing-file fallback or acceptance
of changed hashes. Three regressions rebind background Scene context 8x4 to 10x7
and verify exact Restore, interrupted resume and takeover with retained 8x4 bytes.
Selected workflow/placement/native/media/recovery/dialog/localization: 161 pass,
0 fail; build/packaged runtime hash/editor diagnostics pass.

After owner deployment and normal reload, completed-receipt inspection again passed.
Fresh Restore `11Ci3dSxLcrqbUXu` completed, reproducing both complete remapped native
Drawing sources and the full historical Level target. Unrelated destination Level
metadata stayed exact. Background reverted to uploaded source-original URL alias
`image-1Zg2npInOF2Slpzo-2.png`, not destination pre-import background; native URL
bytes matched the preserved original file exactly. Both journal entries completed
and the Drawing wrapper stayed closed. Settled visible-player samples showed source
historical red [255,51,0,255] and blue [0,68,255,255], with both restored Drawing
shapes invisible. This verifies source-history semantics and native background
public visibility independently of Drawing gates.

All eight new source/import evidence/output/archive/backup/alias files passed
bounded byte/hash rereads and remain retained, along with the pre-existing PNG.
Both named disposable Scenes were removed, both clients returned to the original,
and its full canonical snapshot stayed exact (47 Drawings, 0 Tiles). Temporary
acceptance sessionStorage/globals removed. No real crash/network test.
Full-frame/hidden-tab transition fidelity, native locked-layer create/update/delete
hooks, actual ZIP disk download, public exchange UX, release-phase partial recovery
and compensated-receipt clearing remain gated.

**Deployed inherited locked-layer recovery-hook acceptance follow-up:**

Disposable source `XRz1mlXY8e7SCCLp` retained a Drawing in unlocked child ink under
a locked ancestor group, plus a real unassigned Consolidate generation
`35hxtzP6k1VFDx7f`. Its 10,464-byte portable recovery ZIP preserved complete
artwork/history and the inherited lock. Initial destination `UAybX96aQKOQhWXO`
stopped at tree-installed with one exact hidden unassigned composite present and
the locked Drawing absent. Standard layer-lock notification was surfaced; no
final release/history installation occurred. Fresh inspection verified partial
owned staging and every file; the original Scene stayed exact.

Verified Foundry 14 native backend source explains the mismatch: preCreate,
preUpdate and preDelete derive fresh hook-options objects by object rest, so
WeakMap registration of the caller's options cannot survive. Native update
cleaning also expands dotted flag-removal paths before the hook. Scoped guard
registries now key an opaque random token carried in copied operation options,
with separate create/delete/update maps. Exact Scene identity, active owning GM,
intent identity/phase and full document source remain bound. Update matches only
the registered hidden/staging-removal patch or its exact host-expanded shape;
no broad metadata normalization. Tokens are removed after awaited native calls
in existing finally blocks, so copied options lose authority too. Fabricated
tokens, different actions, changed source/context/owner and post-revocation calls
refuse. Same-client trusted code is not a security boundary; this is a scoped lock
exception, not a public permission mechanism.

Two dedicated guard tests cover host deep copies, cross-action/fabricated tokens,
authority/source/intent changes, revocation of copies, exact expanded patches and
rejection of unrelated changes. Existing recovery fixtures now emulate host copies
rather than falsely requiring hook options identity.
Selected guard/recovery/layer validation: 199 pass, 0 fail. Build, packaged runtime
hash, editor diagnostics and scoped whitespace checks pass.

After owner deployment and normal GM reload, fresh review separately compensated
the initial partial fixture and verified compensated-retained-evidence. New release
fixture `IBkmG5qfu8McOhhW` created both exact hidden sources, including the inherited
locked Drawing, then separately reviewed finalization released its exact native
source and removed staging without changing the lock or opening the wrapper.
Fresh completed-import inspection passed. Ordinary native create/update/delete
attempts with fabricated tokens before and after release each returned zero
changed documents with full Scene snapshots unchanged.

New compensation fixture `NX62MtzSmzmgSbvQ` created exact hidden locked staging.
Ordinary create/update/delete again refused with standard lock errors and unchanged
full snapshot. Fresh compensation deleted both exact hidden sources despite the
inherited lock, restored exact prior tree/Level, retained its journal and reported
compensated-retained-evidence. No unlock, hook suppression or noHook option used.
This closes bounded inherited locked-layer create/release/delete recovery-hook
acceptance, not ordinary optimization Restore through locked layers.

All 11 source/import evidence/output/archive files passed bounded byte/hash rereads
and remain retained. All four named disposable Scenes were removed after complete/
compensated state verification. Both clients are on the original Scene, whose full
canonical snapshot remains exact (47 Drawings, 0 Tiles). Temporary acceptance
sessionStorage/globals removed. No real crash/network test.
Full-frame/hidden-tab transition fidelity, public recovery
UX, release-phase partial recovery and compensated-receipt clearing remain gated.

**Reviewed portable ZIP download implementation and deployed acceptance:**
Internal `reviewRecoveryProjectExport` collects the complete strict project ZIP,
keeps a private immutable byte copy and binds its fingerprint to exact full Scene,
current owner and cancellation/currentness guards. Explicit download/server-file
retention approval grants a private single-use capability; fabricated/reused
capabilities or changed context refuse. `downloadRecoveryProjectExport` creates
an actual `application/zip` Blob and sanitized filename, checks context again
immediately before clicking, removes its anchor and revokes its object URL.
Element-creation/click errors also clean up resources and consume authority.
Its receipt is only `download-initiated`, never proof of a saved file.

`promptRecoveryProjectExport` presents localized name/size/hash/required fonts and
disclosure that full ancestry may contain historical GM-private artwork. Fonts/
modules are not embedded, all server evidence remains retained, and this approval
cannot upload, import, mutate native state or authorize exposure. Cancel/close
grants no capability. No public toolbar registration. Regression coverage includes
exact Blob bytes/type/filename, tampered reviews, source drift, fabricated/reused
authority, error cleanup/retry refusal, modal cancellation and source drift while
the modal is open. Selected recovery/bundle/localization validation: 78 pass.

Disposable source `tD64Cqkr8wjpQ1AD` contained complete Consolidate generations
`J3YJfRveHVmDrW6a` and `ZzJYem3t8CDcvAc8`, with the second parent-linked to the
first. Real localized approval returned a 15,847-byte receipt with SHA-256
`a95f361ab9b55ca815588964b3b035a59bf596c952b59352c7f6158ba441ebb7`.
Browser automation reported no download event; the owner supplied the saved ZIP.
Local disk reading matched the exact receipt size/hash and strict decoding verified
both complete generations, parent linkage and all four recovery files. Independent
fresh collections had equal decoded manifests but differing ZIP container hashes;
disk acceptance correctly binds to its own approved bytes, not recollection.
Live No-button cancellation left the full source snapshot exact.

All four immutable archive/output files were reread/verified and retained.
Only the named disposable source was removed after checking complete history.
Both clients returned to the original Scene with 47 Drawings and 0 Tiles; its full
snapshot was exact. Acceptance sessionStorage/global removed; owner-saved ZIP
preserved. No real crash/network test. This closes bounded reviewed ZIP download/
disk verification, not public recovery UX, full keyboard/accessibility,
release-phase partial recovery, compensated-receipt clearing or transition fidelity.

**Owner-approved explicit release-resume implementation (live acceptance pending):**
The owner approved separately reviewed continuation of only exact retained release
state, without automatic retry/rollback or owner takeover. Internal
`reviewRecoveryImportFinalizationResume` uses fresh strict read-only reconciliation
of `releasing`, `history-installed`, `native-released` or `complete` intent. Its
review discloses phase, final/staged native inventory, exact target history/Level,
remaining-step semantics and continuing file retention. Approval requires
`resume-finalize-import` plus renewed Tile/background visibility decisions; it is
not interchangeable with ordinary hidden-staging finalization approval.

`resumeRecoveryImportFinalization` shares guarded execution with initial
finalization, rereads all evidence before writing and initializes checks from the
freshly inspected exact native/history state. It installs history only if absent,
advances only remaining phases, updates only exact still-staged Drawing/Tile
members and skips already-final Level backgrounds. Existing scoped native lock
guards authorize only remaining hidden sources and exact release patches.
It verifies complete native/history/evidence before clearing intent and verifies
the completed receipt afterward. Already-cleared journals remain read-only via
completed-receipt inspection, not resume. Edited, missing or ambiguous state
refuses; interruption preserves receipt/files/journal and consumes approval.

Regressions exercise acknowledgement-loss states at release intent, history
installation, history phase, native release, native-released/complete phases and
journal removal across Drawing, Tile and background; mixed collections and
partially released members; distinct/fabricated/reused approval refusal; stale
context/corrupt evidence; and another interruption during explicitly approved
resume followed by fresh review. Existing normal finalization remains covered.
Deployed live release-resume acceptance is still a gate. Public controls,
compensated-receipt clearing, owner handoff and full transition/accessibility
acceptance remain pending. Real crashes/network outages remain owner-deferred.
Selected recovery/bundle/native-guard/localization validation: 85 pass, 0 fail;
build, packaged runtime hash, editor diagnostics and scoped whitespace pass.

**Deployed Drawing release-resume acceptance follow-up:**
After owner deployment/GM refresh, imported the previously owner-saved 15,847-byte
ZIP (exact approved SHA-256 reverified) into disposable Scene `CaSJ0CrsaRIfbHW2`.
Initial detached preparation refused a missing reserved-path inventory; supplying
the actual FilePicker listing resolved fixture setup without bypassing admission.
Real intent, five JSON/archive/output uploads and hidden Drawing staging passed.
Both imported recovery generations and parent linkage remained intact.

A fixture-scoped `updateDrawing` listener cancelled the finalization signal only
after the real native release completed. The service stopped explicitly, retaining
`history-installed` intent and exact final Drawing/history. Fresh read-only
inspection identified that state. An ordinary GM reload discarded all approval
capabilities; newly loaded modules and retained session acceptance metadata
reconstructed only fixture/context information. Fresh inspection verified unchanged
final sources and full original Scene. Separate explicit resume approval completed
the remaining phases and cleared intent, with zero Drawing update hooks and exact
unchanged Drawing, history and selected Level. Completed receipt inspection passed.

Second disposable Scene `kQ4HVXfpneiW8Y3P` remapped the verified first import's
retained ZIP evidence into a differently sized destination. Five new uploads and
real hidden staging passed. A scoped `updateScene` listener cancelled only after
history installation while intent remained `releasing`. Fresh inspection verified
exact installed history, no final Drawings and complete hidden staging. Fresh
explicit resume advanced history phase, released its remaining Drawing exactly
once, reached complete and cleared intent. Completed receipt inspection passed.
Neither test intercepted backend writes or simulated a crash/network outage.

All ten immutable evidence/archive/output files passed bounded byte/hash rereads
and remain retained. Both named fixtures were removed only after exact completed
receipt inspection. GM returned to the original Scene; Aroh remained there.
Original full canonical snapshot stayed exact (47 Drawings, 0 Tiles). Acceptance
sessionStorage/global/input bytes removed; owner-saved ZIP preserved.
This closes bounded Drawing resume with remaining native release and post-reload
already-final state, not Tile/background or mixed/partial-collection live resume.
Compensated-receipt clearing/retry lifecycle, public recovery UI/accessibility,
owner handoff and broader fidelity remain gates. Real crashes/network outages
remain owner-deferred.

**Compensated receipt clearing and fresh-attempt lifecycle implementation:**
Internal `reviewCompensatedRecoveryImportClearing` requires fresh strict
reconciliation of exact compensated state and all retained evidence. Its review
lists retained paths and discloses journal-only clearing, receipt/file retention
and the absence of retry/import authority. Explicit exact token/plan approval
requires `clearCompensatedReceipt` and `retainFiles`; private single-use capability
is distinct from compensation, staging and import approvals.

`clearCompensatedRecoveryImport` runs under the existing Scene operation queue,
rechecks owner/currentness/cancellation/full snapshot and rereads complete evidence
before removal. Only the import journal is removed. Post-write comparison ignores
only host modification bookkeeping, with every substantive Scene field exact.
Fresh `inspectClearedCompensatedRecoveryImport` uses a strict compensated receipt
to verify absent journal, restored prior tree/Level, no native staging/history,
original destination baseline and unchanged durable evidence. It grants no writes.
Interrupted clearing carries the receipt for read-only uncertain-removal checks;
if the journal remains, another fresh clearing review is required. No automatic
retry, file deletion, receipt adoption or owner handoff occurs.

Regression coverage spans Drawing/Tile/background compensation, fabricated/reused
or mismatched approval, stale context/authority/cancellation/corrupt evidence,
before/after removal acknowledgement loss, post-removal edits, altered receipt and
missing evidence. A complete fresh-attempt test proves preparation is blocked
before clearing, then allocates new identities/paths using the retained collision
inventory, obtains new approval, persists new intent/assets and preserves all old
files. Old cleared receipt verification refuses once a subsequent import begins.
User-facing receipt storage/recovery dialogs and deployed clearing/retry acceptance
remain gates, alongside Tile/background live resume and broader release work.
Selected recovery/native-guard/localization validation: 90 pass, 0 fail; build,
packaged runtime hashes and editor diagnostics pass.

**Internal localized recovery review dialog implementation:**
`createRecoveryImportReviewDialogs` supplies separate hidden-staging, compensation,
finalization/resume and compensated-clearing review adapters. Each snapshots its
input before awaiting the modal and displays untrusted identities/paths/native
Level targets through textContent rather than HTML. Native release decisions are
validated against supported distinct keys and matched to initial versus resume
mode. Every required decision has an initially unchecked required checkbox;
Tile/background exposure acknowledgements are independent of release consent.
Reviews report exact token/plan digest, native IDs and, where applicable, retained
paths, phase, already-final IDs and exact before/target Level data. Localized
warnings preserve closed-wrapper/native-exposure, source historical background,
file retention and no-automatic-retry distinctions.

`promptRecoveryImportApproval` is an internal adapter: obtain fresh service review,
await the explicit dialog, then invoke its guarded approve method. It returns only
the exact private single-use capability. It performs no native execution, upload,
receipt storage, toolbar registration or ownership handoff. Modal close, unchecked
decision, context/owner loss or cancellation refuses authority. The service's full
snapshot check also refuses source drift during the modal. Clearing warns that its
caller must retain the compensated receipt before execution; production receipt
retention and lifecycle orchestration are not supplied by this adapter.

Regression coverage includes separate Tile/background acknowledgements, safe
text disclosure, exact cloned decision shapes, invalid/duplicate/wrong-mode keys,
cancel/close/currentness/authority loss and actual clearing/resume service
capability integration with no writes before explicit execution. Public import
entry/resource/storage dialogs, durable receipt retention, toolbar wiring and
live keyboard/accessibility/tablet acceptance remain gates.
Selected recovery-dialog/service/localization validation: 95 pass, 0 fail;
build, packaged dialog hash, editor diagnostics and scoped whitespace pass.

**Internal durable receipt storage implementation:**
`recovery_import_receipt_storage.js` retains complete/compensated intents in strict
`foundryshop-recovery-import-receipt` version-1 JSON envelopes, with explicit
`maxReceiptBytes` encode/decode/read budgets distinct from total evidence budgets.
Non-terminal phases and lossy JSON serialization refuse. Fresh review first
reconciles receipt/native/evidence, then binds full Scene snapshot, designated
owner, upload permissions, cancellation/currentness and exact immutable bytes.
Separate localized persistence/retention consent grants a single-use capability.
Receipt filenames include token, terminal phase and SHA-256 within the original
evidence root; existing files are not overwritten/adopted or retried automatically.

Execution repeats strict inspection, uses shared collision-preflight verified
JSON upload, compares exact returned reference and inspects stored receipt.
No Scene fields or journal are written. Failure carries the exact planned
reference and receipt so uncertain upload acknowledgement can be inspected.
`inspectStoredRecoveryImportReceipt` requires exact reference and budgets, binds
owner/full snapshot across file reads, verifies hash, strict envelope and original
recovery closure/native baseline. Existing journal must equal receipt; absent
journal invokes complete or cleared-compensated read-only inspection. Subsequent
imports/native edits refuse; hashes prove integrity, not authenticity/authority.

`promptRecoveryImportReceiptPersistence` obtains fresh service review plus
localized path/size/hash and independent storage/retention acknowledgement,
returning only approval. It does not execute or clear intent. Tests cover exact
byte thresholds/schema/terminal phases/lossless data, immutable persistence with
unchanged Scene, compensated journal clearing and fresh stored-file inspection,
complete receipt persistence, corruption/context/collision refusal and unknown
upload acknowledgement with exact reference read-only verification.
This provides durable storage, not a public receipt catalog or discovery UI.
End-user reference retention, persistence-before-clearing orchestration, live
storage/clearing acceptance and full import-entry/public wiring remain gates.
Selected receipt/recovery/dialog/storage/localization validation: 112 pass,
0 fail; build, packaged runtime hashes, diagnostics and scoped whitespace pass.

**Internal persistence-before-clearing retirement and exact receipt lookup:**
`retireCompensatedRecoveryImport` requires fresh compensated evidence, snapshots
the Scene/owner context, separately prompts receipt storage and executes verified
immutable persistence before obtaining a distinct clearing review. Caller-supplied
exact retained reference may replace storage only after fresh receipt/evidence/
native inspection and exact equality to the current compensated journal.
Clearing review displays its durable path/size/hash; the clearing service rereads
that receipt after modal approval before removing intent. Service post-write
guards take over from pre-write full-snapshot guards after removal.
Workflow error retains receipt and exact reference, including an uncertain upload's
planned reference. Cancelled storage never clears; cancelled clearing preserves
uploaded receipt for another explicit review. Uncertain removal remains inspect-only,
never auto-retried. No new-import authority or file deletion is granted.

`findStoredRecoveryImportReceipt` derives exact deterministic filename, byte count
and hash from a supplied terminal receipt, first verifies its evidence/native
state, then checks FilePicker listing under unchanged context. Explicit not-found
returns the expected reference; matching file is strictly reread/decoded/reconciled.
Case/encoded aliases, duplicates, invalid listings or context drift refuse. It is
not arbitrary file scanning, a receipt catalog, ownership handoff or authenticity
proof. Receipt references remain necessary when journals are absent.
Tests cover successful persistence/clearing order, cancellation at each modal,
reuse without upload, corruption during clearing review, uncertain journal removal
with read-only verification, deterministic lookup and alias/context refusals.
Production UI entry points/general receipt browsing and live lifecycle acceptance
remain gates.
Selected lifecycle/recovery/dialog/storage/localization validation: 114 pass,
0 fail; build, packaged runtime checks, diagnostics and scoped whitespace pass.

**Internal full reviewed recovery import entry implementation:**
`importReviewedRecoveryProject` accepts supplied strict ZIP bytes and explicit
destination Level/root/currentness/evidence/receipt budgets. Detached preparation
performs existing native/schema/history/resource/empty-destination admission.
`promptRecoveryImportEntryApproval` obtains genuine service review then localized
destination, upload count/bytes/paths, required fonts/modules, numeric elevation/
coordinate policy and exact Level targets. Each import, native Tile/background and
empty metadata-replacement decision is independently unchecked. The proposed
complete receipt is encoded against its byte budget before intent or uploads.
Approval is destination/full-snapshot bound; initial cancellation writes nothing.

Execution persists intent, verifies assets, then asks for separate fresh hidden
staging review, executes staging, asks for separate final release (renewing native
exposure decisions), executes guarded finalization and finally separately reviews/
persists the complete immutable receipt. Success returns complete receipt plus
verified stored reference. No public controls, file chooser, automatic storage
selection, ownership handoff or automatic retries are added. Every service keeps
its own Scene queue/capability/evidence guards; the wrapper does not hold a Scene
operation lock across user dialogs or nest queued operations.

`InterruptedReviewedRecoveryImportError` reports the exact stopped step/token and
retains available completed receipt/uncertain reference. Stage/release cancellation
after uploads preserves assets-verified/native-staged journal respectively.
Cancellation of receipt storage after completed native finalization is not rolled
back or called success: complete receipt remains attached for read-only checking
and later fresh storage review. Uncertain uploads/finalization retain service
causes/journal evidence; no automatic compensation or native release follows.
Tests cover Drawing/Tile/background full completion, independent dialog order,
initial cancellation, stage/release/receipt cancellation, upload uncertainty and
undersized receipt budget refusing before dialogs/writes.
Production file/destination/storage entry UI, public control registration, live
entry/storage/retirement and full keyboard/accessibility acceptance remain gates.
Selected entry/recovery/dialog/native-guard/localization validation: 106 pass,
0 fail; build, packaged runtime checks, diagnostics and scoped whitespace pass.

**Opt-in import file/destination/storage setup UI:**
`promptRecoveryImportSetup` validates explicit file/entry/receipt/time budgets and
exact designated-GM Scene authority before opening a localized modal. Native file
input accepts one nonempty ZIP within the admitted size, Level select chooses only
from the supplied Scene, shared data-folder text input selects an existing path,
and metadata replacement is an unchecked separate setup choice (renewed in exact
plan review). No Scene creation/activation or settings changes. DOM labels and
option text use textContent, never user-provided HTML.

After setup acceptance, shared folder admission reuses `reviewBakeStorage` for
permissions/private/target checks, then reads and validates a current collision
inventory. File arrayBuffer length is checked and exact Scene/owner/cancellation/
currentness guards run across every asynchronous boundary. No uploads, directory
creation or import authority result. `promptReviewedRecoveryImport` hands the
selected bytes/options to existing detached preparation and independently reviewed
entry/staging/release/receipt workflow. Strict ZIP admission, empty destination,
historical native resources and actual receipt-size preflight remain authoritative.
Tests cover selected exact bytes/options, no-write cancellation, invalid budgets,
missing/empty/oversized/wrong-extension files, unknown Levels, private folders,
lost authority and source drift during file reading.
Folder selection supports manual data-path entry and native FilePicker folder
browsing constrained initially to the data source. Existing admission still
refuses invalid/private/package folders. Picker callbacks check exact context,
setup closure revokes late callbacks, and pending/open picker cleanup runs after
dialog settlement, including failure. Reopening closes the previous picker.
Errors appear in a polite live status area and standard notification rather than
silently falling back. Tests cover picker options/manual path preservation,
successful selection/cleanup, render failure, stale callback and close during
pending render. Public registration and live native picker/modal focus,
keyboard/accessibility/end-to-end acceptance remain gates.

**Internal evidence-derived recovery action controller:**
`reviewRecoveryImportActions` first reconciles the retained journal or exact
supplied terminal receipt/stored reference. Available actions derive from verified
state plus phase: inspect always, stage only complete assets-verified baseline,
finalize only complete native-staged hidden artwork, resume only exact release
state, compensate only supported complete hidden/pre-native state, retire only
compensated state, and retain receipt only terminal states. Missing upload evidence
offers inspection only; no upload retry/adoption action. Full Scene/owner context
binds the action review; caller mutations to returned action lists confer nothing.
One write attempt consumes review, and each action independently invokes fresh
localized guarded approval before native execution. Terminal receipt byte budget
is checked before release/compensation.

`promptRecoveryImportActions` displays token/phase/evidence state/missing paths
and a native select defaulting to inspect; selection itself grants no write
authority. Terminal native actions separately verify existing exact stored receipt
or prompt immutable persistence. Cancellation after native completion carries its
terminal receipt in `InterruptedRecoveryImportActionError`; no success-shaped
fallback, rollback or automatic storage retry. Compensation leaves its journal.
Explicit later retirement discovers/verifies any exact deterministic stored receipt
before persistence-before-clearing orchestration, avoiding reupload collision.
Existing receipt references are byte/native/evidence checked, not blindly adopted.
Tests cover fresh state action inventory, read-only default/cancel, stale review,
fabricated action mutation, missing-evidence no-retry, finalization/resume/
compensation retention, cancellation after complete, reuse without upload and
compensated retirement. No public registration, ownership transfer or distributed
lock added. Live panel/modal/accessibility and broader acceptance remain gates.
Selected action/recovery/setup/dialog/localization validation: 114 pass, 0 fail;
build, packaged runtime hash, diagnostics and scoped whitespace pass.

**Owner-approved recovery/storage catalog scope (2026-10-09):**
Replace exact-reference-only reopening UX with an explicitly scoped folder
catalog, extending toward module-owned recovery, backup and disposable-cache
management. Show purpose/type, exact path, known byte size, Scene/import identity,
verification state, dependencies and reference protection, and available
thumbnails. Dates, sizes and previews must be evidence-backed or displayed as
unknown; directory listings alone do not prove age, ownership or dispensability.
Inspection must be bounded and cancellable, and unrecognized/corrupt/uncertain
items remain protected. No general filesystem crawl or automatic cleanup.

The owner selected safe regenerable-cache cleanup plus separately reviewed
retirement of understood backup sets. Retirement must disclose lost Restore
capabilities and preserve any active/shared dependencies. Absence of a reference
in loaded Scenes alone is not proof that compendiums, other worlds or external
consumers do not use a file. Module metadata retirement and physical file deletion
are separate operations; neither silently implies the other.

Platform feasibility check: deployed Foundry v14.365 exposes no FilePicker.delete
API and excludes generic ZIP from CONST.UPLOADABLE_FILE_EXTENSIONS, while JSON is
allowed. The official FilePicker article documents browse/upload permissions,
not a file-delete workflow. Do not patch permission/extension checks, disguise ZIP
bytes with an allowed filename, or invoke undocumented deletion endpoints.
Keep genuine portable ZIP decoding client-side and upload supported, versioned
JSON evidence and admitted image assets through the existing verified upload path.
Physical cleanup remains unavailable without a supported, host-authorized storage
mechanism. Until one is established, present reviewed exact-path cleanup manifests
for host-side administration, not an in-module claim of completed deletion.

The public EULA permits package development; neither it nor the reviewed Terms
explicitly establishes that bypassing these file restrictions is approved.
No categorical policy violation is asserted solely from the missing API. Seek
Foundry/provider guidance before adding server-side storage integration, which
would be a separate deployment/security scope. Sources:
https://foundryvtt.com/article/file-picker/
https://foundryvtt.com/api/v14/classes/foundry.applications.apps.FilePicker.html
https://foundryvtt.com/article/license/
https://foundryvtt.com/article/terms-of-service/
This is approved design scope and platform research, not implemented catalog or
cleanup acceptance. No existing evidence files were deleted or reclassified.

**Owner-approved scene-Level scope/combination refinement (2026-10-08):**
The owner clarified that "layer" for this exchange decision means native scene
Levels/floors, not Foundryshop drawing layers/groups. Best-effort existing-Level
matching is omitted: source IDs are Scene-local, names may be ambiguous and there
is no safe universal mapping. No automatic Level creation or Level-setting edits.

Export dialog defaults to active-Level artwork, with an explicit all-Level/full
project option. Full/subtree/selection Drawing scope remains independent of Level
scope; tree/preset context stays intact. A Drawing associated with several Levels
is included once when it belongs to the selected Level, retaining its source
associations in the portable JSON. Unassociated/other-Level artwork is excluded
from active-Level exports; full exports retain it. Full library saves retain all
Levels rather than silently narrowing saved projects.

Package validation now admits multiple distinct source Level references.
Import still defaults to single-Level behavior: multi-Level packages require an
explicit source-Level choice or explicit full-project combine. A single chosen
Level retains original numeric elevations, with final included/excluded counts.
Unassociated packages continue to map to the displayed destination Level.
Recovery-bearing packages/Scene optimization journals remain refused.

The owner selected moving combined imports to the active native Level's finite
ground elevation and requested order preservation for real illustration work.
The implemented composition keeps drawing-layer/group hierarchy authoritative,
then assigns fresh within-layer sorts from original elevation, native sort and
stable package order for ties (higher values above lower values). Existing
destination IDs, artwork, sorts, locks and player gates are never reordered.
Cross-floor artwork had no single global overlap order: combine explicitly warns
that new overlaps are a new composition, not pixel-identical conversion. Mixed
interface modes, incompatible existing managed elevations/order and insufficient
safe sort space still refuse rather than rewriting existing artwork.

Final preview/resource verification uses only the selected package artwork and
its retained metadata. The usual hidden import wrapper/staging journal remains.
Native destination ground/existence is checked before journaling, creation,
release and completion; changes compensate only imported work and preserve
unrelated Level edits. No native background/grid/lighting configuration is imported.
No binary asset bundling, recovery portability or format-version migration is
claimed by this slice.

180 targeted exchange/resources/preview/library/shape/stamp tests pass, covering
active/all export, multi-Level selection/refusal, combine order and stable ties,
layer hierarchy precedence, additive source preservation, explicit dialog choices,
finite ground and ground-change compensation. Editor diagnostics are clean.
Deployed native acceptance subsequently passed within the bounded scope below.

**Deployed Level exchange acceptance (disposable Scenes):**

- Source `ImBR7yMwMNFD4ZTY` held red lower-floor artwork at elevation0/sort1024
  and overlapping blue upper-floor artwork at elevation20/sort512 in one drawing
  leaf. Full export contained both; lower/upper filtered exports each contained
  only the expected Drawing. The actual export dialog defaulted to the active
  Level and its approval fulfilled. The integrated download event timed out:
  actual disk-file download is not claimed.
- Destination `4HXF2xKrkH2ZV7Po`, ground7, imported only the explicitly chosen
  upper source Level through the standard dialogs. Review disclosed one included,
  one excluded and retained numeric elevation. Blue remained at20, mapped to the
  destination Level with fresh identity/provenance; geometry/styles and complete
  Level settings were exact. The imported wrapper remained private; no import
  journal remained.
- Combining onto that existing managed elevation20 destination refused before
  journaling, preserving its existing Drawing exactly. No automatic elevation
  rewrite or layer-order bypass was used.
- Fresh additive destination `VnvG3VkLZZOokwPv` contained existing ground7
  control artwork. Explicit combine review disclosed ground7 and the new
  composition/order policy. Both imported Drawings moved to7; red received1024
  and blue2048 despite blue's lower source sort. Geometry/styles, complete
  existing control artwork and complete native Level stayed exact; journal cleared.
  GM native overlap patch was uniform blue `(51,51,221,255)`.
- Aroh's visible native framebuffer initially showed only background
  `(51,85,68,255)` in three uniform20x20 artwork patches. Explicitly applying
  Imported Presentation revealed red-only `(221,51,51,255)`, overlap blue
  `(51,51,221,255)` and blue-only `(51,51,221,255)`. This is sampled ordering/
  concealment evidence, not full-frame or diverse-artwork fidelity certification.
- A later additive-combine final-review cancellation left the complete destination
  Scene exact. Both clients returned to the original Scene/Token controls; all
  three identified fixtures and the live test global were removed. Complete
  original Scene equality passed; source baseline was also exact before removal.

The source fixture's native automatic layer-order reconciliation explicitly
reported the existing global mixed-managed-elevation constraint, even across
separate native Levels, without mutating its captured source state. These tests
do not certify general multi-Level managed-layer ordering. Production optimization
controls remain disabled; recovery-bearing exchange remains blocked. Corrected
the final review's obsolete statement that all multi-Level packages were unsupported.

**Confirmed initial import layout:** place the imported tree beneath a new
player-hidden group, and place originally Unassigned Drawings in an `Imported
Unassigned` layer within that group. Preserve original native hidden/locked fields.
Freshly remapped presets include the wrapper gate; a new uniquely named `Imported
Presentation` preset stores the package's live presentation intent plus originally
Unassigned artwork. Original imported presets leave that new layer hidden unless
the GM explicitly includes it. The import itself sets all player gates off and
never applies a presentation automatically. The wrapper/new layer are deliberate
destination structure, not loss of the original project.

Repeated additive imports must not collide. Target root/subtree positioning and
the relationship between imported and existing artwork must be explicit.
Round-trip tests compare canonical drawing data after expected ID/author/Level
remapping, not just counts or screenshots.

**Confirmed additive policy:** explicitly select additive mode (empty-project mode
remains the default). Create a new hidden root group above the existing stack.
Preserve all existing Drawing data, sort, membership, IDs, native locks, nodes,
player gates and presets without updates. Allocate imported sorts above existing
managed artwork and reject incompatible render modes/elevation, invalid existing
order, or insufficient safe integer sort space rather than changing existing sorts.
Top-level placement remains the default; targeted group placement is implemented below.

**Subtree/targeted exchange slice implemented:** The owner selected a new hidden
wrapper inside a chosen unlocked group, not merging incoming nodes/artwork into
existing ones. Destination group selection is additive-only, disabled/reset in
empty mode, and excludes locked groups/locked ancestors. The service independently
validates target kind/existence/locks. The wrapper is the target group's top child.
Imported sorts occupy the available safe integer gap between managed artwork
below and above the insertion point, including valid negative sorts. Insufficient
space, unsafe integers, invalid existing order and incompatible elevation/interface
mode refuse import without changing existing Drawings or their sorts.

Subtree export adds explicit `scope: "subtree"` to the existing version-1 package
contract; full packages remain supported unchanged. The chosen layer/group and
descendants retain their ancestor chain, including names, locks, defaults and
player gates. No sibling artwork, ancestor sibling nodes or Unassigned Drawings
are included. Presets are restricted to included nodes; omitted preset entries
still mean hidden. This preserves ancestor live/preset intent without flattening
gates or inventing new effective defaults. Coordinates remain Scene pixels.
Resource inventory and optional thumbnails reflect only packaged artwork/context.
Unsupported excluded artwork does not block a valid subtree, while unsupported
included data, recovery state and multiple source Levels still refuse export.

Full/subtree packages use the same resource review, fresh IDs/author/Level remapping,
hidden staging, baseline fingerprints, verified journal and compensation path.
Existing nodes/Drawings/presets/gates are preserved. Imported presentation presets
capture destination ancestor gates, not implicitly enabling them: a hidden target
ancestor stays hidden after applying Imported Presentation. Final review names
the destination; nothing is applied automatically. Source context is rechecked
across export review/thumbnail/download, including excluded artwork mutations.

All 531 regression tests pass, covering ancestor/subtree/preset/resource scope,
strict package round-trip, outside-vs-included unsupported data, safe targeted
sort intervals (including negative upper sorts), inherited locks, no-space refusal,
fresh identity/native schema, preservation of existing content and ancestor gates,
interrupted-import compensation, scoped dialogs and cancellation/stale exports.
Native detached v14 Scene/Drawing documents validated a one-Drawing subtree with
three ancestor/subtree nodes and targeted import sort 5050 between 100 and 10000,
without changing detached destination/live Scene sources. Native export submitted
and verified a three-Drawing/one-layer subtree JSON via intercepted final download.
Export/import select/submit targets measured 44px without horizontal overflow;
additive-only enabling and empty-mode resetting were verified. No server-side
Scene/settings/library writes were used. Connected/multi-GM/real-file interruption
acceptance and explicit multi-Level mapping remain separate release work.

Imported presets capture existing player gates at import time, preserving that
presentation on application; later manual gate changes can be restored to the
snapshot. Original presets are untouched and hide newer imported nodes when
applied. Numeric suffixes resolve imported preset name collisions, and IDs are
checked against existing Drawing/node/preset IDs. Combined counts must fit limits.
Journal v2 stores SHA-256 fingerprints of baseline Drawings; preflight, completion
and compensation verify them. Conflicting new artwork, baseline edits/deletion, or
changed tree/journal state block cleanup rather than overwriting another GM's work.
Journal v1 empty-import discard remains supported.
**Confirmed empty-project metadata policy:** a Scene with zero Drawings may still
retain layers/groups and presets after native Drawing deletion or Scene copying.
Offer a separate explicit metadata-replacement confirmation before preflight, then
the normal final preview confirmation. Refuse replacement if any Drawings exist
at preflight or commit. Replace, rather than append, the retained nodes/presets;
do not include their gates in imported presets. Keep the original metadata in the
import journal for safe compensation/discard. Cancellation leaves the Scene unchanged.
Browser SHA-256 requires HTTPS or localhost when a baseline contains existing
Drawings. Missing browser support reports an explicit pre-write error; no weak
checksum or silent conflict-detection fallback is used.

### WEBP export

Render selected artwork in a dedicated export surface, not by screenshotting the
live canvas. Do not include Tokens, Walls, selection handles, toolbars, lighting,
or other unrelated Scene objects. Export must not change live canvas visibility,
player presentation, or GM workspace to obtain its result.

Require a clear choice of:

- whole drawing map or selected layers/groups;
- effective player-presented artwork or effective GM-workspace artwork;
- transparent background or inclusion of the displayed Level's background;
- crop/bounds, pixel dimensions or scale, and WEBP quality.

Player-presented export respects all ancestor gates and native hidden constraints.
GM-workspace export follows documented native GM behavior and clearly warns about
hidden/player-withheld content. Do not choose an audience implicitly.

Verify canvas/encoder dimension limits, memory use, transparent WEBP output, actual
MIME type, and cross-origin asset access. Report blocked assets or unsupported
rendering instead of silently omitting them or returning a different file type.
The live background remains unchanged. A WEBP is a publication artifact, never a
replacement for JSON recovery or a way to unflatten artwork.

**Transparent publication slice implemented:** The owner approved transparent
artwork first and Level-background composition as the following slice. Library
offers browser download without library-folder/upload requirements. Audience is
required, never implicit. Whole-map scope includes ordinary Unassigned artwork on
the displayed Level; a selected layer/group includes descendants. Player scope
composes ancestor presentation gates/native hidden restrictions and excludes
unresolved membership. GM scope composes private workspace gates, includes orphan
membership under native GM behavior and warns about withheld/hidden content.
Native-hidden geometry is half-opacity; text retains its own native opacity.
Locks do not omit artwork. Staged/pending imports block publication.

Reuse validated snapshot/geometry/texture/font services and the shared bounded
render queue, not preview-fit output, cache or live screenshots. Actual measured
artwork bounds get a 1 Scene-pixel margin; custom Scene-pixel crop is explicit.
Scale 0.1-4 (default 1) produces ceil(width*scale)/ceil(height*scale), without
stretching or automatic shrink-to-fit. Quality 0.1-1 defaults to 0.9 with a live
percentage slider. Native number arrows and focused wheel adjustment remain.
Form controls measure 44px. Bounds: existing 1,000-Drawing/100,000-coordinate/
4 MiB snapshot, 16 textures and one elevation/interface mode; output axes 8,192px,
16 million pixels and 32 MiB encoded bytes, additionally capped by GPU texture
limits. Text raster bounds and resource consent/decoded-memory limits are enforced.
Large/mixed-mode projects may need smaller scoped exports; fail explicitly rather
than omitting content. Maximum-size memory/performance acceptance remains pending.

Keep output transparent, verify actual MIME and WEBP-header dimensions, and
dispose offscreen targets/display objects/owned bitmaps/textures. Publication uses
public texture alpha-mode and pixel extraction APIs with clamped unpremultiplication:
the bundled PIXI 7 Uint8 conversion otherwise wraps saturated half-opacity red to
black. No global PIXI patches or private extractor calls. Preview/thumbnail
behavior is unchanged. Recheck full Drawing sources/raw layer metadata/workspace,
Scene/Level/authority and window/abort context across review/render/download.

Native v14 checks verified real 240x240 WEBP output at scale 2, transparent corners,
opaque red, half-opacity red after clamped extraction, actual Drawing sort order
(blue above red), native text rendering and intercepted native-dialog download.
A fresh dependency-graph check also encoded/decoded 5000x2 WEBP, beyond the
unchanged 4096px imported-image cap; publication has its own validated header limits.
All 47 live Scene Drawings were unchanged; no library/Scene/setting writes occurred.
The transparent milestone passed 502 regression tests. Tests cover audience ancestor/native/Unassigned/orphan rules, stale/canceled
publication, bounded output, unsupported MIME/dimensions, GPU limits, alpha
conversion and resource disposal. Expanded JSON exchange remains
a separate incomplete milestone; connected/real hardware/performance acceptance
is not replaced by these detached checks.

**Displayed-Level background slice implemented:** The explicit background choice
defaults to transparent. Level composition draws the map-rectangle base color,
then an independently loaded static PNG/JPEG/WEBP background image, then selected
artwork. It uses native fill/cover/contain/width/height fit, anchor, centered position
plus offsets, signed X/Y scale, rotation and tint. Background alphaThreshold is an
occlusion setting, not an image-opacity multiplier. Foregrounds, other-Level
imagery, fog, lighting, grid and padding are deliberately excluded and disclosed.
Background-only export is supported. Content bounds include the transformed
background with the existing 1 Scene-pixel margin; custom crop remains available.
Scene-rectangle crop is available only with Level composition and clips to the
map rectangle. Returning to transparent resets that incompatible crop.

Reject invalid transforms/resources, video backgrounds and primary artwork below
the background elevation rather than changing native stacking or substituting a
background. Existing single-elevation/interface artwork restrictions remain.
Background images allow 8,192px axes, additionally GPU-limited, and 16 MiB
compressed bytes. Existing artwork image limits stay unchanged (4,096px axes,
16 million decoded pixels collectively). Composed textures share a 64-million
decoded-pixel budget; shared background/artwork paths are loaded once. Output
limits remain unchanged. Level source, background transforms and explicit Scene
rectangle coordinates participate in all publication stale-source checks.

Native detached checks matched all five public background resize modes with
noncentral anchor/offset/rotation and signed scale. Real encoded/decoded 100x80
WEBP pixels verified blue base color, green-tinted white image and opaque red
artwork above it, with an offset map rectangle clipped exactly. Native background/
crop checks also verified rotated/flipped/offset background-only content bounds
at {x:99,y:199,width:102,height:112}, including image pixels outside the map
rectangle. Native background/crop controls measured 44px without horizontal overflow; crop enabling/reset and
dialog cancellation passed. Scene source remained unchanged and the live
background texture stayed valid; no real files/settings/Scene writes occurred.
All 512 regression tests pass, including detached metadata, fit/graph order,
background-only output, source changes during review/render, shared texture reuse,
images beyond stamp axes, combined memory/GPU limits and disposal on refusal.
Maximum-size performance, arbitrary native third-party effects and connected
release acceptance are not claimed by these isolated checks.

### SVG export

SVG is the first appropriate vector format: it can express paths, shapes, text,
transforms, and groups without a proprietary art-tool dependency. Do not promise
PSD/AI/DXF compatibility, Foundry-native effects, or pixel-perfect fidelity from
arbitrary third-party SVGs.

Export the supported Drawing subset in actual stack order with a viewBox matching
the selected coordinate space. Preserve group/layer naming through standard SVG
groups; escape text and attributes. Use the same explicit scope/audience selection
as WEBP. Define stroke joins/caps, curve conversion, fill rules, opacity compositing,
text/font dependence, textures/patterns, and transformed geometry through tested
conversions. Report unsupported features before export rather than substituting
styles silently. Raster texture embedding, if later supported, must be explicit;
it does not make the file entirely vector.

JSON remains the authority for exact native metadata, presentation presets,
locking, and recovery data. SVG is not a full editable-project backup.

SVG is export-only. No SVG parser/importer, tracing/OCR or Level background
replacement is part of this plan. Phase 5F now includes raster image upload/paste
as stamps, not Scene backgrounds. JSON remains the sole editable-project import format.

**Strict vector slice implemented:** The owner explicitly selected vector-only
SVG first, with named refusal diagnostics for textures and image stamps instead
of raster embedding. Library exposes Export vector SVG alongside WEBP. Both use
the same explicit audience, displayed-Level whole-map/layer/group scope, native
presentation/workspace gates and stale-source/authority/abort checks. SVG supports
content/custom bounds and scale, not raster quality/background/resource-consent
controls. A separate required fidelity acknowledgement prevents implicit acceptance
of font/viewer differences. There are no library uploads or Scene writes.

Validated rectangle/ellipse geometry uses native stroke inset and centered
rotation. Public native smoothing calls are recorded as quadratic/cubic SVG path
commands (open paths remain open), avoiding a duplicate smoothing algorithm or
tessellated/raster curve substitution. Geometry uses miter joins, butt caps, miter
limit 10, nonzero fill rule and separate fill/stroke/text opacity. Native-hidden
GM geometry is half-opacity without dimming its text. Actual sort order is kept,
including interleaved layers. Named SVG ancestor groups repeat per Drawing to
preserve hierarchy labels without changing that order. Only included Drawing
memberships/ancestors are emitted; Unassigned/orphan scope is explicitly named.
XML text/attributes are escaped, with invalid XML characters refused.

Text uses the loaded native font and public native wrapping/metrics, explicit
positioned spans, outlines and SVG shadow filters. Fonts are not embedded or
outlined; viewers must have them installed. Required disclosure covers baseline,
outline/shadow/antialiasing differences and complex/self-intersecting fill
triangulation differences. Unsupported native text styles, unavailable fonts and
oversized native text metrics fail rather than fall back. Raster references and
image stamps block the entire export, as do degenerate rectangle/ellipse strokes
whose native rendering SVG cannot preserve. No partial exports or resource fetches.

Bounds use the shared detached native display measurement with guaranteed disposal;
the viewBox retains Scene coordinates and standard SVG aspect ratio. Existing
snapshot/geometry and viewport/output byte limits remain: 1,000 Drawings,
100,000 coordinates, 4 MiB snapshot, one elevation/interface mode, 8,192px axes,
16 million output pixels and 32 MiB encoded bytes. SVG is not a native metadata,
lock/presentation-preset/recovery backup and remains export-only. Raster embedding
is deferred, not implicitly enabled by this implementation.

All 522 regression tests pass. Native v14 parsed and rasterized rectangle/rotated
ellipse/smoothed polygon SVG with six preserved cubic segments; all 24,400 tested
flat-interior pixels agreed with native offscreen output within a 15-channel-value
tolerance (antialiased boundaries intentionally excluded). A real native dialog
submission produced a parsed/rasterized 242x122 SVG with two wrapped/escaped label
lines and explicit audience/consent; browser download was intercepted. Native
select/number/submit/consent targets measured 44px with no horizontal overflow.
Scene source stayed unchanged, fixture styles/localization were restored, and no
real file/settings/Scene writes occurred. These checks are not cross-viewer font,
arbitrary third-party-effect, maximum-size performance or connected acceptance.

## Suggested architecture

``` text
FoundryshopLayerManager
├─ LayerTreeStore
│  ├─ stable IDs
│  ├─ parent/child relationships
│  ├─ logical ordering
│  └─ versioned schema validation
├─ DrawingMembershipService
│  ├─ Drawing flags
│  ├─ active-layer assignment
│  └─ orphan recovery
├─ DrawingOrderService
│  ├─ logical stack -> Foundry sort
│  ├─ relative ordering
│  └─ normalization/reconciliation
├─ DrawingConsolidationService
│  ├─ compatibility analysis
│  ├─ merge / flatten planning
│  ├─ reversible recovery snapshots
│  └─ unflatten / recovery-data disposal
├─ VisibilityService
│  ├─ GM workspace state
│  ├─ GM-authoritative player presentation
│  ├─ ancestor visibility gates
│  └─ native visibility composition
├─ PresentationService
│  ├─ group gates / explicit mass operations
│  ├─ presets
│  └─ persisted synchronization / reconnect
├─ DrawingPackageService
│  ├─ versioned JSON export / validation / import planning
│  ├─ ID, author, Level, preset and recovery remapping
│  └─ staged import journal / verification / compensation
├─ ArtworkExportService
│  ├─ shared scope / audience / bounds selection
│  ├─ dedicated WEBP rendering
│  └─ supported SVG conversion
├─ ArtworkImportService
│  └─ JSON-only import; SVG/WEBP output only
└─ LayerPanelUI (GM-only)
   ├─ tree
   ├─ drag/drop
   ├─ eye controls
   ├─ active-layer marker
   ├─ lock controls
   └─ Wacom-friendly targets
```

Keep Foundry API access behind services/adapters. UI code should
manipulate Foundryshop concepts rather than directly rewriting Drawing
documents everywhere.

## Tablet-oriented UI/UX

Controls should have generous hit targets for Intuos use.

``` text
[eye] [expand] [drag] Layer Name [active-pencil] [lock] [menu]
```

Recommended interactions:

-   click layer name → active drawing layer;
-   eye → local visibility;
-   separate, clearly labeled presentation control → player presentation;
-   drag handle → reorder/reparent;
-   group eye → toggle ancestor gate, preserving child settings;
-   Alt-click eye → solo locally, if retained;
-   context menu → show/hide all, show/hide players, move, rename,
    duplicate settings, delete.

Implement the approved Intuos4 tool shortcuts below first. Common-layer
keybindings/macros can follow demonstrated need; no generic hardware framework
or all-functions shortcut generator is required.

All these controls are GM-only. Prefer a distinct presentation control over a
modifier-only interaction so pen users can see which audience a change affects.

## Wacom Intuos4 PTK-840 setup

**Status:** tool shortcuts/setup and the focused key diagnostic are implemented.
The 437-test regression suite passes. Native Foundry v14 checks verified explicit
Freehand/Token Select activation, label/stamp ghost cancellation, unchanged Scene/
brush data, native Configure Controls without binding writes, and 44px tablet
setup/test targets without horizontal overflow. Key capture was tested with
synthetic events; the physical PTK-840/driver still needs owner acceptance.
Pen pressure
is deferred as a future possibility, not an active investigation or delivery gate.
Scope the documented and hardware-tested profile to the owner's PTK-840 on
Windows using Chrome or Edge. Defer other models until users request them.

### Driver-to-Foundry input boundary

Use Wacom driver keystroke assignments and Foundry's native module keybindings:
ExpressKey -> driver keystroke -> registered Foundryshop action. No additional
hotkey add-on, native helper, WebHID integration or direct driver programming is
required for this first slice.

Foundryshop cannot program Wacom driver profiles/tablet displays or reliably
identify the physical ExpressKey from an ordinary keyboard event. Settings must
describe a setup guide and Foundry binding configuration, not imply hardware
configuration or automatic device detection. Do not claim compatibility with
the owner's exact legacy driver until tested.

Wacom application profiles target the browser executable, not a Foundry URL/tab.
Explain that bindings may affect other tabs; using a dedicated browser application
for Foundry can isolate the profile from ordinary browsing. Browser/OS-reserved
shortcuts may never reach Foundry. Start new actions unbound; choose/test actual
assignments with the owner rather than silently install guessed combinations.
Higher function keys are candidates only if the driver can emit them and the
browser demonstrably receives them.

### Initial actions and Settings surface

- Draw: Freehand pencil explicitly activates Drawings/Freehand, never a toggle.
  Preserve brush appearance and the normal layer-default/override contract.
- Tokens: Select / Move cancels armed Foundryshop label/stamp placement and
  explicitly activates Tokens/Select. Native token permissions still govern
  selection/movement; this is not permission escalation.
- Reuse existing toolbox-toggle and cancel-label shortcuts as optional
  assignments. Add a general placement-cancel action only through the shared
  label/stamp cancellation services, not a second placement-state mechanism.
- In the existing Settings tab, add a compact Intuos4 PTK-840 section with a
  button assignment guide, actual current Foundry bindings, access to native
  Configure Controls and manual Wacom Tablet Properties instructions.
- Keep Foundry's keybinding store authoritative. Any convenience assignment
  preset is explicit, conflict-reviewed and limited to the selected actions;
  never reset or replace unrelated bindings.
- Provide a non-executing Test tablet button field showing received key/code/
  modifiers. Capture only while the diagnostic is deliberately focused/active;
  prevent Foundry actions during the test, clean up listeners on dismissal and
  do not collect/log unrelated typing.
- Respect chat, labels, dialogs and editable focus in normal shortcut dispatch.
  Do not switch tools in an active drawing/drag gesture. Serialize asynchronous
  activation, validate ready canvas/tool availability and authority, and report
  failures rather than swallow them or simulate clicks on toolbar DOM.
- Keep setup guidance/diagnostic preferences client-local; retain existing
  GM-only Foundryshop controls and native keybinding persistence semantics.

Touch Ring follow-ups may use native canvas zoom bindings. Direct repeatable
line-width decrease/increase commands are possible later, but should not rely
on where the cursor happens to hover. Defer additional ExpressKey/ring mappings,
pen-end erasing, pressure-driven opacity/tilt and broad all-functions exposure.

### Future possibility: pressure-sensitive Freehand

Deferred and outside current scope. Do not implement pressure capture, a test pad,
pressure settings or a variable-width renderer now. This does not block Intuos4
shortcuts, ordinary Freehand drawing or release.

Browsers can expose normalized pen pressure, but actual PTK-840 driver/browser
support would need hardware verification. Foundry v14 stores one strokeWidth per
Drawing, so true persistent thin-to-thick ink would require a separately approved
geometry/rendering design covering editing, player display, persistence and
exports. Changing the whole stroke's width is not equivalent.

If revisited, pressure must be optional and Off by default, preserve normal
fixed-width behavior, and pass real-device and representation feasibility checks
before implementation. Mention only as an unimplemented possibility in future
documentation, never as a supported feature or release commitment.

### Delivery and acceptance

1. Implement two native keybinding actions and the compact PTK-840 setup/key-test
   surface; verify direct mode activation, placement cancellation, focus/gesture
   guards, unavailable-tool errors and non-destructive binding configuration.
2. Owner configures the driver for the chosen browser and verifies actual
   ExpressKeys, repeated presses, tool switching and browser/OS conflicts.
   Mock key events alone do not certify the physical tablet.
3. Include verified setup, limitations and driver/browser-specific instructions
   in owner UI cleanup and final-final README documentation. Do not advertise
   untested tablets or promise direct Wacom profile programming.

Research references:
- [Foundry keybindings and conflicts](https://foundryvtt.com/article/keybinds/)
- [Foundry v14 keybinding API](https://foundryvtt.com/api/classes/foundry.helpers.interaction.ClientKeybindings.html)
- [Wacom keystroke assignments](https://101.wacom.com/UserHelp/en/Keystroke_Full.htm)
- [Wacom application profiles](https://101.wacom.com/UserHelp/en/AppSpecificSettings_Full.htm)
- [Wacom Touch Ring assignments](https://101.wacom.com/UserHelp/en/CustomizingTouchRing-Dial_Full.htm)
- [Pointer Events pressure contract](https://www.w3.org/TR/pointerevents3/#dom-pointerevent-pressure)

## Deletion behavior

Deleting a pseudo-layer must **not silently delete its Drawings**.

Offer explicit choices:

1.  move Drawings to another layer;
2.  move Drawings to Unassigned;
3.  delete layer and Drawings --- destructive confirmation required.

Apply similarly safe policy to group deletion.

## Undo and transactional behavior

For multi-document operations:

-   compute desired state first;
-   batch updates where supported;
-   persist layer-model changes only when valid;
-   reconcile/recover after partial failure;
-   avoid one socket/render operation per Drawing when batching is
    possible.

Investigate Foundry v14 native undo behavior before promising layer-tree
undo. Foundryshop may need its own command history for hierarchy-only
changes.

## Performance considerations

A hand-drawn dungeon may contain hundreds or thousands of Drawing
documents.

-   Avoid rewriting every Drawing for a simple client-local visibility
    change.
-   Avoid renumbering every Drawing after every drag.
-   Debounce UI refreshes.
-   Batch embedded-document updates.
-   Cache membership indexes by Drawing ID.
-   Reconcile sort ordering lazily where possible.
-   Stress-test with at least 1,000 and preferably several thousand
    simple Drawings.
-   Benchmark `Flatten Layer`/consolidation against equivalent unflattened artwork;
    measure actual Scene load, interaction, visibility, reorder, and rendering gains.
-   Keep active artwork editable at stroke granularity while allowing finished layers
    or groups to be explicitly consolidated.

## Hooks/events to investigate during implementation

Use the v14 hook/API surface rather than old v11-v13 examples.
Investigate:

-   Scene/canvas-ready lifecycle;
-   Drawing creation for active-layer assignment;
-   Drawing update/deletion for UI/index refresh;
-   Scene change/update;
-   user reconnect for presentation-state application;
-   per-GM local-state restoration without registering player controls.

Prefer public hooks/APIs. Avoid relying on underscore-prefixed internals
such as `_sendToBackOrBringToFront`; Foundry documents those as internal
and they are more fragile across releases.

## Implementation phases

### Layer and JSON foundation status

This section describes the foundation slice only; the authoritative consolidated
status and remaining milestones are at the start of this document.

The implementation provides a nested GM-only panel, stable membership,
per-GM/per-Scene workspace state, brush-default capture, and Drawing sort
reconciliation with drag/arrow reorder. Passive player presentation uses persisted
Scene state without sockets or player-facing controls. Groups support nested
creation, per-GM folding, aggregate Drawing counts, drag/explicit reparenting,
tri-state indicators, ancestor gates, and audience-specific recursive commands.
Show All to Players is confirmed because it overrides withheld child settings.

Safe removal now offers transfer to another layer or Unassigned, followed by
confirmation. It transfers and verifies membership before removing the subtree
metadata; partial failures report recovery guidance. It never deletes artwork.
The destructive "delete layer and Drawings" choice is not yet implemented.

Full player-presentation snapshots are implemented: stable preset IDs, save,
confirmed apply/replace/delete, rename, derived matching status, and explicit
missing/new-node indicators. Application uses a single Scene update with no
Drawing updates; newer nodes are hidden. Removal preserves incomplete references
and warns before invalidating snapshots. Automated service/UI tests cover
workspace isolation, stale/cancelled dialogs, persistence, authority, and failures.
Preset rendering/reconnect behavior still needs the live GM/player matrix.
The user reports basic preset tests passing.

Independent layer/group locks are now implemented with inherited protection,
native-hook edit/delete/create guards, selection release, assignment/removal checks,
and selected-label toolbox integration. Lock/unlock never writes native Drawing
locks. Reorder/presentation and sort-only maintenance remain available. Cancellable
pre-update/pre-delete and control/release contracts were checked against the local
running v14 source; complete live interaction/multi-client validation is pending.

Full-project JSON export and empty/additive project import are now implemented for the
declared v14 schema: Drawing-only packages, hierarchy/defaults/locks/presets,
dependency inventory, fresh IDs, author remapping, displayed-Level mapping,
translation, and explicit texture replacement paths. Native validation is performed
before writes and data-changing normalization is refused. Source-author identity
is excluded; imported Drawing provenance records package IDs and import operation.

Imports use the confirmed hidden wrapper/Unassigned layout, staging suppression,
a separately persisted exact-ID journal, verified creation/staging release, and
own-operation compensation. A retained interrupted-import journal exposes a
confirmed discard action; conflict/ownership changes refuse automatic cleanup.
Tests cover canonical Drawing state after expected reference/order remapping,
native locks, no player staging flash in hook mocks, cancellation/staleness,
re-export, failure compensation and unrelated-content preservation.

This is the first Phase 5C slice, not full exchange completion. Limits are 20 MiB,
2,000 nodes, 200 presets, 10,000 Drawings, 1,000,000 point coordinates, and
10,000,000-pixel geometry/translation bounds; wrapper/preset capacity is reserved.
Only one source Level is supported. Empty-project mode is the default; explicit
additive mode preserves existing artwork with fingerprinted journaling. Recovery-bearing
packages, unknown Foundryshop metadata, incomplete references and unsupported
native fields fail explicitly. Text/font layout is not included in computed
conservative geometry bounds.

Resource preflight now checks same-origin texture availability/image MIME with
HEAD requests (four concurrent, five-second timeout each, maximum 128 distinct
local destinations) and checks loaded native Foundry font families. Missing local
textures, unverified MIME, redirects and missing fonts block import. A repair/
recheck dialog shows detailed status, accepts inventoried texture/font replacement
mappings and lists available font families. Checks run again immediately before
the journal is written; Scene, Level and required module changes abort without
import writes. Mapping changes preserve all other native Drawing fields.

External HTTP(S) texture URLs are never fetched by preflight. The GM may replace
them with local paths or explicitly acknowledge unverified external resources in
the repair dialog; acknowledgement defaults off and is displayed at final review.
Foundry may load them during rendering, which can contact the external hosts.
Unsafe URL schemes/credentials and local redirects are not bypassed or followed.
Availability/image MIME does not guarantee image decoding or visual fidelity;
font discovery confirms loaded families, not identical cross-platform metrics.
No assets/fonts are embedded and no external font-loading mechanism is introduced.

Required metadata modules are checked. Opaque extension references are preserved,
not guessed at or rewritten. Subtree exchange is now implemented above;
multi-Level mapping and actual recovery interchange remain later Phase 5C work.

Native Drawing schema and file/Level contracts were inspected in the running v14
source. JSON renderer/server round trips and connected player visibility still
need live-world validation. The user reports basic layer/pen tests passing.

Public v14 documentation confirms `refreshDrawing`/`drawDrawing` hooks, Drawing
render flags and display-object references, and integer sort operations. The
documented ShapeData schema exposes a numeric points array, not an explicit
disconnected-path collection; faithful flattening still needs a geometry spike.
The user reports preliminary foundation tests passing. The dialog/background fix
was checked against the local running v14 client source. Automated tests still do
not establish native renderer behavior, and the new hierarchy requires live tests.

Initial ordering requires managed drawings to share elevation and `interface`
rendering mode. Mixed combinations are rejected without changing those fields.
Unassigned native drawings keep their own visibility/order; unresolved membership
is suppressed for players until explicitly assigned. The native hidden/locked
fields are not rewritten. Multi-client shared-tree writes are not transactional;
avoid simultaneous GM edits until an authority/conflict policy is implemented.

Still pending: expanded JSON exchange, WEBP/SVG export, complete
native v14/multi-client integration validation,
destructive artwork deletion, reliable multi-GM conflict
handling, and the geometry/storage/transaction work for flattening.

### Phase 0 --- Foundry API feasibility and implementation contracts

- Verify creation/update hooks, native visibility, locks, undo, integer sorting,
  elevation precedence, and embedded-document batching on the target v14 build.
- Prototype disconnected/compound Drawing geometry early. If ordinary Drawings
  cannot represent the required consolidation faithfully, surface the blocker
  before investing in the full flattening engine; do not substitute raster Tiles,
  joined paths, or custom rendering without a separately approved scope change.
- Define versioned Scene state and per-GM/per-Scene local state. Keep authoritative
  presentation separate from workspace visibility and active-layer selection.
- Define one canonical sibling-order representation rather than conflicting
  `order` and child-list sources. Derive a deterministic Drawing stack from it.
- Decide how elevation constrains Drawing-only sort guarantees; do not overwrite
  user elevation silently to force a promised layer order.
- Preserve native Drawing locks through independent ancestor-inherited editing
  gates, and compose visibility with native `hidden` without rewriting it.
- Define safe behavior for Unassigned Drawings and deleted/locked active layers.
- Use full preset snapshots; newer nodes default hidden, missing references block
  apply until explicit replacement/deletion, and simultaneous GM writes remain unsupported.
- Measure recovery payload sizes and select durable storage before flattening.
- Use Canvas Layers only for focused optional research; retain license notices
  for any actual reuse. No import or coexistence work is required.

**Exit gate:** verified API/geometry evidence and documented contracts for the
above unresolved details. Implementation should not guess around Foundry limits.

### Phase 1 --- Core Drawing layer foundation

-   New versioned Scene schema, validation, and initialization; no legacy migration.
-   Stable IDs.
-   Drawing membership flag.
-   Active drawing layer stored per GM/Scene.
-   GM-only flat layer panel; authority checks on mutation entry points.
-   GM-local eye toggle.
-   Drag reorder.
-   Native Drawing sort reconciliation.
-   Fixed Scene Background entry.
-   New layers default to GM-visible and player-hidden.
-   Explicit Unassigned membership handling and assignment.
-   Membership indexes and batched, debounced lifecycle refresh.

**Acceptance:** overlapping drawings in three layers visibly reorder as
entire groups; Scene Background remains underneath.

### Phase 2 --- Groups and hierarchy

-   nested groups;
-   drag reparenting;
-   tri-state visibility;
-   group visibility gates preserving child settings;
-   explicit recursive Show All / Hide All operations;
-   orphan handling;
-   safe deletion.
-   native lock preservation and handling of a locked/deleted active layer.

**Acceptance:** cyclic drops are rejected; subtree moves preserve IDs and
membership; hiding/showing a group restores child settings. Safe deletion never
implicitly destroys artwork. Workspace state is independent between GMs.

### Phase 3 --- Player presentation

-   authoritative GM player visibility;
-   persisted Scene synchronization; socket invalidation only if necessary;
-   reconnect persistence;
-   player rendering runtime with no player-facing layer UI or preferences;
-   ancestor-gated effective visibility composed with native Drawing state;
-   non-GM mutation rejection and malformed/stale synchronization tests.

**Acceptance:** players see the GM-selected presentation without layer controls.
Unauthorized requests cannot change persisted state. Reconnect and Scene switches
recover the same presentation. Tests do not claim document confidentiality.

### Phase 4 --- Presets

-   full named presentation snapshots of every node's own player gate;
-   one-Scene-write application; newer nodes become player-hidden;
-   location switching;
-   GM-only Wacom/keybinding exposure where useful;
-   unique names, stable IDs, live-state matching indicators;
-   confirmed apply/replace/delete and stale-dialog guards;
-   missing-reference warnings, blocked application, and explicit recapture repair.

**Acceptance:** presets change only player presentation; GM workspace, active
layer, brush configuration, and selection remain unchanged. Every saved gate,
including hidden child settings, is restored exactly; newer nodes become hidden.
Removed references block apply until explicit replacement or deletion. No per-stroke
updates are made. Keybindings remain optional polish after live validation.

### Phase 5 --- Drawing-tool integration

-   per-layer brush defaults;
-   Foundryshop/Boneyard-derived palette integration;
-   compact pen-friendly layer selector;
-   Wacom ExpressKey/keybinding support.

**Acceptance:** GM layer selection and brush defaults cooperate with existing
drawing controls without modifying selected artwork or a different GM's defaults.
Players receive no Foundryshop layer-selector actions or keybindings.

### Phase 5B --- Drawing consolidation and flattening

- verify Foundry v14 compound/disconnected Drawing geometry capabilities;
- compatibility partitioning by Drawing type/style/render semantics;
- Merge Drawings and Flatten Selected;
- Flatten Layer and Flatten Group;
- preserve order-sensitive artwork;
- reversible recovery snapshots and Unflatten Layer;
- explicit recovery-data disposal;
- transactional failure/recovery tests;
- retain later strokes on unflatten and prompt on edited replacement conflicts;
- repeated flatten recovery lineage and conflict-resolution policies;
- benchmark thousands of strokes before and after flattening.
- follow the owner-approved Consolidate / Bake split in section 15: complete
  image-Drawing consolidation, then transparent native WEBP Tile baking with
  direct-bake support, typed lineage and Undo Bake / Restore originals.
- include owner-approved reversible Level-background baking with verified original
  and Foundryshopped copies, safe media preflight and full-resolution budgets.

**Acceptance:** finished pen-heavy layers can be reduced to substantially fewer
underlying Drawing documents without visible changes or loss of layer behavior, and
can be restored while recovery data is retained.

### Phase 5C --- Portable JSON drawing projects

The full-project/empty/additive slice and resource/font checks/replacement flows
are implemented as described above. Continue with native GM/player round-trip
validation, subtree exchange, explicit multi-Level mapping, and
recovery round trips when the actual consolidation/recovery schema exists.

- Define a separately versioned package schema and canonical round-trip contract.
- Export drawing-specific state only; inventory external assets and fonts.
- Preserve retained recovery by default; support explicit warned omission.
- Implement validated dry-run import into an empty Scene, then additive imports.
- Map placement, Level constraints, author identity, and every internal ID/reference.
- Stage imports player-hidden, verify completion, and expose package presentation
  only by explicit GM action. Test interrupted import and own-operation cleanup.
- Provide full-project export first, then selected-subtree packages with valid
  references and explicit scope.

**Acceptance:** another GM imports a JSON project into an empty Scene and receives
equivalent editable artwork, tree, defaults, presets, and retained unflatten data
after expected remapping. Existing Scene settings/background are untouched.
Repeated additive import creates no collisions or unintended player reveal.

### Phase 5D --- WEBP / SVG artwork export

- Share scope, audience, background/bounds selection and asset diagnostics.
- Build dedicated WEBP output independent of the live canvas composition.
- Implement supported SVG geometry/style/text/group conversion in render order.
- Verify alpha, visual comparisons, font/asset limitations, large-map memory,
  encoding type, and export completion/error reporting.

**Acceptance:** WEBP contains only chosen artwork/background, no native controls
or unrelated objects. SVG preserves the declared vector subset with explicit
warnings for limitations. Both leave live presentation/workspace unchanged.

### Phase 5E --- Removed from scope

SVG/vector import remains excluded. The Phase 5F stamp amendment restores raster
image import/paste only. Keep JSON import/export and SVG/WEBP export. Arbitrary
reference Tile tooling remains excluded; section 15 separately approves baked
artwork Tiles and reversible Level-background baking with original-copy retention.

### Phase 5F --- Unified toolbox, artwork previews and reusable library

This amendment supersedes the earlier GM-only UI rule only through an explicit
role-access setting. Default access remains GM-only. Vector import remains
out of scope. The October 6 stamp amendment below restores
raster image import/paste; thumbnails alone remain preview metadata.

#### Confirmed product decisions

- One auto-opening Drawing Toolbox is the primary Foundryshop interface.
- The **8button** layout keeps the default tablet toolbox eight 44px buttons wide,
  plus gaps and window padding. Three persistent rows remain visible when collapsed:
  eight drawing controls; compact stroke/fill, width and both opacity sliders;
  and up to five recent colors alongside swap and fill/no-fill.
- The expanded body has seven tabs: **Brush & Selection**, **Layers**,
  **Presentation**, **Palettes**, **Labels**, **Library**, and **Settings**.
  Tabs display Foundry Font Awesome icons with localized tooltips and accessible
  names instead of visible titles. Keep keyboard tab navigation and 44px tablet
  tap targets. Collapsed armed-label status has its own row, not extra tool buttons.
- Library browses reusable JSON artwork, not native Foundry Scenes. Projects and
  Shapes are library filters, not separate floating windows.
- Palettes are multiple named shared palettes, not personal/campaign duplicates.
- Reusable shapes contain one or several selected Drawings, preserving saved
  styles and relative layout, and support preview, click-to-place and repeat mode.
- Armed-shape wheel transforms: Shift rotates 15 degrees per event;
  Ctrl scales by factor 1.1 within 5%-2000%. Consume modified canvas wheel input
  only while armed; synchronize ghosts and numeric controls without Scene writes.
  Ordinary canvas wheel input and Alt combinations retain native behavior.
  Use the numeric rotation control for finer adjustments.
- Prefab placement reserves complete sort batches, not per-component midpoint
  allocations. Exhausted gaps automatically re-space existing Drawing sorts,
  including Unassigned artwork, preserving relative visual order. Persist original
  and reordered digests/sorts in a version-3 transaction journal before writes;
  verify maintenance and restore original sorts on failed placement. Concurrent
  artwork edits retain recovery state rather than being overwritten. This applies
  to stamp placement only; additive project imports retain their no-reorder policy.
- Generate actual artwork previews from JSON. Embed a small WEBP thumbnail by
  default in newly exported packages. The artwork data is authoritative.
- Store library packages in a configurable Foundry data folder, with a small
  searchable catalog rather than full geometry in world settings.
- A GM-managed minimum Foundry role controls access, defaulting to GM. Authorized
  users receive the same Foundryshop controls, subject to validated permissions.
- Restricted actions from an authorized non-GM use a validated online-GM request.
  They do not grant unrelated Foundry permissions or silently bypass native checks.

#### Remaining baseline work at this amendment

Hierarchy, presentation presets, independent locks, full-project JSON export,
empty/additive import, resource checks and confirmed empty-metadata replacement
are implemented. A native v14 import of the supplied 30-Drawing project into its
cleared copy was verified, including persistence after reload and unchanged source
artwork. This is not completion of the multi-client acceptance matrix.

Subtree/targeted JSON and dedicated SVG/WEBP output have since been implemented.
Still required: explicit multi-Level mapping; faithful flattening feasibility and recovery implementation;
destructive artwork operations already in scope; and release/performance testing.
Recovery-bearing exchange remains refused until real recovery storage exists.
Session geometry/image stamp placement is implemented as the first reuse slice.
Portable saved shapes, verified custom-shape file creation and a mixed project/
shape browser, full-project saving and optional embedded thumbnails are implemented.
Durable catalog management remains pending; label banks remain separate from geometry reuse.

#### Toolbox layout and interaction contract

**Persistent row 1:** Select, Rectangle, Ellipse, Polygon, Freehand and Text
modes, the Layers shortcut, and expansion/collapse (eight buttons). Display current
mode; collapsed armed placement status and its cancel action occupy a separate row.
The Layers shortcut toggles a short scrollable quick-layer flyout, including while
collapsed: active layer/name/count, group folding, separate inline GM-workspace and
player-presentation visibility eyes, and lock controls with inherited-lock status.
Reuse the authoritative layer controller and visibility summaries. Player-eye taps
change live player presentation gates, not GM workspace visibility; distinguish the
two columns with icons and named tooltips. No drag/drop, reordering, deletion or
other destructive management in this flyout. Provide Open full Layers tab, second-tap
close, outside-tap dismissal and Escape. Open state is transient; preserve readout
scroll during refresh without changing the selected main tab or collapsed state.
**Thumbnail-first flyout amendment:** first implement the shared bounded offscreen
Drawing renderer and actual layer/group thumbnails in the current readout. Then
replace the in-flow readout with a true non-modal anchored overlay beside the
Layers button: classic neutral-gray panel, flat rows, selected-row highlight,
artwork thumbnails, names/counts, folders and the existing GM/player eyes/locks.
**Slate/glass amendment:** extend the Photoshop-inspired styling across the Drawing
Toolbox, not unrelated Foundry windows. Default to sleek neutral slate surfaces,
flat compact controls and restrained glass on the header/window chrome, with opaque
readable control surfaces, clear selected/focus states and preserved pen targets.
Offer per-client Foundryshop Slate, Foundry and Game system choices in the Settings
tab and module settings. Game system opts into the active system's CSS class,
as Townie Maker does with D35E; inherit system styling without changing system
settings or hardcoding D35E as the only supported system. Systems without matching
application styles naturally retain Foundry styling. This is game-system theming,
not an OS light/dark preference. Keep saved colors accurately colored in all modes.
Fit/flip the overlay
at viewport edges and constrain list height without
resizing/repositioning the toolbox on opening. Retain 44px tablet rows, tap opening,
keyboard labels/dismissal, outside/Escape/second-tap closing and full-tab access.
Do not add Channels, Paths, masks, blend modes, layer opacity or drag/drop merely
to imitate controls that have no implemented Drawing-layer equivalent.
**Cursor-anchor amendment:** snapshot the opening click/pen tap in viewport
coordinates instead of anchoring beside the toolbox. Do not track subsequent
cursor or toolbox movement; preserve the snapshot across content refreshes.
Recompute edge fitting on viewport resize. Each reopening captures a new point;
keyboard activation uses the Layers button position, not synthetic (0, 0).
Native Drawing controls remain supported; Foundryshop shortcuts open this toolbox
or select the relevant tab rather than opening competing main windows.

**Persistent row 2:** stroke/fill icon color chips, active color target,
width minus/value/plus and stacked stroke/fill opacity sliders. Trial two 22px
lanes in the existing 44px tablet row, each with its own icon, percentage and
accessible name. Remove duplicate opacity controls from Brush & Selection.
This is an intentional smaller-target exception pending hands-on pen validation;
enlarge the opacity lanes if the trial is uncomfortable.

**Persistent row 3:** up to five recent colors and compact swap/fill-no-fill actions.
Keep the default tablet rows within the eight-button width without shrinking pen
targets. Recent colors are local convenience state, separate from
saved shared palettes. Use a bounded deduplicated history with a visible current
target; selecting a recent color does not edit the shared palette.

The collapsed toolbox must preserve these controls and any armed shape/label
status, including a visible cancel/disarm action. It must not hide a mode that
changes the next canvas click.

**Brush & Selection:** detailed stroke/fill width, alpha, fill type/pattern, text
style, tool-specific settings, eyedropper, and explicit selection actions. Changing
the brush changes future artwork, not selected artwork; applying to selection is
a separate named action with existing native/inherited lock checks.

**Layers:** hierarchy, active layer, GM workspace visibility, player gates, locks,
membership, defaults, folding, ordering, reparenting and safe removal. Preserve
the two visibility domains and existing own/ancestor gate semantics.

**Presentation:** snapshot capture/apply/replace/rename/delete, incomplete-snapshot
diagnostics and a clear audience status. Keep presentation separate from private
workspace/tool state.

**Palettes:** scrollable named sections with labeled swatch grids, add/rename/
duplicate/reorder/delete palette, and add/edit/reorder/remove colors. Applying a
swatch and editing a saved swatch are separate explicit actions; no long-press,
hover or double-click requirement. Allow the same color in different palettes.
Color edits commit on Save; Cancel leaves the shared palette unchanged. Confirm
destructive deletion and reject stale concurrent edits.

**Labels:** combined styled typing/preview composer first, then unified saved
entries with starter defaults. Preview clicks arm one standalone cursor placement;
Escape/Cancel disarms. Font-size/rotation controls and canvas modifier-wheel
gestures update the ghost. Keep explicit Save and Apply-to-selection, naming and
personal/campaign ownership. Do not delete user entries during UI consolidation
or replenish intentionally deleted starters. No Next/Repeat label controls.

**Library:** searchable thumbnail cards, Projects/Shapes filters, names/tags and
details; save current project or selected artwork, browse/add JSON files, preview,
place/import, rename/tag, refresh/reindex and explicit deletion. A project import
uses existing translation, Level mapping, resources, metadata-replacement warning,
dry run, hidden staging and journaled completion. It is not native Scene creation,
activation, background replacement or import of Tokens/Walls.

**Settings:** toolbox density/position/appearance and drawing behavior settings,
plus authorized library configuration. Access threshold, relay policy, library
folder and destructive administration remain GM-only. Keep Foundry's module
settings registration as a supported recovery entry point; the tab edits the same
settings, not a competing store.

The color picker is an on-demand child popup for stroke/fill chips or explicit
palette editing. Color picking, file selection, text input and confirmations may
remain bounded child dialogs; "one toolbox" eliminates duplicate main panels, not
necessary modal workflows. Preserve the existing picker/eyedropper behavior.

#### Pen, keyboard and window behavior

**Whole-window sizing amendment:** keep the eight-button layout and density choices,
and add a separate client-local 50-125% scale slider in 5% steps. Default 100%;
Mouse (50%) and Tablet (100%) presets set scale without overwriting density.
Use native ApplicationV2 window scaling for all chrome/text/controls and the
Layers flyout together, not unrelated dialogs or other Foundry applications.
Show the percentage while dragging and apply on release so the slider does not
move under the pointer. Keep viewport bounds in rendered pixels, scaled scroll
limits and captured flyout cursor coordinates correct at every size. Smaller
layouts deliberately reduce pen targets: recommend tablet density at 100% for
44px targets and mouse input at 50%. Verify 50/75/100/125%, drag positioning,
small viewports, flyout flipping and persistence before proceeding to JSON previews.

- Comfortable controls target at least 32 CSS pixels; tablet density targets at
  least 44 CSS pixels with spacing. Compact mode remains an explicit choice.
- All operations have single-click/tap paths. Dragging may enhance reordering, but
  move buttons/dialogs remain available. No pressure, hover, wheel or right-click
  requirement for essential actions.
- Persist local tab, collapse state, size and position; clamp to viewport. Scroll
  the tab body, not the persistent strips. Maintain tab-specific scroll positions
  across ordinary data refreshes without losing focused edits.
- Brush/tool buttons leave keyboard drawing focus usable. Text/numeric editors
  accept input normally; switching tabs never submits an unsaved edit silently.
- Suppress canvas creation beneath UI interactions. Cancel placement on Escape,
  Scene/Level change, permission loss and incompatible tool/layer changes.
- Implement accessible labels, selected/armed states and keyboard tab navigation.
  Do not convey workspace/presentation/lock state through color alone.
- Test Wacom-style pointer input, browser zoom, small viewports and picker placement
  without assuming mouse hover or native touch gestures.

#### Shared artwork renderer and thumbnail contract

Create one bounded, offscreen renderer over validated Drawing snapshots. Reuse
geometry, style, text, sort and bounds interpretation for import previews, library
thumbnails, shape ghosts and WEBP output. Never screenshot the live canvas or
temporarily create Scene Drawings to render a preview.

**First renderer delivery:** transparent WEBP previews, initially at 96px for layer
cards, with 32-512px bounded output dimensions, 256 KiB maximum encoded preview,
1,000 Drawings, 100,000 point coordinates, 4 MiB snapshot data, 16 textures,
4096px source textures, 16 million total decoded texture pixels, 250,000 estimated
smoothing segments and bounded text rasterization. Initial texture preview
support is static PNG/JPEG/WEBP; unsupported image formats fail explicitly.
One render at a time, at most 32 waiting requests, cancellable work and a 64-entry/
8 MiB/30-second preview cache. Reject unsupported geometry/resources explicitly;
never substitute native fallback hazard art or screenshot Scene output.
These are preview limits, not restrictions on existing Scene artwork or final
export size; full WEBP/SVG exports have their own future fidelity/limit acceptance.
Render layer identity artwork including native/player/workspace-hidden members
on the displayed Level, with a disclosed full-artwork label; group thumbnails
combine descendant layers. Empty, loading and failed previews are distinct.
Lazy-load visible rows, cancel obsolete requests, fingerprint artwork/styles/
resources, retain transparency and show white thumbnail backgrounds in the UI rather than encode
it into artwork. Use Foundry's native smoothing and text-style helpers where
appropriate, measured graphics/text bounds and no Scene or primary-group writes.

Render thumbnails with a fitted view box, preserved aspect ratio and padding;
show actual artwork and alpha on white for thumbnail readability, not generic
shape icons. The thumbnail WEBP remains transparent; larger preview checkerboards
can be a future explicit viewing option rather than forced thumbnail presentation.
Measure loaded text and handle rotations/stroke extents; conservative package
bounds remain diagnostics rather than proof of exact rendered bounds.

Preview default is all packaged artwork, including player-hidden/native-hidden
content, visibly labeled as a full-artwork preview. Hiding is not confidentiality.
Optional audience filtering must use the same declared export rules. A thumbnail
included with a full package may reveal that artwork and is disclosed in export.

Extend the versioned package schema with optional, bounded thumbnail metadata and
scope information for subtree/shape packages. Define MIME, dimensions, encoded-byte
and decoded-pixel limits; accept embedded WEBP only for this field. Preserve older
packages without thumbnails. Keep thumbnail bytes separate from canonical artwork
comparison; regenerate or mark stale thumbnails when artwork changes.

Do not trust an embedded thumbnail to prove package validity or resource readiness.
**Generated import preview milestone implemented:** after native dry run and
resource repair/recheck, the final review starts a bounded 384x256 full-artwork
preview asynchronously. Use validated import-plan snapshots so mapped textures/
fonts, translation, Level and sort match the planned import, removing temporary
staging metadata only in detached preview data. Clearly exclude destination
artwork/background. Dismissal or a stale Scene/Level/revision/GM authority cancels
obsolete work; never attach its image to another review. Failure is an explicit
advisory warning, not proof of readiness or a new bypass of import validation.
**Embedded export thumbnail milestone implemented:** version 1 accepts an optional
`thumbnail` object with `mime: image/webp`, `scope: full-artwork`, integer width/
height and canonical base64 data, never a URL. Cap at 256 KiB, 512px per axis and
262,144 pixels. Validate RIFF size/chunk boundaries, reject animation, and compare
canvas dimensions with the static VP8/VP8L header before any image decoding.
This is header validation, not certification of compressed-image decodability.
The export dialog defaults to generating 256x192 thumbnails; allow opting out and
require separate external-resource acknowledgement. Rendering failure requires
an explicit export-without-thumbnail decision. Check exact authoritative package
artwork/metadata before saving; reject changed content rather than attach stale
art. Embedded bytes never participate in native artwork verification or Scene
persistence; import review continues generating its own authoritative preview.
Saved-library cards are implemented; dedicated publication exports and durable
library administration remain separate follow-up milestones.
Validate the package before enabling import. The authoritative preview is generated
from artwork, with missing font/texture warnings and the existing repair/recheck
flow. Never fetch external resource URLs merely to generate a thumbnail. Explicit
acknowledgement is required before rendering resources that contact another host.
Treat missing assets, unsupported rendering and encoding failures explicitly;
offer a deliberate export-without-thumbnail path if thumbnail generation fails.

Use bounded render sizes/concurrency, lazy thumbnail loading, cancellation and
cache eviction. Validate image headers/dimensions before expensive decoding where
available. Release PIXI/canvas textures and object URLs. Cache by artwork/render
options/resource status, not just filename.

#### Starter prefab art and default palette amendment

**October 6 product decision:** use one original muted-color **Fantasy Mapping**
palette for the starter prefabs and make it the toolbox's default palette for
first-time use. It should complement parchment, pale dungeon stone and ordinary
fantasy battlemap backgrounds without imitating or bundling another product's
artwork. Do not produce a sepia prefab variant or a separate sepia starter kit.
Other default/preset palettes remain available in the Palettes tab; this decision
does not remove palette choices or collapse them into one palette.

The proposed 20-color Fantasy Mapping palette is:

| Name | Hex |
|---|---|
| Charcoal Ink | `#302B26` |
| Brown Ink | `#594538` |
| Parchment | `#E8D8B5` |
| Ivory | `#F4EAD2` |
| Aged Paper | `#BBA47B` |
| Sandy Earth | `#BA9868` |
| Clay | `#956A50` |
| Deep Soil | `#614C3C` |
| Oak Wood | `#A17A4F` |
| Dark Timber | `#6B4E35` |
| Limestone | `#B8B3A3` |
| Slate | `#858B88` |
| Deep Stone | `#535E60` |
| Sage | `#A3AD7A` |
| Moss | `#74834D` |
| Pine | `#445F49` |
| Shallow Water | `#8FAEB0` |
| Deep Water | `#526F83` |
| Rust Red | `#A45B46` |
| Ochre Gold | `#C29B4B` |

Ship the palette as an immediately available built-in default, without requiring
world setup. Support direct shared editing and copying to another named palette. Preserve a user's
explicit palette selection and existing custom/shared colors; do not overwrite
them on startup or upgrade. Default palette selection is not a command to recolor
placed artwork or replace the Scene background. Prefabs retain their authored
colors and relative styles when placed.

Ship 88 original top-down editable prefabs across eight categories: rooms and
structure; trees and vegetation; furniture; storage and supplies; dungeon
features; natural terrain; camp and settlement; map symbols. Include distinct
deciduous/oak/broadleaf/conifer/narrow-conifer/dead-tree silhouettes plus shrubs
and a stump. Prefer native geometry without external textures or font dependencies,
transparent surroundings, restrained dark outlines and readable muted fills.
Target 2-12 Drawings per ordinary prefab and review a ceiling of 24. These are
visual objects, not native Walls, lights, collision or functional doors.

Review actual-renderer contact sheets on white, parchment, pale stone and dark
ground. Growing the catalog is approved when additional objects are useful;
prefer meaningful objects and silhouettes rather than inflating counts with recolors.
Built-in searchable artwork cards and the unified Projects/Shapes browser expose
the collection and two complete example projects: The Wayfarer's Rest and
Whispering Woods Ruins. Examples use the same default color palette;
placement/import remains explicit and preserves existing transaction safeguards.
**First implementation milestone:** Fantasy Mapping (20 colors) is the default
built-in palette selector, with Grayscale and Bright Markers alternatives. Persist
selection client-locally.
**Unified palette amendment:** use one selector for built-in and custom palettes,
render only its selected palette as compact horizontal wrapping swatches, and
append a + swatch to add a color. Header + creates and selects a named empty palette.
Manage reveals rename/duplicate, imports, per-color edits/reordering/removal, and
custom-palette delete or confirmed built-in reset. Built-ins are directly editable;
persist overrides through the existing revision-checked, verified shared service,
never write merely on viewing, and reset only the chosen built-in's name/colors.
Creating/duplicating/adopting a palette selects it immediately. Changes to saved
colors do not recolor existing artwork or alter authored prefab styles.

#### Paired appearance swatches (implemented; owner acceptance remains)

Implemented with the full 447-test regression suite passing and native Foundry v14 dry-run
checks: rendered tinted split samples, whole-button semantics, native editor
field rebinding/submission, touch repeat controls, context actions/Escape and
exact Pattern/Solid/None Drawing source output through the creation hook.
Width/opacities and saved layer defaults were preserved; Solid/None cleared
stale textures/repeat flags. Fixtures intercepted settings writes and did not
create live Scene artwork. Physical pen/touch and multi-GM acceptance remain
part of the owner cleanup/release milestone.

Extend the existing palette rather than add a tab or a competing brush-preset
system. Palettes can contain ordinary single-color entries and named paired
appearance entries. This is a bounded appearance shortcut, not the full named
brush-preset milestone; broader brush presets can reuse it later.

**Application contract**

- A single-color entry keeps existing behavior: apply to the currently targeted
  Line or Interior. Do not make existing color buttons unexpectedly set both.
- A paired entry sets Line color and Interior color/tint together, regardless of
  the current Line/Interior target. It also sets an explicit Interior mode:
  None, Solid or Pattern. Pattern includes its own texture reference and repeat
  scale, using the existing material-scale contract.
- Preserve current line width, line opacity and interior opacity. Do not save
  those in a pair or silently restore visible width/opacity when they are zero.
  Do not capture tool, text/font, geometry, stamp transforms or unrelated defaults.
- Solid explicitly clears the active texture; None cannot retain an accidentally
  active textured fill. A Pattern entry uses its saved material/scale, not whatever
  texture happens to be selected later. Switching entries must not leak an old
  texture or effective repeat scale into a new appearance.
- Apply to future native drawing only. Do not recolor existing artwork, alter
  labels or override authored prefab/copied/image-stamp styles. Applying to
  selected artwork remains a separate explicit action, not a side effect of
  clicking a palette entry.

**Split-button and editor contract**

- Divide the swatch left/right: Line on the left, Interior on the right. The
  whole button is one activation target, not two miniature click regions.
- Show solid colors directly; show a tinted material sample for Pattern and
  checkerboard/slash for None. Use a fine separator and explicit tooltip/
  accessible name describing the entry, Line, Interior mode/tint and material.
  Distinguish pairs from single colors without relying on color alone.
- Right-click a single color offers Create paired swatch, using that color as an
  editor starting point. Saving adds a new named entry; it does not silently
  replace the original single color.
- Right-click a pair offers Edit, Duplicate and Delete. The existing +/Manage
  controls expose equivalent operations for touch/pen/keyboard users. Right-click
  is an optional shortcut, never the only path; maintain tablet targets, keyboard
  focus, dismissal and existing destructive-action confirmation standards.
- Use a bounded editor with name, Line color, Interior mode, Interior color/tint,
  optional material and repeat scale, and an outlined-object preview. Reuse the
  existing color/material pickers and numeric-control standards.
- The editor preview uses current line width and both opacities and explains
  those inherited settings, including invisible outline/interior cases. Compact
  palette samples identify saved colors/materials; they are not a promise that
  the current brush renders at full opacity.
- Save commits a validated entry; Cancel changes neither palette nor brush.
  Applying/editing a pair never automatically overwrites the active layer's
  saved defaults. Keep shared palette ownership and revision-checked verified
  writes; refuse stale concurrent edits rather than replace newer entries.

**Texture and failure contract**

- Texture applies to the Interior only; separately textured Lines are not part
  of the supported Drawing workflow.
- Reuse shipped materials/native local-file selection and bounded resource
  verification. Save references, not image bytes or transient blob URLs.
- Resolve/verify a Pattern resource before changing either color or any creation
  setting. Missing, invalid, canceled or stale resources must not apply a partial
  pair or silently fall back to Solid. Report real failures explicitly.
- Application uses one verified transient appearance overlay rather than
  sequential native-color/module-repeat setting writes. This implementation
  refinement eliminates partial persistent brush application: Return restores
  the untouched baseline. Explicit manual width/opacity edits retain their
  ordinary persistence; appearance edits while armed remain transient and show
  a modified indicator. Saving the shared entry still requires verified,
  revision-checked persistence.
- Integrate pair fields into relevant palette validation, CRUD, duplication,
  ordering, search, reset and palette exchange surfaces. Existing single-color
  entries remain usable; do not add speculative legacy migration infrastructure.

**Layer-default precedence (explicitly approved)**

An explicitly chosen pair wins over active-layer saved appearance defaults for
subsequent drawing. Limit the override to colors, Interior mode and optional
texture/scale; preserve the normal width/opacity and unrelated-property behavior.
Do not bypass layer membership, visibility, locks, ordering or permission checks.
Make the active appearance override visible, with a named Return to layer defaults
action. That action clears the paired appearance override and resumes normal
layer-default behavior; it does not edit/delete the pair or rewrite saved layer
defaults. Merely viewing a palette or editing a saved entry does not activate
an override. Do not persist transient override state as Scene/layer metadata.
Cover layer/Scene changes and reload in lifecycle tests so an invisible stale
override cannot unexpectedly affect a different workspace.

**Implementation sequence and acceptance**

1. Extend the palette entry contract and validated services; cover mixed entries,
   existing single-color behavior, revision conflicts, duplication/reset/exchange.
2. Add the split preview, bounded paired editor and equivalent context-menu/
   +/Manage operations without adding a new main panel.
3. Wire verified appearance application and narrow layer-default precedence,
   visible override status and Return to layer defaults. Reuse the material
   pipeline; do not duplicate rendering/resource loading.
4. Test exact future-Drawing output for Solid, None and Pattern pairs, switching
   from existing textures and conflicting layer defaults. Assert width/opacity
   preservation, current target independence, no Scene writes on Save/Cancel,
   unchanged saved layer defaults and unchanged authored stamps/labels.
5. Verify missing-texture, stale-selection/layer/Scene, partial-write and
   concurrent-edit failures; verify return-to-defaults and lifecycle cleanup.
   Native checks must exercise final Drawing creation, not just button colors.
6. Validate split/tinted previews, transparent settings, keyboard/context-menu
   behavior and non-right-click touch paths. Include this workflow in owner UI
   cleanup and the final-final README conversion after implementation is verified.

#### Starter prefab package contract

Ship deterministic validated definitions, using shipped textures where authored
and no external asset downloads; generate lazy previews using the shared renderer.
These built-in cards require no configured folder. They load the existing stamp
pipeline at Scene-grid size (100px per square on gridless Scenes); rearming retains
the loaded pixel scale. The version-1 shape wrapper contains stable ID, name,
category/tags, nominal footprint and an existing validated project payload; refuse
hidden/locked components, layer/preset membership, source Levels/provenance and
mixed render modes. Native geometry remains authoritative and independently
editable.

**Current starter collection:** 88 artwork prefabs, including eight textured
examples, in the Fantasy Mapping appearance. Eight categories contain 11
vegetation, 10 structure, 11 furniture, 11 storage, 15 dungeon, 13 terrain, 9 camp
and 8 symbol entries. Six tree silhouettes include round deciduous, spreading
oak, broadleaf, conifer, narrow conifer and dead branching tree. Add complementary
shrubs/stump/log/reeds/fungi, room/corridor templates, seating/sleeping/study props,
storage/transport, tomb/ritual/forge fixtures, water/rock/shore objects, camps and
market/bridge/fence objects, and explicit annotation symbols. Combined category
filter and name/tag search update cards without losing input focus and report
visible/total counts. Cache validated definitions, return detached copies and
keep thumbnails lazy/cancellable; do not rebuild the entire catalog per preview.
Persistent custom shape files/saves, expanded details and example projects remain
follow-ups; more distinct useful assets can be added without a fixed count ceiling.

#### Texture materials amendment and next implementation sequence

**October 6 approved direction:** add texture materials to editable Drawings,
starting with repeating shape fills, not a separate terrain-painting engine.
Keep the unified Palettes tab focused on colors. Image stamps remain fitted
single images; material fills repeat inside shape boundaries. Soft-edge terrain
painting, material blending, PBR lighting and vector import are not included.
Existing prefabs keep their authored styles; do not automatically texture or
recolor the starter collection.

**Verified foundation:** the running Foundry v14.365 Drawing schema exposes
`texture`, `fillType`, `fillColor` and `fillAlpha`, but no dedicated texture
scale/offset fields. Native pattern fills and our offscreen renderer already
accept image textures. Project packages inventory asset paths, and stamp
placement checks texture availability. The creation-default patch service
currently does not accept texture paths; this and layer brush-default validation
must be deliberately extended, not bypassed. Documentation research is not a
substitute for native pixel-fidelity checks on each supported shape.

**UI contract:**

- Put a compact Material control in Brush & Selection: None / Solid / Texture,
  a selected-material thumbnail/name, and a searchable thumbnail picker.
  Reuse the existing fill-mode control rather than adding a second independent
  mode selector. No extra top-row tool or competing color palette selector.
- Reuse fill color as tint and fill opacity as material opacity. White shows
  the original material colors. Make this interaction explicit in the UI.
- Selecting a material changes future-drawing defaults only. Applying material
  settings to existing selected artwork requires a separate explicit action,
  native edit permission, lock checks and stale-selection verification.
- Add texture scale after the native fill proof. Define scale relative to Scene
  grid units (with a documented gridless fallback), rather than making material
  density depend accidentally on the source image dimensions.
- Independent texture rotation/offset are follow-ups to scale, not required for
  the first usable release. Numeric shape rotation and stamp wheel rotation
  remain distinct from independent material orientation.
- Scope first delivery to the existing GM toolbox. Add no player-facing material
  controls or permission changes as part of this milestone.

**Asset contract:**

- Start with 12-16 original deterministic seamless materials that complement
  Fantasy Mapping: rough stone, flagstone, brick, cobblestone, timber planks,
  wood grain, packed earth, sand, gravel, grass, forest floor, water ripples,
  snow, ice and parchment grain. Final entries depend on visual proof; do not
  add near-duplicate assets merely to meet a count.
- Prefer restrained neutral/grayscale patterns suitable for palette tinting,
  readable beneath outlines, with consistent authored nominal repeat sizes.
  Target 256-512px static PNG/WEBP assets; measure actual decoded memory and
  package size before expanding the kit. Bundle files locally with stable paths.
- Original procedural generation is the recommended first asset approach.
  Curated CC0 assets are optional: verify each asset's license/source, retain
  provenance, and use licensed downloadable files rather than assuming website
  thumbnails or API access have the same terms. ambientCG explicitly permits
  asset redistribution; Poly Haven distinguishes CC0 assets from site content
  and separately governed API access.
- Provide explicit existing-local-file selection through native FilePicker.
  Do not scan arbitrary folders or automatically download external collections.
  Upload support, if added, must reuse verified persistent-file handling.
  Never persist blob/object URLs or embed full texture bytes in Scene flags.
- Reuse static-image header/decode checks, timeouts, preview cancellation/cache
  and owned-resource cleanup. Preserve current image/preview limits: individual
  source checks must not exceed 16 MiB, 4096px per axis or 16 million pixels;
  previews retain their stricter aggregate and distinct-texture limits.
  Report missing, unsupported or oversized assets explicitly, without rendering
  a success-shaped placeholder. External requests require explicit consent.
- JSON continues to carry texture references, not a portable bundled asset pack.
  Preserve resource inventories, replacement mappings and preflight safeguards.

**Implementation steps, in order:**

1. **Native repeating-fill proof (next implementation task).** Test detached
   textured rectangle, ellipse, polygon and closed-freehand Drawings against
   the offscreen renderer. Verify repetition, shape clipping, tint, opacity,
   outlines, resize and rotation. Extend creation-default validation and the
   existing fill UI with a minimal local texture selector. Test that selecting
   a texture changes only new-drawing defaults, not existing Scene artwork.
2. **Starter materials and picker.** Produce and visually review a small proof
   collection first on white/parchment/stone/dark backgrounds, then complete
   the useful 12-16 material kit. Add bounded searchable previews, explicit
   local-file selection and clear selected/missing-resource states. Verify
   tablet targets, mouse scaling and narrow-window wrapping without extra
   palette controls.
3. **Consistent texture scale.** Choose a validated module-owned Drawing
   metadata contract and extend package/shape validation intentionally.
   Extract one shared fill-transform helper, distinguishing material fills
   from fitted image stamps; use it in native artwork, ghosts, thumbnails,
   import previews and future exports. Do not add an independent renderer.
4. **Complete integration and explicit selection application.** Wire material
   settings through layer default capture/apply, ordinary drawing creation,
   copy/place, prefab transforms, JSON export/import and resource replacement.
   Implement the explicit existing-selection action using repository-standard
   permissions, locks, stale-state checks and verified writes. Add textured
   prefab examples only after consistency is proven.

**Acceptance gates:**

- Native and preview output agree on repetition, clipping, tint/alpha and
  material scale for all supported closed shape types. Compare actual rendered
  output, not only schema validity or successful image decoding.
- Check material seams across repeat boundaries, tiny/large shapes, resize,
  rotated shapes and gridless Scenes. Define and test stamp scaling policy:
  whether material density stays world-relative or scales with the copied
  artwork must be decided before step 3 rather than silently inferred.
- New brush defaults and layer defaults agree; material selection does not
  mutate already placed artwork. Explicit selection application rejects locked
  or changed targets and does not affect unrelated fields.
- Copy/place and JSON round trips retain texture paths, validated metadata,
  geometry, style and order. Image-stamp fitting remains unchanged.
- Missing files, invalid headers, decode failures, external-resource refusal,
  cancellation and stale Scene/Level/authority changes are explicit and leave
  no unintended persistent artwork or orphaned preview resources.
- Run focused service/renderer/UI tests, native detached visual checks, the full
  regression suite and the staged build with runtime hash verification.
  Do not modify the user's live Scene for research or proof tests.

**Material milestone status:** steps 1-4 and textured starter integration are
implemented. Retain independent texture rotation/offset and terrain painting as
deferred scope; continue publication/library work through their own gates.

**Step 1 implemented:** Brush & Selection retains the existing None/Solid/Pattern
selector and adds native local-file selection, selected path and explicit
clear-to-Solid. Selection reuses bounded header/decode/resource cleanup, refuses
external/transient URLs, checks unchanged Scene/Level/brush state and changes only
future creation defaults. Fill tint/opacity remain existing controls; disabling
and re-enabling fill restores Pattern when a texture remains selected.
Layer default capture/application now includes texture references. Project
dependency inventory includes default-only textures, and import replacements
map those references as well as Drawing textures. Sixteen detached native v14
pixel comparisons matched exactly across rectangle/ellipse/polygon, smoothing,
two sizes, rotation, tinted translucent fills and outlines, without Scene writes.

**Step 2 implemented:** ship 15 original deterministic seamless 256px grayscale
PNGs: rough stone, flagstone, brick, cobblestone, timber planks, wood grain,
packed earth, sand, gravel, grass, forest floor, water ripples, snow, ice and
parchment. Combined compressed assets total 286,908 bytes; reproducible Node
generation uses periodic noise/cells and explicit pattern geometry, without
third-party artwork or dependencies. Asset tests verify exact generated bytes,
distinct patterns, bounded static-image headers and repeat sampling on both
axes, including negative coordinates.
The inline Brush & Selection material picker uses three columns, lazy thumbnails,
localized name/category search without rerendering, selected source thumbnail/name,
explicit no-match/decode-error states and native local-file browsing. No new
palette controls or top-row buttons. Built-in thumbnails are restricted to the
fixed bounded shipped catalog; external custom-reference thumbnails are not
automatically requested. All actual material selections still use bounded
verification with stale/cancellation checks before updating creation defaults.
Native review verified all 15 files decode, compact tablet/50% geometry, and 30
exact native/offscreen pixel comparisons using rotated tinted translucent shapes.
Live Scene artwork remained unchanged. Build/packaging now includes assets.

**Approved step 3 policy and implementation:** scaling a textured prefab scales
its saved material with its geometry, preserving proportions. Texture repeat
width is 0.05-100 grid squares in client-local brush defaults (default 1), with
100px/square on gridless Scenes. Resolve it at new-Drawing creation to
`flags.foundryshop.materialRepeat`, a finite positive pixel width <=10,000,000.
Aspect ratio is retained by uniform scaling against source texture width.
Existing Drawings without metadata retain native pixel repetition; no migration
or automatic rewrite. Ordinary native shape resize retains the stored repeat
width; copy/place and prefab transforms multiply saved repeat width by their
geometry scale. Image-stamp fitting remains a separate branch.
Layer defaults store grid-square width and creation resolves it for the
destination Scene. The virtual field is not written into Foundry's native
Drawing palette schema. A shared material fill helper serves native rendering,
ghosts and offscreen rendering; validated metadata survives shape/project JSON
and asset replacement. Native creation previews use current material width.
Eighteen exact native/offscreen pixel comparisons covered three repeat widths,
three shape types and two prefab scales without persistent Scene edits.
**Step 4 selection application implemented:** a single "Apply fill to selected
artwork" action in Brush & Selection confirms the selected Drawing count before
replacing fill type, texture, tint, opacity and repeat width. This explicitly
changes existing artwork, not future defaults. Solid/None removes material
texture and repeat metadata. Strokes, geometry, labels, membership and provenance
are untouched. Reject the entire batch for uneditable/locked artwork, locked
layers, pending imports or fitted image stamps; never silently skip components.
Recheck Scene/Level, selection IDs, grid, defaults and full Drawing sources after
confirmation and local bounded image verification. Use one native embedded
Drawing update, then verify exact resulting sources except Foundry modification
statistics. Server failures/partial or altered writes explicitly warn that some
artwork may have changed; do not restore stale snapshots over concurrent edits.
Detached native Drawing schema tests verified Pattern/Solid/None, metadata removal
and preservation of geometry/strokes without live Scene changes. Tablet review
verified a 44px action and no horizontal overflow.
**Textured starter-prefab integration:** eight additional editable examples use
shipped flagstone, timber planks, forest floor, sand, water ripples, ice, rough
stone and brick. Saved pixel repeat widths retain proportions through existing
grid-relative prefab loading, scale/rotation, previews and JSON dependency
inventory. Internal catalog definitions total 102: 88 Library artwork prefabs
and 14 text examples shown only as saved Labels entries. Original solid-fill examples
remain unchanged. Search "textured" in Library to find the additions. Complete
example projects are implemented below; independent texture rotation/offset and
terrain painting remain deferred.
Validation: all eight offscreen previews rendered in native Foundry v14; all 13
components passed detached native Drawing validation after 1.5x scale/45-degree
rotation with repeat metadata intact. Live Scene data remained unchanged.
Regression tests cover JSON round trips, shipped dependency files, five scales
including placement bounds, category counts and existing solid-fill examples.

**Complete example projects:** the unified Library browser offers The Wayfarer's
Rest and Whispering Woods Ruins as Built-in project entries without a configured
user-library folder. Both are
validated editable project packages assembled from shipped prefabs, with nested
groups, Ground/Structure/Features/Labels/Notes layers, texture repeat metadata and
native-font labels. Full Map overview, Terrain only and All details (includes
notes) snapshots demonstrate presentation. Notes start presentation-hidden;
preview/download include them and do not promise confidentiality.
Lazy shared-renderer previews show all artwork. Review import reuses normal
empty/additive resource checks, offsets, dry-run and confirmation; Download JSON
uses the existing validated serializer. Browsing/canceling writes no artwork.
Import retains pixel coordinates, maps to the displayed Level and uses the
existing player-hidden wrapper/fresh-ID/current-author policy. No backgrounds,
grid changes, Walls or lighting are included. Verified custom-shape saving is
implemented, including full-project saving and optional embedded thumbnails;
durable administration remains follow-up work.
Validation covers both examples imported into empty and
populated projects with source styling, existing artwork and hidden-wrapper
policy preserved. Detached Foundry v14 checks validated all 60 native Drawing
components and rendered both complete previews. Tablet project actions measured
44px high without card overflow; temporary fixtures were removed and live Scene
data remained unchanged. The runtime build includes both examples.

#### Reusable shape placement contract

**Styled labels:** ship 14 default saved-bank entries in Labels, with no separate
Library label previews. Signika covers readable rooms/notes; Amiri covers fantasy landscape
names; Modesto Condensed covers dungeon/tavern headings. Use Foundry's existing
font resources, without bundled font files or third-party downloads.
Examples include room labels, Whispering Woods, Silver River, Old Watchtower,
THE SUNKEN KEEP, THE WAYFARER'S REST and a two-line passage note. Ink/map colors
and 22-64px authored sizes suit parchment and ordinary map backgrounds.
Saved bank entries optionally carry validated `{fontFamily,fontSize,textColor}`;
plain entries retain Drawing defaults. The editor uses native registered font
choices, 8-256px whole-number size and color controls; styles follow standalone
cursor placement and explicit selected-label application, without changing brush
defaults. Initialize starter defaults once; do not replenish deleted entries.
Explicit starter restoration remains additive and does not replace user entries.
Missing fonts and stale style edits fail clearly. JSON text prefabs retain font
dependencies. Native detached review verified all 14 rendered layouts fit their
Drawing bounds, and tablet examples have 44px targets without horizontal overflow.
No persistent live Scene/settings writes were made during verification.

**Label composer amendment:** make the primary Labels surface an inline font
selector, multiline text area, native Drawing font size/text color/text opacity
controls and live parchment preview. Font options and textarea use their chosen
typefaces; preview shows exact requested size/color/opacity. Inputs update without
rerender/focus loss. Text/font/color/opacity draft edits disarm placement; font-size
changes update an armed cursor label. Place label arms the draft, Save adds it to
the selected bank, and Apply updates the selected
editable Drawing without arming placement. Do not write Drawing brush defaults.
Keep the unified saved presets below as readable clickable words in their fonts,
with accessible buttons, keyboard focus and selected states. Add optional
validated textAlpha (0-1) to bank/armed style and preserve it through placement,
including 0 opacity. Foundry v14 Drawing schema exposes fontFamily, fontSize,
textColor and textAlpha, but not editable bold/italic/alignment/shadow controls;
do not invent unsupported native properties. Native Chromium review confirms
font-preview menu entries, live multiline font/color/opacity changes and bounded
tablet layout without Scene edits.

**Combined typing/preview refinement:** replace the duplicate preview with a
single styled native textarea on parchment. Apply exact selected font size,
font family and RGBA text color; never apply opacity to the whole control.
Keep caret/selection visible, native multiline editing/spellcheck/maxlength and
bounded vertical resize/scroll (100-240px). Preview typography rather than claim
pixel-identical Foundry canvas wrapping/outlines. Draft/action/storage semantics
follow the preview-first contract above.

**October 6 stamp amendment:** implement editable one/multi-Drawing copy-and-place
and PNG/JPEG/WEBP image import/clipboard paste before the persistent library.
This supersedes the earlier exclusion of raster image import only; SVG/vector
import remains excluded; continuous spaced/scattered stamp-brush strokes are a
later Phase 5G milestone, not part of this first placement slice.
The implemented first milestone has a session-only copied/loaded stamp, numeric scale/rotation,
ghost preview, primary-click placement and repeat, with explicit Escape/cancel.
Do not imply a saved searchable shape catalog exists before its storage milestone.

Images upload through native FilePicker to a GM-configured existing data folder,
using fresh filenames; never keep temporary clipboard/blob URLs in Scene data.
Limit each shape stamp to 100 Drawings, 100,000 point coordinates and 4 MiB.
Limit each image to 16 MiB, 4096 pixels per axis and 16 million pixels, inspect
headers before decoding, reject animated inputs, and verify uploaded resources.
Use image-backed rectangular Drawings with white untinted fills, transparency,
and explicit image-stamp metadata. A narrowly scoped Drawing texture matrix fits
the image to its rectangle on native resize; ordinary pattern fills are unchanged.
Integrate that metadata into future offscreen rendering/SVG/WEBP exports. No Tiles
or parallel artwork hierarchy are introduced. Native JSON packages retain asset
paths rather than embedding uploaded image bytes, with existing resource checks.
Uploaded assets persist even if placement is cancelled; do not silently delete files.

The Library tab owns import/paste/copy/rearm and scale/rotation/repeat controls,
without adding a ninth top-row button. Show armed status/cancel outside tab bodies
even when collapsed. Clipboard handling only consumes supported image payloads
on the drawing canvas, never text-field pastes or native Drawing copy/paste.
Scene/Level/authority changes, Escape and leaving drawing mode cancel previews.
Reuse the existing import journal and verified Drawing transaction for placements,
but preserve destination layer tree/presets, active layer gates and existing artwork.
Respect active-layer/ancestor locks and workspace hiding, choose fresh IDs/current
author/displayed Level, and reject stale destination or mixed elevation/interface
ordering. Never replace saved styles with active brush defaults.

Save one or more selected Drawings as an editable shape package with normalized
local coordinates, relative positions, order and saved styles. Exclude user IDs,
Scene-specific IDs and private workspace; include asset/font inventories. Saving
does not change the source selection. Reuse subtree/package remapping helpers
rather than building an independent geometry format.

Use a canvas ghost for the complete shape, placed with one primary click. Expose
explicit numeric scale/rotation and repeat-placement controls; preserve relative
geometry and order under transformations. Placement targets the active unlocked
layer and displayed Level, uses fresh IDs/current author, and preserves native
hidden/locked fields with clear warnings. Do not silently override brush defaults,
presentation gates or original saved styles.

Capture a destination snapshot for each placement, verify it before writing,
serialize multi-Drawing writes and journal/compensate partial failures. Verify the
common elevation/interface constraints and safe sort space before placing a
collection. Repeat mode must not accumulate ghosts or repeatedly place from the
same pointer event. Collapse/tab changes preserve a visible armed state; explicit
disarm and Scene/Level/authority changes remove it.

#### Library storage and catalog

**Project browser milestone implemented:** GM-configured `data` root, immediate
JSON files only, with a session-derived metadata index and two-column searchable
name/filename cards. Cap at 100 files, 20 MiB each and 64 MiB per serial refresh;
stream with 10-second per-file timeout, same-origin credentials, no-store and no
redirects. Independently require GM and `FILES_BROWSE`. Validate each package;
display explicit file/thumbnail errors. Keep only normalized path/root, SHA-256
file identity, name/kind, counts and bounded embedded thumbnail metadata, never
duplicate geometry. Re-read/revalidate exact fingerprints before card import,
then reuse existing mode, translation, resources, hidden staging and journal flow.
Older thumbnail-free packages remain usable. The browser now supports verified
project/custom-shape writes as described below; full durable administration remains
follow-up work. Built-in example projects share the same browser without files
or a configured folder and are visibly distinguished from saved content.

**Persistent custom-shape milestone:** Save selection creates a fresh named/
categorized/tagged editable shape file in the configured data root, independently
requiring GM Drawing access and FILES_BROWSE/FILES_UPLOAD. Reuse selection-copy
normalization without changing session copied/armed stamps; normalize geometry
and material repeat to 100px per square, clear Level/provenance/membership/author
references and normalize common elevation to zero. Native-hidden/locked artwork,
mixed render modes and pending imports remain refused. Bounds: 100 Drawings,
100,000 points, 4 MiB, 20-square footprint axes, 12 tags of 40 characters,
name/category 80/40 characters and source grid 5-2,000px (gridless 100px).

Stable shape identity lives in the portable JSON, with a fresh shape-ID filename.
Check immediate file capacity and case-insensitive filename collisions before
upload; no intentional overwrite. Foundry file upload lacks atomic
create-if-absent, so simultaneous external writes to the same path are not
supported. Recheck selected complete sources/IDs, Scene/Level/grid, authority and
folder across the metadata prompt, browsing, upload and verification. Exact
SHA-256 read-back precedes success and reindex; uncertain uploads report the
potential file path without destructive automatic cleanup. Distinguish successful
save plus refresh failure so users do not duplicate a verified file.

Refresh now validates project and shape packages, indexes bounded shape
ID/category/tags without geometry duplication, refuses duplicate shape IDs,
offers Projects/Shapes filtering and tag search, and rechecks exact fingerprints
before shape placement through the existing grid-aware stamp preview/Repeat flow.
Project and shape saves now optionally generate embedded thumbnails as described
below; older thumbnail-free packages remain supported. Portable rename/duplicate/
tag editing and replacement repair are implemented in the administration slice
below. Shared catalog removal/restoration is implemented separately below;
file deletion remains deferred.
Original shape-saving validation: 421 tests passed, covering exact byte verification, collisions,
permissions, stale/deleted selection, canceled dialogs, duplicate IDs, failed
reindex after a verified save and serialized custom-shape reload/placement.
Detached Foundry v14 checks exercised native Drawing normalization and a mocked
FilePicker upload/read-back/reindex, with matching fingerprints and no changes
to Scene data or session stamps. Actual library writes were not performed during
validation. Tablet Save/Place actions measured 44px high without section overflow.
Temporary fixtures were restored/removed; the staged runtime build is verified.

**Project-save and thumbnail milestone implemented:** Save current project
captures all Scene Drawings plus the complete portable layer/default/preset tree,
including native-hidden and presentation-hidden content, not unrelated Scene
documents. It reuses existing one-source-Level/20 MiB/10,000-Drawing/1,000,000-point
validation; unsupported recovery and unfinished imports remain hard refusals.
Fresh `project-ID.json` filenames use bounded generated IDs. The administration
slice below adds optional portable library metadata; fresh saves still never
silently overwrite prior files.
The same serial project/shape file writer checks capacity, case-insensitive
collisions, authority/root/snapshot, then verifies exact SHA-256 read-back before
publishing metadata or refreshing. No automatic deletes or Scene writes.

Both save dialogs default to a generated 256x192 embedded full-artwork WEBP,
bounded by the existing preview and thumbnail validators. External resource
loading needs explicit consent. Unchecking the option is supported; render/resource/
encoding/size failures require a separate Save without a thumbnail confirmation
before upload. Cancellation or stale complete artwork/layers/presets,
Scene/Level/grid/permissions/folder cannot use the fallback. Shape thumbnails live
inside their portable project, survive validated reload and display directly in
Library; older thumbnail-free shapes retain the existing lazy preview path.

Validation at that milestone: 461 tests passed. Native Foundry v14 dry runs exercised the actual
metadata dialogs, hidden Drawing plus layer/default/preset project save, shape
normalization, real rendered WEBP thumbnails and intercepted upload/read-back/
reindex with matching fingerprints. Project/selection controls measured 44px;
Library had no horizontal overflow. Two files existed only in the fixture's
in-memory store; real Scene data and files/settings were not written. Owner
physical tablet, real-file and multi-GM acceptance remain release gates.

**Portable metadata/duplication/repair slice implemented:** The owner explicitly
selected metadata edits inside portable JSON, not catalog-only overrides.
Manage saved files exposes saved-card edit/duplicate and unfinished-replacement
review; built-ins are not editable. Projects use optional bounded
`library: {id, category, tags}`, with project name authoritative. New project
saves receive identity metadata; first metadata edit assigns an older project an
identity. Shape edits preserve outer identity; copies get fresh IDs/filenames.
Artwork, layers/defaults/presets, references and embedded thumbnails stay intact.
Name/category bounds are 80/40 characters; at most 12 trimmed/deduplicated tags
of 40 characters. Source fingerprints, root/context and independent permissions
are rechecked; copies recheck their source after folder browsing before upload.

Replacement additionally requires SETTINGS_MODIFY and a separate confirmation
disclosing backup/concurrency limitations. Before any replacement, write and
verify a bounded hidden world ledger (at most 100 records, revision checked)
containing only token/root/path/before/after fingerprints, not artwork or rollback
bytes. Verify exact uploaded bytes before removing the marker. Uncertain writes
or marker-clearing failures retain explicit repair/error cards after reload;
fresh reindex and fingerprinted reads also consult the current ledger.

Repair re-reads/validates current bytes, displays path/name/kind/count/hash and
whether they match original, intended or neither version. Explicit acceptance
rechecks that fingerprint and clears only the marker; it never uploads, deletes
or restores Scene content. Missing/malformed files require external restoration
before acceptance. Verified operation plus refresh failure is a separate outcome.
Foundry uploads lack atomic compare-and-swap and world-setting revision checks
are not atomic locks. Same-path concurrent browser/external edits are unsupported.
Back up files first. Native v14 FilePicker exposes no supported file-deletion API;
do not invent socket endpoints. Shared catalog removal/restoration is implemented
below; a supported deletion workflow remains unresolved work.

Validation: 479 regression tests pass, covering cancellation, bounds, permissions,
stale bytes/context, preserved geometry/thumbnail metadata, source-independent
copies, uncertain replacements, failed journal writes/clearing and repair.
Native Foundry v14 dialogs exercised edit plus separate replacement confirmation,
fresh duplication, simulated failed upload, persistent repair review/acceptance,
44px form targets and no horizontal overflow. All file/setting writes were
intercepted in memory; real files and 47 Scene Drawings remained untouched.
Physical tablet, real-file and multi-GM acceptance remain release gates.

**Shared catalog removal/restoration implemented:** The owner selected shared
removal for all GMs, not per-GM hiding. Removal is separately confirmed and leaves
JSON/assets/Scene documents untouched. Removed items enables the management view;
restoration explicitly accepts current validated bytes and returns the card to
ordinary browsing/import/placement. Built-ins cannot be removed. Require GM,
FILES_BROWSE and SETTINGS_MODIFY independently, not FILES_UPLOAD.

Keep a separate hidden world catalog with version/revision and at most 100
removed records across configured roots. Each record contains only normalized
root/path, kind, stable portable ID (nullable for identity-free project files),
bounded name and removal-time fingerprint; no geometry, thumbnails or resource
payloads. Browse/validate files to obtain current metadata rather than persisting
a second artwork catalog. Removals survive refresh/reload and root changes.
Records follow paths; moved/copied files at another path are separate discoveries.
Changed bytes or replaced identities never silently resurface: keep removal and
disclose changes. Missing/malformed paths retain named/kinded removed error cards
and need external restoration plus refresh before catalog restoration.

Recheck authority, root, open/abort context, current source fingerprint and
expected whole catalog revision/state before writes. Verify setting read-back;
uncertain writes report that removal/restoration may have persisted and require
refresh/inspection, not blind retry. These optimistic checks are not atomic
cross-GM locks; simultaneous catalog writes remain unsupported pending the
concurrency milestone. Removed files cannot import/place/edit/duplicate, even
through stale entries. Repair warnings remain visible in both views; catalog
restoration refuses unresolved replacements and repair acceptance does not
restore catalog membership. No automatic file cleanup, uploads or Scene edits.

Validation: 488 regression tests pass, including source/cancel/permission/root/
revision races, dropped and uncertain setting writes, capacity, malformed
catalogs, changed/missing files and independent repair/removal state. Native
Foundry v14 in-memory removal/restoration and isolated toolbox checks verified
hidden cards without placement, restored placement, 44px tablet restore/dialog
targets and no horizontal overflow. Catalog writes were intercepted; file bytes
and all 47 Scene Drawings were unchanged. Fixtures were restored and closed.
Real-file, physical tablet and connected multi-GM validation remain owner gates.

Use a GM-configured folder under a supported Foundry FilePicker data source.
Store independently portable JSON files containing their thumbnails. Catalog
contains stable entry ID, kind, name, tags, package path, content fingerprint,
version and thumbnail locator/cache metadata; not duplicated Drawing geometry.
Choose finite catalog, package, tag and file-operation limits before coding.

Never assume folder browsing/upload/delete rights from module access. Normalize
paths, restrict writes to the configured library root and refuse traversal,
unexpected sources or arbitrary caller-supplied paths. Verify writes before
updating the catalog; interrupted saves surface an explicit repair state.
Refresh/reindex handles missing files, stale metadata, collisions and older
thumbnail-free packages without silently replacing content.

Separate removal from the catalog from file deletion, with explicit confirmation.
Use stable identity and expected fingerprints to prevent stale edits/deletes.
Large JSON uploads use supported file APIs rather than embedding payloads in
socket messages. Validate any files independently when read, including changes
made outside Foundryshop.

#### Access and online-GM relay

World setting selects the minimum Foundry role; default is GM. Gate main UI,
shortcuts and every service action consistently. Non-authorized clients still
receive passive presentation rendering; no editing controls are exposed.
Authorized editors need their own private workspace/active-layer state, separate
from the player audience gates. Do not merely expose GM buttons while leaving
their canvas on the passive player visibility branch. This workspace access does
not override native document visibility/ownership permissions; verify those
limits explicitly before claiming equivalent editing access.

Authorized users are not promoted to GM. Use native permissions for allowed
document/file actions. For restricted module actions, send a bounded typed command
to one deterministically chosen online GM. Recheck caller identity/role, current
Scene/Level, requested action, expected revision/fingerprint, native/inherited
locks, document ownership rules and payload limits on the GM before applying.

GM-only administration cannot be relayed by a non-GM. No generic document patch,
code execution, arbitrary file path or generic settings-update command is allowed.
Use unique request IDs, duplicate suppression, bounded timeouts and a verified
result. A timeout is not proof that nothing committed: reconcile operation IDs
before retry. If no GM is available, disable restricted actions with a reason;
never return success-shaped defaults or promote permissions.

Wire `socket: true` only when this validated relay is implemented. Module role
thresholds cannot make player-hidden data confidential or authorize unrelated
Scene manipulation. Exercise two online GMs, disconnects and request replay.

#### Implementation milestones and acceptance

**Shell milestone implemented:** seven-tab navigation, persistent tool/brush/
recent-color controls, embedded layer/preset/JSON surfaces, local settings,
color-selector child popup, local tab/collapse/position state and per-tab scroll.
Existing palette editing and personal/campaign label/color data are preserved.
Advanced brush/selection expansion, thumbnail rendering/library, persistent reusable
shape packages/catalog and minimum-role/relay work are still
pending. Non-GM toolbox opening is disabled until that access gate is implemented.
Native v14 smoke checks verified all seven tab bodies, separate layer/preset/
exchange action surfaces, collapsed width controls and no Scene changes.

**Named shared palettes implemented:** world-owned revisioned store, 32 palettes,
256 colors per palette, 2048 overall. Grouped swatch cards expose palette and color
CRUD, duplication, pen-friendly move controls, comma-separated color additions,
explicit adoption of existing color lists, stale-edit rejection and verified
writes. Applying and editing colors remain separate; adoption leaves originals
untouched. Saved color editing currently uses hex/name fields; an isolated
graphical picker with Save/Cancel for saved palette edits remains pending.
Language-file namespace expansion is regression-tested after a native v14 loader
failure caused raw labels in the toolbox.

1. Define shared UI/service contracts, role threshold, named palette schema,
   package preview/scope schema and storage limits. Keep all existing services
   callable while extracting reusable panel bodies.
2. Build the toolbox shell and seven tabs. Integrate existing controls, layer and
   presentation bodies, settings, picker and labels; redirect old launchers.
   Regression-test all existing actions and private workspace behavior.
3. Implement named shared palettes and persistent brush/recent-color strip. Keep
   current saved colors through an explicit adoption path into named shared
   palettes; never silently discard them. Legacy migration remains out of scope,
   but current development-world data must not be lost by this redesign.
4. Prove offscreen renderer fidelity and supported geometry/assets/text, then
   implement WEBP/SVG output and generated import previews/embedded thumbnails.
5. Add subtree/shape packages and shared library catalog/file flows. Implement
   actual artwork cards and preview-before-import with no Scene writes.
6. Implement single/repeat shape placement and verified transactional creation.
7. Complete role/service gating and restricted online-GM relay before enabling
   non-GM access. Earlier milestones remain GM-only until this gate passes.
8. Validate pen/keyboard UX, resource/network failures, role changes, concurrent
   edits, thumbnail limits, reload persistence and realistic large libraries.

Acceptance: collapsed controls remain usable; all existing main workflows are
reachable in the toolbox; generated previews faithfully depict supported artwork
without changing the Scene; legacy thumbnail-free JSON remains importable; failed
preview cannot accidentally enable import; library saves/edits/deletes are verified;
shape placement preserves geometry/style/order and respects destination locks;
unauthorized users cannot invoke services/relay; and native Foundry permissions
remain unchanged. Publish unsupported fidelity cases rather than claiming a
generic image thumbnail satisfies actual-artwork preview requirements.

### Phase 5G --- Mapping workflow and illustration tools

**October 6 workflow amendment:** all five recommended shortlist items and all
five "worth adding later" suggestions are approved roadmap work. Spaced stamp
brushes appeared in both lists and are one capability, not two implementations.
This phase is planned, not implemented. Complete the shared renderer, previews,
exports and persistent library foundations first; do not divert those milestones
into a general-purpose raster editor.

#### Shared interaction and safety contract

- Preserve the eight-button-wide tablet toolbox. Keep contextual selection actions
  in Brush & Selection, reusable assets in Library, and advanced brush settings/
  presets in the existing tabs or child dialogs. Do not add a permanent ninth tool
  button or an eighth tab without a separate UI scope decision.
- Brush/preset changes affect future artwork only. Transforming or adjusting
  selected artwork requires an explicitly named selection operation.
- Preview first, commit explicitly, and cancel without Scene writes. Keep armed
  modes and cancel visible while collapsed; Escape, Scene/Level changes, authority
  loss and leaving drawing mode cancel transient work. No essential pen workflow
  depends solely on hover, right-click, dragging tiny handles or modifier keys.
- Reuse native validation, active-layer and ancestor locks, workspace visibility,
  player gates, permission checks, resource checks, operation serialization and
  verified transactions. Never repurpose player presentation to implement editing
  isolation. Existing artwork outside an operation's declared scope is unchanged.
- Define finite object/point/history limits and a measured interaction/performance
  budget for each milestone before coding. Failure and unsupported geometry must
  be explicit; no silent style clamping, partial-success claims or placeholder art.
- Integrate new geometry and image metadata into JSON, thumbnail previews and
  WEBP/SVG output before declaring a feature complete. Publish renderer limitations
  and SVG raster-image handling; do not claim image stamps become vector paths.

#### G1. Atomic undo/redo for module operations

Treat one module operation as one history entry: a multi-Drawing stamp, collective
transform, image adjustment, layer duplication or generated room/corridor. A
continuous stamp stroke is one entry regardless of impression count. Research
native history integration first; do not create competing Ctrl+Z behavior or imply
that native clipboard/drawing actions are covered by module history automatically.

Store bounded before/after state and operation-owned IDs, with expected
fingerprints/revisions. Undo/redo refuses intervening edits, deletion, changed
membership or authority rather than overwriting another GM's work. Respect locks
at execution time and distinguish committed undo history from unfinished-write
recovery journals. Define history retention and reload behavior explicitly; do
not promise durable cross-reload undo without verified storage.

**Acceptance:** one undo removes/restores the whole operation; redo recreates its
declared result. Partial failures recover or retain an actionable journal.
Unrelated artwork and newer edits survive. Native undo remains functional, and
conflicts/history eviction are visible rather than silent.

#### G2. Collective selection transforms, duplicate and flip

Move, uniformly scale and rotate one or several selected Drawings as a collection,
using a declared shared pivot and preserving relative layout, order and styles.
Provide numeric controls and pen-friendly manipulation; reuse stamp transforms
rather than adding another coordinate model. Duplicate uses fresh IDs/current
author and an explicit destination, never overwrites the source.

Add horizontal/vertical flip. Prove native support for polygons, primitive shapes,
text and image stamps separately. Specify whether text remains readable or is
mirrored; reject unsupported cases with a clear reason instead of silently
changing their meaning. Image mirroring needs renderer/package metadata, not
negative native dimensions. No non-uniform scale or skew is implied by this scope.

**Acceptance:** mixed supported selections preserve collective geometry and
stack order; original IDs remain for in-place transforms and new IDs for copies.
Native/ancestor locks and stale selections block writes. Cancel leaves source
unchanged; one operation has one undo entry. Round-trip/export fidelity covers
each supported geometry class and flip representation.

#### G3. Live artwork transform previews

Update the complete selection or stamp ghost as scale, rotation, position and
supported flips change. Do not require repeated re-arming to inspect each value.
Separate preview state from documents; maintain a stable pivot, hide native handles
from export, and dispose preview objects/textures/listeners on cancellation.
Coalesce pointer/input events and bound concurrent rendering. Previews must not
contact unapproved resource hosts or display a different transform than commit.

**Acceptance:** pen and numeric adjustments produce responsive previews matching
the committed geometry. Cancel, tab/collapse changes and Scene/Level changes obey
the shared interaction contract; repeated edits do not leak ghosts or resources.
Selection preview never exposes source artwork through player presentation.

#### G4. Named brush/tool presets

Save named reusable configurations for drawing modes and supported width, stroke/
fill colors, opacity, fill/pattern and smoothing settings: for example stone wall,
river, road and GM annotation. Prefer a bounded shared named collection with local
last-used state, following the shared-palette store and stale-write patterns.
Store validated configuration/resource references, not duplicated palette banks,
Scene IDs or presentation/workspace settings.

Provide create, apply, rename, duplicate and explicit delete. Selecting a preset
does not alter selected Drawings or their saved stamps. Missing resources or
unsupported tool properties block application with repair guidance.

**Acceptance:** one application restores the declared new-artwork configuration;
existing artwork remains byte-for-byte unchanged. Preset edits have Save/Cancel,
stable identity, finite limits, permission gates and stale-edit protection.
Active preset status is honest after manual changes, rather than falsely claiming
the brush still exactly matches a saved preset.

#### G5. Optional grid snapping and angle constraints

Offer off/grid/half-grid positioning and explicit fixed-angle constraints for
eligible drawing, placement and transform interactions. Respect Scene grid type,
size, offset and the displayed Level; research native snapping APIs before
implementing geometry calculations. Define hex-grid and gridless behavior rather
than treating every Scene as a square grid.

Keep unconstrained freehand available for caves and natural terrain. Provide
visible toggles and numeric options usable without a keyboard; optional modifiers
are shortcuts, not the only control. State whether snapping applies to a placement
anchor, vertex or collective pivot, and never independently distort stamp members.

**Acceptance:** snap and angle settings affect only opted-in operations and are
accurate under pan/zoom and supported grid types. Preview and commit agree.
Turning snapping off restores ordinary drawing behavior; constraints never
rewrite previously created artwork or conflict with native selection gestures.

#### G6. Room and corridor illustration tools

Drag or specify room dimensions; draw a corridor centerline and choose width.
Generate editable Drawing outlines with rectangular, rounded and irregular room
variants, with explicit line/fill styles and supported corner/join behavior.
Reuse geometry/renderer helpers and snapping, rather than emitting opaque raster
artwork. Define finite vertex counts, minimum widths and behavior for crossing,
degenerate or self-intersecting paths; reject unsupported input before commit.

This is illustration only. Do not create/update Foundry Walls, doors, lights,
movement restrictions, Tokens or Scene backgrounds. Any future gameplay-document
generation requires a separate preview/approval and scope decision.

**Acceptance:** generated shapes have correct dimensions/joins, remain editable,
respect active-layer/Level gates and export faithfully. One creation is one undo
entry; cancellation creates nothing. Existing artwork and gameplay documents are
untouched. Include square-grid rooms and unsnapped cave/corridor examples.

#### G7. Non-destructive image-stamp adjustments

Add opacity, tint and rectangular cropping to image stamps. Retain the original
uploaded asset; adjustments are validated document metadata, not overwritten image
bytes. Define crop coordinates in source-image space, handle transparent pixels,
and preserve the uncropped source for reset. Keep ordinary native pattern fills
unchanged. Image opacity/tint are selection operations, distinct from the active
brush's stroke/fill controls.

Renderer research must prove crop, tint, scaling, rotation and flip composition
before exposure. Integrate native resize, JSON/resource checks, shared offscreen
rendering, thumbnails and exports. If exact cropping cannot be represented in a
supported export, disclose/block that output rather than silently exporting the
uncropped image.

**Acceptance:** Save/Cancel/reset work without touching the original file.
Transparent edges and non-square crops render consistently at multiple scales.
Undo restores prior adjustments; missing assets and stale/locked selections are
reported. This is not pixel painting, retouching or a general raster editor.

#### G8. Layer/subtree duplication and GM workspace solo/isolate

Duplicate a layer or group subtree and its editable artwork with fresh node/
Drawing IDs, remapped membership, retained relative order/styles and explicit
handling of native locks/hidden state and recovery-bearing content. Use safe
player-hidden defaults for the duplicate; leave existing presentation presets
unchanged, so their application does not accidentally reveal the new nodes.
Reject unsupported recovery rather than dropping it. No source deletion or
automatic selection of a different Level.

Solo/isolate is local GM workspace state only. Remember/restore the preceding
visibility state without overwriting concurrent deliberate workspace changes;
define nested solo and deleted-node behavior. Solo never changes player gates,
presentation snapshots or native document hidden flags. Show isolation clearly
and provide an explicit exit action even when collapsed.

**Acceptance:** duplicate produces independent artwork/tree membership with no
changes to the source and has one undo entry. Visibility/lock/order invariants
hold under hierarchy changes. Solo affects only that GM's workspace, and leaving
solo restores the declared state safely while players see unchanged presentation.

#### G9. Bounded spaced stamp-brush strokes

After stamp placement, live previews and atomic undo are stable, allow pen dragging
to place image/shape impressions at defined spacing along the stroke. Start with
spacing, size and rotation controls; add optional reproducible seeded variation
only after the deterministic baseline passes. Do not promise pen pressure dynamics
without separate device/browser evidence.

Sample distance in Scene coordinates, not browser event count. Preserve source
layout and style for every impression. Choose finite per-stroke impression,
Drawing, point, resource and Scene budgets before coding; multi-Drawing stamps
multiply cost. Preview/count the prospective result, stop before limits and surface
the limit explicitly. Serialize/journal commits, reject stale destinations and
avoid duplicate impressions from repeated/coalesced pointer events.

Use editable Drawing impressions initially. Do not conceal object proliferation
with automatic rasterization, flattening or joined paths. If benchmarks show
unacceptable cost, request a narrower limit or storage decision before shipping.

**Acceptance:** evenly spaced impressions at different pen speeds/zoom levels;
one undo for the entire stroke; deterministic geometry for declared settings;
no extra impressions after cancellation, lost capture or Scene/Level changes.
Failure leaves no untracked partial stroke. Benchmark representative tree/rock/
footprint stamps and multi-Drawing shapes near the advertised count limits.

#### Dependency and delivery order

1. Finish Phase 5F shared renderer/export/preview and persistent asset/shape library.
   Preserve the implemented session stamp-placement and 8button GUI.
2. Establish atomic operation history/undo and common verified mutation contracts
   (G1). Native history feasibility is a prerequisite, not a post-release patch.
3. Deliver collective transforms with live previews (G2-G3), then named tool
   presets (G4) and snapping/angle constraints (G5). Image flipping depends on the
   image adjustment/rendering representation as needed.
4. Deliver room/corridor illustration (G6), non-destructive image adjustments
   (G7), and layer duplication/workspace solo (G8). These may proceed independently
   only after their respective history, geometry and renderer prerequisites pass.
5. Deliver bounded spaced stamp brushes (G9) last, after placement/history/
   preview/snapping foundations and performance evidence.
6. Extend Phase 6 acceptance for every feature. Non-GM use remains disabled until
   the existing role/relay validation gate passes; do not relax it for this phase.

No scope is added for pixel painting, magic-wand/content-aware tools, arbitrary
layer blend modes, automatic image-to-Wall/lighting conversion or vector import.
Other earlier suggestions (align/distribute, stroke stabilization, smart symbols,
hatch presets, annotation kits and scale helpers) are not separately approved by
this amendment; existing planned behavior remains unchanged.

### UI consistency standard and owner-led cleanup pass

**Status:** standards codified; comprehensive cleanup/review still pending.
The project owner will perform a tab-by-tab UI cleanup pass to ensure a
consistent-quality experience across all tab contents and the main GUI.
This is an explicit release-readiness checkpoint, not a claim that every
existing control already meets the standard. Apply these rules to new work
now; record existing gaps for the cleanup pass rather than silently expanding
unrelated feature work. No runtime redesign is authorized by this note alone.

#### Main GUI and layout

- Keep one unified toolbox with a stable tool strip, quick brush controls,
  tab navigation and a scrollable tab body. Preserve the eight-button-wide
  tool-strip rhythm; tabs need not contain eight entries.
- Retain compact, comfortable and tablet densities. Existing baseline control
  sizes/gaps are 28px/3px, 36px/4px and 44px/6px respectively, at 100% UI scale.
  Primary standalone actions must retain at least 44px hit targets in tablet
  mode, including icon-only, plus/minus and visually unboxed preset buttons.
  Review dense quick-control exceptions explicitly with real pen input.
- Use shared spacing, typography, control heights, borders, focus treatments
  and theme tokens. Verify both the Foundry-following appearance and the Slate
  theme. Artwork previews may use a deliberate neutral/parchment background;
  do not let theme button styling repaint swatches or artwork samples.
- Keep primary controls near the top, reusable examples/content below, and
  secondary management/advanced options in clearly labeled lower sections or
  disclosures. Avoid multiple competing selectors for the same state.
- Fit supported viewport sizes and UI scales without horizontal overflow,
  clipped actions or off-screen dialogs/flyouts. Let rows wrap and collections
  form responsive grids. Prefer one main vertical scroll region per tab;
  bounded editors, lists and flyouts may scroll independently when justified.
- Preserve per-tab scroll, window position, collapse state and draft values
  across ordinary refreshes. Do not replace a focused editor on every keystroke
  or lose caret, selection, native undo or in-progress edits to background hooks.

#### Controls and interaction

- Use native semantic buttons, inputs, selects and textareas with localized
  labels, accessible names and visible keyboard focus. Icon-only actions need
  meaningful labels/tooltips; critical instructions cannot be hover-only.
  Selection, armed modes, locks and errors must not rely on color alone.
- Numeric size controls follow the line/font-size pattern: editable value with
  decrease/increase actions, Up/Down Arrow keys and a documented wheel shortcut
  where appropriate. Prefer native number-input behavior; visible minus/plus
  buttons are the touch-friendly stepper equivalent, not tiny spinner arrows.
  Declare units, bounds and increments; preserve per-control semantics rather
  than imposing font-size steps on unrelated values. Font size uses 1px steps,
  Shift 5px steps, and 8-256px bounds.
- Choose controls by task: font size and line width use precise numeric
  steppers; bounded visual adjustments such as opacity or gamma-style tonal
  values use sliders with a visible current value. Gamma is a control-design
  example, not approval to add a gamma feature.
- Consume wheel events only over the intended control and only for handled
  gestures. Keep Ctrl/Alt/Meta browser/Foundry gestures available on size fields.
  Placement retains Shift+wheel rotation and Ctrl+wheel scaling; do not restore
  Alt+wheel rotation. Button/input alternatives must remain available.
- Editing a draft is not applying it to existing artwork. Clearly distinguish
  Use/arm, Place/Repeat, Save to a collection, and Apply to selected artwork.
  Show active modes and provide an obvious cancel/disarm action, including
  when the toolbox is collapsed.
- Show selection-dependent availability and the reason an action is blocked.
  Validate inputs visibly; report failed writes explicitly, including possible
  partial effects. Confirm destructive/bulk changes and recheck their targets.
  Do not silently discard drafts, reset settings, or mutate Scene artwork
  while browsing tabs, examples or previews.

#### Numeric and slider standard for mouse, keyboard and touch

Use established web spinbutton/slider patterns rather than custom gesture-only
widgets. This standard applies when those controls are implemented or cleaned
up; it does not assert that existing controls already support every path.

| Control | Mouse / wheel | Keyboard | Touch / pen |
|---|---|---|---|
| Precise numeric stepper | Type an exact value, click decrease/increase, or wheel over the control. Wheel up increases, down decreases by the declared step. | Up increases and Down decreases; direct editing remains available. Existing font-size Shift coarse steps remain; document other coarse steps only when supported. | Large decrease/increase buttons plus direct numeric entry; do not depend on native spinner arrows or a hardware keyboard. |
| Bounded visual slider | Drag or click the track; wheel adjustment may be added when useful, over the control only. Show the current value and units. | Retain native range-input arrows: Up/Right increase, Down/Left decrease, Home/End select bounds. | Generous thumb/track hit area, tap-to-position and an equivalent exact-value input or large step buttons for fine adjustment without dragging. |

- Prefer native `input type="number"` and `input type="range"` with associated
  labels, `min`, `max` and `step`. Do not add redundant ARIA or replace native
  keyboard behavior with competing handlers. Custom controls require equivalent
  semantics and real assistive-technology validation.
- All interaction paths share the same validated value, bounds and step.
  Synchronize slider, displayed number and preview immediately without
  recreating the editor. Reject invalid typed values visibly; clamp step/button
  adjustments to bounds. Do not make tiny wheel deltas unpredictable or allow
  duplicated handlers to apply a step twice.
- Slider precision must match the domain: percent opacity has explicit percent
  units; gamma-style ratios, if later approved, have explicit bounds, precision
  and neutral/default value. Do not choose a nonlinear mapping without defining
  and explaining it. Do not treat percentages and ratios as interchangeable.
- In tablet mode at 100% scale, target at least 44 by 44 CSS pixels for standalone
  adjustment actions and slider interaction areas. The visible rail/thumb can
  be smaller than its hit area; hit areas must not overlap nearby controls.
  Compact density is not the touch-size acceptance baseline. Recheck effective
  target sizes at supported UI scales.
- Touch must not require wheel gestures, modifier keys, hovering or precise
  dragging. Provide a single-pointer non-drag alternative on the same surface.
  Allow vertical tab scrolling outside intentional slider manipulation; avoid
  page-wide touch suppression. Do not silently change values when scrolling past
  controls.
- Test the actual native/browser behavior on target touch devices, including
  screen-reader interaction. WAI-ARIA specifically warns that slider gestures
  may not work reliably with some touch assistive technologies; a mock or
  desktop mouse proof is not sufficient.

**Standards basis:** [WAI-ARIA spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/)
and [slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/);
[WCAG 2.2 target size enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
(44px, Level AAA) and
[dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
(non-drag pointer alternative, Level AA). These inform the project baseline;
they are not a claim of full WCAG conformance. Wheel direction/steps and density
choices are Foundryshop interaction conventions, not W3C requirements.

#### Tab-content contract

| Tab | Primary content and quality standard |
|---|---|
| Brush | Current stroke/fill controls and materials first; distinguish color, opacity, texture and repeat-size units. Keep selected material feedback and explicit Apply-to-selection behavior separate from future brush defaults. |
| Layers | Readable hierarchy, active destination and consistently placed visibility/lock/order controls. Distinguish local GM workspace visibility from player presentation and native document locks. Secondary tree management must not crowd ordinary selection. |
| Presentation | Authoritative player gates and preset controls with explicit actions/status. Applying presentation must not change GM workspace, brush, selection or active layer. |
| Palettes | One named-palette selector. Dropdown color samples run horizontally, not as a vertical column. Selected palette colors form a wrapping row/grid with a trailing plus action to add a color; management actions remain secondary. |
| Labels | Font selector and combined typing/live-preview textarea first, followed by size, color and text opacity. Font choices preview their typefaces. Saved/example presets below appear as rendered words, while retaining accessible button semantics and tablet hit areas. No duplicate typing/preview box or invented native text fields. |
| Library | Search/filter and recognizable artwork previews with clear source/type and placement modes. Distinguish shipped examples, session copies and persistent user content; do not imply session-only artwork is saved. File/catalog management is secondary and explicitly confirmed when destructive. |
| Settings | Group appearance/density/scale and behavior preferences with clear labels, units and effects. Keep occasional configuration out of the primary drawing workflow; settings do not silently alter existing artwork. |

Preview the actual color/font/material/artwork whenever practical rather than
substituting generic buttons. Communicate fidelity limitations: the label
textarea previews typography, not pixel-identical native canvas wrapping,
outline or shadow. Previewing must not create or edit Scene documents.

#### Cleanup review and acceptance

The owner-led pass covers all seven tabs, the persistent quick controls, layer
flyout, collapsed toolbox, collection editors and related dialogs. Record
tab-specific findings and agreed corrections, then implement them in bounded
passes with focused regression checks. Mark the checkpoint complete only after
the owner reviews the corrected experience.

- Review each surface at compact/comfortable/tablet densities, supported UI
  scales, both appearance modes and narrow/short supported viewports.
- Exercise mouse, pen/touch and keyboard navigation; verify target sizes,
  focus visibility, readable labels, contrast and discoverable shortcuts.
- Check empty/populated collections, long names, multiline/large/transparent
  labels, missing resources, locked selections, errors and armed/cancel states.
- Verify no unnecessary horizontal scrolling, duplicated primary controls or
  management clutter; primary tasks remain reachable without hunting.
- Verify live changes preserve input focus/caret and ordinary refreshes retain
  drafts/scroll. Confirm consistent outcomes for button, input and wheel paths.
- For numeric/slider controls also verify arrow keys, slider bounds keys,
  touch non-drag alternatives, synchronized values, scroll behavior and actual
  touch assistive technology; record any untested device/browser combinations.
- Verify browsing/style previews do not modify artwork, local GM visibility
  does not change player gates, and players receive no editing/presentation UI
  under the current GM-only policy.

Functional tests and detached UI proofs support this pass; neither replaces
the owner's real-world quality review. It adds no new feature scope and does
not relax permission, confirmation or transaction safeguards.

### Phase 6 --- Integrated validation and release readiness

- Run the full acceptance matrix on real GM and player clients.
- Test multiple GMs, Scene switching, reconnects, external Drawing edits, invalid
  references, native hidden/locked Drawings, and interrupted multi-document work.
- Verify player UI absence as well as presentation correctness.
- Complete the owner-led tab-content/main-GUI cleanup checkpoint against the
  UI consistency standard above, with owner review of the corrected experience.
- Benchmark 1,000 and several thousand Drawings with realistic nesting; compare
  load, interaction, visibility, reorder, and flattening before/after timings.
- Use existing Node tests for pure stores/services and Foundry integration tests
  for renderer, document lifecycle, and network behavior. Run existing build and
  tests for each integrated milestone.
- Document GM-only controls, group gates, player-hidden defaults, presentation-only
  hiding, geometry limits, recovery storage, and destructive confirmations.
- Include Phase 5G operation undo/conflicts, collective previews/transforms,
  presets, grid/angle constraints, room/corridor geometry, image adjustments,
  duplication/solo and stamp-brush count/performance limits in the release matrix.
- Verify licensing for any reused material and package without external layer
  dependencies.

**Acceptance:** scenarios A-P pass for declared supported artwork, including
actual count reduction for compatible pen strokes. Unsupported geometry is
reported without transformation, but that alone does not satisfy the flattening
milestone. If Foundry cannot support it faithfully, request a scope decision.
No migration tooling or legacy adapter is part of the deliverable.

### Dependency order and implementation surfaces

Phase 0 precedes foundation coding. Phase 1 supports Phase 2; both support Phase 3.
Phase 4 depends on the authoritative presentation service from Phase 3. Phase 5
uses established membership/default APIs. Phase 5B depends on stable membership,
ordering, lock/visibility behavior, and the Phase 0 geometry/storage evidence.
Phase 5C uses those foundations and the preset schema; it can start before Phase
5B finishes, but recovery round-trip acceptance requires the actual recovery
format. Phase 5D can proceed alongside JSON packaging once geometry conversion
and shared export selection are defined. Raster stamps use the Phase 5F placement
milestone; no vector import phase is required.
None of these exchange features should be
blocked solely on flattening research.
Phase 6 validates the integrated system; it does not defer earlier phase tests.
Phase 5G follows the Phase 5F renderer/library foundations and uses the detailed
history/geometry dependency order above. It does not depend on faithful flattening
unless a particular operation explicitly carries recovery-bearing artwork.

**Current execution sequence (greenfield):**

1. Preserve the verified preview-first Labels/Library workflow and continue
   focused checks through later milestones. Owner UI polish and live acceptance
   remain steps 7-8, not unfinished implementation of Next/Repeat label modes.
   Preserve the implemented paired appearance swatches and narrow transient
   layer precedence; include them in owner UI/release acceptance. Full brush
   presets remain a separate milestone.
   Preserve the implemented PTK-840 shortcuts and Settings setup/key diagnostics;
   verify physical ExpressKey assignments with the owner. Pen pressure is a
   deferred possibility only; no pressure
   implementation or research is part of this execution sequence.
2. Preserve implemented project/shape saves/thumbnails, portable metadata edits/
   duplication, replacement repair and shared catalog removal/restoration.
   Complete real-file/multi-GM acceptance. File deletion remains deferred until
   a supported API or an explicit external-only workflow decision exists;
   do not block publication on an unsupported deletion endpoint.
3. Preserve transparent/Level-background WEBP and strict vector SVG publication;
   preserve subtree/targeted JSON. First deliver the owner-approved private
   Layers-tab reference transparency/tracing slice in section 11: native true-
   compositing feasibility (owner now requests general renderer investigation
   before any contiguous-only implementation), workspace/service/UI, lifecycle and publication
   consistency, then automated/native acceptance. Preserve the implemented
   owner-approved one-Level/explicit-combine exchange and its deployed sampled
   ordering/concealment acceptance; broaden artwork fidelity and real-file
   download verification without adding best-effort native Level matching.
   Do not block ordinary publication on flattening.
4. Deliver Phase 5G tools in their dependency order: atomic history first,
   collective transforms/previews, then precision/generation/image tools;
   bounded spaced stamp brush last.
5. Implement the owner-approved reversible Consolidate / Bake workflow in
   section 15: image Drawing consolidation first, then transparent WEBP Tiles
   for native finished-map handoff; no mandatory intermediate consolidation.
   Add recovery exchange
   only when the actual engine/storage contract exists, not placeholder payloads.
   Include section 15's preservation-first render-cache/image-Drawing comparison;
   verify native Tile placement/player behavior and benchmark both outputs.
   Tile and reversible Level-background baking are approved; follow the explicit
   asset preservation, capability detection and full-resolution gates.
   Preserve original brushstrokes by default; explicit reversible commands precede
   any separately designed opt-in automatic expand/recomposite behavior.
6. Finish destructive artwork operations and validated role access/GM relay.
   Non-GM editing remains disabled until authority/concurrency validation passes.
7. Complete the owner-led UI cleanup against the codified tab/main-GUI and
   numeric/slider/touch standards. Preserve native independent locks, accessibility,
   draft/focus/scroll state and passive player presentation.
8. Complete connected GM/player/multi-GM, real pen/touch, reload/reconnect,
   interruption/recovery and performance acceptance; finalize package/license/
   asset checks. Detached/native checks supplement, not replace, this matrix.
9. **Final-final:** convert the reconciled implementation plan into GitHub README
   documentation only after the shipped behavior, owner cleanup and acceptance
   are verified. Do not use this conversion to declare unfinished features done.

Phase labels describe capability groups, not a mandatory numeric execution order.
No legacy migration or external Canvas Layers adoption is added. Non-GM editing
is off by default; only explicitly authorized roles gain the toolbox after the
Phase 5F permission/relay validation gate passes.

Place cohesive stores/services under `scripts/layers/`, with GM panel templates,
styles, and localized strings following existing project patterns. Wire lifecycle
initialization through `setup.js`. Extend `module.json` only for required resources
and, if demonstrated necessary, `socket: true`. Reuse `scripts/drawing_config.js`
for supported brush defaults rather than adding a competing configuration path.
Add focused Node tests under `tests/`; renderer and multi-client behavior require
the target Foundry v14 environment, not just mocks.

The UI calls validated service commands. Services compute target state before
writing documents, expose errors, and reconcile partial failures. Keep geometry
conversion and Foundry API access isolated without speculative legacy boundaries.

## Final-final milestone: public README and documentation

This is the last delivery step, after implementation, owner UI review and release
acceptance. Target the existing GitHub README as the primary user guide; use
linked detailed pages only where they genuinely improve navigation.

- Describe verified installation/Foundry compatibility, getting started, the
  GM/player authority boundary and passive presentation.
- Document the actual seven tabs, keyboard/mousewheel/pen/touch controls,
  layers/presets/locks, palette/material workflows, label editing and cursor
  placement, examples, reusable artwork and library administration.
- Explain import/export formats and scope, preview/import review, assets and
  missing-resource recovery, history/flatten recovery, permissions and limits
  only for features actually delivered.
- Include practical troubleshooting, screenshots of the final cleaned-up UI,
  examples, asset/font/license attribution and links to deeper reference material.
- Remove speculative designs, obsolete mode names, milestone logs, internal
  implementation details and redundant roadmap promises from the user guide.
  Retain this reconciled specification as development history/reference where
  useful, rather than pasting it wholesale into the README.
- Check links, documented control names/localization, screenshots, examples and
  all published workflows against the final packaged build.

Acceptance: a new GM can install the packaged module, complete a small project,
present it to passive players, save/share it and recover from documented errors
using the README without referring to this implementation plan. Do not advertise
unimplemented features, untested roles or unsupported Foundry versions. This
milestone does not authorize an automatic Git commit or release.

## Acceptance scenarios

### A. Photoshop-style reorder

Three overlapping pseudo-layers. Drag bottom to top. All member Drawings
render above the other two groups; Scene Background is unchanged.

### B. Active layer

Select `Map Ink`, draw five strokes; select `Labels`, draw two.
Membership persists across reload.

### C. Group visibility preserves child settings

Hide `Sharran Fane`; all descendants become effectively hidden without changing
their own settings. Show it again; previously hidden children remain hidden and
previously visible children return. Test workspace and presentation independently,
including ancestor-hidden and mixed groups. Explicit Show All changes child
settings; it does not silently enable a parent outside the selected subtree.

### D. GM-controlled presentation, not confidential storage

A layer is withheld by the GM. Players have no Foundryshop layer controls and
cannot change authoritative presentation through its command entry points.
When the GM presents it, all player clients apply the same state, subject to
native Foundry rendering constraints. Hidden Drawing data may still reach clients;
this scenario does not test or promise confidentiality.

### E. Reconnect

GM applies `Deep Quarry` preset. Reconnecting player receives the same
authoritative state. GM workspace visibility, active layer, brush settings, and
selection remain unchanged. New layers remain player-hidden until presented.

### F. Canvas Layers absent

Foundryshop Layers must function normally with the external Canvas Layers
module not installed. This is the standard supported configuration; no external
dependency, import, or coexistence adapter is required.

### G. Large map

1,000+ Drawings across many groups/layers remain practical to toggle and
reorder.

### M. Editable JSON sharing into an empty Scene

Export a project with nested layers, styled strokes, text, Unassigned artwork,
presets, and retained recovery. Import as a different GM into an empty Scene.
Compare canonical data after ID/author/Level remapping. Reload and verify the
tree, order, editing, defaults, and available unflatten operations. The destination
background, grid, dimensions, and unrelated Scene state remain unchanged.
Package presentation is retained but not exposed to players until explicitly
applied by the importing GM.

### N. Additive JSON import and failure recovery

Import the same package twice alongside existing artwork. IDs and references
remain distinct and all original artwork survives. Test missing assets/fonts,
unsupported versions, malformed references, cancellation, and interruption at
each write stage. Invalid packages make no changes; partial execution identifies
and compensates only its own created records, with explicit error reporting.
Compact export omits only the exported recovery and leaves the source intact.

### O. WEBP publication

Export whole-map and selected-subtree artwork with each audience/background mode.
Check actual WEBP encoding, requested dimensions/alpha, crop, stacking, and
appearance. Tokens, Walls, toolbars, and selection outlines are absent. Live
workspace/presentation state never changes. Missing/CORS-blocked assets and
excessive export dimensions produce actionable errors, not incomplete images.

### P. SVG vector exchange

Export supported paths, shapes, text, nested groups, styles, and transforms.
Inspect in an independent SVG viewer/editor and compare geometry/order/appearance
within declared font and rendering limits. Player-hidden content is excluded from
player-presentation output. Unsupported effects are reported before export;
JSON remains necessary for exact native state and recovery.

### Q-R. Removed import scenarios

SVG/vector import scenarios remain excluded. Phase 5F raster stamps require
header/decode/upload-byte validation, transparent image fit on native resize,
ghost cancellation, fresh-ID repeated placement, active-layer/Level/lock gates,
clipboard/text-field separation, and partial-write journal recovery.
JSON interchange (M-N), WEBP export (O), and SVG export (P) remain required.

## Non-goals for initial release

-   replacing the Scene Background renderer;
-   arbitrary compositing across Drawings, Tiles, Tokens, Walls,
    Lighting, etc.;
-   Photoshop blend modes;
-   destructive raster/pixel editing (non-destructive image-stamp opacity, tint
    and cropping are in Phase 5G);
-   lossless Drawing reconstruction from raster images, automatic tracing or OCR;
-   general-purpose arbitrary SVG fidelity, PSD/AI/DXF interchange;
-   duplicating Foundry's full Scene backup/import/export;
-   treating ordinary client-hidden pseudo-layers as secure GM secrecy;
-   player layer panels, visibility preferences, presets, or drawing collaboration;
-   legacy-world migration, Canvas Layers import, and coexistence adapters;
-   runtime dependence on the external Canvas Layers module.

## Research references

-   Foundry v14 `DrawingData` (`sort`, `hidden`, `locked`, `elevation`,
    stroke/fill fields):\
    https://foundryvtt.com/api/interfaces/foundry.documents.types.DrawingData.html
-   Foundry v14 `CanvasDocument.sortRelative(...)`:\
    https://foundryvtt.com/api/classes/foundry.CanvasDocument.html
-   Foundry Canvas Layers article; Scene Background is rendered lowest
    and Foundry has distinct canvas layers:\
    https://foundryvtt.com/article/canvas-layers/
-   Foundry v14 canvas API:\
    https://foundryvtt.com/api/
-   Canvas Layers v2.0.0, verified Foundry 14.368:\
    https://foundryvtt.com/packages/canvas-layers
-   Canvas Layers source repository---optional research; pin a revision and audit
    licenses before reusing code:\
    https://github.com/WBHarry/canvas-layers
-   Foundry module development; module socket namespace behavior:\
    https://foundryvtt.com/article/module-development/

## Final design principle

**Foundryshop should present an artist's mental model while respecting
Foundry's document/rendering model.**

The GM should think:

> "I am drawing on named, draggable layers over my map mat."

Foundryshop should quietly handle Drawing membership, native sort order,
hierarchy, visibility authority, persistence, synchronization, and
explicit reversible consolidation. Players simply receive the GM's presentation;
the new engine needs no legacy layer migration or external layer dependency.

That separation is the core of the feature.
