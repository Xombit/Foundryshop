# Changelog

## Unreleased - Layer foundation

- Rush release R8 hardening: when the canvas redraws or no scene is active,
  the Layers panel shows an inline status instead of failing the whole toolbox,
  and the quick-layers flyout closes quietly. Sub-panel switches stay readable
  in light toolbox themes. Section help hints share one chip beside the section
  title. `npm run build` also writes `dist/foundryshop-<version>.zip`.

- Rush release R6 panels: the seven icon tabs became four labeled panels —
  Style, Color, Layers (Layers | Presentation) and Assets (Stamps & Library |
  Labels). Each panel remembers its last sub-view. Settings moved to a gear
  button in the window header that toggles back to the previous panel.

- Rush release R5 tracing reference: a layer's ⋯ menu offers "Make tracing
  reference", which renders that layer's drawings to WEBP, uploads it to the
  stamp asset folder (or `foundryshop-tracing`), and places a hidden, locked
  50% Tile under the drawings while hiding the source layer in your GM view.
  Refresh replaces the Tile; Remove deletes the Tile and shows the layer again.
  Uploaded images are kept because Foundry has no supported file delete API.

- Rush release R4 layers panel: each row is now GM view, Players, name, drag
  handle and a ⋯ menu; rename, duplicate, up/down, lock, assign, brush defaults,
  move and remove live in that menu so rows stay one line. Duplicate Layer copies
  the layer settings and its artwork into a new unlocked layer directly above and
  activates it (groups and locked layers are refused). Remove Layer / Group adds
  a "Delete its artwork too" destination that deletes the subtree's Drawings
  after a confirmation showing the count; locked artwork blocks it.

- Rush release R3 tool rail and selection: the rail adds Label and Stamp tools
  (click to place the current label or copied stamp, click again to stop; with
  nothing to place they open the matching panel). Collapse moved to the window
  header so nine 44px tools fit. A highlighted selection bar appears only while
  Drawings are selected (count, edit/apply/clear label, copy as stamp), replacing
  the always-disabled selection buttons in the Brush tab. 63 tests and build pass.

- Rush release R2 brush bar: the always-visible bar now has stroke/fill chips,
  swap, no fill, a brush preset menu with save/delete (starters: Wall ink,
  Pencil sketch, Floor fill, Water fill; up to 32 per user), a width slider with
  quick sizes 2/4/8/16/32 (mouse wheel still works), labeled Line/Fill opacity
  sliders and eight recent colors. The toolbox is about 440px wide on tablet
  density. 54 toolbox tests and build pass.

- Rush release R1 GUI fixes: starter labels no longer show raw translation keys
  (stored keys are localized on read and repaired on the next edit); toolbox
  layer rows fit without horizontal scrolling; long help paragraphs became
  collapsible Help chips with Foundry tooltips; control titles use Foundry
  plain-text tooltips (`data-tooltip-text`). 82 focused tests and build pass.

- Polished toolbox keyboard tabs: one Tab stop, wrapping arrow/Home/End
  navigation, focus restored after keyboard activation, and explicit navigation
  render errors. Pointer activation does not steal focus from drawing.
  59 selected toolbox/appearance/localization tests pass; build, packaged toolbox
  parity and editor diagnostics pass. Updated keyboard behavior awaits deployment.

- Added opt-in evidence-derived recovery action controller and localized selector,
  defaulting to read-only inspection. Exact fresh states gate hidden staging,
  finalization, explicit resume, compensation, receipt retention and retirement.
  Missing upload evidence never offers retry. Each write has independent service
  approval and consumes its action review. Terminal actions separately retain
  receipts; cancelled storage preserves the completed/compensated receipt in
  explicit errors. Retirement verifies existing exact receipt storage before
  separate clearing approval without reupload. Exact receipts/references support
  read-only inspection after journal removal. No public registration or automatic
  retry/rollback/handoff; live panel/accessibility acceptance remains.
  Selected action/recovery/setup/dialog/localization validation: 114 pass, 0 fail;
  build, packaged runtime hash, diagnostics and scoped whitespace pass.

- Added native data-source folder browsing to opt-in recovery import setup while
  retaining manual path entry. Picker selection remains subject to shared-folder
  admission; it grants no writes. Context checks block stale callbacks, setup
  closure revokes late selection and closes pending/open pickers. Errors surface
  through live status and standard notification. Focus/modal/tablet interaction
  still needs live acceptance; no public registration.

- Added opt-in reviewed recovery import setup: native local ZIP selection,
  explicit destination Level in the supplied Scene, existing shared folder path
  and unchecked empty-metadata replacement. Validates explicit budgets and
  file count/extension/size before reading, shared folder permission/privacy/
  target and current collision inventory, and unchanged owner/Scene context
  through asynchronous reads. Hands off to the independently reviewed full
  workflow; no setup uploads, settings writes, Scene creation/activation or public
  toolbar registration. Native folder-browser polish and live acceptance remain.
  Selected setup/recovery/dialog/storage/localization validation: 116 pass, 0 fail;
  build, packaged runtime hash, editor diagnostics and scoped whitespace pass.

- Connected internal full reviewed recovery import entry from strict ZIP bytes,
  explicit destination Level/root and budgets. Localized initial review discloses
  exact paths/count/bytes, fonts/modules, coordinate/elevation policy and Level
  targets with independent import/native-visibility/metadata consent. Terminal
  receipt size is preflighted before writes. Intent precedes verified uploads;
  hidden staging, final release and complete receipt storage each require another
  fresh review. Interrupted/cancelled post-intent steps retain explicit step/token
  and available receipt/reference without retry or compensation. Tests cover
  Drawing/Tile/background completion, initial no-write cancellation, staged/release/
  receipt cancellation, upload uncertainty and pre-write receipt-budget refusal.
  File selection/storage discovery, public wiring and live acceptance remain gates.
  Selected entry/recovery/dialog/native-guard/localization validation: 106 pass,
  0 fail; build, packaged runtime checks, diagnostics and scoped whitespace pass.

- Connected internal compensated-import retirement: persist and verify the exact
  receipt first, then separately approve journal clearing. Clearing rechecks
  durable receipt bytes after modal approval before removal. Explicit workflow
  errors retain receipt/reference across cancellation or uncertain writes; an
  exact supplied existing reference is verified rather than reuploaded. Added
  read-only deterministic terminal-receipt lookup with explicit not-found/verified
  states and path-alias refusal, not a general receipt catalog. No automatic retry,
  import authority or public controls. Live acceptance remains pending.
  Selected lifecycle/recovery/dialog/storage/localization validation: 114 pass,
  0 fail; build, packaged runtime checks, diagnostics and scoped whitespace pass.

- Added internal immutable recovery-import receipt storage for complete/compensated
  terminal states. Strict version-1 JSON envelopes have explicit byte budgets and
  lossless validation. Fresh localized approval binds exact path/size/hash and
  retention; shared verified-file storage refuses collisions and verifies readback
  without native writes or journal clearing. Uncertain uploads carry exact
  reference/receipt for fresh read-only inspection, never automatic retry.
  Stored receipt inspection binds context across reads and validates original
  evidence/native state before or after journal removal. Tests cover terminal
  formats/budgets, cleared/completed states, stale context, corruption, collisions
  and lost upload acknowledgement. Public receipt discovery, persistence-before-
  clearing orchestration and live acceptance remain pending.
  Selected receipt/recovery/dialog/storage/localization validation: 112 pass,
  0 fail; build, packaged runtime hashes, diagnostics and scoped whitespace pass.

- Added internal localized recovery review dialogs for hidden staging,
  compensation, finalization, explicit resume and compensated-receipt clearing.
  Exact IDs/plan, phase, already-final artwork, retained paths and Level targets
  are shown with text-safe DOM rendering. Each required decision is independently
  unchecked, including native Tile/background exposure. Fresh service review
  produces only a single-use capability; dialog acceptance performs no writes.
  Cancellation, missing consent and stale context refuse. Receipt storage,
  full import entry/public controls and live keyboard/tablet acceptance remain
  gates. Unit and service-integration tests cover cancellation, safe disclosure,
  distinct decision shapes, fresh clearing/resume authority and no implicit writes.
  Selected recovery-dialog/service/localization validation: 95 pass, 0 fail;
  build, packaged dialog hash, editor diagnostics and scoped whitespace pass.

- Added internal separately reviewed compensated-import receipt clearing. Exact
  compensated baseline and complete retained evidence are required; explicit
  single-use clearing/file-retention approval removes only the import journal.
  Full evidence is reread before removal and exact cleared state verified afterward.
  Returns the compensated receipt; uncertain removal reports an error with that
  receipt for read-only verification, never automatic retry. A new import requires
  fresh preparation, identities, collision inventory and approvals. Regressions
  cover all native output types, authority/cancellation/context/evidence refusal,
  removal acknowledgement loss, changed cleared receipts and new intent/assets
  persistence retaining old files. Public UI and live clearing/retry acceptance
  remain pending.
  Selected recovery/native-guard/localization validation: 90 pass, 0 fail; build,
  packaged runtime hashes and editor diagnostics pass.

- Deployed Drawing release-resume acceptance passed on Foundry 14.365. Controlled
  cancellation after real native release retained `history-installed`; ordinary
  GM reload, fresh evidence inspection and separate resume approval completed
  without rewriting final Drawing/history/Level. A second controlled cancellation
  after history installation retained `releasing` with hidden staging; fresh
  approved resume released the remaining Drawing exactly once and verified complete
  receipt. Both fixtures contained two complete recovery generations. Ten server
  evidence/archive/output files reread/verified and retained; both disposable
  Scenes removed, original full snapshot exact. No crash/network simulation or
  new public control. Tile/background and mixed/partial native live resume
  acceptance, compensated-receipt clearing and public recovery UX remain pending.

- Added internal separately reviewed recovery-import release resume for exact
  retained release-phase evidence. Fresh single-use approval requires distinct
  resume and renewed native Tile/background visibility decisions; normal
  finalization approval cannot authorize resume. Evidence is reread before writes.
  Only missing history, still-staged native sources and an unreleased background
  are written; already-final state is not replayed. Complete intent is cleared only
  after exact final verification. Edited/ambiguous state refuses; interrupted
  resume retains evidence and requires another fresh approval. Regressions cover
  all release phases across Drawing/Tile/background, mixed and partial native
  collections, stale reviews, corrupt evidence and repeated interruption. No
  automatic retry/rollback, owner handoff or public controls. Deployed live
  release-resume acceptance remains pending; real crash/network tests deferred.
  Selected recovery/bundle/native-guard/localization validation: 85 pass, 0 fail;
  build, packaged runtime hash, editor diagnostics and scoped whitespace pass.

- Added internal reviewed portable recovery ZIP downloading with exact immutable
  byte/hash and full Scene/current-GM binding, single-use approval and localized
  GM-private ancestry/font/module/server-file-retention disclosure. No public
  toolbar wiring, upload, Scene mutation or exposure authority. Reports only
  download initiation, not disk completion. Fabricated/reused capabilities,
  changed context, cancellation and download failure are covered by regressions.
  Live Foundry 14.365 approval downloaded an owner-saved 15,847-byte ZIP; disk
  size/SHA-256 exactly matched the receipt and strict decoding verified two
  complete parent-linked generations and four recovery files. Automation emitted
  no download event, so completion was established from the owner-supplied file.
  Live modal cancellation preserved the source; all four server files verified/
  retained, disposable Scene removed, original Scene exact, saved ZIP preserved.
  Selected recovery/bundle/localization validation: 78 pass, 0 fail. Public
  exchange controls and full keyboard/accessibility acceptance remain gated.

- Live inherited locked-layer recovery hooks passed on Foundry 14.365 after
  correcting host option-copy semantics. Foundry creates fresh hook-options objects
  and expands dotted update paths; guards now carry a short-lived opaque token in
  private action-specific registries instead of relying on options object identity.
  Exact Scene/owner/journal/phase/source/patch checks remain; release accepts only
  its original patch or exact host-expanded form. Tokens expire after awaited
  native calls, including failures; fabricated/revoked/other-action tokens refuse.
  An initial partial staging fixture was freshly inspected and separately
  compensated after deployment. New fixtures verified hidden creation under an
  inherited group lock, exact final release without unlocking, and locked hidden
  deletion through compensation. Ordinary create/update/delete attempts with
  fabricated tokens remained blocked before/after release and before compensation;
  full Scene snapshots stayed exact. All four fixtures removed, all 11 files
  verified/retained, both clients on unchanged original Scene. Two focused guard
  regressions and host-copy assertions cover the correction. Selected guard/
  recovery/layer validation: 199 pass, 0 fail; build, packaged runtime hash, editor
  diagnostics and scoped whitespace checks pass. Public exchange remains off.

- Live native background portable recovery acceptance passed on Foundry 14.365:
  real full-scene Bake with preserved original image, 23,002-byte portable ZIP,
  32,293-byte JSON evidence and four destination assets, exact staged Level
  retention, separate background replacement/visibility approval and final release.
  Aroh sampled exact green/yellow baked pixels despite the closed Drawing wrapper.
  Normal GM reload freshly verified the unchanged completed receipt and disk files.
  Restore exposed an image-size assumption for rebound destination dimensions.
  Recovery now verifies background bitmap dimensions from hash-bound persisted
  bytes separately from native destination Scene placement; Drawing/Tile dimension
  checks stay exact. Shared entry logic covers Restore, resume and owner takeover.
  Three regressions cover 8x4 images rebound to 10x7 Scene context; 161 selected
  workflow/placement/native/media/recovery/dialog/localization tests pass.
  Deployed fresh Restore reproduced exact archived Drawings and full source-
  historical Level state while preserving unrelated destination metadata.
  Restored original-background alias bytes were exact; Aroh saw that public
  historical image while restored Drawings stayed concealed. All eight created
  files reverified/retained; both disposable Scenes removed; original Scene exact.
  Full-frame/transition fidelity, locked-layer hooks and public exchange remain
  gated. No real crash/network interruption tests.

- Live native Tile portable recovery acceptance passed on Foundry 14.365:
  real player Tile Bake, 9,772-byte portable ZIP, 14,645-byte JSON evidence,
  three destination uploads, hidden staging, separately approved native Tile
  visibility and exact final Tile/Level/history. Aroh sampled only background
  while staged, then exact red/blue baked pixels despite the closed Drawing wrapper.
  Restore exposed an Apply-only private-artwork placement check. Placement reviews
  now bind explicit Apply/Restore actions; Restore requires its own archived
  placement approval, not public exposure/ground conversion. Apply gates remain
  unchanged. Fresh review after deployed fix and normal GM reload completed the
  retained Restore intent, reproducing both exact archived Drawings and removing
  the Tile while preserving the Level and closed wrapper. Settled visible-player
  samples confirmed concealment. All five files reverified/retained; two disposable
  Scenes removed; both clients returned to the unchanged original Scene.
  Three regressions added; 148 selected placement/native/workflow/dialog/recovery/
  localization tests pass, build and editor diagnostics pass. A wider targeted run
  exposes an unrelated existing invalid-options error-wording assertion mismatch.
  Background import/Restore, full-frame fidelity, locked-layer native permissions
  and completed-receipt reload remain separate gates; public exchange remains off.

- Live Drawing-only portable recovery acceptance passed on Foundry 14.365:
  two real Consolidate generations, strict source ZIP collection, destination
  remapping to different dimensions/grid, JSON evidence plus four immutable
  assets, fresh inspection, hidden native staging and exact final release.
  Both imported Restore generations reproduced their exact archived native
  sources; destination Level and closed tree remained exact.
  Aroh's visible client concealed restored strokes, then displayed exact sampled
  red/blue pixels after explicit Imported Presentation approval. Separately
  reviewed native compensation removed hidden staged artwork and retained all
  evidence; normal GM reload freshly verified the compensated journal and files.
  All three disposable Scenes were removed, both clients returned to the original
  Scene, full original Scene remained exact, and all 14 created evidence/output/
  archive files were reverified and retained. Internal reviewed APIs were exercised,
  not the unwired public exchange UI. Tile/background imports, locked-layer native
  bypass, final-receipt reload, full-frame fidelity and actual disk download remain
  separate acceptance gates. No runtime changes or real crash/network tests.

- Owner-approved Foundry-compatible durable JSON import evidence now wraps the
  unchanged portable ZIP as explicit base64 data with exact size/hash. Strict
  version/schema/base64/budget/inner-hash validation precedes shared ZIP/history
  validation. JSON uploads use `application/json` and `.json` evidence references;
  review includes envelope overhead in total upload budget. No renamed ZIP,
  upload-policy bypass, automatic retry or adoption is used.
  Three regressions cover multi-chunk exact round-trip, exact byte-budget boundary,
  malformed/altered envelopes and inner ZIP, and supported upload content type.
  Live two-generation source collection and detached destination preparation
  passed. The corrected Scene guard passed a live intent write; Foundry then
  refused ZIP upload before destination evidence/native writes. JSON evidence
  still needs deployment/live acceptance. All disposable Scenes were removed,
  original Scene verified exact and immutable source recovery files retained.
  Combined recovery/storage/layer/exchange/localization validation passes 399
  tests; build, packaged runtime hashes, editor diagnostics and scoped whitespace
  checks pass.

- Live portable recovery acceptance exposed a Scene bookkeeping guard failure:
  Foundry changes `_stats.modifiedTime` on the importer’s own journal update.
  Shared post-write Scene comparison now omits only modification time and modifier
  identity, preserving every substantive field and stable metadata. Destination
  digest, intent/assets baseline, staging/release/compensation and fresh inspection
  use the same semantic state. Review approvals still bind the full exact snapshot.
  Fixtures now simulate host modification stats on native writes; three regressions
  additionally cover non-mutating comparison, stable-metadata refusal and stale
  approval refusal. Initial live destination stopped at retained intent with no
  uploads or native artwork; this is not completed import/Restore acceptance.

- Added separately reviewed final recovery-import release. Fresh complete hidden
  staging/evidence and exact token/digest approval repeat native Tile/background
  visibility decisions. Durable `releasing` precedes exact history installation;
  `history-installed` precedes scoped exact-source/patch native staging release.
  Imported native hidden values and closed Drawing wrapper are preserved.
  Background/texture updates preserve unrelated Level fields; full owned and
  unrelated state, authority/dependencies and fresh final evidence verify before
  `native-released`, `complete` and import-journal removal.
  Uncertain writes retain files/journal without retry or compensation. Fresh
  inspection recognizes exact mixed staged/final sources and Level/history states;
  complete receipts verify uncertain cleanup read-only, without granting writes.
  Hidden-staging compensation refuses release phases. Ten regressions cover
  Drawing/Tile/background/multi-generation completion, repeated approvals,
  evidence/schema/dependency checks, partial/uncertain native/history/phase/cleanup
  outcomes, context/ownership conflicts and altered completed evidence.
  Public controls, release recovery and deployed native/player/Restore acceptance
  remain gated.
  Combined recovery/storage/layer/exchange/localization validation passes 393
  tests; build, packaged runtime hashes, editor diagnostics and scoped whitespace
  checks pass.

- Added separately reviewed compensation for exact hidden recovery-import staging.
  Fresh verified evidence and exact deletion/file-retention approval precede file
  rereads and durable `compensating` intent. Scoped exact-source delete permission
  supports locked Drawings without a general bypass; only owned hidden documents
  are deleted and prior layer metadata restored after empty-collection readback.
  Selected Level/background, unrelated Scene/Levels and all uploaded files remain
  untouched. Uncertain writes stop without automatic retry; fresh reconciliation
  admits exact partial compensation and completed `compensated` receipts.
  Seven regressions cover Drawing/Tile/background and pre-native cleanup, explicit
  approvals, stale/corrupt evidence, deletion/phase/tree uncertainty, fresh partial
  review, authority/context/ownership conflicts and retained file/receipt state.
  No receipt clearing, final visibility/history release, public UI or deployed
  native compensation/Restore acceptance is included.
  Combined recovery/storage/layer/exchange/localization validation passes 383
  tests; build, packaged runtime hashes, editor diagnostics and scoped whitespace
  checks pass.

- Added reviewed hidden native recovery-import staging and partial-state inspection.
  Fresh assets evidence and exact token/digest approval precede file rereads,
  closed-tree installation, `tree-installed`, hidden Drawing/Tile creation and
  `native-staged`. Exact-source scoped Drawing create permission supports locked
  historical layers without granting a general bypass. Owned collections and
  unrelated Scene/Levels, authority, journal and dependencies verify every step.
  Partial/uncertain writes retain evidence/documents and consume approval; fresh
  inspection identifies exact hidden partial states and refuses edited/unowned
  sources or phase inconsistencies. Six regressions cover Drawing/Tile/background
  staging, approval/byte refusal, uncertain tree/phase/create writes, context/
  dependency loss and conflicting partial native state.
  No final visibility release, background write, optimization-history installation,
  compensation, public UI or deployed native import/Restore acceptance yet.
  Combined native-staging/reconciliation/storage/recovery/exchange/localization
  validation passes272 tests; build, packaged runtime hashes, editor diagnostics
  and scoped whitespace checks pass.

- Added reload-independent read-only pre-native recovery-import reconciliation.
  Fresh serialized journal/disk inspection requires bounded evidence reads and
  exact owner/destination baseline/context guards, without a preparation or
  approval capability. Reports missing ZIP, partial assets and complete verified
  evidence; corrupt/path-conflicting evidence refuses. ZIP/history/targets/
  uploads/background aliases and staged/final native digests must match intent;
  native schemas and historical dependencies are rechecked. Missing files under
  `assets-verified` refuse; complete files under `intent` do not advance phase.
  Six regressions cover partial/full evidence, Drawing/Tile/background aliases,
  corruption/missing paths, journal mismatch, budgets, native normalization,
  dependencies and asynchronous authority/context changes.
  No retry/adoption, handoff, native-partial reconciliation, phase write, public
  control or deployed reload acceptance yet.
  Combined reconciliation/storage/recovery/exchange/localization validation
  passes266 tests; build, packaged runtime hash, diagnostics and scoped whitespace
  checks pass.

- Added session-owned recovery asset upload after verified durable intent.
  Full inventory collision preflight precedes evidence-ZIP upload; shared verified
  storage repeats per-file checks and exact readback. ZIP uploads first, then all
  planned images/archives. Final rereads and retained-ZIP history verification
  precede the journal-only `assets-verified` transition. Current authority,
  destination baseline, journal and historical dependency guards remain enforced.
  Failures retain files/intent, consume the attempt and require reconciliation;
  no adoption, deletion, automatic retry or native creation follows.
  Six storage/phase regressions cover byte closure, initial/late collisions,
  ambiguous uploads, immediate/final corruption, authority/abort/context/resource
  changes and uncertain journal transitions. Tests use fixture storage; no deployed
  upload acceptance, native execution, reload reconciliation or public UI yet.
  Combined asset/storage/recovery/exchange/localization validation passes260 tests;
  build, packaged runtime hash, editor diagnostics and scoped whitespace pass.

- Added internal exact-plan recovery approval and version4 durable import intent.
  Genuine unchanged preparation, bytes, destination context, historical resource
  requirements and every separate native visibility/metadata decision bind the
  approval. Total upload review includes the retained evidence ZIP. Intent stores
  verified-file descriptors, staged/final native digests, baseline/target tree/
  Level and complete rebuilt optimization history before any upload.
  Readback and unrelated Scene state are verified; uncertain persistence retains
  intent and consumes approval rather than retrying or reporting success.
  Ordinary JSON-import discard refuses version4 with an explicit disclosure;
  existing staging hooks safely refuse its different ownership shape.
  Five new approval/intent regressions cover exact decisions, forged/edited plans,
  budgets/collisions/dependencies, versioned roundtrips and ambiguous write outcomes.
  No public approval UI, uploads, phase advancement, native execution,
  compensation/reload reconciliation or deployed persistence acceptance yet.
  Combined intent/preparation/recovery/exchange/localization validation passes242
  tests; build, packaged runtime/localization hashes, diagnostics and scoped
  whitespace checks pass.

- Added guarded empty-project recovery import preparation with a hidden Drawing
  wrapper, Imported Presentation preset and cross-generation Unassigned membership.
  Archives/journals rebuild against the same presentation context. Strict detached
  native checks cover historical originals/replacements, live documents and
  temporary hidden Drawing/Tile staging. Existing sort rules are checked through
  reverse history; required archived fonts/metadata modules must be available.
  Active-GM/file-permission/snapshot/abort guards, retained metadata consent and
  refusal of existing journals protect planning. Owner chose separate native
  Tile/background visibility approval; required decisions are reported, not yet
  consumed. Seven preparation regressions plus existing hierarchy checks cover
  hidden ancestry, native normalization, dependencies, stale context, empty-project
  policy, native visibility and historical order. No uploads, journal/native
  writes, approval UI, additive import or deployed native Restore acceptance.
  Combined preparation/recovery/image/exchange/localization validation passes237
  tests; build, packaged runtime hashes, diagnostics and scoped whitespace pass.

- Added pure destination-bound recovery remapping across retained generations:
  fresh node/preset/Drawing/Tile/operation identities, planned image paths, rebuilt
  archive/lineage checksums and journal digests, importing-GM authors/owners and
  separate original-author provenance. Owner chose destination Scene dimension/
  grid rebinding with unchanged artwork coordinates and numeric elevations.
  Drawing/Tile-only history preserves destination Level settings; background
  history imports source background/texture states with preserved byte aliases
  while retaining unrelated destination settings. Exact history and enclosing
  ZIP validation precede return. Six regressions cover ancestral remapping,
  restored/reapplied history, layer/resource references, backgrounds, collision/
  budget refusal and each successive pure Restore state.
  Combined recovery/image/exchange/localization validation passes224 tests;
  build and packaged runtime hashes pass, with clean diagnostics and scoped
  whitespace checks.
  This remains a planner, not an importer: additive/hidden presentation, native
  schema checks, separate background approval, durable intent, file writes and
  deployed native Restore acceptance are still required. Public controls unchanged.

- Added the enclosing version-1 recovery project ZIP foundation: inline source
  manifest, retained immutable recovery chain and ordinary same-server image
  bytes share the strict stored-ZIP32 codec. Content-addressed entries preserve
  separate source aliases while deduplicating equal bytes. Cross-generation
  texture collection reuses native image/container validation with optional
  stream byte limits; existing unbounded bake-image calls retain their behavior.
  Collection enforces cumulative resource budgets and source/owner/abort guards,
  closes owned bitmaps, refuses external paths before ordinary texture fetches,
  and leaves fonts/modules as destination requirements. Decode validates exact
  inventories, image hashes/dimensions and complete recovery history. Six new
  enclosing-ZIP/collector regressions plus one byte-budget regression cover
  archived textures, deduplication, corruption, missing resources, cumulative
  budgets, cancellation/staleness and restored/reapplied history.
  Combined recovery/image/exchange/localization validation passes218 tests;
  distributable build succeeds, packaged runtime hashes match and editor
  diagnostics are clean.
  No native writes, deployed acceptance, download UI or destination importer;
  recovery-bearing public exchange remains blocked.

- Added read-only recovery project manifest/source collection for one explicit
  Level. Verified chronological history rewinds live Drawing/Tile/background
  roots and completed Restores without requiring old composites to stay live.
  Retains later independent artwork and exact native author/remapping inputs;
  edited/missing roots, occupied originals, semantic context changes and corrupt
  evidence refuse. Resource inventory covers archived-generation textures/fonts
  and preserved original-background aliases, distinguishing missing image bytes.
  Eleven new regressions pass; combined bundle/recovery/exchange/localization
  validation passes158 tests. Enclosing project ZIP, ordinary resource-byte
  collection, destination remapping/durable import/Restore acceptance remain.
  No live world writes; public recovery exchange stays blocked.

- Owner chose self-contained ZIP recovery exchange retaining baked form and full
  Restore ancestry; Level backgrounds require an empty destination project and
  separate explicit replacement approval. Added a read-only immutable-file
  collection/ZIP32 codec foundation with exact hashes/archive descriptors,
  ancestor/output/background-byte closure, strict file inventories and explicit
  caller byte/entry budgets. Compressed/encrypted/extended/malformed ZIP entries,
  corrupt/omitted files and stale source context refuse. Added pinned local
  MIT-licensed fflate0.8.3 (zero known dependency advisories at installation).
  This is not a portable project importer: project/resource bundling, destination
  remapping, durable import and Restore acceptance remain. Public recovery-bearing
  JSON export/import remain blocked; production controls are unchanged.
  Ten new codec/collector regressions pass; the combined recovery/exchange/
  localization run passes147 tests. Local0.1.0 build succeeds with the vendored
  runtime/license included; editor diagnostics are clean. No live world writes
  or deployed destination-import acceptance occurred in this slice.

- Desktop native keyboard review checks passed all eight shared review types:
  Shift+Tab/Space/Tab/Enter approval and explicit Escape cancellation, including
  preview, file/apply, Restore and takeover disclosures. Unchecked Enter cancelled
  rather than granting approval. Forward Tab stalled on window controls in both
  module review and plain native DialogV2, so full tab-cycle acceptance remains
  limited without a speculative host patch. Read-only checks made no file/native
  writes; complete original Scene remained exact and test globals were removed.
  Physical tablet/screen-reader and end-to-end keyboard execution remain untested.

- Measured deployed full-Scene Consolidate fidelity with eight native Drawings,
  including rotated curves/text, transparency, repeated material and image stamp.
  All six apply/four Restore dialogs completed. Uncropped PNG retained layer,
  elevation5 and native sort. Integer100% showed7,131 changed pixels of256,000,
  maximum channel delta51; fractional placement/zoom added resampling differences.
  No numeric tolerance or pixel-equivalence certification was introduced.
  Restore recovered exact baseline/independently verified archive sources and
  zero differing framebuffer pixels at100% aligned/fractional,125% and150%.
  Removed the disposable fixture, retained recovery files and verified the
  complete original Scene unchanged. Player/Tile/hardware gates remain.

- Added owner-approved scene-Level exchange policy instead of best-effort mapping:
  JSON export defaults to the active Level, with explicit all-Level export.
  Multi-Level import chooses one source Level or explicitly combines the full
  project onto the active Level's ground. Drawing-layer hierarchy is preserved;
  within-layer fresh sorts follow original elevation/native sort/stable package
  order. Existing artwork and Level settings remain untouched; review discloses
  exclusions, elevation changes and new cross-floor composition. Ground changes
  during import fail and compensate only imported work. Library full-project
  saves retain all Level associations; recovery-bearing exports remain blocked.
  180 targeted exchange/resources/preview/library/shape/stamp tests pass.
  Deployed native selected-floor/additive-combine acceptance passed: numeric
  elevation retention, ground7 remapping, elevation-before-source-sort overlap,
  exact existing artwork/Level preservation, hidden import and explicit preset
  reveal on Aroh, and complete-Scene preservation on final-review cancellation.
  Incompatible existing managed elevation refused before journaling. Removed all
  three disposable fixtures and verified the complete original Scene unchanged.
  Active-Level export defaults/filtering passed; actual disk download remains
  unverified. Existing global mixed-elevation ordering is still a limitation,
  including across separate Levels. Corrected obsolete multi-Level refusal text.

- Deployed live private hide/show/hide -> Restore passed all standard approvals.
  Both intent/execution dialogs disclosed revision0 ->2; exact archived originals,
  Level settings and later artwork returned while the current private tree stayed
  at revision2. Aroh's visible framebuffer showed restored artwork concealed.
  Retained Drawing elevation labeling is also live verified. Live Consolidate ->
  repeat Consolidate -> Tile Bake and three successive Restores completed
  uninterrupted, preserving exact preceding composites, root originals and later
  artwork with verified ancestor archives. Removed both disposable fixtures,
  retained immutable recovery files and confirmed the original Scene unchanged.
  Broader visual/hardware/exchange gates remain; production controls stay disabled.

- Following the owner-approved private-presentation recovery refinement, Restore
  now accepts a newer layer revision only when every other archived tree value
  matches. Intent/execution dialogs disclose both revisions; current revision
  and immutable archives stay unchanged. Actual layer differences, revision
  rollback, Apply context changes and any changes during review still refuse.
  Drawing/Tile/background Restore, interrupted resume, exact later-artwork
  preservation and localized disclosure regressions pass:90 targeted tests.
  Deployed live toggle/Restore verification subsequently passed as recorded above.

- Live private leaf-layer Consolidate retained GM-only presentation; the existing
  player gate revealed then concealed the composite on Aroh's visible client.
  Separate unchanged-context private Restore completed all standard approvals,
  restored exact baseline/verified-archive originals, preserved later artwork
  and complete Level/layer settings, and kept all restored artwork concealed.
  Changing presentation then switching it back advances the layer revision;
  current strict recovery refused before creating an intent, without changing
  the composite or journal. Documented this pre-refinement usability limitation
  without bypassing deployed recovery checks. Removed both fixtures, retained verified
  recovery files and confirmed the original Scene unchanged. Production controls
  remain disabled; live lineage and broader fidelity acceptance remain.

- Live public-selection Consolidate/Restore completed uninterrupted with all
  standard approvals on a disposable Scene. The editable image Drawing retained
  its layer, elevation5 and native sort1024. Exact originals, Level/layer settings
  and later artwork restored; four GM/player20x20 framebuffer patches, including
  translucent overlap, had zero differing bytes. Player apply/Restore refused
  without writes. Deleted only the fixture and verified the original Scene
  unchanged. Corrected Consolidate's elevation label to distinguish retained
  Drawing elevation from Bake ground placement. Broader live layer/lineage/
  fidelity acceptance remains; production controls stay disabled.

- Connected opt-in reviewed Consolidate preparation, apply, resume, Restore and
  disconnected-owner takeover to the shared bounded renderer/durable executor.
  The editable image Drawing retains layer ownership, player gating, elevation
  and contiguous native stack position; mixed layers/elevations, intervening
  artwork, sort ties, custom crop/sort and broad scopes refuse. Standard dialogs
  disclose retained Drawing placement rather than ground flattening. Repeat
  consolidation and Bake from one composite retain and reverify original-stroke
  lineage; reviewed Restore can expand successive generations without absorbing
  later artwork. Added partial apply/Restore, authority, stale-selection,
  edited-composite, ancestry and full-resolution GPU regressions. Live acceptance
  after deployment remains required; production controls stay disabled.
  234 targeted rendering/storage/placement/recovery tests pass; editor
  diagnostics, localization JSON and changed-file whitespace checks are clean.

- Verified the deployed background-redraw fix with uninterrupted public
  color-only and existing-image Bake/Restore using all standard review dialogs.
  Image persistence disclosed and approved all three paths; the separately
  reread original backup matched all 8038 bytes. Exact archived Drawings,
  complete Level settings and later artwork were restored. Aroh's five20x20
  framebuffer patches matched restored native rendering with zero differing
  bytes after making the tab visible, without manual render-flag flushing.
  Hidden tabs still defer native presentation updates. Removed both disposable
  Scenes, preserved the complete original Scene and retained immutable recovery
  files. Consolidate integration is next; production controls remain disabled.

- Live color-only Level-background Bake/Restore retained exact sources/settings
  and later artwork; Aroh's three sampled patches matched restored native
  artwork with zero differing bytes after native render-flag flushing. Foundry
  v14 redraws the canvas on background updates, temporarily clearing readiness
  and controlled Drawings: initial apply/Restore safely interrupted and completed
  through fresh public resume. Added guarded settling of the owned redraw and
  exact execution-selection reconciliation, retaining timeout/cancellation,
  authority and unrelated-context refusal. Disposable fixture cleanup preserved
  the original Scene; retained one archive/PNG pair. Redeployment is needed to
  verify uninterrupted live completion and image-background acceptance.
  217 targeted Bake/rendering/recovery regressions pass.

- Added opt-in reviewed Level-background Bake preparation and public apply,
  resume, Restore and disconnected-owner takeover entry points, sharing the Tile
  workflow/recovery engine. Full-Scene public composition retains the existing
  background; original image backups are included in exact durable-path approval.
  Background mapping gets full-resolution isolated GPU acceptance. Restore
  rechecks original URL bytes against the immutable backup before creating intent
  and before reverting native settings; changed/missing originals refuse safely.
  Added background replacement disclosures and retained Tile destination guards.
  213 targeted rendering/storage/placement/recovery tests pass. Live background
  acceptance and Consolidate integration remain next; production controls stay
  disabled. Owner deferred actual network-outage/process-crash testing to field
  testing rather than requiring further simulated release gates.

- Verified live reload recovery with deliberately withheld native-write
  completion at all six Tile apply/Restore transitions. Scene-instance wrappers
  awaited real persistence, then returned an unresolved Promise to the caller;
  reload discarded the waiting executor without a graceful abort or rejection.
  Public resume reconciled persisted state against the earlier journal phase,
  avoided duplicate replacements/originals and completed exact Restore while
  preserving later artwork. Deleted only the fixture, retained one verified
  archive/PNG pair and preserved the original Scene. No runtime fix was needed.
  This simulates lost completion delivery, not an actual network outage or
  process crash while the native server request is unresolved.

- Verified live partial-batch Bake/Restore recovery with real native writes on
  a disposable Scene. Fixture-only wrappers persisted one of three deletions,
  hidden-original recreations or exposure updates, then threw. Each interruption
  retained the correct journal phase; after reload, public resume reconciled
  remaining work without duplicate replacement/original creation. Exact Restore
  preserved all archived sources and later artwork. Deleted only the fixture,
  retained one verified archive/PNG pair and preserved both original views.
  No runtime fix was needed. Pending-response loss and abrupt crash remain
  separate acceptance gates; these were injected subset writes, not server
  failures or crashes.

- Completed live native-selection/options keyboard acceptance: ordinary canvas
  click and Shift-click selected both fixture Drawings, and public Bake's
  default controlled-selection reader produced the exact scope IDs. Enter
  submitted valid options, Space activated approval, invalid fractional sort
  remained editable and corrected Enter succeeded. Empty selection was blocked;
  native selection changes invalidated review; Escape cancelled from a focused
  numeric input. Cancelled public entry at scope review before rendering/uploads.
  Full disposable Scene source remained unchanged; deleted only that fixture and
  preserved the original Scene. Physical tablet and later review-dialog keyboard
  acceptance remain open; no runtime fix was needed.

- Verified native rain presentation over a real baked Tile on Aroh's player
  framebuffer. At a fixed native shader time, rain changed 10451 pixels in the
  measured artwork crop; repeated reads and local visibility restoration were
  exact. After exact Restore, rain-on and rain-off samples matched native
  Drawings with zero differing pixels. A weather-mask readback positive control
  was inconclusive, so roof/mask blocking is not certified. Deleted only the
  disposable Scene, retained one verified archive/PNG pair and preserved the
  original Scene. Other weather types and natural animation timing remain open.

- Completed live actor-backed vision, wall and static-light acceptance on a
  disposable Scene. Aroh's native vision source saw the near-side baked patch
  while the wall blocked the far side; removing wall sight/light restrictions
  exposed both. In darkness, an ambient light brightened only the near side.
  Restored native Drawings matched both sampled dark and lit patch colors
  exactly, including faint native darkness pixels despite negative visibility
  tests. Exact Restore and cleanup preserved the original Scene; retained one
  verified archive/PNG pair. D35E's linked-token creation refreshed the existing
  actor's equipment-derived statistics; investigated, reported and left that
  system recalculation intact at the owner's direction. Future fixtures should
  use disposable actors. Weather, animated/colored lights, fog persistence,
  other vision modes and automatic refresh timing remain unverified.

- Verified native same-elevation token stacking on Aroh's player framebuffer:
  four isolated native render states confirmed 2221 opaque overlap pixels
  matched the token-only reference and none matched the Tile-only reference.
  With token vision enabled and no vision sources, the baked Tile contributed
  zero framebuffer pixels; disabling token vision restored its contribution.
  Exact Restore preserved the original Drawing and fixture Token, then cleanup
  deleted only the disposable Scene and left the original Scene unchanged.
  Retained one verified archive/PNG pair. Native refresh flags were flushed
  before measurements; actor-backed vision, walls, lighting, weather, other
  elevations and automatic refresh timing remain unverified.

- Verified live GM/player Tile audience behavior with Gamemaster and ordinary
  player Aroh: GM-only output contributed zero player framebuffer pixels;
  player-visible output contributed 21690 pixels, with stable repeated reads
  and exact framebuffer restoration after local mesh suppression. Flushed
  queued native Tile render flags because the integrated player tab suspended
  animation frames; this is visibility/render evidence, not frame-timing
  acceptance. Player Bake, Restore, resume, takeover and layer-panel context
  access were rejected without Scene writes, and GM controls were absent.
  Both Bake/Restore cycles recovered exact originals; the player independently
  verified final sources. Deleted both disposable Scenes, retained two verified
  archive/PNG pairs and left the original Scene unchanged. Shared-session player
  upload refusal also failed safely before artwork mutation. Vision, token
  stacking, occlusion, lighting/weather and production registration remain open.

- Verified both final visibility-write/reload boundaries with real files:
  interrupted after Bake exposed its Tile and after Restore exposed originals,
  before journal completion. Explicit resume after each browser reload accepted
  the already-visible exact state without duplicate artwork and completed both
  entries. Archive originals matched the pre-Bake sources; the second client
  independently verified exact final Restore. Retained one archive/PNG pair
  and deleted only the disposable Scene. Partial batches, abrupt mid-request
  crashes and player presentation remain open; no runtime fix was needed.

- Completed three real native-write/reload recovery cases: aborted immediately
  after hidden Tile creation, after source Drawing deletion, and after Restore
  Tile deletion, before their corresponding journal advancement. Reloaded the
  executing client after each interruption and explicitly resumed from durable
  files/document state. The same staged Tile was reused; final Restore matched
  both full original Drawing sources exactly, independently checked by the
  second client. Retained one archive/PNG pair and deleted only the disposable
  Scene. Final-exposure, partial-batch and hard-crash cases remain unverified.

- Completed real durable Tile Bake handoff acceptance: cancellation and former
  owner reconnection during verified handoff review left ownership unchanged;
  after owner disconnection, DM approved the native ownership-transfer dialog
  and resumed to completion from existing verified files. Interrupted Restore
  immediately after native hidden-original creation, before journal advancement;
  the replacement remained, and explicit resume restored both originals exactly.
  Deleted only the disposable Scene and retained the archive/image pair.
  Broader native-write/reload and player/presentation gates remain; no runtime
  fix or production registration was needed.

- Real two-GM acceptance confirmed designated-GM write admission, remote
  Drawing edits invalidating options, and public Bake entry rejection of a
  competing remote journal before preparation/uploads. Synthetic disposable
  journal tests confirmed allowed token/owner and phase updates, sticky
  conflicts, and live-hook detection of ownership/recovery-descriptor changes
  even after remote reversal. Connected-owner takeover refused without writes.
  No recovery files or replacement artwork were created; disconnected-owner
  handoff and interruption during native writes remain separate gates.

- Live desktop Bake options acceptance covered Layer/Selection/All, both
  audiences, PNG/WEBP, automatic/custom crops, literal layer labels,
  Close/Escape cancellation, and stale-selection/source rejection without
  options writes. Fixed Foundry v14's disabled approval button after invalid
  submission: capture-phase validation now reports invalid input before
  DialogV2 submission starts, leaving fields editable. Inactive layer/crop
  fields are disabled so obsolete invalid custom values cannot block automatic
  crop. Added guard regressions and verified correction in the real client.
  Disposable fixture cleanup preserved the original Scene exactly; no uploads
  or Bake operations were performed. Tablet/player/multi-client gates remain.

- Extended the explicit screen-fidelity harness with integer projection,
  live primary-group graph, raw GPU raster and opaque-backdrop controls.
  Reconstructed vectors matched native Drawings exactly in the live primary
  group. PNG and raw transparent raster matched each other exactly and both
  reproduced the aligned Tile differences; a matched opaque RGB-backdrop
  control matched native output exactly. Recorded the transparent intermediate/
  compositing boundary without changing Tile transparency or release policy.

- Added explicit live framebuffer Tile fidelity acceptance at actual measured
  zooms, with repeat-reference stability and exact restored-screen checks.
  Pixel-aligned 100% rendering still differs from native vectors; fractional
  placement and 125%/150% zoom differ more. Recorded measurements without a
  fabricated acceptance tolerance; production fidelity remains gated.
  Bake resolution review now explicitly discloses fixed-raster edge/text
  sampling differences at zoom/fractional placement.

- Preserve native PreciseText bitmap resolution during Bake instead of forcing
  publication's resolution-1 sampling. Real rotated-text comparison exposed
  4187 changed pixels; the correction matched the native reference exactly.
  Preview/publication sampling remains unchanged and Bake still verifies actual
  generated text bitmap dimensions against GPU limits. Added an explicit
  disposable-Scene fidelity harness; nine geometry/text/texture fixtures matched
  their native geometry/text-texture references pixel-for-pixel. This does not
  certify live Tile shaders, occlusion or player presentation.

- Bake overlap review now uses existing Tiles' native v14 shape bounds, including
  texture anchors and rotation, instead of an assumed top-left origin and
  circumscribed circle. Reviews retain both exact native sources and bounds;
  either changing invalidates approval. Missing/nonfinite/overflowing bounds
  refuse, other-Level Tiles remain excluded, and the operation's own staged Tile
  remains excluded on resume. Added regressions and a read-only real-client
  check with centered and rotated offset-anchor Tile documents.

- Fixed live Foundry v14 Tile Bake compatibility: Scene grid snapshots accept
  native grid instances and serialize Foundry Color values as exact hex strings;
  replacement Tiles carry an explicit empty name instead of an undefined native
  source field; rendered-source hashes use the same code-unit ID ordering as
  recovery archives. Tile output now uses top-left texture anchors, matching the
  reviewed pixel bounds rather than shifting the image by half its dimensions.
  Placement and GPU acceptance reject centered replacement anchors. Added
  focused regressions and tested real sandbox uploads, Bake and exact Restore
  with later Drawings retained, plus cancellation after asset verification,
  browser reload and resume from existing files/journal. Production controls
  remain unregistered.

- Added an opt-in Restore originals entry for the latest completed Tile Bake.
  It verifies the unchanged replacement and absent source identities against the
  exact retained archive/output, then writes only a lineage-bound restore intent
  and continues through the normal preview, placement and execution approvals.
  Cancellation before intent creation is no-write; interruption retains one
  resumable intent and later Drawings are preserved. Added reload-safe Tile Bake
  resume for existing unfinished apply/restore intents. It reads verified
  retained files, reconstructs actual preview,
  placement and exact-source execution approval, and guards async review state.
  Apply rechecks GPU display; restore avoids allocating the removed Tile texture.
  Missing/corrupt files refuse without regeneration/uploads, cancellation retains
  recovery, and native failures propagate. No production registration/live writes.

- Added an explicit Tile Bake takeover entry for interrupted operations owned by
  a disconnected GM. It verifies the exact recovery archive, output and native
  state before changing journal ownership, then runs the standard fresh preview,
  placement and execution reviews. A reconnected former owner, changed context,
  missing/corrupt evidence or cancellation before transfer refuses. This is a
  recovery handoff, not cross-client locking or server compare-and-swap; native
  operations remain opt-in and no production controls are registered.

- Added temporary fail-closed monitoring of persisted Scene optimization journals
  during Bake, resume, restore-intent and takeover review lifetimes. Unexpected
  operation tokens, immutable recovery-descriptor/owner changes and Scene
  document replacement invalidate the review; invalidation remains latched and
  hooks are released on all exits. This detects competing durable updates seen
  by the client but is not a distributed lock or server compare-and-swap.

- Added localized scope/options UI to the opt-in Tile Bake entry: Layer-default,
  Selection/All, explicit audience and integer Tile sort, PNG/WEBP encoding,
  automatic/custom exact integer crops and external-resource consent. Snapshot
  guards refuse artwork/selection/workspace changes during the dialog; options
  make no writes and do not bypass subsequent exact reviews. Production toolbar
  registration and real UI/authority acceptance remain pending.

- Added an opt-in GM Tile Bake dialog entry point connecting scope/resolution/
  placement/encoded-preview/file/native approvals to the real workflow. It binds
  displayed Scene/Level, generates fresh IDs and excludes overlapping reviews.
  Cancellation distinguishes no-write exits from retained durable operations;
  unexpected/partial-write errors propagate and completed tokens cannot restart.
  Default localized dialog flow is fixture-tested; no toolbar registration or
  live destructive operation was enabled.

- Added a world Bake recovery folder setting with native folder picker and
  read-only existing/shared-data-folder preflight. The connected workflow checks
  designated GM/file permissions before rendering and folder availability before
  persistence; changed configured paths cannot redirect uploads. Existing recovery
  references remain unchanged. No automatic directory/probe-file creation or
  production Bake commands were added.

- Added opt-in localized GM Bake review dialogs for exact scope/exclusions,
  resolution/crop, placement, decoded output preview, durable paths and native
  execution. Unchecked acknowledgements and explicit cancellation guard each
  approval; text-safe reports and owned preview URLs avoid HTML injection/leaks.
  Optional encoded-preview approval is wired into read-only workflow preparation.
  No production command registration or automatic persistence/apply was added.

- Added concrete default native Tile texture acceptance: exact file/decode checks,
  live GPU axis admission and full-resolution upload/sampling in an owned isolated
  PIXI renderer, with explicit GPU errors and cleanup. Read-only v14 accepted
  8000 x 6000; 20000px native Tile display refused against the actual 16384px GPU
  axis without downsampling. This is capability evidence, not shader fidelity or
  cross-client certification; production controls remain disabled.

- Connected an opt-in designated-GM Tile Bake workflow from scope/render/placement
  review through durable assets and separately approved native apply. Preview
  preparation is read-only; persistence requires exact paths and display
  acceptance remains mandatory. Same-client overlapping workflow work refuses;
  retained execution snapshots detect approval-wait changes, and interrupted
  native retries receive fresh partial-state reviews. Fixtures cover rendering,
  apply, reload-style restore, refusals and lost acknowledgements. No production
  controls or live Scene writes were enabled.

- Added execution-stage apply/restore review and optional executor binding for
  one exact Scene/token. Verified durable evidence and explicit source approval
  precede phase-aware native guards; own staged replacements, partial deletion
  and hidden-original recovery are allowed while unrelated native/workspace/
  journal changes and phase regressions refuse. Optional selection binding
  permits only owned-source deselection. Integration covers interruption/resume
  and exact Tile/background restoration; production UI remains disabled.

- Added detached native bake replacement construction, sharing deterministic
  output descriptors with durable preparation. Locked neutral Tiles capture
  native defaults and explicit identity/sort/audience; full-Scene backgrounds
  retain unrelated Level settings and original alpha threshold. Schema
  normalization/unstable round trips refuse, including Foundry's fractional
  Tile-origin rounding. Read-only v14 acceptance covered large Tile schemas
  and background sources; no live writes, GPU display guarantee or UI activation.

- Added reload-safe bake asset recovery for pre-native intents, with verified/
  missing file inventory, exact archive/lineage checks, native/workspace review
  snapshots and explicit missing-path approval. Only byte-identical supplied
  assets may fill missing paths; conflicts/read errors never become absence or
  overwrite permission. Missing archive requires its original exact bytes.
  Upload interruption retries reconcile persisted evidence before advancing
  assets-verified; no native source/replacement writes or UI activation.

- Bound approved bake scopes to one exact recovery archive/apply intent across
  their own intent/assets journal revisions. Captured sources, audience,
  destination, lineage, reviewer identity, workspace/selection and native
  context remain strict; unrelated journal revisions and a second intent
  refuse. Durable preparation accepts this binding without weakening the
  original pre-intent review guard. No native execution/UI activation.

- Added durable bake asset preparation binding exact rendered source digest/
  review, native replacement and original background bytes to immutable
  recovery/output/backup file intents. Apply intent persists before upload;
  exact readback/digest and persisted decode evidence precede assets-verified.
  Retry reconciles matching files after lost upload/journal acknowledgements
  without overwriting mismatches. Mock prepared-upload/apply/restore integration
  restored exact originals and retained later strokes. No live writes/UI.

- Added read-only resource-to-review-to-encoding transaction with per-source
  rendered bounds, enclosing full-resolution Tile crop or exact custom bounds,
  full-Scene background bounds, exact encoding/cropped-ID approval and post-
  approval graph/bounds revalidation. Conservative crop review lists wholly
  outside sources explicitly; altered public review cannot bypass acceptance.
  Native rotated negative-coordinate label and unacknowledged-crop refusal
  passed without Scene writes. Durable operation preparation/UI remain pending.

- Added awaited bake Drawing texture-resource preparation for native ordinary
  fills, rectangular image stamps and material-repeat matrices. Shared paths
  load once with consent/media/currentness checks; full-image GPU leases enforce
  actual input axes without resampling. Owned graphs release before textures/
  bitmaps, including partial failure and retained-builder refusal. Oversized
  Drawing input mapping remains an explicit unsupported capability, not a
  publication cap. Native tiled/single-target fixture differed in only 2 of
  819200 channels by at most 2/255; no pixel-identical native fidelity claim.

- Added uncapped bake Drawing geometry/text preparation from captured raw native
  sources and a scope-compatible capability inspector with explicit exclusions.
  Reuses native rectangle/ellipse/smoothed path, centered rotation and alpha
  rendering; native full-resolution text checks loaded fonts and actual GPU
  bitmap axes. Texture fills/stamps/material metadata remain explicitly pending.
  Read-only native 48MP/long-axis and 1001-source rendering passed; a 512 x 320
  geometry/text fixture matched all 655360 channels tiled versus single-target.
  No Scene mutation or production bake UI activation.

- Added full-scene identity-transform background compositing using the retained
  full source bitmap in CPU canvas tiles, with RGB tint, background color below
  source alpha and source-over GPU Drawing pixels. Oversized backgrounds do not
  require a giant GPU texture; original image ownership/bytes remain intact.
  Read-only scaled-pattern/alpha fixtures completed at 20000 x 1000 and
  8000 x 6000; sampled seam differences versus a full-canvas reference reached
  3/255 and 1/255 respectively, not a pixel-identical native fidelity claim.
  Drawing resource preparation, durable operation wiring and UI remain pending.

- Added uncapped bake image input loading for static PNG/JPEG/WEBP, retaining
  exact original bytes and SHA-256 for later backup persistence, external-contact
  consent, explicit stream/decode/currentness checks and owned bitmap cleanup.
  Sequential GPU-sized cropped texture visits accept inputs larger than GPU
  texture axes without uploading a giant texture. Read-only native 20000 x 1000
  PNG loading/crops passed, with matching sampled alpha across 16383/16384.
  Final background/material compositing, persistence and UI remain unwired.

- Added full-resolution tiled raster backend for owned detached scene-coordinate
  graphs, with PNG/WEBP encoding, actual GPU working-tile capabilities, advisory
  memory, progress/cancellation/context-loss handling and exact encoded/decode
  verification. No publication output caps or silent downscaling. Native
  read-only synthetic GPU output passed at 8000 x 6000 and 20000 x 1000, including
  sampled tile seams/alpha; artwork/resource orchestration and UI remain pending.

- Added archive-bound ground placement/audience acceptance: exact reviewed Tile
  bounds, neutral locked-overlay settings, Level-ground elevation, GM-hidden
  versus player-public output, private ancestry refusal, explicit Tile-overlap/
  ground-stacking acknowledgement and changed-context invalidation. Background
  requires full Scene bounds and identity shared transforms with neutral derived
  tint/color; unsupported transforms refuse without moving foreground imagery.
  Integrated with native schema verification; no live bake/UI activation.

- Added strict detached native schema acceptance for original/restore-staged
  Drawings and Drawing/Tile/Level-background replacement states. The verifier
  binds to the reviewed archive checksum, rejects normalization, and requires
  explicit placement/stacking/audience acceptance. Executor integration tests
  pass; read-only v14 native round-trips passed for Level, Drawing and a detached
  8000 x 6000 Tile. No live embedded documents were created.

- Added reviewed bake-scope preparation for Layer (default), Selection and All
  on one displayed Level, with Unassigned support, explicit inclusion/exclusion
  and removal counts, ancestor audience/visibility/lock gates and renderer
  capability reasons. Exact exclusions/ground-depth change require approval;
  mixed elevations/private background scopes refuse. Stale native/workspace/
  selection reviews are rejected; approved manifests create typed recovery from
  authoritative captured IDs. No bake UI or live map write is enabled.

- Added persisted-output acceptance for static PNG/JPEG/WEBP: actual container/
  animation checks, file SHA-256, reviewed dimensions and browser decode with
  bitmap cleanup, without stamp/publication image-size caps. Output-verifier
  bindings integrate with journal/native executor evidence. Read-only live
  browser validation accepted synthetic 8000 x 6000 PNG/WEBP/JPEG and
  20000 x 1000 PNG; no assets uploaded or Scene documents changed.

- Added resumable native optimization executor services for Drawing/Tile/
  Level-background apply and staged-original restoration. Actual native state
  and durable phase evidence gate exact-source removal, replacement reversion
  and final visibility; partial writes/lost responses retain recovery and avoid
  duplicate recreation on resume. Explicit decode/native acceptance and active
  GM/context guards remain mandatory. Drawing-only JSON export now refuses
  optimization journals to avoid silently losing baked output/recovery.
  Fixture-tested only; no live map writes, deployment or bake UI activation.

- Added a separate typed optimization recovery archive for exact native
  Drawing originals, Drawing/Tile/Level-background replacement states, complete
  layer/grid/Level context, original-background byte-copy references and parent
  lineage. Persistent reads verify file/payload hashes; read-only reconciliation
  reports partial deletion and native-state conflicts. Journal evidence adapters
  bind actual files/native states to intent digests and require explicit output
  decode acceptance. No native apply/remove/restore command or bake UI is enabled.

- Added durable optimization intent/phase journal services with typed
  Drawing/Tile/Level-background descriptors, immutable recovery references and
  lineage, ordered evidence-verified apply/restore transitions, stale-write
  refusal and explicit uncertain-write errors. Scene queue serialization and
  designated-active-GM ownership gate writes; reviewed disconnected-owner
  handoff preserves the interrupted phase. Native execution/reconciliation,
  operator routing/UI remain pending; typed archives and read-only evidence
  adapters are added above.

- Added verified persistent file storage and consolidation-archive adapters:
  prepared references for intent journaling, collision refusal, exact server
  byte/hash readback and reload-safe archive identity/checksum validation.
  Source/authority/cancellation guards prevent success on changed context;
  uncertain uploads retain a reconciliation path. No document deletion, live
  world writes or bake UI is enabled by these services. The journal foundation
  above adds phase records but not native transaction execution.

- Revised planned Bake sizing to match the running Foundry client's actual
  image capabilities, including large/long-axis maps. The operator manages
  resources; estimates are advisory rather than arbitrary module memory/size
  gates. Full 8000 x 6000 acceptance is required, with explicit platform failure
  reporting and no silent downscaling. Existing publication limits are unchanged.

- Approved Layer-default, Selection and All-on-displayed-Level bake scopes.
  Baking must remove only verified reviewed sources from the live Drawing
  collection after durable asset/archive readback, retaining exact sources and
  membership for reload-safe recovery. Internal archives are not disposable
  temp files; scope previews and interrupted/partial-delete reconciliation are
  required before production activation.

- Approved planning for direct Level-background baking: preserve verified
  original and Foundryshopped assets plus exact settings/stroke recovery.
  Input/output formats are independent; static PNG/JPEG/WEBP are the initial
  assured inputs, other formats need explicit capability checks, and animated
  sources remain unchanged. Full-resolution large-map output requires native
  capability acceptance; no silent downscaling or background replacement is enabled.

- Refined the optimization plan into reversible Consolidate (Drawing-layer
  workflow) and Bake to Tile (transparent WEBP/native finished-map handoff).
  Read-only v14 research verified Level background fields and elevation-first
  Tile/Drawings ordering. Tile baking is planned, not enabled; typed recovery,
  original-stroke lineage and Undo Bake are required. The later amendment above
  also approves planning direct Level-background baking.

- Added native directory stage instrumentation and a disposable, server-
  readback-verified consolidation/restoration benchmark. Hook debug logging
  inflated the earlier multi-second stalls; with logging off, 500-stroke
  interaction measured 110.5 ms, one image Drawing 33.4 ms, and exactly restored
  originals 111.7 ms. Native sidebar filtering schedules all-Drawing refreshes.
  Developer safety tests cover denied uploads, changed assets, ownership and
  restoration conflicts; no production consolidation command or sidebar bypass.

- Added an explicit disposable-Scene drawing-session profiler with bounded
  checkpoints, pixel-union coverage measurement and source/view cleanup checks.
  Live map/detail runs reached 1000 strokes without sustained settled-frame
  slowdown, but native directory rendering dominated selection stalls in this
  setup. Findings and limitations are recorded in the design; no automatic
  consolidation, live caching or production UI bypass is enabled. Best-effort
  vector merging is acceptable only as an explicit reversible experiment.

- Added conservative straight-line consolidation analysis and detached fidelity
  probes. Connected lines can change endpoint rasterization, so no vector merge
  command is enabled. Added a checksummed, bounded originals-archive format and
  conflict-checked restoration previews for the owner-approved reversible image
  Drawing approach. The later storage foundation above adds verified file
  persistence; journaled document replacement remains pending. This foundation
  never deletes original strokes.

- Added **Selected Drawings only** JSON export for moving a scrawled map without
  exporting unrelated artwork in the same layers. Selected Unassigned strokes,
  required layer ancestry and scoped presets are preserved; source/selection
  changes refuse stale downloads. Existing preview-first additive import applies
  X/Y offsets with fresh IDs and leaves source/destination originals unchanged.
  This does not enable layer opacity or merge/consolidate strokes.

- Added optional synchronous snapshot-currentness guards before cache publication
  and replay, including an opt-in native full-recapture shadow guard for missed
  events. Borrowed texture fingerprints now include frame/orig/trim/rotation and
  texture-view revisions. Native selection/release and pan shadow checks block
  stale frames and recover without Scene edits. Full recapture is deliberately
  not enabled as a live per-frame optimization.

- Added detached ordered cache replay acceptance fixtures with uncached native
  text, multiply/filter barriers, fractional pan/zoom and parent effects.
  Reports retain both premultiplied and straight-alpha errors. Normal-opacity
  framebuffer comparisons stayed within one channel; inherited opacity
  changed compositing and remains refused by native capture. No live activation.

- Added bounded read-only native cache snapshot capture with stable slot-to-
  Drawing mapping, borrowed textures and explicit viewport/context checks.
  Prepared document values are used only for cache reconstruction; stored
  project exports remain unchanged. A detached native geometry probe matched
  both eligible runs exactly in the current Scene. Live caching remains off.

- Added an opt-in serialized cache host with revision guards, bounded stale
  preparation retries, scoped Drawing/Scene invalidation, pan/layer/font/asset/
  context-loss listeners and asynchronous teardown coordination. Race tests
  reject outdated frames and unregister listeners. It is not started by module
  setup and does not suppress native drawing output.

- Added a geometry-only independent artwork-cache adapter reusing the validated
  artwork renderer, explicit source/context SHA-256 fingerprints, native tie
  ordering, borrowed texture readiness/revision guards and owned run textures.
  Text caching remains explicitly refused pending font bitmap ownership and
  resolution validation. No live source suppression or startup hooks are enabled.

- Added an independent owned Drawing-run cache service connecting admission to
  shared memory reservations, synchronous allocation/render/replay, fingerprint
  reuse, stale-frame gates and retryable disposal. Failed disposal retains its
  reservation; editing fallback evicts derived resources. Detached native-slot
  pixel/restoration tests pass. The live renderer adapter remains disabled.

- Added a side-effect-free runtime Drawing-cache admission service with complete
  native-stack metadata capture, shared compatible-run planning, aggregate
  surface/output/scratch budgets and bounded reservation accounting. Unsupported
  interface/mixed-elevation paths and active editing receive native fallback.
  Native infinite-sort barriers are preserved. No live render hooks, cache
  activation, stroke consolidation or layer-opacity controls are installed.

- Added layer/group subtree JSON export with scoped artwork, ancestor lock/gate/
  default context, restricted presets/resources and scoped optional thumbnails.
  Version-1 packages now accept explicit full/subtree scope; existing full packages
  keep their behavior. No sibling/Unassigned artwork leaks into subtree packages.
- Additive imports can target an unlocked existing group with unlocked ancestors,
  creating a new player-hidden wrapper above its children. Existing Drawings/
  sorts/nodes/gates/presets stay untouched; insufficient integer sort capacity
  refuses rather than reorders. Imported presets preserve destination parent gates.
  Native detached schema/planning checks, subtree download and 44px dialogs passed;
  resource review, stale-state protection and journal compensation remain shared.
  Explicit multi-Level mapping and recovery exchange remain pending.

- Added strict vector SVG publication in Library with shared explicit audience/
  scope/crop/scale and stale-source/authority guards. Native rectangle/ellipse/
  open/closed path geometry, smoothing curves, rotation and opacity remain vector.
  Escaped named groups preserve interleaved native stack order. Text uses loaded
  native wrap metrics, explicit outlines/shadows and required fidelity consent;
  fonts are not embedded and viewer differences are disclosed.
- Textures/image stamps and degenerate shapes block the whole SVG with named
  diagnostics; unavailable fonts, unsupported styles, oversized text and invalid
  XML stop export. No raster embedding, background composition or SVG import.
  Native checks verified parseable/rasterizable SVG, native-dialog submission/
  intercepted download, 44px consent/controls and geometry agreement away from
  antialiased edges. JSON remains the exact editable-project format.

- Added optional displayed-Level background composition to WEBP publication:
  base color and static image with native fit/anchor/offset/signed scale/rotation/
  tint, background-only output and exact Scene-rectangle crop. Transparent mode
  remains the default. Foreground/other-Level imagery, fog, lighting, padding and
  grid remain excluded. Invalid/video/blocked resources and primary artwork below
  the background elevation fail explicitly. Background/source/Scene-rect changes
  invalidate review/render; owned resources obey combined decoded/GPU bounds.
- Native checks matched all five native resize modes, verified encoded image
  tint/base-color/artwork stacking and 100x80 map clipping, and measured 44px
  background/crop controls without horizontal overflow. No Scene/settings/file
  writes were required. Expanded JSON exchange remains a subsequent slice.

- Added transparent artwork WEBP publication in Library with explicit player/GM
  audience, whole displayed-Level or layer/group scope, actual/custom Scene-pixel
  crop, 0.1-4 scale and live quality slider. Dedicated uncached offscreen rendering
  excludes backgrounds/grid/other Scene objects/UI and never edits artwork.
  Source/workspace/authority/context checks guard download; staged imports,
  unsupported geometry/resources and output/GPU limits fail explicitly.
- Publication verifies WEBP MIME/header dimensions, releases GPU/texture resources
  and corrects PIXI 7 saturated-color overflow during alpha extraction. Native
  checks verified transparent alpha, GM half-opacity geometry, stacking, text,
  requested dimensions and 44px dialog controls. Expanded JSON exchange remains
  a subsequent slice, not claimed complete.

- Added confirmed shared catalog removal/restoration for saved projects/shapes.
  Removed items persist across refresh/reload in a bounded world catalog (100
  records across folders), without JSON uploads/deletion or Scene edits.
  A Removed items view exposes restoration; stale cards cannot import/place/
  edit/duplicate removed files. Externally changed files stay removed with
  explicit disclosure; missing/malformed files retain recoverable error cards.
  Replacement repair warnings remain visible independently of catalog removal.
  Catalog writes use expected-state/read-back verification and report uncertainty
  explicitly, not atomic multi-GM locking. Native tablet restoration measured
  44px without horizontal overflow; file deletion remains external/deferred.

- Added Manage saved files for portable project/shape name/category/tag editing
  and fresh-identity duplication. Project packages now support bounded optional
  library identity/category/tag metadata; metadata lives in JSON, not catalog-only
  overrides. Geometry, layers, presets, references and thumbnails are preserved.
- Metadata replacement requires separate confirmation, exact source/read-back
  fingerprints and a verified persistent world repair marker. Uncertain files
  cannot be imported, placed, edited or duplicated until explicitly reviewed.
  Recovery accepts revalidated current bytes without uploading/deleting/rolling
  back; malformed/missing files need external restoration. Native management
  dialogs use 44px form targets. Concurrent same-path writes remain unsupported:
  Foundry upload and settings checks are not atomic cross-client locks.
  Shared catalog removal/restoration is implemented separately above; supported
  file deletion remains deferred.

- Added Save current project in Library: fresh portable JSON files retain all
  Scene Drawings, nested layers/defaults and presentation presets through the
  existing single-source-Level contract. Shared project/shape writes verify
  exact SHA-256 bytes, independent file permissions, finite capacity, collisions
  and stale inputs; uncertain uploads report retained-file paths without cleanup.
- Project and selection saves now offer embedded 256x192 WEBP thumbnails by
  default, with external-resource consent and a separate confirmed thumbnail-free
  fallback before uploads. Saved-shape thumbnail cards avoid redundant rendering.
  Native dialogs/tablet targets and mock upload/read-back/reindex were checked
  without real file or Scene writes. Later administration slices are described
  above.

- Added mixed single-color/paired Line–Interior palette entries, whole-button
  split previews, tinted material samples and None/Solid/Pattern interiors.
  Right-click and touch/keyboard-accessible creation/Manage paths offer named
  editing, duplication and confirmed removal through revision-verified palette
  writes. The bounded native editor previews actual current width/opacities and
  has material browsing plus wheel/arrows/minus/plus repeat controls.
- Paired application verifies material resources before activating a transient,
  Scene/Level/active-layer-scoped appearance override. It preserves normal
  width/opacity behavior, wins narrowly over layer appearance defaults and
  exposes Return to layer defaults. Manual edits are marked modified. No partial
  multi-setting brush writes, automatic selected-artwork edits or authored
  label/stamp overrides; Solid/None remove stale textures/repeat flags.

- Added unassigned, GM-only native keybindings for Draw: Freehand pencil and
  Tokens: Select / Move. Tool activation cancels armed label/stamp placement,
  preserves brush defaults, refuses overlapping activation and blocks canvas
  gestures or pending placement writes. Typing focus retains normal behavior.
- Added an Intuos4 PTK-840 browser setup section in Settings with current native
  assignments, Configure Controls access and a deliberately focused key diagnostic.
  The test suppresses Foundry actions, stores no input and removes listeners on
  blur, refresh or close. Wacom driver programming remains manual; physical
  ExpressKey validation is pending and pressure remains deferred.

- Unified built-in example projects and saved files in the Library browser.
  Artwork prefab, saved-shape and loaded-stamp previews now arm placement directly;
  redundant Place Prefab controls are removed and Escape still cancels.
- Moved the 14 starter labels into default saved-bank entries in Labels, with
  one-time initialization that respects later deletions. Saved previews show
  readable font-rendered words with disclosed representative scaling.
- Replaced label Next/Repeat UI with one-shot native cursor ghosts, explicit
  cancel, visible rotation controls, Shift+wheel rotation and Ctrl+wheel font size.
  Text-only labels do not inherit palette textures; refused creation is reported
  and stale Scene/Level/layer/workspace changes cannot commit a cursor placement.
- Renamed the default toolbox theme to Foundryshop Slate. Reconciled the product
  plan, preserving owner UI cleanup and making public README conversion the
  final-final milestone after implementation and release acceptance.

- Added persistent custom-shape saving from selected artwork to the configured
  library folder. Named/category/tagged shape JSON normalizes grid-relative
  geometry and texture repeats without changing Scene artwork or session stamps.
  File permissions, stale-input checks, bounded packages, collision refusal and
  exact SHA-256 read-back verification guard writes; failed/uncertain uploads
  explicitly identify potentially retained files. Library now indexes shapes,
  filters Projects/Shapes, searches tags and reloads fingerprinted shapes for
  ordinary preview/Repeat placement.

- Added two complete editable example projects directly in Library: The Wayfarer's
  Rest and Whispering Woods Ruins. Nested layers, textured geometry, styled labels,
  presentation-hidden notes and three full presentation presets demonstrate the
  combined workflow. Lazy all-artwork previews, normal confirmed empty/additive
  import review and JSON download need no user-library folder or uploads.

- Added eight textured editable starter prefabs: flagstone room, planked table,
  forest-floor and sandy clearings, rippling pond, frozen pool, rough-stone column
  and brick dais (102 total). Shipped material dependencies and saved repeat
  widths use the existing preview/placement pipeline and scale with artwork.
  Original solid-fill examples remain unchanged.

- Added label font-size minus/plus buttons and wheel adjustment (Shift: 5px),
  matching line-width controls. Updates the live editable preview immediately
  and clamps to 8-256px without changing Drawing brush defaults.

- Merged label typing and preview into one parchment-backed styled textarea.
  Exact selected font size/color/text opacity render directly while typing,
  preserving native multiline editing, spellcheck, selection and length limits.
  Text alpha does not fade the background/caret; contrasting selection and
  bounded resize/scroll behavior keep even large or transparent labels editable.

- Reworked Labels into a live composer: font-preview dropdown, multiline
  font-rendered text area, size/color/opacity controls and parchment preview at
  the top. Explicit arm/save/apply actions keep draft editing separate from
  placement and brush defaults. Saved and example labels appear below as
  unboxed font-rendered words with accessible click/keyboard behavior.
  Added validated optional text opacity through storage and all placement paths,
  including fully transparent labels. Native Chromium review verified per-font
  dropdown entries, live multiline updates and no horizontal overflow.

- Added 14 immediately available styled label examples and matching editable
  Library prefabs (94 total). Signika room labels/notes, Amiri landscape names
  and Modesto Condensed headings use Foundry's existing font files.
  Saved labels optionally retain validated font/size/color, with native registered
  font choices in the editor. Styles follow Next/Repeat/Place and explicit
  selection application without modifying brush defaults. Plain labels retain
  default-font behavior; missing fonts and stale style edits fail explicitly.
  Native review verified all 14 text layouts fit their bounds, previews render,
  and tablet example buttons are 44px with no horizontal overflow.

- Added explicit, confirmed fill application to selected artwork. Batched updates
  replace fill type/texture/tint/opacity/repeat only, preserve other Drawing data,
  and clear material metadata for Solid/None. GM permissions, native/layer locks,
  pending imports, image-stamp exclusion, stale selection/artwork/default/grid
  checks and bounded texture verification guard writes. Exact post-write checks
  report incomplete updates explicitly without unsafe concurrent-edit rollback.
  Detached Foundry v14 document tests verified Pattern/Solid/None without editing
  the live Scene; tablet UI retains a 44px action button.

- Added independent texture repeat width (0.05-100 grid squares; gridless uses
  100px), resolved into validated Drawing metadata at creation. Shared material
  matrices preserve image aspect ratio across native artwork/ghosts/previews.
  Layer defaults and JSON round trips retain repeat settings; saved textured
  prefab scaling scales the material with the geometry. Existing native patterns
  and fitted image stamps remain unchanged. Eighteen scaled native/offscreen
  pixel comparisons matched exactly.

- Added 15 original seamless 256px grayscale texture materials (about 280 KiB),
  generated reproducibly without external assets. Brush & Selection now has
  a compact searchable three-column material picker, lazy source thumbnails,
  selected built-in thumbnail/name, explicit preview failures and local-file
  browsing. Selection reuses bounded verification and affects future artwork
  only. Runtime builds include the material assets.

- Added the first texture-material slice: local static-image selection in Brush
  & Selection, verified bounded decoding before setting future Pattern defaults,
  material path/clear controls, existing fill tint/opacity and no Scene edits.
  Remembered layer defaults now include textures; JSON inventories and maps
  textures referenced only by layer defaults. Native/offscreen pixel output
  matched across 16 shape/size/rotation/smoothing cases. Starter materials,
  searchable previews and independent material scale remain follow-up work.

- Unified Palettes into one persisted selector for built-in/custom palettes,
  compact horizontal wrapping swatches and a trailing + color button. New/copied
  palettes are selected automatically; Manage reveals advanced controls.
  Built-ins now support direct shared edits and a confirmed reset to shipped
  defaults, using revision-checked, verified storage.

- Fixed multi-component prefab sort-space exhaustion: reserve complete batches
  and automatically re-space exhausted gaps while preserving existing native
  visual order. Sort-only maintenance has verified durable rollback/recovery.
- Added armed-stamp Shift + wheel rotation (15 degrees) and
  Ctrl + wheel scaling (factor 1.1), with live ghosts, numeric-control sync,
  repeat/rearm retention and unchanged ordinary canvas wheel input and Alt combinations.

- Expanded starter artwork from 12 to 80 distinct editable prefabs across eight
  categories (337 components), including six tree silhouettes, furniture/storage,
  dungeon fixtures, terrain, campsite/settlement objects, room outlines and map
  symbols. Added combined category/search filtering and a live result count.
  Catalog validation is cached while callers receive independent copies; actual
  thumbnails remain lazy. The 64-prefab target is no longer a collection ceiling.

- Added the Fantasy Mapping default built-in palette (20 colors), with Grayscale
  and Bright Markers alternatives, client-local selection and explicit copying
  to editable shared palettes. Existing colors/brush defaults are not overwritten.
- Added the first 12 original editable starter prefabs, including three distinct
  trees. Built-in searchable cards need no folder setup and use actual lazy
  thumbnails. Placement reuses native ghosts, grid-relative sizing, scale/rotation,
  repeat and verified transaction safeguards. No external assets/fonts, functional
  Walls/doors/lights or sepia variants. The remaining starter kit is follow-up work.

- Added a GM-configured shared-folder project browser in Library with searchable
  two-column thumbnail cards, Drawing counts and explicit invalid/missing-preview
  states. Bounded serial reindexing requires separate file-browse permission.
  Card import rechecks SHA-256 bytes/root and reuses the existing import dialogs,
  resources, staging and journal safeguards. This first slice is read-only;
  persistent shapes, tags, library saves and destructive administration follow.

- Project JSON export now includes an optional generated 256x192 WEBP thumbnail
  by default, with full hidden-artwork disclosure and explicit external-resource
  acknowledgement. Rendering failure offers deliberate export-without-thumbnail
  confirmation; stale Scene/artwork refuses download. Strict bounded static WEBP
  metadata/header validation preserves packages without thumbnails. Embedded
  thumbnails do not persist into Scene artwork or replace generated import review.

- Added generated artwork previews to JSON import review, using mapped textures/
  fonts and the validated destination ordering. Preview renders asynchronously
  without Scene writes, cancels on dismissal, includes hidden package artwork and
  excludes destination/background content. Explicit preview warnings do not bypass
  import validation or resource checks.

- New color-save dialogs prefill a localized descriptive name from hue/lightness/
  saturation, including neutral grays and brown. Names remain editable; existing
  names, palette imports and persistence validation are unchanged.

- Added client-local whole-toolbox scaling from 50-125% in 5% steps, with Mouse
  (50%) and Tablet (100%) presets. Native ApplicationV2 scaling includes chrome,
  text and the Layers flyout; density remains independent. Applies on slider
  release with viewport-aware size limits and preserved cursor anchoring.

- Anchored quick layers to the opening click/pen tap instead of the toolbox side.
  The anchor stays fixed until closed, including across artwork refreshes and
  toolbox movement. Viewport flipping/clamping remains; keyboard opening uses the
  Layers button as its fallback anchor.

- Added the default Photoshop-inspired Slate / Glass toolbox theme, with neutral
  slate controls, subtle glass chrome and flat layer rows. Client-local Foundry
  and Game system alternatives are available in the Settings tab/module settings;
  Game system opts into the active system's CSS class like Townie Maker.
- Replaced the inline Layers readout with a true anchored overlay that follows
  the toolbox, flips/clamps at viewport edges and does not resize the toolbox.
  Retained both visibility eyes, locks, group folding, counts, dismissal and full
  tab access. Artwork thumbnails now have white UI backgrounds; WEBP alpha is
  unchanged.

- Added a bounded shared offscreen Drawing-to-WEBP renderer and lazy, real
  layer/group artwork thumbnails in the quick readout. They show full artwork on
  the displayed Level, including hidden members; they are not player previews.
  Native smoothing/text styling, rotation, alpha, pattern fills and fitted image
  stamps are supported without live Scene writes. Unsupported content produces a
  visible warning rather than substitute art. Texture downloads/decodes, rendering,
  cancellation and short-lived caching are bounded; refresh retries resources.
  The renderer remains the foundation for planned JSON/library previews/export.

- Changed the top-row Layers shortcut to a short quick-layer flyout with active
  layer, counts, group folding, separate GM/player eyes and lock controls.
  No drag/reorder/destructive actions; full management remains in the Layers tab.
- Added session editable shape stamps and PNG/JPEG/WEBP import/clipboard stamps
  in Library, with ghost click-to-place, scale/rotation, repeat and visible cancel.
  Images use verified uploads to an existing GM-configured data folder and resize
  as rectangular Drawings, preserving native layer/presentation/JSON behavior.
  Placements reuse the durable import journal without changing destination
  layers/presets; failures compensate only their own artwork. Continuous stamp
  brushes, vector import and persistent saved-shape catalog remain deferred.
- Stacked stroke and fill opacity in two 22px lanes within the existing 44px
  tablet brush row, with separate icons, accessible names and live percentages.
  Both remain available when collapsed; removed duplicate sliders from the tab.
- Refined the tablet toolbox into the eight-button-wide "8button" layout:
  accessible icon tabs, compact stroke/fill/width/opacity controls, and five recent
  colors beside swap and fill/no-fill on a separate persistent row. Collapsed
  armed-label status no longer adds buttons to the eight-tool row.
- Fixed a translation namespace collision between the fill-type label and its
  options, which prevented Foundry from loading the language file and displayed
  raw translation keys. Added a whole-file namespace-expansion regression check.
- Added multiple named shared palettes with grouped color cards, explicit palette
  create/rename/duplicate/reorder/delete and color save/edit/reorder/remove/import.
  Old personal/campaign lists can be copied explicitly without changing originals.
  Shared writes have finite limits, revision guards and verified persistence.
- Added the seven-tab unified Drawing Toolbox shell, with persistent drawing/brush
  controls, recent colors and active-target opacity while collapsed. Tab/position/
  collapse state is local; tab bodies retain their scroll positions.
- Embedded layer hierarchy, presentation presets and JSON exchange using the
  existing layer controller/services. Legacy layer/Quick Draw launchers select
  toolbox tabs; the existing picker opens as a child color-only popup.
- Integrated saved-color editing and local density/auto-open/edge-pan settings.
  Preserved personal/campaign palette and label data pending the named-shared
  palette milestone. Library thumbnail cards and reusable shapes remain pending.
- Toolbox access now defaults to GM-only; trusted-role access stays disabled until
  its planned permission/relay validation is implemented.
- Empty-project JSON import now supports Scenes with no Drawings but retained
  layers/presets (such as Scene copies). Replacing that metadata requires a separate
  confirmation and final preview approval; existing Drawings are never replaced.
  Failed-import compensation retains/restores the prior metadata.
- Fixed JSON export of native v14 Drawings with unset names or text. These optional
  strings export as empty strings without modifying source artwork; other invalid
  or non-JSON metadata remains rejected.
- Added explicit additive JSON import mode with a new top-level player-hidden
  group above existing artwork. Existing Drawings, sorts, membership, locks, layer
  gates and presets remain unchanged; conflicting imported preset names are suffixed.
- Imported presets capture existing player gates at import time. Original presets
  remain unchanged and hide newer imported nodes on application.
- Added SHA-256 baseline fingerprints to import journals. Failed-import cleanup
  restores the prior tree and removes only operation-owned Drawings, refusing
  conflicts or edits/deletion of existing artwork. Older empty-import journals
  remain discardable.
- Removed vector/SVG and raster image import from the roadmap. JSON import/export
  and SVG/WEBP export remain in scope.

- Added JSON import resource preflight: bounded same-origin texture HEAD checks,
  loaded Foundry font discovery, font replacement mappings, and a repair/recheck
  dialog. Missing/unverified local textures and unavailable fonts block all writes.
- Resource checks run again before import journaling, with Scene/Level/module
  freshness checks. External URLs are not preflight-requested and require explicit
  acknowledgement; redirects and unsafe URL schemes are never followed.
- Added resource concurrency/timeout/limit, no-external-request, mapping persistence,
  cancellation, stale-state and post-confirmation failure regression coverage.

- Added full-project JSON export and validated empty-project import with fresh
  Drawing/node/preset IDs, importing-GM authorship, explicit displayed-Level mapping,
  optional translation, texture replacement mappings, and dependency inventory.
- Imports stage beneath a player-hidden wrapper and preserve native Drawing
  hidden/locked fields. Originally Unassigned artwork receives an imported layer;
  a new Imported Presentation preset restores player gates only on explicit apply.
- Added durable exact-ID import journaling, verified writes, own-operation failure
  compensation, and confirmed interrupted-import discard with conflict refusal.
- Added bounded version/geometry/reference validation and native-document preflight.
  Unsupported recovery, multiple source Levels, unknown Foundryshop metadata and
  nonempty targets are rejected explicitly. External URLs remain unverified;
  additive/subtree import and broader exchange remain pending.
- Added canonical JSON round-trip, dialog/cancellation, ID/Level/author remapping,
  staging visibility, native-lock preservation, and failure-cleanup tests.

- Disabled native screen-edge auto-pan during new Drawing creation by default,
  preventing the map from shifting beneath pen strokes near the viewport border.
  A client setting restores native behavior; navigation and existing-object
  manipulation retain native panning.

- Added a GM-only Layers panel and toolbox shortcut, stable Drawing membership,
  versioned Scene tree state, and per-GM/per-Scene workspace state.
- Added explicit assignment, native sort reconciliation, drag/arrow reorder,
  remembered brush defaults, and a fixed Scene Background entry.
- Added persisted GM presentation with passive player rendering and no player
  layer controls. Native visibility/lock flags are preserved; hiding is not
  confidential storage.
- Added batched ordering, cached visibility gates, stale-revision checks, and
  explicit errors for incomplete operations and unsupported sort combinations.
- Added foundation tests including native-style refresh mocks, player authority
  rejection, Place Text integration, and a 3,000-Drawing batched reorder.
- Destructive artwork deletion, exchange, and flattening remain
  pending; real Foundry v14 rendering and multi-client validation are still required.
- Fixed Add/Rename Layer dialogs to supply the attribute-free DIV required by
  DialogV2. Background labels now read the displayed v14 Level instead of the
  deprecated Scene background accessor.
- Added nested groups, per-GM collapse preferences, group Drawing counts, drag
  reparenting, a pen/keyboard-friendly Move to Group dialog, and root reparenting.
- Added independent workspace/presentation tri-state indicators. Group gates
  preserve child settings; explicit recursive commands overwrite only the subtree,
  with confirmation before Show All to Players.
- Added confirmed non-destructive layer/group removal into a destination layer
  or Unassigned. Transfers are verified before metadata removal; partial failures
  preserve artwork and surface recovery guidance.
- Added hierarchy, visibility, dialog, cancellation, and failure-path tests.
- Added full named player-presentation snapshots with GM-only save/apply/replace/
  rename/delete controls. Applying uses one Scene write and hides newer nodes
  without changing the GM workspace, brush, selection, or Drawing documents.
- Preset matches are derived from live gates. Removing referenced nodes warns and
  marks affected snapshots incomplete; applying requires explicit replacement or
  deletion rather than silent reference repair.
- Added preset schema, persistence, cancellation, stale-dialog, write-failure,
  authority, workspace-isolation, and 3,000-Drawing no-embedded-write tests.
- Reordered the roadmap to complete presets, then lock ownership, then portable
  JSON projects; JSON sharing no longer waits on the flattening feasibility gate.
- Added GM layer/group lock controls with ancestor-inherited protection, canvas
  selection release, Drawing edit/delete/create guards, and inherited assignment/
  removal checks. Native Drawing locks remain untouched when locking/unlocking.
- Selected-label actions honor layer locks and recheck after dialogs. Layer order,
  player presentation/presets, and sort-only maintenance remain available.
- Added lock inheritance, persistence-write failure, native-hook cancellation,
  authority, selection, creation, and toolbox regression tests.

## Foundryshop 0.1.0

First release under the Foundryshop name, by Xombit.

- Rebranded from Boneyard Drawing Tools: new module ID `foundryshop`, title, authors,
  localization keys (`FOUNDRYSHOP.*`), CSS prefix (`fshop-`), hook names, application IDs,
  and build/package/deploy scripts. The original author is credited in `module.json`,
  `LICENSE`, and the README.
- Uses a fresh settings namespace: saved colors, labels, toolbox position, and panel
  settings from Boneyard Drawing Tools are not imported.
- Deployment warns when Boneyard Drawing Tools is still installed (shared Ctrl+D default).
- Fixed the release workflow's license URL.
- Includes everything in the pre-rename development builds below.

## Pre-rename development builds

These local builds were made under the Boneyard Drawing Tools name before the rename.

### 3.2.0-toolbox.2 (local refinement)

- Stroke/Fill chips and saved-color swatches are filled with the color they represent
  (with readable text), and keep that color in pressed/hover theme states.
- No Fill shows a checkerboard with a red slash on the Fill chip.
- Scrolling the mouse wheel over the Width row changes line width (Shift: ±5); rapid
  scrolling updates immediately and saves once scrolling pauses.

### 3.2.0-toolbox.1 (local feature test)

- Added a floating, pen-friendly Drawing Toolbox that auto-shows on the Drawings layer
  (single instance, user close suppresses it until next activation, toolbar button and
  unbound keybinding to toggle, collapse, remembered position, Compact/Comfortable/Tablet sizes).
- Toolbox tools use Foundry's scene-control activation; stroke/fill chips, swap, No Fill,
  width, opacity, and saved-color swatches; "More colors" opens the detailed panel.
- Added quick labels with My Labels (per user) and Campaign Labels (GM-edit) banks,
  optional starter labels, and Off / Next Shape / Repeat / Place Text modes.
- Labels are injected only into the local user's native interactive creations via
  `preCreateDrawing` (paste, undo, Place Text, and other users are ignored); Next Shape is
  consumed only after creation succeeds; armed state is never persisted.
- Selected-drawing label edit/apply/clear with lock, permission, and stale-change checks.
- Detailed panel now ignores only its own config writes, so toolbox changes stay in sync.
- Added label-bank, label-placement, and toolbox regression tests.

### 3.1.0-colors.2 (local refinement)

- Added a dedicated visible color block to every saved-color row.
- Fixed Save Current Color and Edit dialogs losing their prefilled values when DialogV2 serializes input elements.
- Save captures the active Stroke/Fill color; Edit starts with the saved name and hex.

### 3.1.0-colors.1 (local feature test)

- Added named saved colors under the picker, with personal and campaign palettes.
- Personal palettes use per-user world storage, available across browsers/computers.
- Campaign palettes are shared, with GM-only editing and player swatch use.
- Colors can be saved, selected, renamed, edited, and deleted with confirmation.
- Duplicate saves offer to rename the existing color instead of adding a duplicate.
- Preset imports preserve original settings and skip existing saved colors.
- Writes are serialized per client; stale edit/delete drafts are rejected.
- Added validation, limits, localization, and saved-color regression tests.
- Marked the v14 baseline verified after the local tester reported passing on 14.365.
- Raised minimum compatibility to v14; v13 has not been regression-tested.
- Saved-color features still require live multi-client testing.

### Local v14 compatibility baseline

- Replaced obsolete drawing-default access with v14 DrawingPalette settings.
- Preserved the v13 setting path; v13 regression testing is still required.
- Panel edits update only the changed drawing property and preserve other defaults.
- Native palette changes synchronize into the open panel without write-back loops.
- Panel edits refresh the native creation palette, without changing selection drafts or existing drawings.
- Added explicit toolbar ordering and guarded asynchronous panel toggles.
- Direct stroke-width input now updates defaults immediately and rejects invalid numeric input.
- Eyedropper samples the rendered screen using PIXI extraction, accounts for canvas bounds and display scaling, and displays pixel rows in the correct order.
- Picker listeners, preview frames, and overlays are cleaned up on close and canvas teardown.
- Added dependency-free Node regression tests and Windows local build/package/deployment scripts.
- Automated tests passed; the local tester subsequently reported live v14 tests passing on 14.365.

## Boneyard Drawing Tools (original project by Lich / operation404)

Release history of the upstream module, preserved for reference.

### 3.0.0

- **Breaking:** Requires Foundry VTT v13.
- Migrated to ApplicationV2 (`HandlebarsApplicationMixin`). The panel is now a standard Foundry window — draggable, with native title bar and close button.
- Replaced custom keyboard shortcut system with Foundry's built-in `game.keybindings` API. Shortcuts are now configured through Foundry's Configure Controls menu.
- Replaced direct WebGL `readPixels` dropper with PIXI renderer extract API.
- Updated `getSceneControlButtons` hook for v13's object-keyed controls format.
- Updated `DrawingsLayer` references to `foundry.canvas.layers.DrawingsLayer`.
- Color values from drawing defaults are now normalized to handle `Color` objects.
- Settings changes are applied in real-time (no need to close the panel).
- Window position is remembered between opens.
- Toolbar tooltip shows the current keyboard shortcut.
- Removed jQuery usage throughout.
- Removed unused `vector_math.js`.
- Fixed duplicate preset color swatches setting registration.
- Fixed dropper preview size setting type (was `String`, now `Number`).

### 2.0.9
- Updating GitHub workflows to properly link a url for the license and readme of the release.

### 2.0.8
- Updating GitHub workflows to fix bug with version field not being set in the module.json file.

### 2.0.7

- Improved fix for panel closing when clicking a button. (#4)
   - Still a workaround, but all original module functionality should be restored now.

### 2.0.6

- Fix for drawing config panel closing when clicking a button while the active game system is pf2e.
   - This is likely a temporary fix, as it doesn't fix the issue of receiving two `focusout` events, but does check if they were emitted with a non-null `sourceCapabilities` to check if an actual hardware item generated the event - i.e., the mouse.
