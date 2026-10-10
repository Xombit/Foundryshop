# Foundryshop

A pen- and tablet-friendly drawing toolbox for Foundry VTT: a floating tool
palette, saved colors, quick map labels, and an advanced color picker for
sketching maps live on the canvas.

**Compatibility:** Foundry VTT v14 (live-tested on 14.365). v13 is not supported.

**Version:** 0.1.0 (first Foundryshop release).

Foundryshop edits the defaults for **new drawings**; the toolbox's *Selected*
row is the only part that changes an existing drawing. Native creation-palette
changes update the panels, and Foundryshop edits refresh the native palette
without replacing a selection-mode draft.

The expanded toolbox has four panels — **Style**, **Color**, **Layers**
(Layers | Presentation) and **Assets** (Stamps & Library | Labels); the gear in
the window header opens Settings. A layer's ⋯ menu can turn it into a faded,
hidden **tracing reference** Tile to draw over. The panel strip uses one
keyboard Tab stop. Left/Right arrows switch panels, Home/End jump to the
first/last panel, and Tab continues into the controls. Mouse/pen switching does
not force keyboard focus onto the strip.

## Credits and history

Foundryshop began as a continuation of
[Boneyard Drawing Tools](https://github.com/operation404/boneyard-drawing-tools)
by **Lich (operation404)**, released under the MIT License. The Quick Draw
Config panel, color selector, eyedropper, presets, and recent colors come from
that project. Foundryshop added Foundry v14 support, saved colors, the floating
Drawing Toolbox, and quick labels. Both copyright notices are kept in
[LICENSE](LICENSE), and the upstream history is preserved in
[CHANGELOG.md](CHANGELOG.md).

Foundryshop uses a new module ID (`foundryshop`). It does not import settings,
saved colors, or labels from Boneyard Drawing Tools. Disable Boneyard Drawing
Tools in worlds that use Foundryshop: both add drawing controls and the same
default **Ctrl+D** shortcut.

## Rendering optimization status

Drawing-cache work is experimental and not enabled on the live canvas. The
runtime admission service checks compatible ordered runs and aggregate memory;
developer probes test pixels, invalidation and restoration without changing
Scene sources. Admission means eligible for further renderer/performance
validation, not that caching is active. Original strokes remain authoritative.

The opt-in serialized cache host rejects outdated asynchronous preparations,
coalesces invalidation and coordinates teardown with resource ownership.
It remains inactive; live replacement and reference-layer opacity still require
native rendering and interaction acceptance.

Read-only native snapshot capture preserves the complete primary stack and
keeps text, hidden/unsupported display states and non-Drawing objects uncached.
Its developer shadow probe compares independently rebuilt cache runs with
borrowed native geometry without replacing live canvas output.

Ordered replay probes also retain uncached text and blend/filter barriers.
Inherited container opacity is not interchangeable with fading cached runs:
native capture refuses it, and whole-layer transparency remains unenabled.

The optional guarded native capture checks for unhooked dependency changes
before publication/replay. Its full recapture is a shadow-validation tool,
not a live per-frame fast path. Actual control/release and pan checks preserve
Scene data and restore the client view after testing.
Private composited layer opacity is still pending its renderer gate. See the
[official design](Foundryshop_Layer_System_Design_UPDATED_FLATTENING.md).

Authorized disposable-Scene profiling reached 1000 synthetic strokes at roughly
60 FPS when settled, with 73% viewport ink for map-scale paths and 12% for compact
detail. A follow-up found hook debug logging heavily inflated the initial
seconds-long selection stalls: with logging off, the 1000-map-stroke interaction
cycle measured about 200 ms. Native directory rendering still refreshes all
Drawing states, not just the selected row.

A server-readback-verified recovery benchmark reduced 500 native strokes to one
image Drawing: the measured selection/refresh/release cycle fell from 110.5 ms
to 33.4 ms, and returned to 111.7 ms after exact restoration of all 500 sources.
These are client-specific progressive-load results, not an hours-long soak,
physical pen latency or a guaranteed stroke/coverage limit. The developer-only
[session profiler](tools/drawing-session-profile.mjs),
[directory profiler](tools/drawing-directory-profile.mjs) and
[consolidation benchmark](tools/drawing-consolidation-profile.mjs) are never
started by the module. World-writing probes need explicit authorization and
cleanup; the consolidation benchmark also uploads two retained evidence files.
Production consolidation and interruption recovery remain planned; no source
deletion command, sidebar bypass or live cache is enabled.

The recovery-storage foundation now prepares immutable file references, uploads
to an explicitly supplied existing Foundry data folder and verifies server
readback size/SHA-256. Consolidation archive reads also check their payload
checksum and Scene/Level/archive identity. Changed sources, denied uploads and
unverified readback refuse success; uncertain uploads retain their path for
future journal reconciliation. These services do not delete Drawings or change
Scene settings. Native transaction execution and UI remain pending.
The existing Drawing-only v1 archive retains its 1000-source/5-MiB limits; those
are not the future Bake image-size policy.

The operation-journal foundation records durable intent and ordered apply/restore
phases in Scene flags, retaining lightweight file references, source digests,
typed Drawing/Tile/Level-background descriptors and lineage. Every phase requires
explicit state-verification evidence; stale writes and uncertain server responses
refuse success. Writes are serialized through the existing Scene layer queue and
restricted to Foundry's designated active GM, with reviewed handoff for a
disconnected owner. This is not an atomic server lock, automatic reconciliation
or a native document transaction. No journal command is exposed yet;
operator-to-designated-GM coordination and transaction execution must be wired
before activation.

Typed recovery archives now preserve exact native originals, layer/grid/Level
context, Drawing/Tile/background before/staged/after states, original-background
copy references and immutable parent lineage. They use a separate format, not
the old Drawing-only v1 archive or interchange-project limits. Read-only
reconciliation detects partial deletion, edited replacements and identity/
context conflicts without touching newer strokes. Journal phase evidence checks
persisted archive/output/backup hashes and native state, and requires explicit
output decode/render acceptance. Archive metadata tests include 1001 sources
and a 20000px axis; this does not establish full-size image-rendering support.
Native schema/placement acceptance, original-copy fallback restoration and
portable recovery exchange remain pending.

The native executor foundation can resume an existing verified intent for a
Drawing, Tile or Level background. It stages replacements, removes only exact
archived sources, and restores missing originals hidden before reverting the
replacement and restoring their recorded visibility. Partial writes/lost
responses leave the last verified journal phase for a fresh inspection and
resume; newer strokes remain untouched. Execution requires explicit output
decode and native schema/placement/audience acceptance guards, designated-GM
ownership and unchanged context. It respects Drawing-layer locks. These are
fixture-tested services, not enabled UI or live-native acceptance; no deployment
or live map operation was performed. Drawing-only JSON exports now refuse
Scenes carrying optimization journals rather than omit baked outputs/recovery.

The persisted-output acceptance adapter now checks actual static PNG/JPEG/WEBP
container bytes, file identity, exact reviewed dimensions and browser
`createImageBitmap` decode, releasing decoded bitmaps on success/failure.
It has no stamp/publication axis or megapixel cap; animation and other media
are refused rather than converted to their first frame. Read-only browser tests
accepted generated 8000 x 6000 PNG/WEBP/JPEG and 20000 x 1000 PNG using this
adapter, without uploads or Scene changes. These simple synthetic images prove
encode/decode capability on this client, not detailed-map fidelity, GPU
compositing, server storage acceptance or a general maximum-size guarantee.

Bake-scope preparation now supplies read-only Layer-default, Selection and All
manifests on one displayed Level. It lists included/excluded Drawing IDs, source
layers, Unassigned membership, removal counts and actionable exclusion reasons;
private/hidden/locked/interface/multi-Level or renderer-unsupported sources are
never silently folded in. Approval requires exact exclusion acknowledgement and
the ground-stacking disclosure; mixed elevations and GM-private background
destinations block approval. Selection/membership/source/Tile/Level/workspace
changes invalidate the review. An approved manifest creates typed recovery from
its captured source IDs without trusting mutable preview lists.
Renderer capability and native placement/pixel/resource checks, resolution/
bounds preview, operation preparation and actual bake UI remain unwired.

The native-schema adapter now checks exact strict detached Foundry document
round-trips for originals, hidden restore staging and Drawing/Tile/Level
replacement states. A review-bound verifier rejects schema normalization and
requires a separate explicit placement/stacking/audience check; it does not
pretend schema validity establishes visual fidelity. Read-only v14 inspection
confirmed exact stored Level/Drawing round-trips and an 8000 x 6000 detached
Tile round-trip. No Tile was created in the Scene.

Ground-placement acceptance now binds reviewed crop bounds, audience and Tile
overlap acknowledgement to the exact archive. Tile output must be neutral,
locked, at the Level background's elevation and hidden for GM-only presentation.
Public output rejects private layer ancestry. Background output requires the
full Scene rectangle, neutral resulting tint/color and unchanged identity Level
texture transforms; nonidentity/shared transforms are explicitly refused until
inverse-mapping support exists. Existing foreground/fog imagery is not moved.
Changed native Tile context invalidates approval; owned staged output does not.
These checks integrate with strict schema acceptance, but do not prove crop
coverage, detailed pixel fidelity or GPU compositing. Rendering/resource preview,
operation orchestration, authority routing and UI activation remain pending.

The full-resolution raster backend now renders an owned detached display graph
through sequential GPU tiles into a full-size PNG/WEBP canvas. Working tile size
is clamped to actual texture/renderbuffer/viewport limits, not output dimensions;
output is never silently downscaled. It reports advisory buffer sizes, progress,
cancellation/context-loss errors and verifies encoded format/dimensions/decode.
Read-only native tests produced 8000 x 6000 PNG in about 2.5 s (48 tiles) and
20000 x 1000 PNG in about 0.9 s (20 tiles) on a 16384px-texture-limit GPU.
Sampled opaque/transparent seam pixels matched. Synthetic geometry only:
texture-backed Drawing resource preparation, detailed raster fidelity and native
output display acceptance remain pending.
Full browser canvas/encoder memory still applies; tiling is not streamed encoding.

The bake input resource adapter now reads static PNG/JPEG/WEBP without stamp/
preview/publication byte or pixel caps, retains the exact original Blob and
SHA-256 for future backup persistence, and owns the decoded bitmap. External
URLs require consent before contact; redirects and animated/unsupported media
refuse. Source loading checks authority/currentness, streamed length and decode
dimensions, with configurable timeout (0 disables it). A sequential crop visitor
provides GPU-sized temporary textures even when the input exceeds GPU axes.
Read-only native testing loaded a synthetic 20000 x 1000 PNG and visited 20 crops
in about 245 ms; texture samples across 16383/16384 matched including alpha.
Repeating fills, font resources, backup uploads and final native Tile/background
display acceptance remain pending.

The full-scene background compositor now uses that retained bitmap directly in
CPU canvas tiles, avoiding both oversized GPU inputs and cropped-source sampling
edges. It accepts only reviewed identity Level transforms, applies image tint,
keeps background color below image transparency, and blends GPU-rendered Drawing
pixels above the background rather than overwriting it. Original resources stay
caller-owned for backup persistence. Read-only noninteger-scaled striped/alpha
fixtures passed at 20000 x 1000 and 8000 x 6000; sampled seam-channel differences
against a full-canvas reference were at most 3/255 and 1/255 respectively.
This is measured best-effort fidelity, not pixel-identical native rendering.
Texture-backed Drawing resource preparation, native-background comparisons,
restore/upload orchestration and UI remain pending.

The bake Drawing adapter now prepares exact captured native sources without
preview/project Drawing, point, text-length or coordinate budgets. Supported
geometry is rectangle, ellipse and smoothed polygon/path, with native inset,
rotation, order and alpha handling reused from the artwork renderer. Text uses
loaded native fonts and full-resolution native text rasterization, checked
against actual GPU bitmap axes before and after construction. Raw recovery
sources are not normalized. Scope inspection gives explicit reasons for invalid/
unsupported geometry, foreign rendering metadata, unavailable fonts and pending
texture-fill preparation; no unsupported content is silently dropped.
The synchronous geometry-only path excludes texture-backed fills; the resource
wrapper described below supplies their separate media/GPU acceptance.
Read-only native fixtures rendered 48MP and
long-axis output, plus 1001 Drawings beyond preview count limits. A 512 x 320
rotated-shape/smoothing/text fixture matched all 655360 RGBA channels between
128px tiled and single-target rendering. This is synthetic renderer acceptance,
not native Placeable pixel equivalence, crop coverage or production bake UI.

Texture-backed bake graphs now have an awaited resource wrapper. Opt-in scope
inspection validates ordinary fills, rectangular image stamps and repeat-size
metadata; media/decode/GPU acceptance still occurs before rendering. Shared paths
load once through the uncapped static-image adapter, and actual GPU input axes
are checked without downsampling. Native ordinary tiling, independent stamp-axis
scaling and material-repeat matrices reuse the existing fill helpers. Owned
graphs are cleaned before shared textures and decoded images on success/failure;
using a retained builder after the wrapper returns refuses.
Read-only native rotated/alpha stamp and repeating-fill fixtures compared 128px
tiles against a single target: 2 of 819200 channels differed, at most 2/255.
This is best-effort renderer evidence, not native Placeable equivalence.
Drawing texture inputs above actual GPU axes still refuse explicitly: tiled
material/stamp mapping is pending even though large background inputs already
use the CPU compositor. No production bake UI is enabled.

The read-only reviewed render transaction now connects resource preparation,
per-source rendered bounds, explicit approval and final PNG/WEBP encoding.
Tile output can use an integer enclosing crop or exact supplied dimensions;
background output uses its full Scene rectangle. Reviews list partly cropped
and fully outside source IDs, exact dimensions/encoding and advisory output
RGBA size. Approval must match dimensions, format, quality and every cropped
identity; a modified public review cannot bypass this. Graphs rebuild and bounds
recheck after approval. Bounds are conservative geometry/text extents, not pixel
coverage. Native testing enclosed a rotated negative-coordinate label and
refused an unacknowledged crop without changing the Scene. No backups/uploads,
source removal or production controls are enabled by this render transaction.

Durable bake operation preparation now binds rendered pixels to an exact
raw-source digest, source IDs, crop/destination and encoding review. It prepares
separate output, recovery JSON and original-background-copy paths, then records
the apply intent before uploading any bytes. Uploads require exact readback/
SHA-256; retries reconcile existing matching files rather than overwrite them.
Asset verification requires current originals, native/placement acceptance and
decoded persisted output before advancing the journal to assets-verified.
The preparation layer does not create replacements or delete Drawings; the
existing resumable executor performs those later steps. Mock integration tested
prepared uploads through apply and exact restore while preserving later strokes.
No live Scene mutation was used for this slice. The operator must be the
designated active GM. Passing `approvedScope` to preparation now binds its exact
review across the operation's own intent/assets journal revisions without
loosening native-state checks; authority routing and UI remain pending. Partial preparation
retains its journal/files, not a disposable cache. Missing bytes after reload
still need explicit recovery/re-preparation; no placeholder upload is invented.

Approved scope bindings retain exact originals, exclusions, Scene/Level/grid,
all Drawings/Tiles, workspace and selected IDs, plus the original reviewing user.
Only one matching intent can bind each approval; archive bytes/checksum, source
digests, lineage, destination and Tile audience must match. The bound preparation
guard permits only the unchanged baseline journal and its exact intent/
assets-verified revisions. Unrelated writes or native changes still invalidate
review, and the original pre-intent guard remains strict. Binding does not permit
native source removal or execution-stage changes; resumable apply/restore checks
remain separate. Lower-level callers without an approved scope still supply
their own explicit context guard.

Reload-safe asset recovery now inspects existing bake intents at `intent` or
`assets-verified`, independently of the original in-memory preparation closure.
It verifies the exact archive, lineage and native originals, then lists verified
and missing archive/output/background-copy files. Conflicting bytes, invalid
listings and HTTP/read failures are errors, not "missing" classifications.
Recovery requires explicit approval of every missing path and exact matching
bytes; it never re-renders or fetches a mutable original URL as a substitute.
A missing archive blocks inspection unless its exact original bytes are supplied.
After upload/readback and persisted output acceptance, recovery can advance to
assets-verified only. Native replacements and Drawing removal are untouched.
Changed native/workspace/journal state invalidates the review; advanced native
operations use the executor/reconciliation path instead. No recovery UI or live
world writes were added.

Native replacement construction is now available during durable preparation:
omit an explicit replacement and supply the audience plus, for Tiles, an
unoccupied native ID and exact integer sort. Construction shares the output
file descriptor with persistence and uses detached strict native documents.
Tiles are locked, neutral, ground-aligned and initially hidden; their final
hidden state matches the reviewed audience. Background updates change only
image source/color/tint and retain every other Level setting, including the
original alpha threshold and shared foreground/fog transforms. Native defaults
are captured, but normalization of requested values refuses rather than silently
moving or resizing output. Foundry v14 rounds fractional Tile origins, so those
crops require a new integer-origin render review before native placement.
Detached v14 checks accepted 20000 x 1000 and 8000 x 6000 Tile sources and a
full-Scene background update without changing the Scene. Schema acceptance does
not prove GPU display support; persisted decode, placement/audience acceptance,
original-byte recovery and execution guards remain mandatory. No production
Bake controls are enabled.

Execution-stage review now supplies a separate approval for one existing,
unfinished apply/restore operation after verified archive/output/backup reads.
Pass `approvedExecution` to the resumable executor alongside its explicit
context, native-placement and output-verification callbacks. Approval binds the
exact Scene/token, immutable journal records and phase/revision progression.
It permits only phase-compatible exact changes to archived originals and the
replacement, including partial deletion or hidden-original restoration after
an interrupted write. All other Drawings/Tiles/Levels, Scene/grid, layer
workspace and import state must remain unchanged. Optional selection checks
permit automatic deselection of removed originals, not unrelated selection
changes. Later artwork may be retained as part of a freshly reviewed baseline;
it cannot be introduced during an approved execution. This closes the gap
between strict pre-write snapshots and intentional native mutations without
loosening the original scope guard. It does not route authority, authorize
unreviewed placement, repair missing files or enable production controls.

The opt-in `prepareReviewedTileBake` workflow now connects scope/capability review,
full-resolution rendering, placement approval, detached native construction,
durable preparation and reviewed native execution. It is restricted to the
operating designated GM; other operators refuse before rendering, rather than
silently relaying destructive work. A mandatory native display-acceptance
callback remains separate from browser decode and runs again before native work.
Preparation returns an immutable image Blob for preview and detached reports,
without uploading or changing the Scene. `persistAssets` requires the exact
listed archive/output paths; `apply` separately requests execution approval.
The execution snapshot is retained across the wait for approval, so intervening
changes cannot quietly become a new baseline. Interrupted native writes require
a fresh partial-state review on retry, retaining exact recovery evidence and
later strokes. Same-client workflow preparation/writes exclude overlapping work
per Scene, not a cross-client lock. Fixtures connect the actual render adapter
through apply and fresh exact restore, with mocked browser/native/storage APIs.
GM dialogs, storage configuration, authority coordination, concrete native
display acceptance and authorized live acceptance are still needed before
exposing production Bake controls. The background workflow is now connected as
described below; Consolidate integration remains separate.

The advanced opt-in `prepareReviewedBackgroundBake` shares this pipeline, but
requires player audience, the full Scene rectangle and identity shared Level
texture transforms. It composites the existing background plus approved ink,
not a transparent ink-only replacement. An existing background image is loaded
at its original resolution and its exact retained bytes are backed up alongside
the output and archive; all three paths require explicit persistence approval.
Color-only backgrounds require just the output and archive. The decoded
original resource is released after rendering while its immutable Blob remains
available for backup. Background GPU acceptance shares the full-resolution
isolated texture-upload adapter; it is not a visual-fidelity certification.

Developer-only entry points in `scripts/layers/bake_entry.js` are
`promptReviewedBackgroundBake`, `promptResumeBackgroundBake`,
`promptRestoreBackgroundBake` and `promptTakeOverBackgroundBake`. Preparation
requires explicit `audience: 'player'`, a scope (`kind` and, for Layer, `layerId`),
the displayed `levelId` and an existing recovery folder (or the configured one).
Selection uses the real native controlled Drawings by default. Do not supply
Tile `sort`/`replacementId` or custom `bounds`. Standard localized review dialogs
disclose replacement of the existing background and the below-Tile stack change.
Apply, resume and takeover keep the designated-active-GM authority rule and the
same-client review lease shared with Tile commands.

Restore verifies that the original background URL still contains the archived
bytes before intent creation and again before reverting the background. If the
file was moved/deleted/changed, recover that original file from the retained
immutable backup first; the workflow refuses to silently restore changed pixels
or overwrite unrelated files. External originals require explicit
`acknowledgeExternal: true` again during recovery. Color-only backgrounds have
no URL to verify. Restore does not require GPU display acceptance to recover
originals. Mocked integration and GPU tests pass. Live color-only and
existing-image background Bake/Restore acceptance also passed on disposable
Scenes with exact source/settings recovery, backup bytes and sampled player
presentation verified. These functions are not registered as production controls.

Foundry v14 redraws the displayed canvas when a Level background changes.
The executor now waits for its own background-update redraw before further
native work, retaining authority, journal and native-state checks and a bounded
timeout. Execution review accepts only the expected empty or unchanged
controlled-selection set from that redraw; unexpected selections or unrelated
changes still refuse. The first live color-only run recovered through fresh
resume and exactly restored sources/settings; three player patches matched
native restored artwork after render-flag flushing. Follow-up deployed tests
completed both color-only and existing-image apply/Restore uninterrupted through
the owned redraw, using every standard approval dialog. Original-image backup
bytes matched exactly; five player framebuffer patches matched restored native
artwork with zero differences after making the player tab visible, without
manual render-flag flushing. Hidden-tab automatic refresh timing and broader
artwork/hardware fidelity are not certified by these samples.

### Reviewed Consolidate (developer-only)

`prepareReviewedConsolidation` in `scripts/layers/bake_workflow.js` shares the
bounded transparent renderer, verified recovery storage and resumable executor
with Bake, but creates a neutral full-image rectangle Drawing using the existing
image-stamp renderer. It preserves one leaf-layer membership (or Unassigned),
source elevation, native stack position and layer player visibility. The
composite remains unlocked for Drawing editing; individual strokes require
Restore originals. This does not bake artwork into the background or a Tile.

Opt-in commands in `scripts/layers/bake_entry.js`:

- `promptReviewedConsolidation`
- `promptResumeConsolidation`
- `promptRestoreConsolidation`
- `promptTakeOverConsolidation`

Supply an explicit audience, displayed Level, existing recovery folder and
`kind: 'selection'` or `kind: 'layer'` with one leaf `layerId`. Selection uses
native controlled Drawings by default. Preparation also requires a unique
replacement Drawing ID; the public command generates it when omitted. Bounds
come from the complete rendered extent; custom bounds/sorts, All and groups
refuse. All admitted sources must occupy one contiguous native Drawing run,
with one membership/elevation and unambiguous integer sorts. Hidden/locked/
unsupported sources are listed as exclusions; exclusions cannot be silently
accepted, and an intervening source remains a stack barrier. Existing layer
order needing repair refuses rather than rewriting unrelated sorts.

The same six separate approvals cover scope, resolution, Drawing placement,
preview, immutable archive/output persistence and native execution. Standard
dialogs distinguish retained Drawing placement from Bake's ground-stack change.
Partial apply/Restore, disconnected-owner takeover and stale-context refusal
reuse the durable engine. Edited/deleted/reassigned composites refuse automatic
Restore instead of overwriting newer work. Later independent artwork is preserved.

Repeat Consolidate and Bake from one tracked composite automatically retain its
immutable original-stroke archive lineage. Multiple existing composites require
Restore before combining, rather than losing an ancestor. Drawing ancestor
archives and outputs are reverified before preparation and native transitions;
missing/corrupt ancestors refuse. After restoring a newer composite or Tile,
`promptRestoreConsolidation` may explicitly expand the earlier completed
Drawing apply, provided its exact composite is present, all journal operations
are complete and it has no existing restore intent. Keep every ancestor file
and the Scene journal. Restore proceeds one reviewed generation at a time.

Targeted mocked integration, lineage, partial recovery and GPU tests pass.
Live public-selection Consolidate and Restore also completed uninterrupted on
a disposable Scene, preserving membership, non-ground elevation, native sort,
exact original sources/settings and later artwork. Four GM/player framebuffer
patches, including translucent overlap, matched original/composite/restored
artwork with zero differing bytes after native refresh. This is sample evidence,
not full-frame or diverse-artwork certification. Live private leaf-layer
Consolidate retained GM-only presentation; enabling then disabling the existing
player-presentation gate revealed then concealed the composite on Aroh's visible
client. A separate unchanged-context private-layer Restore recovered exact
archived originals, preserved later artwork and kept restored artwork concealed.

Full-Scene GM framebuffer testing also exercised eight Drawings: translucent
overlaps, rotated ellipse/smoothed polygon, open smoothed path, rotated multiline
text, repeated material fill and a rotated image stamp. Consolidate completed
all six standard approvals with an uncropped 537 x 333 PNG, retaining elevation
5, layer and lower native sort. Integer 100% rendering differed in 7,131 of
256,000 Scene pixels (maximum channel delta 51); fractional placement and
125%/150% zoom introduced more sampling differences. These are measurements,
not an approved numeric tolerance or pixel-equivalence pass. Restore completed
all four standard approvals, recovered exact baseline/verified-archive sources
and returned zero differing framebuffer pixels at all four views. The fixture
was removed, recovery files retained and the complete original Scene unchanged.
This run did not test player vision, Tile shaders/occlusion or physical hardware.

Desktop keyboard checks of all eight shared review types passed acknowledgement
and approval using Shift+Tab, Space, Tab, Enter; Escape explicitly cancelled each.
The required acknowledgement starts unchecked. Enter on the initially focused
approval button without acknowledgement cancels rather than approving.
Forward Tab from that button became stuck on the window-controls button in this
session, reproduced in a plain native DialogV2 prompt as well. Full tab-cycle
acceptance therefore remains limited; no host focus handling was patched.
These were read-only dialog checks, not keyboard-driven optimization writes.
Physical tablet/screen-reader acceptance remains untested.

Restore permits a newer layer revision only when every other archived layer-tree
value matches exactly. This covers changing presentation and switching it back;
an actual gate, hierarchy, lock, order, preset or default change still refuses.
Restore intent and native execution dialogs disclose both revisions and retain
the current tree/revision. Exact current-context guards still invalidate approval
on any further change, including revision-only changes during review/execution.
Apply/preparation remain strict; lower revisions refuse. Never reset revisions
or edit immutable archives to bypass recovery checks. This owner-approved policy
passes targeted tests and deployed live hide/show/hide followed by Restore:
exact originals/settings/later artwork returned, revision 2 remained intact and
Aroh's restored artwork remained concealed. Both review disclosures and retained
Drawing elevation labeling were verified in the deployed dialogs.

Live Consolidate -> repeat Consolidate -> Tile Bake also completed uninterrupted
with all standard approvals. Successive reviewed Restore recovered each exact
preceding composite, then the original strokes, preserving later artwork and
Level settings. All ancestor archives were independently reread and matched the
retained journal chain. This verifies recovery lineage, not full-frame or
diverse-artwork visual fidelity; those broader checks remain.
No production controls are registered.

Native Tile display acceptance now has a concrete default adapter. It verifies
the exact file bytes and decode dimensions, checks the live renderer's actual
texture axis, then uploads the full-resolution bitmap and samples it into a
one-pixel target using an owned PIXI renderer. GPU errors, context loss and
incomplete readback refuse; texture/renderer/bitmap resources are released.
The live renderer's GL state is never borrowed. Read-only native v14 testing
accepted 8000 x 6000 (~778 ms for the acceptance check) and explicitly refused
20000 x 1000 against the observed 16384px native texture axis. Long-axis encoding
and export still work; a single native Tile cannot display that output on this
GPU. This is upload/sampling capability evidence, not full native Tile shader,
occlusion, color-management or pixel-fidelity certification, nor an allocation
guarantee for another player client. No image is resized and no Scene is changed.

Opt-in localized Bake review dialogs are now available through
`createBakeReviewDialogs`. They supply scope, resolution/crop, ground placement,
encoded preview, exact durable paths and native execution approvals. Each dialog
requires an initially unchecked acknowledgement; close/decline produces an
explicit cancellation error. Source IDs, exclusions and paths are rendered as
text, not HTML. Preview decodes the actual output Blob at exact natural dimensions,
scales only its on-screen presentation and revokes its temporary URL on every exit.
Pass its scope/render/placement/preview callbacks to `prepareReviewedTileBake`,
then explicitly call `persistAssets(await dialogs.approvePersistence(workflow.review))`
and `apply({approveExecution: dialogs.approveExecution})` at separate user actions.
Encoded-preview approval remains read-only and rechecks the source snapshot.
These are dialog adapters, not registered commands or automatic persistence.
No storage settings, GM relay or production toolbar entry point was added.

Bake recovery storage now has a world setting, **Bake recovery storage folder**,
with Foundry's native folder picker and an empty default. Choose an existing
shared data folder created manually; module/system directories and private
FilePicker folders refuse. The Tile workflow can use this configured folder
when `root` is omitted, or an explicitly reviewed folder. Before scope/render
work it checks the designated GM, browse/upload permissions and the exact
returned folder listing; it repeats availability checks before persistence.
Configured-folder changes invalidate the pending workflow rather than redirect
its uploads. Existing journals retain their original paths: changing the setting
does not move/delete recovery files, and reload recovery uses those stored paths.
No folders, probe files or settings are created automatically. Successful browse
and permissions are preflight evidence, not a guarantee of server write access;
actual uploads still require exact returned paths and verified byte readback.
The setting does not enable production Bake commands.

An opt-in GM entry function, `promptReviewedTileBake`, now connects the six
dialogs to the Tile workflow in order: scope, resolution, placement, actual
encoded preview, durable files and final native apply. It captures the displayed
Scene/Level and operating designated GM, generates fresh native/operation IDs
when omitted, and excludes overlapping review lifetimes on that client. The
caller still supplies explicit audience, scope/layer and integer Tile sort;
storage uses the configured recovery folder unless explicitly provided.
Scope/render/placement callbacks cannot replace the command's mandatory
dialog approvals. Cancellation before persistence returns `status: "cancelled"`
with no recovery record; cancellation after persistence returns the exact
retained journal descriptor and warns that recovery evidence was not rolled
back. Unexpected errors propagate, including partially successful native writes;
they are never reported as cancellation or completion. Completion is reported
only after the executor verifies the persisted complete phase. This function
is not registered on the toolbar or automatically invoked; real DialogV2 layout,
authority coordination and authorized live apply/restore acceptance remain gates.

The opt-in entry now opens a localized Tile Bake options dialog when audience
or Tile sort has not been supplied. Layer is the default scope, with the active
leaf preselected when available; Selection and All remain explicit alternatives.
Audience and integer native Tile sort must be chosen, not inferred. Encoding
supports WEBP/PNG, quality, automatic enclosing bounds or custom integer-origin/
positive-integer-size crops. External texture contact requires an unchecked
opt-in. No preview budgets or arbitrary image-size caps are imposed. Options
capture artwork, Level/grid, workspace, journal and selected identities while
the dialog is open; changed context refuses rather than becoming a fresh baseline.
Choosing options does not write files, settings or native documents and does not
replace the six later exact reviews. The entry remains unregistered pending real
UI/multi-client acceptance and authority coordination.

The opt-in `promptResumeTileBake` entry now resumes the final unfinished Tile
apply/restore intent after reload using only its verified stored archive/output
and retained paths. It reconstructs an actual image preview, placement acceptance
and exact-source execution review; it never re-renders or uploads missing bytes.
All native/workspace/journal state remains exact across asynchronous reads and
dialogs, then switches to the existing phase-aware execution guard for owned
mutations. Changed folder settings do not redirect recovery. New artwork already
present at fresh review is retained; changes during that review refuse. Apply
rechecks full-image GPU display acceptance before each native step. Restore
still requires byte/decode/schema/placement evidence, but does not allocate the
Tile texture it is removing. Completed operations need a separately created
restore intent; this entry does not create one. Missing assets need exact-byte
recovery first. Cancellation preserves and reports the journal; unexpected or
partial native errors propagate. New Bake/resume dialogs share one same-client
review lease. Neither entry is registered as a production command yet.

The planned optimization workflow has two reversible options: **Consolidate**
keeps finished artwork as fewer Drawings within Foundryshop layers; **Bake to
Tile** exports transparent WEBP as locked native ground artwork above the
existing Level background, with fresh Drawings above it. Bake can also work
directly from original strokes. Both retain original-stroke recovery; baking a
consolidation also retains its previous representation for Undo Bake. Tile
placement and typed recovery foundations exist; production bake/recovery controls
remain disabled.
Direct **Bake into background** now has an opt-in reviewed workflow: combine chosen ground-map ink
with the displayed Level background into a new Foundryshopped image, retaining
a verified original image copy, native background settings and stroke recovery.
Source backgrounds need not be WEBP; initial assured bake inputs are static
PNG/JPEG/WEBP, with other Foundry media explicitly checked or refused before any
change. Video/animated backgrounds remain untouched and can use a transparent
Tile overlay instead. WEBP is the preferred derived format, not a requirement
on originals; PNG output is a planned lossless alternative.

Planned Bake must preserve full resolution up to the running Foundry client's
actual image capabilities, including large/long-axis maps; resource management
belongs to the operator. Memory estimates are advisory, not arbitrary module
size caps. Browser/GPU/encoding and server constraints still need explicit
capability checks and failure reporting; downscaling needs explicit approval.
The current publication renderer's limits remain in place, but Bake must not
inherit them: full 8000 x 6000 output is a required acceptance case.

Planned Bake scopes are **Layer (default)**, **Selected Drawings**, and **All
eligible Drawings on the displayed Level**, with explicit inclusion/exclusion
and flattening review. Selected or Unassigned strokes need not be moved to a
layer first. After asset and recovery readback verification, Bake removes only
the reviewed source Drawings from the live collection to reduce document count.
Exact sources and membership stay in durable internal recovery files, not
disposable temp files or hidden live Drawings. Recovery survives reloads and
preserves newer strokes; no production bake/removal command is enabled yet.

## Installation

Until a public release exists, build and deploy locally (below). Releases will
be published at <https://github.com/Xombit/foundryshop>.

## Local development and testing (Windows)

These dependency-free PowerShell scripts build, package, and deploy the module.
Node.js must be available on PATH for JavaScript syntax checks; no npm install
is required. Run these commands from the repository root:

```powershell
# Validate syntax and stage the runtime files with a resolved local manifest.
.\tools\build.ps1 -Version 0.1.0

# Build and create packages\foundryshop-0.1.0.zip.
.\tools\pack.ps1 -Version 0.1.0

# Preview deployment without building or changing the Foundry installation.
.\tools\deploy.ps1 -FoundryModulesPath 'E:\your-foundry-data\Data\modules' -WhatIf

# Deploy (asks for confirmation); Foundry can remain running for client-code updates.
.\tools\deploy.ps1 -FoundryModulesPath 'E:\your-foundry-data\Data\modules'
```

Build output is in `dist\foundryshop`. Source files are unchanged by the build.
Local packages omit manifest/download endpoints so they do not advertise
automatic updates.

Deployment requires an explicit existing `modules` directory. It moves the
previous installation into `module-backups` beside the `modules` directory
before copying the clean build, so old runtime files cannot linger. Foundry can
remain running for changes to existing client-side JavaScript, CSS, and
templates. Do not reload or interact with the module during deployment. After
deployment completes, fully reload each browser client.

Manifest changes (version, entry points, styles, dependencies, compatibility)
or server-loaded resource changes may require a world relaunch or server
restart. A first install of Foundryshop requires enabling it in
**Manage Modules**. The script does not back up worlds; back up your test world
separately.

To roll back, stop Foundry, move the test installation out of the active
`modules` directory, and move the saved module folder back as `foundryshop`.

The ZIP contains the manifest at its root. Extract it into the module's own
`foundryshop` directory, not directly into `Data\modules`.

Run the automated regression tests with `npm test` (no dependency installation
required). Before normal use, test in a disposable world on your exact Foundry
build: toolbox and panel opening, each drawing property on new drawings,
native-palette synchronization, labels, saved colors for a GM and a player,
the eyedropper at several zoom levels, and persistence after reload.

The recovery ZIP foundation includes a checked-in browser copy of MIT-licensed
fflate 0.8.3 and its license in `scripts/vendor`. Builds/tests use that local copy,
not a CDN or runtime npm resolution. To regenerate it after a deliberate pinned
dependency update, run `npm ci --ignore-scripts` followed by `npm run sync-vendor`.
The normal build copies the runtime module and license with the rest of `scripts`.

- [Quick Drawing Settings](#quick-drawing-settings)
- [Stroke and Fill Settings](#stroke-and-fill-settings)
- [Color Selector](#color-selector)
- [Saved Colors](#saved-colors)
- [Keyboard Shortcut](#keyboard-shortcut)
- [Settings](#settings)

## Quick Drawing Settings

The drawing toolbar and **Ctrl+D** open the **Brush & Selection** tab in the
Drawing Toolbox. The former Quick Draw Config launcher no longer opens a second
main panel. Stroke/fill chips open the existing color selector as a child popup;
its detailed brush and saved-color sections are hidden because those controls now
live in the toolbox. Eyedropper and color-picker behavior remain available.

## Paired Line / Interior swatches

Palettes can mix ordinary colors with named paired appearances. Single colors
still change only the active target; a split swatch applies both colors and its
None, Solid or Pattern interior mode. Pattern pairs also retain a local material
and repeat width. Line width and both opacities are not stored in the pair.

Use the split-circle button to create a pair, or right-click a color to start
from it. **Manage palette entries** exposes editing, duplication and removal
without requiring right-click. The editor includes shipped materials, local-file
browsing and an outlined preview using the current width/opacities. Repeat width
has native number arrows, wheel adjustment and touch-friendly minus/plus buttons.
Compact Pattern swatches show tinted material samples at full opacity.

Saving changes the shared palette only. Applying first verifies the material,
then activates a **transient appearance override** for future native drawing.
It wins over saved layer appearance fields without changing layer defaults or
the persistent brush settings. Normal layer width/opacity behavior is preserved.
The named override remains visible; manual appearance changes mark it modified.
**Return to layer defaults**, changing Scene/Level/active layer or reloading
clears it. Solid/None clear effective textures and stale repeat flags.

Pairs do not automatically edit selected artwork, labels or authored prefabs,
copies or image stamps. Saving/canceling the editor does not activate the pair.
Missing materials and stale palette/brush/context changes are reported rather
than partially applying an appearance.

## Unified Drawing Toolbox

The GM-only toolbox opens in drawing mode and remembers its local position,
collapsed state and selected tab. Drawing modes plus stroke/fill, width,
both opacity sliders and up to five recent colors remain accessible when collapsed.
The **8button** layout keeps the default tablet toolbox eight 44px tool buttons
wide (plus gaps and window padding). Stroke/fill icon chips, width and active-target
opacity share a compact second row. Stroke and fill opacity are stacked in two
22px lanes within the tablet row's 44px height, with matching icons, live percentages
and named accessible sliders. This intentionally trials smaller pen targets; the
row can be enlarged after hands-on testing. Five recent swatches, swap and fill/no-fill
occupy the next row. Tabs use Foundry's Font Awesome icons with named tooltips and
accessible labels, rather than visible titles. Expanded tab content
scrolls independently, with per-tab scroll retained across ordinary refreshes.

- **Brush & Selection:** hex colors, fill type, picker and
  selection text actions. Choose a local static PNG/JPEG/WEBP texture using the
  material picker beside the material path; it selects Pattern fill for new shapes.
  Fill color tints the material (white preserves its colors), and fill opacity
  controls transparency. Clear removes the texture and selects Solid fill.
  Files are bounded/decoded before selection; external URLs are refused by this
  picker. Brush changes affect new artwork, not selected Drawings. Native
  **Texture repeat width** sets one tile's width in grid squares (0.05-100);
  gridless Scenes use 100px per square. Image aspect ratio is preserved. New
  drawings store the resolved pixel size; changing the default never rescales
  existing artwork. Layer default capture includes this setting.
- **Layers:** existing hierarchy, membership, visibility, locks, defaults and
  ordering, embedded without changing the underlying services.
- **Presentation:** existing snapshot capture/apply/rename/replace/delete controls.
- **Palettes:** one selector for built-in and named shared palettes, with a compact
  wrapping row of swatches for only the selected palette. The trailing **+** adds
  a color; the header **+** creates and selects a new palette. **Manage** reveals
  rename, duplicate, delete/reset, import and per-color edit/reorder/remove controls.
  Applying a swatch changes the active brush target; editing its saved value does
  not. Colors can appear in different palettes but not twice in the same palette.
  **Copy my saved colors** and **Copy campaign colors** explicitly adopt old lists
  into a newly named shared palette without deleting or modifying the originals.
  Shared writes detect stale revisions and verify storage. Limits are 32 palettes,
  256 colors per palette and 2048 colors overall. Deletion requires confirmation.
  Saved-color editing currently uses a hex/name dialog; graphical palette-edit
  picker integration remains a follow-up.
- **Labels:** live text composer, personal/campaign saved labels and one-shot
  cursor placement. Fourteen styled examples are default saved entries.
- **Library:** JSON export/import/interrupted-import discard and a shared-folder
  project/shape browser with searchable preview cards, including two built-in
  example projects, plus 88 editable artwork prefabs without folder setup.
  **Save selected shape** writes a verified named/category/tagged shape package;
  **Save current project** writes a fresh project package with an optional thumbnail.
  **Manage saved files** exposes portable metadata editing, duplication and
  unfinished-replacement review, plus shared catalog removal/restoration without
  deleting files. **Copy selected shape** loads
  1 to 100 editable Drawings into a session stamp; **Import image** and **Paste
  image** load PNG/JPEG/WEBP artwork. Configure an existing data upload folder in
  Settings first. Set numeric scale/rotation and optional Repeat, then click the
  loaded-stamp preview; tap the canvas ghost to place it. Escape/cancel disarms it.
  Native Drawing clipboard operations are not intercepted; supported image pastes
  outside text inputs in drawing mode also load/arm an image stamp.
  Shape stamps preserve styles and relative layout, use the active visible unlocked
  layer and displayed Level, and use the existing verified import journal.
  Hidden/locked source artwork and mixed elevation/interface ordering are refused
  explicitly in this initial slice. Limits: 100 Drawings, 100,000 point coordinates,
  4 MiB shape data; images 16 MiB, 4096px per axis and 16 million pixels. Animation
  is unsupported. Uploaded assets are byte-verified and persist even if placement
  is cancelled; they are never automatically deleted. The loaded stamp is not
  restored after reload. File deletion and continuous spaced
  stamp-brush strokes remain later work.
- **Settings:** local density, automatic opening and Drawing edge-pan preferences,
  backed by the same registered module settings, plus an Intuos4 PTK-840 setup
  guide, current shortcut assignments and a focused key-test field.

### Wacom Intuos4 PTK-840: browser setup

No separate hotkey add-on is required. Foundryshop exposes two GM-only actions
in Foundry's **Configure Controls**, unassigned by default:

- **Draw: Freehand pencil** switches directly to Drawings/Freehand and preserves
  brush settings. Repeated presses keep Freehand selected; this is not a toggle.
- **Tokens: Select / Move** cancels armed Foundryshop label/stamp placement and
  selects the normal Token tool. Native token movement permissions still apply.

To set up your ExpressKeys:

1. Open **Settings -> Wacom Intuos4 PTK-840 -> Configure Controls**.
   Find the Foundryshop actions and assign two shortcuts. Check Foundry's conflict
   warnings; avoid browser/Windows-reserved combinations.
2. In **Wacom Tablet Properties**, add an application profile for the Chrome or
   Edge executable you use for Foundry. Assign the same keystrokes to two
   ExpressKeys and give them descriptive names.
3. Focus **Test tablet button** in Foundryshop Settings and press each ExpressKey.
   The readout shows received key, code and modifiers without executing Foundry
   actions or saving input. Tab leaves the field; Escape ends capture.
4. Leave the test field, finish any active canvas press/drag, and try each
   shortcut on the canvas. Shortcuts do not switch tools while typing in inputs
   or during a canvas gesture/pending placement write.

The Settings readout uses Foundry's actual keybindings, not a second assignment
store. Existing toolbox-toggle and armed-label-cancel shortcuts are also listed
as optional assignments. After updating the installed module, reload Foundry so
the new actions register.

Wacom profiles target the browser application, **not a particular website/tab**;
using a dedicated browser for Foundry can keep the assignments away from ordinary
browsing. Shortcuts intercepted by Windows or the browser may never reach the
test field and can still trigger outside Foundry. Foundryshop cannot program the
driver, identify a physical ExpressKey or configure tablet displays.

The guide targets the PTK-840; actual driver/browser/ExpressKey behavior still
requires testing on your hardware. Other model-specific layouts and Touch Ring
presets are deferred. **Pen-pressure thickness is an unimplemented future
possibility**, not part of this setup.

Layer toolbar launchers select the Layers tab, while the toolbox's top-row Layers
button toggles a quick-layer flyout at the opening click/pen-tap position. It flips sides
and clamps at viewport edges, retains that anchor without tracking later cursor
or toolbox movement, and never changes the
toolbox size merely by opening.
Keyboard opening anchors to the Layers button instead of synthetic cursor coordinates.
Its scrollable readout shows group folding, active-layer selection, Drawing counts,
separate GM-workspace and player-visibility eyes, and own/inherited lock status.
Player visibility is a live presentation gate, not GM workspace visibility.
The flyout has no drag/reorder/delete controls; **Open full Layers tab** provides
full management. It works while collapsed and closes on a second tap, outside tap,
Escape, tab selection or toolbox close. Its open state is not persisted.
Layer/group cards now have actual artwork thumbnails, lazily generated offscreen.
They include hidden content on the displayed Level (not a player-presentation
preview); groups include descendants. Alpha stays transparent in the WEBP, with
a white UI background for readability. The refresh button regenerates previews after fixing a resource.
Missing fonts/textures, unsupported geometry, mixed elevations/render groups and
oversized artwork show a warning with details instead of fake art. Preview limits
are 1,000 Drawings, 100,000 point coordinates, 4 MiB of snapshot data and 16 static
PNG/JPEG/WEBP textures (16 MiB each, 4096px per axis, 16 million pixels in total).
Smoothed geometry is limited to 250,000 estimated curve segments. No external
URLs are fetched automatically. Output is bounded to 32-512px; previews do not
create Scene Drawings or screenshot the live canvas. The shared renderer is the
foundation for JSON import previews, embedded export thumbnails and future library previews/export.
The JSON import review generates an optional full-artwork preview with selected
texture/font replacements and destination import ordering, without destination
artwork or Scene background. Closing the review cancels obsolete preview work.
Preview failures are shown explicitly but do not replace or bypass import
validation, resource preflight, dry run or player-hidden staging.
The default **Foundryshop Slate** theme uses Photoshop-inspired slate surfaces, flat
layer rows and subtle glass chrome. Select **Foundry** or **Game system** in the
Settings tab or module settings to inherit those themes instead. Game system opts
into the active system's CSS class (as Townie Maker does), with Foundry styling
where the system has no matching rules. The choice is per-client and does not
change the world's theme. Color chips retain their actual colors in all modes.
Settings also offers a client-local **50-125% toolbox scale** slider in 5% steps,
with **Mouse (50%)** and **Tablet (100%)** presets. It scales window chrome, text,
controls and the Layers flyout together while retaining the eight-button layout.
Density stays independent; 100% with tablet density preserves 44px pen targets.
The percentage updates while dragging and the scale applies on release. Child
dialogs and other Foundry windows are not scaled.
Saving a new color prefills an editable descriptive name, such as **Light
Blue-green**, **Muted Blue** or **Brown**, calculated locally from its RGB color.
These are approximate labels, not unique color identities. Existing names and
imported palettes are unchanged; you can replace the suggestion before saving.
The picker remains a child popup, not another toolbox. Tab navigation supports
keyboard arrows/Home/End; pen users
can tap each tab directly. An armed label remains visible with an explicit disarm
button while collapsed. Shared editing remains GM-only until the planned role
threshold and online-GM relay are validated. Personal palette/label data is retained,
even though non-GM toolbox access is currently disabled.

<img src="images/drawing_tools_panel_example.png" width=40%>

## Layers (initial implementation)

GMs can open the **Layers** toolbox tab from the Drawings toolbar or the toolbox's
layer button. Add named layers, click a name to make it active, and draw normally.
New local GM drawings receive the active layer's membership. Existing artwork is
left alone until you select drawings and use **Move selected drawings here**.
Undo/restored drawings and drawings with explicit membership retain their flags.

- The list runs top to bottom. Drag its grip to reorder, or use the arrow buttons
  with a pen or keyboard. Relative stroke order within each layer is preserved.
- **GM view** changes only your per-user, per-Scene workspace. **Players** controls
  persisted presentation for all players; new layers are player-hidden.
- Players have no layer panel or layer-selection controls, but the module must be
  enabled on their clients to apply the presentation.
- **Remember current brush** captures the current stroke/fill defaults. Selecting
  that layer restores them to the creation palette, and new drawings use them.
  Capture again to change the saved defaults, or **Forget brush defaults** to use
  the ordinary creation palette without layer overrides. Place Text preserves its
  explicit no-stroke/no-fill style while receiving layer membership.
- A hidden active layer blocks creation until you click its name to show it again.
- **Unassigned** drawings keep native visibility and sort. Drawings whose layer
  reference is unresolved are listed there for the GM and suppressed for players
  until assigned. Explicitly unassigning a drawing restores native visibility, so
  it may become visible to players.
- The Scene Background is informational, fixed, and never rewritten.

### Groups and safe reorganization

Use **Add Group** to create a top-level folder. Open its **Actions** to add a
layer or subgroup inside it. Click a group name to fold/unfold its descendants;
folding only affects your panel layout, not the canvas or player presentation.
Collapse preferences persist per GM/Scene. Group counts include descendant Drawings.
Selecting a layer unfolds and locally shows its ancestors.

- Drag above/below a row to reorder among its siblings. Drop in the middle of a
  group to nest a layer or an entire group subtree. Drop indicators show the target.
  Cyclic moves are rejected without changing IDs or membership.
- **Move to Group** provides the same reparenting without dragging; choose
  **Top Level** to move out of a group. Reparenting inherits the new ancestors'
  workspace and presentation gates.
- Workspace/player buttons show **visible**, **hidden**, or **mixed**, based on
  effective descendant states. Tooltips distinguish the node's own gate from
  suppression by an ancestor. Empty groups reflect their own effective gate.
- Clicking a group's visibility button toggles only its own gate. Hiding and
  showing it again restores each child's previous setting; a mixed group whose
  gate is on is hidden on the first click, then restored on the second.
- **Actions → Show All / Hide All** explicitly overwrite every setting in that
  subtree for the selected audience, including the group's own gate. They never
  enable an ancestor outside the subtree. **Show All to Players** asks for
  confirmation because it also enables individually withheld layers.
- **Remove Layer / Group** asks where to move the artwork and then confirms the
  operation. It removes the selected node and descendants, moving all Drawings
  to another layer or Unassigned, **without deleting any Drawing documents**.
  Removal refuses locked artwork/layers. It preserves stroke styles and native
  hidden/lock state; destination visibility may nevertheless reveal the artwork.

Removal transfers and verifies membership before dropping source metadata. If
the transfer fails, the source tree remains. If a later metadata write fails,
some artwork may already be in the destination; the error reports this rather
than claiming success. Refresh, inspect membership, and repair order before
retrying. These operations are not server transactions; avoid simultaneous GM
edits. Other GMs' stale local active/collapse references resolve through ordinary
fallback behavior rather than rewriting their personal settings.

### Player presentation presets

Configure the **Players** column, then choose **Save Current Presentation**.
Each named snapshot records every layer and group's own player gate, including
child settings currently suppressed by an ancestor. Preset names are unique
(case-insensitive); their stable IDs survive layer renames and reordering.

- Click a preset's name and confirm to replace the entire player presentation in
  one Scene update. Layers/groups added after capture become player-hidden.
- Presets never alter GM workspace visibility/folding, the active layer, brush
  defaults, selected artwork, or native Drawing hidden/locked fields.
- A checkmark means the saved target currently matches the live Players column;
  it is computed from actual gates, not a potentially stale "last applied" label.
- The camera button explicitly replaces the snapshot with the current Players
  column, after confirmation. Rename changes only the name; Delete removes only
  the preset, after confirmation.
- Removing nodes referenced by a preset warns first, preserves the snapshot, and
  marks it incomplete with Apply disabled. Review the live Players column and
  replace that snapshot (or delete it) to resolve missing references. No silent
  reference deletion or automatic repair occurs.

Presets are shared Scene state, not per-GM preferences. Players receive the
resulting presentation without preset controls. Reconnect behavior still requires
live v14 validation, and simultaneous GM writes are not server-atomic.

### Layer and group locking

Choose **Actions → Lock Layer / Group** to protect member artwork from accidental
editing. Group locks apply to all descendants without changing their own lock
settings. The lock icon reflects effective protection; unlock the ancestor to
remove inherited protection. A child can also have its own lock, which remains
after the group is unlocked.

- Locked members are released from canvas selection. Native Drawing pre-update/
  pre-delete hooks reject edits, movement, text/style changes, deletion, and
  reassignment. The toolbox's selected-label controls also respect inherited locks
  and recheck them after dialogs.
- Creation into an explicitly locked layer is rejected, including paste/undo with
  supplied membership. Ordinary GM creation uses the first available unlocked
  layer if the remembered active layer is locked; if none is available, it is
  rejected. Click an unlocked layer to choose a different active destination.
- Assignment into/out of a locked subtree and removal of locked nodes are refused.
  Canvas protection does not hide artwork or change player presentation.
- Layer/group reordering and reparenting, visibility controls, presets, and saved
  brush defaults remain adjustable. Sort-only Foundryshop maintenance is allowed.
  Reparenting can change inherited protection.
- Native Drawing `locked` fields are **never written** by these controls. Unlocking
  a layer cannot clear a native lock set elsewhere. These are independent
  accidental-edit guards, not server permissions: scripts using hook suppression
  or direct server operations are outside this protection.

Lock state is shared Scene state; workspace preferences are unchanged. The existing
per-client serialization/stale-revision limits also apply to lock changes.

### Built-in starter artwork and palettes

The **Palettes** tab starts with **Fantasy Mapping**, an original 20-color palette
of parchment, timber, stone, foliage, water and earth colors. Grayscale and Bright
Markers remain selectable alternatives. The selection is client-local and
persists with toolbox state. All palettes use the same selector and are directly
editable by GMs. Built-in edits are stored as verified shared overrides; **Manage**
offers a confirmed **Reset palette to defaults** that restores that palette's
shipped name/colors without touching other palettes. Merely viewing defaults
does not write settings. Creating or duplicating a palette automatically selects
it, ready for adding colors using the trailing **+** swatch.
Existing shared/personal colors and brush defaults are not overwritten.
Picking a swatch changes the current brush target, not already placed prefabs.

**Brush & Selection** also includes 15 original seamless texture materials:
rough stone, flagstones, brickwork, cobblestones, timber planks, wood grain,
packed earth, sand, gravel, grass, forest floor, water ripples, snow, ice and
parchment grain. Open **Choose texture material** to browse a compact three-column
thumbnail grid, search names/categories, or use the folder button to choose an
existing local file. Picking a card verifies/decodes its image before changing
future Pattern defaults; the selected built-in's thumbnail/name remains visible
when the picker is collapsed. Previews show untinted source artwork, and failures
are explicit. Viewing or filtering the picker does not change brush defaults.

The shipped PNGs are deterministic 256px grayscale patterns (about 280 KiB total),
with no external asset downloads or third-party artwork. Tint them using Fantasy
Mapping colors, or use white to retain their original tones. Source images live
in `assets/materials`; regenerate them with `node tools\generate-materials.mjs`.
The build includes the asset directory. Current native repetition uses image
pixels for old unannotated patterns; new drawings use the repeat-width control
(one grid square by default). Saved textured stamps carrying repeat metadata
scale that texture with their geometry, preserving the saved proportions.
Ordinary native resize keeps the stored repeat size, revealing more/fewer tiles.
Fitted image stamps remain independent of material repetition. No terrain
painting, edge blending or PBR lighting is implied.

To change existing artwork, select one or more Drawings and use **Apply fill to
selected artwork** in **Brush & Selection**, then confirm. This replaces only
fill type, texture, tint, opacity and repeat width. Solid/None clears material
texture and repeat metadata. Geometry, strokes, labels, layer membership and
provenance are preserved; brush defaults are not changed.
All selected Drawings must be editable and unlocked (including their layers).
Fitted image stamps and pending imports are refused, not silently skipped.
The selection, Scene/Level, grid, defaults and artwork are rechecked after
confirmation and bounded texture verification. Saved values are verified after
the native batch update. If a server write fails or is incomplete, an explicit
error warns that some artwork may have changed; inspect it before retrying.
The operation does not automatically roll back over potentially concurrent edits.

The **Library** tab includes two complete example projects in the same browser
as saved projects, marked **Built-in** and available without a library folder:

- **The Wayfarer's Rest:** woodland tavern, flagstone floor, planked tables,
  supplies and styled room labels.
- **Whispering Woods Ruins:** forest shrine, brick dais, stone columns, pond and
  landscape labels.

Each includes a nested map group, Ground/Structure/Features/Labels/Notes layers,
and full **Map overview**, **Terrain only**, and **All details (includes notes)**
presentation snapshots. Notes start presentation-hidden, not confidential.
Thumbnails preview all artwork, including notes.

Click a project preview to open the existing resource checks, pixel-offset controls,
empty/additive choice, preview and confirmation. Nothing is created by browsing
or canceling review. Imports get fresh IDs and start inside a player-hidden
wrapper; choose the imported presentation preset explicitly to present them.
Examples use Scene-pixel coordinates (not automatic grid rescaling) and do not
change the Scene background, grid, Walls or lighting. **Download JSON** saves
the editable package without touching the Scene. Texture files reference this
module's shipped assets, not embedded image bytes.

The **Library** tab includes 88 original, editable starter artwork shapes. Filter by
category and search by name or tag together; a live count shows matching results.

| Category | Count | Examples |
|---|---:|---|
| Trees & vegetation | 11 | Six tree silhouettes, shrubs, stump, fallen log, reeds, mushrooms |
| Rooms & structure | 10 | Rectangular/circular/L-shaped rooms, flagstone room, corridor, doors/gates, stairs, ladder |
| Furniture | 11 | Tables including planked timber, chair, bench, bed/bedroll, shelf, desk, throne, rug |
| Storage & supplies | 11 | Chest, crates, barrels, sacks, handcart, weapon rack, urn, hay |
| Dungeon features | 15 | Columns including rough stone, brick dais, altar, well, sarcophagus, statue, pit, rubble, grate, ritual circle, forge |
| Natural terrain | 13 | Rocks, ponds/pools, textured forest floor/sand/water/ice, stepping stones, cave mouth, mud, crystals |
| Camp & settlement | 9 | Firepits, tents, wagon, fence, bridge, market stall, hitching post |
| Map symbols | 8 | North/route/entrance arrows, marker base, encounter/hazard/secret/treasure marks |

The 14 styled starter labels are default saved entries in **Labels**, not a
duplicate Library collection.

Actual-artwork thumbnails are
rendered lazily on white. No library folder, upload, external texture or font
download is needed.

Eight textured examples use the shipped materials and saved repeat widths.
Search **textured** to find them. They remain editable native Drawings, not
flattened images; scaling a prefab scales its texture with the geometry.
Original solid-fill examples remain available unchanged.

Click a prefab preview to load the full shape into the existing stamp ghost, using the
active layer/displayed Level and the scale, rotation and Repeat controls above.
Footprints use Scene grid size, or 100 pixels per nominal square on gridless
Scenes. Rearming preserves that loaded pixel size. Escape/cancel removes the
ghost without creating artwork. Successful placement produces independent native
Drawings with fresh IDs and current author; all components remain editable.
While the ghost is armed over the canvas, **Shift + wheel** rotates by 15 degrees,
and **Ctrl + wheel** scales up/down by a
factor of 1.1, within 5%-2000%. Wheel-up rotates clockwise/enlarges; ordinary
wheel input and Alt combinations remain available to Foundry. Use the numeric
rotation control for finer adjustments. Changing the ghost also updates the numeric
controls and retains the transform for repeat placement/rearming.
Each prefab reserves sort values as a batch. Exhausted gaps automatically
re-space the native Drawing stack without changing existing relative visual
order, including Unassigned artwork. Sort-only maintenance is journaled and
verified; a failed placement restores prior sorts, or retains the recovery
journal rather than overwriting artwork changed by another GM.
Visual door, stairs and fire symbols do not create functional doors, Walls,
lights or collision. Saved prefab styles are independent of the brush palette.

The initial shape wrapper is version-1 `foundryshop-editable-shape`: stable ID,
name/category/tags, nominal footprint and a validated project geometry payload.
This first delivery ships deterministic built-in definitions with local
coordinates, no layer/preset membership and visible unlocked components. Custom
shape-file saving/browsing and example projects remain follow-up milestones.
The original 64-item target is a baseline, not a cap: additional prefabs should
offer useful distinct objects, not just recolors. There is no sepia artwork variant.

### JSON project sharing

The Layers panel now provides **Export Project JSON** and **Import Project JSON**.
Export saves artwork from the active scene Level by default, with an explicit
**Full project: all Levels** option. Within that Level scope, choose the full
Drawing project, a layer/group subtree, or selected Drawings, including player-hidden artwork, hierarchy,
locks/defaults, presets, native Drawing geometry/styles/text/transforms, and module
flags. It includes ordinary Unassigned artwork, but refuses unresolved membership
or incomplete preset references. Author IDs, GM workspace/selection, and unrelated
Scene content are excluded. This is **not** a Foundry Scene backup or player-view
export; review the exported metadata before sharing it.

Choose **JSON export scope** in the export dialog. A subtree package includes the
chosen node and its descendants, plus their ancestor chain (without siblings or
ancestor-layer artwork), preserving names, locks, defaults and presentation gates.
Presets retain only included-node entries; missing entries still mean hidden.
Scene-pixel coordinates are unchanged, and resource inventory/optional thumbnails
cover only packaged content. Ordinary Unassigned artwork is included in a full
project or when explicitly selected.
Packages declare `scope: "full"` or `scope: "subtree"` and use the same validated
version-1 format and import workflow. Unsupported outside artwork does not block
a valid subtree; unsupported included data still does. Recovery-bearing exchange
remains refused until portable recovery/output-chain preservation is implemented.

The owner-approved recovery exchange target is a self-contained ZIP preserving
the baked form and full Restore chain. Baked Level backgrounds will require an
empty destination project and separate explicit background replacement approval.
The first foundation, `scripts/layers/recovery_file_bundle.js`, transports verified
immutable archives, output images, ancestor files and original-background byte
copies with a versioned manifest. It uses stored ZIP32 entries, hashes, strict
inventories and caller-specified byte/entry budgets; source collection refuses
unfinished operations and changes during reads. On its own it does not bundle the
project or ordinary texture resources, remap destination recovery, write files,
create documents or enable portable Restore. Ordinary recovery-bearing exchange
remains blocked; a recovery-files ZIP alone is not a portable project or backup.

The second foundation, `scripts/layers/recovery_project_manifest.js`, captures
one Level's live Drawing project, native authors, tracked baked Tiles and complete
chronological optimization history. Read-only validation rewinds Apply/Restore
operations against verified archives, so earlier composites need not remain live.
Edited/missing roots, occupied original identities, altered restored strokes,
unsupported Scene/Level/layer changes and untracked supplied Tiles refuse.
Later independent Drawings remain part of the project. Texture/font inventory
includes every archived generation, not just live artwork; preserved output and
background bytes are identified separately from missing ordinary texture bytes.
This manifest alone is not an enclosing project ZIP or destination importer. Source IDs and
authors are internal remapping inputs, not destination identity guarantees.

The third foundation, `scripts/layers/recovery_project_bundle.js`, now assembles
an enclosing version-1 `foundryshop-recovery-project-bundle` ZIP. Its inline source
manifest, immutable recovery evidence and ordinary image bytes share one strict
stored-ZIP32 container, with content-addressed byte deduplication and exact source
aliases. Collection includes textures used only by archived originals, checks
static image containers and native bitmap decoding, closes owned bitmaps, and
guards the complete source Scene. Byte limits apply to retained inputs, cumulative
streamed resources and final ZIP overhead; callers must supply explicit budgets.
External/invalid ordinary image paths refuse before any ordinary texture fetch;
verified original-background copies are reused without contacting their original
paths. Fonts remain explicit destination requirements; neither fonts nor module
packages are embedded.

Decode verifies exact image inventories, hashes/dimensions, recovery evidence and
full Apply/Restore history without native writes. Pure decode does not prove
browser/GPU/font fidelity. This is an internal read-only foundation, not yet a
download control, destination importer or portable Restore workflow.
Public recovery-bearing exchange remains blocked. Deployed collection, actual ZIP
disk download and native destination Restore acceptance remain unverified.

The fourth foundation, `scripts/layers/recovery_project_remap.js`, is a pure
destination-bound evidence planner. It allocates fresh node, preset, Drawing,
Tile and operation identities across every generation, moves verified images
to fresh planned paths, and rebuilds all archive checksums, parent references
and chronological journal digests. Native Drawing authors/operation owners map
to the importing GM; source authors remain separate provenance. It validates
the rebuilt history and enclosing ZIP before returning planned upload bytes,
without uploading them or creating native documents.

The owner-selected policy binds recovery to the destination Scene dimensions,
padding and grid while keeping artwork coordinates, numeric elevations and native
sorts unchanged; no coordinate scaling or elevation-to-ground conversion occurs.
For Drawing/Tile-only history, destination Level settings stay intact. Background
history carries the source background and texture-transform states but retains
unrelated destination Level settings; preserved original background aliases use
fresh bytes without contacting their original URLs. Changed Scene dimensions/native
background fitting are not a promise of pixel-identical presentation.

This planner does not yet merge an existing destination tree, install hidden
presentation/staging, resolve additive sort placement, validate native schemas,
authorize background replacement or persist import intent. Its reserved-ID/path
inputs must come from the later guarded importer; they are not a disk collision
check. The empty-destination/background-approval rule and native successive Restore
acceptance remain import gates. Public recovery exchange stays blocked.

The fifth foundation, `scripts/layers/recovery_import_preparation.js`, prepares an
empty destination Drawing/Tile project under explicit active-GM, file-permission,
Scene-snapshot and abort guards. Existing recovery/import journals refuse;
retained empty-project metadata requires explicit replacement consent. Additive
recovery import is not supported in this first preparation slice.

Preparation rebuilds every archive against the same hidden Drawing wrapper and
fresh Imported Presentation preset. Archived Unassigned originals get the same
Imported Unassigned leaf as live artwork, so later Restore does not bypass the
wrapper. Detached strict native checks cover all originals/replacement generations,
live documents and temporary hidden Drawing/Tile staging; normalization refuses.
Every live and reverse-history Drawing stack must satisfy existing order rules
without rewriting sorts. Required archived fonts and Drawing/Tile metadata modules
must be available.

Native Tiles and Level backgrounds do **not** obey the Drawing wrapper. The owner
chose separate native visibility approval instead of excluding those histories:
preparation lists that required approval and background replacement approval,
but does not consume either. Tiles stage hidden before any eventual approved
native visibility release. Source presentation gates remain beneath the closed
wrapper; original presets and a new presentation preset retain reveal intent.
This is still detached planning, not a durable importer. No uploads, file collision
checks, journal writes, approvals or native Scene changes occur. Deployed strict
native validation, durable owned compensation and native Restore remain pending.

The sixth foundation, `scripts/layers/recovery_import_intent.js`, binds explicit
approval to a genuine unchanged prepared plan, its exact image/ZIP bytes and all
required native visibility/metadata decisions. Approval rechecks authority,
destination snapshot and historical fonts/modules. The reviewed upload budget
includes both planned files and a retained evidence ZIP; this ZIP is only a
planned immutable file until the later uploader verifies it.

The internal intent writer uses the Scene operation queue and persists a
version-4 `projectImportJournal` before any uploads. It retains the exact upload
references, evidence-ZIP descriptor, destination baseline, wrapped tree/Level
targets, staged/final native digests and rebuilt optimization history. Exact
readback and unchanged unrelated Scene state are required. Unknown write results
explicitly refuse continuation and consume that approval: the retained intent
must be re-read/reconciled, not automatically retried or removed.

Ordinary Drawing-only discard explicitly refuses this journal format. Existing
staging hooks do not mistake it for an ordinary JSON-import ownership record.
No public approval UI, native executor, compensation or reload
reconciler is wired yet. If intent exists but its evidence ZIP has not been
uploaded, it is not a complete recovery bundle; no native import has occurred.
Tests verify mocked journal writes only, not deployed persistence. Public recovery
exchange remains disabled.

The internal asset stage now uploads only from a successfully verified,
session-owned intent capability. A full destination folder listing preflight
rejects any planned collision (including encoded/case variants) before uploading
the evidence ZIP. Existing verified storage repeats collision checks per file,
uploads exact planned bytes and verifies readback. The evidence ZIP uploads first,
then image/archive files; all files are re-read after the last upload, and retained
ZIP history is decoded/compared before the journal becomes `assets-verified`.

Scene/owner/permissions/abort guards, exact journal identity, unchanged baseline
and historical fonts/modules remain checked throughout. Failure retains intent
and any files, consumes this asset attempt and explicitly requires reconciliation;
it never deletes ambiguous uploads, adopts existing files or automatically retries.
The folder checks are not atomic server-side reservations. `assets-verified` is
byte evidence, not native render/audience acceptance or permission to create
artwork. No native document/tree/Level/history writes occur in this stage.
Upload/readback tests use fixture storage, not deployed Foundry persistence;
reload-safe write authorization and native execution are still pending.

`scripts/layers/recovery_import_reconciliation.js` now provides fresh read-only
inspection of the pre-native version-4 journal and disk evidence, without an
in-memory preparation or approval capability. Explicit total byte/entry budgets
precede reads. The exact pre-native destination baseline, current owning active
GM, file-browse permission, snapshot/journal equality and cancellation guard must
hold. Other owners and changed/native-partial destinations refuse.

Inspection reports missing project evidence, partial assets or all verified
assets. Present bytes must match exact planned paths/hashes; corrupt or ambiguous
path aliases refuse. Retained ZIP recovery history, targets, upload inventory
(including preserved background aliases) and staged/final native digests must
match the journal. Detached schemas and historical fonts/modules are checked
again. An `assets-verified` journal with missing files refuses rather than trusting
the phase. A complete file set while still at `intent` is reported without
advancing it.

This inspector is reload-independent, not a resume/approval/cleanup endpoint.
It does not adopt or retry uploads, change phases, transfer ownership or write
native documents. Missing evidence is not considered a recoverable success;
explicit retry/compensation policy and final native release remain
pending. Tests use serialized journals and fixture disk storage, not an actual
Foundry reload or deployed persistence acceptance.

`scripts/layers/recovery_import_execution.js` now reviews and executes only the
hidden native-staging step. Fresh complete disk evidence at `assets-verified`
and an explicit token/plan-digest staging approval are required. It re-reads all
files immediately before writes, installs the closed Drawing tree, verifies and
journals `tree-installed`, creates exact hidden Drawing/Tile staging documents,
then verifies and journals `native-staged`. Drawing creation on locked source
layers uses a narrowly scoped exact-source permission that expires after the
create call; a copied options object or changed source cannot use it.

Each step verifies owned document collections, complete unrelated Scene/other-Level
state, unchanged selected Level, journal, authority and historical dependencies.
Any partial/uncertain write retains files, tree, documents and journal, consumes
that staging approval and refuses automatic retry/cleanup. Fresh inspection can
now report exact missing/present hidden staging at retained phases, including
tree-write or create acknowledgement loss. Edited/foreign documents, unowned
artwork, conflicting trees or falsely completed staging refuse.

This is not a completed import: final native visibility, background replacement,
optimization-history installation, staging release and journal removal are not
implemented by this step. The original destination Level stays untouched.
Explicit final execution and live player/Restore acceptance remain
gates; tests use fixture native writes, not deployed Foundry documents.

`scripts/layers/recovery_import_compensation.js` adds separately reviewed cleanup
of exact hidden staging. Fresh bounded evidence inspection, exact destination
snapshot and explicit token/digest, deletion and file-retention consent precede
file rereads and a durable `compensating` intent. Only listed exact owned hidden
Drawing/Tile documents are deleted; layer locks use a scoped exact-source delete
permission that expires after the awaited call. Prior layer metadata is restored
only after both owned collections are verified empty. Selected Level/background
and unrelated Scene/Levels remain unchanged.

Uncertain phase, delete or tree writes stop with remaining state and all files
retained. Fresh inspection can review exact partial compensation without assuming
an earlier delete succeeded; any later cleanup requires a new approval. Edited or
unowned artwork, changed context or missing/corrupt evidence blocks cleanup.
Successful cleanup retains a `compensated` journal receipt and every uploaded
file. It does not clear the import block, retry uploads or authorize owner handoff.
Compensated-receipt clearing and deployed compensation/Restore/player
acceptance remain separate gates; these regressions use fixture documents only.

`scripts/layers/recovery_import_finalization.js` adds a separately reviewed final
release from exact complete `native-staged` state. Fresh bounded disk evidence,
native schemas, historical dependencies and exact snapshot are checked again.
Approval binds the token/digest and explicitly repeats native Tile/background
visibility decisions: those sources may immediately be player-visible and do not
obey the closed Drawing wrapper. Imported Restore history restores source historical
backgrounds, not the destination pre-import background.

Execution verifies `releasing` before installing exact optimization history,
then verifies `history-installed` before releasing owned native sources. Drawing
lock bypass is limited to the exact hidden source and exact release patch during
the awaited update. Original native hidden values are preserved, staging flags
removed, and the Drawing wrapper stays closed. Background/texture updates preserve
all unrelated selected-Level settings. Complete collections, history, tree,
selected Level and unrelated Scene/Levels verify at each step. Fresh final disk/
native checks precede `native-released`, `complete` and import-journal removal;
the complete receipt is returned and all files remain retained.

Partial/uncertain history, native, Level or cleanup writes stop with explicit
visibility/background uncertainty, remaining journal and every file retained.
Fresh inspection reports exact staged/final native sources and exact before/after
Level/history state without granting resume authority. Hidden-staging compensation
refuses release phases; no automatic release retry or compensation occurs.
`inspectCompletedRecoveryImport` performs read-only verification using a serialized
complete receipt when journal removal was uncertain or has completed. It requires
absent import journal and exact final native/history/evidence state; it is not an
approval, receipt-discovery or recovery-UI endpoint.

These are fixture persistence tests, not deployed rendering/player or successive
native Restore acceptance. Release-phase recovery, compensated-receipt clearing,
owner handoff, public exchange UI and live acceptance remain gated.
Post-write Scene comparisons exclude only Foundry-maintained modification time
and modifier identity; stable metadata and every substantive Scene field remain
checked. Approval snapshots before writes still include those bookkeeping values.

Foundry v14 FilePicker does not accept `.zip` uploads. Portable exchange still
uses the strict self-contained ZIP, but durable server evidence now uses
`scripts/layers/recovery_import_evidence.js`: a genuine version-1
`foundryshop-recovery-import-evidence` JSON document, uploaded as
`import-<token>.json` with `application/json`. It contains explicitly labeled
base64 ZIP bytes, their exact size and SHA-256 fingerprint. The stored JSON itself
also has its own size/hash reference in the intent. This is not a ZIP renamed
with a different extension or an upload-permission bypass.

Encoding budgets the full JSON/base64 overhead before allocating the encoded
data. Decoding checks exact version/schema, bounded JSON/decoded bytes, canonical
base64 and inner ZIP hash, then reuses the strict ZIP/history/resource validator.
Upload review includes the larger JSON evidence size plus every planned file.
Asset verification and fresh/completed inspection use this same envelope decoder.
No ZIP-upload allowlist change or automatic adoption/retry is required.

Initial live acceptance verified two real successive Consolidate generations,
source ZIP collection and destination detached remapping/native validation.
It exposed the host modification-stat guard failure, subsequently corrected and
verified by a live intent write. The next upload was refused by Foundry's ZIP
extension policy before any destination evidence or artwork existed; the JSON
evidence change is built/tested but awaits deployment and fresh live acceptance.
All disposable Scenes were removed, the full original Scene verified unchanged,
and immutable source recovery/output files retained. Imported final release,
successive native Restore and player concealment/reveal remain unverified.

Subsequent deployed Drawing-only acceptance passed on Foundry 14.365. Two real
Consolidate generations were collected as a 15,862-byte portable ZIP; destination
remapping to different dimensions/grid produced a 23,801-byte JSON evidence
envelope. That envelope and four immutable recovery/output assets uploaded and
verified through the real FilePicker, followed by fresh inspection, hidden native
staging, exact history/final release, import-journal removal and completed-receipt
verification. Destination Level stayed exact and the Drawing wrapper remained closed.

Successive imported Restore operations reproduced the exact first composite and
then both original native strokes; the complete destination tree and Level stayed
exact. On Aroh's visible client, restored strokes sampled only the destination
background while concealed. Explicit GM application of Imported Presentation
revealed sampled red and blue pixels exactly. This verifies the restored-stroke
conceal/reveal path, not full-frame baked-image fidelity or the baked composite's
player rendering before Restore.

A separate live compensation fixture verified hidden document removal, prior
tree/Level state, retained compensated receipt and all five files. After a normal
GM reload, fresh inspection of serialized journal/disk evidence still reported
`compensated-retained-evidence`; all 14 newly created evidence/output/archive files
were reread and verified. All three disposable Scenes were removed and both clients
returned to the complete unchanged original Scene; every immutable file was retained.
These tests use internal reviewed APIs, not the unwired public ZIP-import controls.
Tile/background import and visibility, locked-layer native permissions, reload of
a completed import receipt, full-frame fidelity and actual ZIP disk download remain
separate gates. No real crash/network interruption was simulated.

Subsequent native Tile recovery acceptance passed through the internal reviewed
APIs on Foundry 14.365. A real player Tile Bake produced a 9,772-byte portable ZIP;
the 14,645-byte JSON evidence and two immutable destination assets uploaded and
verified. Hidden staging sampled only background on Aroh's visible client.
Separately approved final release reproduced the exact Tile/Level/history and
displayed exact sampled red/blue baked pixels even with the Drawing wrapper closed.
This confirms why native Tile exposure needs its own approval rather than relying
on Drawing presentation gates.

Restore initially refused because an Apply-only private-artwork placement check
was also applied to recovery. Placement review now distinguishes Apply from
Restore: public Bake exposure/ground-conversion checks remain on Apply, while
Restore separately approves exact archived placement, binds archive/Scene/Tile
context and retains strict native recovery verification. Restore does not require
private originals to become public or the historical background to satisfy a new
full-scene Bake mapping. Its dialog explicitly describes removing the replacement
and restoring native visibility/presentation gates, including source historical
background semantics.

After deployment and normal GM reload, fresh review completed the retained Tile
Restore intent. Both full native Drawing sources matched the imported archive,
the Tile was removed, and the destination Level and closed wrapper stayed exact.
Settled visible-player samples again showed only background; the first sample
immediately after tab wake did not pass, so this is settled-render evidence, not
certification of hidden-tab transition frames or full-frame fidelity.
All five created files were reread/verified and retained, both disposable Scenes
removed, both clients returned to the unchanged original Scene. A completed-import
receipt inspection after reload correctly refused the subsequent Restore intent;
unchanged completed-receipt reload acceptance is still outstanding.
Native background acceptance, locked-layer hooks and public exchange UX remain gated.

Subsequent native background recovery acceptance passed through internal reviewed
APIs on Foundry 14.365. A full-scene background Bake preserved an existing immutable
PNG as original-background evidence. Its 23,002-byte portable ZIP remapped from an
800x600 source to a 1000x700 destination without modifying the image bytes.
The 32,293-byte JSON envelope and four assets (baked image, preserved original,
native original-background alias and archive) uploaded and verified. Staging kept
the destination Level exact. Separate background replacement/visibility approval
released the exact planned Level/history; Aroh sampled green/yellow baked pixels
even with the Drawing wrapper closed. A normal GM reload then successfully
inspected the unchanged completed receipt and freshly reread disk evidence.

Restore initially refused before intent/native writes because it expected the
retained bitmap to match destination Scene dimensions. Recovery entry points now
decode backgrounds at the dimensions of their verified, hash-bound image bytes,
while placement remains bound to the destination native Scene rectangle. Preview
uses bitmap dimensions, not an invented resized image. This shared verification
also covers resume and owner takeover; Drawing/Tile exact geometry-to-image checks
remain unchanged. No resampling, silent scaling rewrite or relaxed file identity.

After deployment and reload, fresh Restore matched both full archived native
Drawings and the exact historical Level, including unrelated destination metadata.
The restored background URL was the uploaded source-original alias, not the
destination pre-import background; alias bytes exactly matched the preserved file.
Aroh's visible client sampled the public historical image while both restored
Drawing shapes stayed concealed. All eight newly created files were reread and
retained, both fixtures removed and both clients returned to the exact original
Scene. These are bounded pixel/native-state checks, not full-frame fidelity or
public dialog/ZIP-download certification. Locked-layer native hooks, hidden-tab
transition frames and release-phase recovery remain outstanding.

Subsequent locked-layer recovery acceptance passed on Foundry 14.365. A source
retained one Drawing in an unlocked child layer beneath a locked group, alongside
a separate real Consolidate generation. Its strict 10,464-byte recovery ZIP
preserved both artwork and the inherited lock. An initial hidden import stopped
with partial staging because Foundry passes a fresh options object to native hooks.
Fresh inspection and separately approved compensation safely removed that partial
staging after deployment, retaining every file.

Recovery native guards now carry an opaque random token across Foundry's copied
options boundary. Private action-specific registries bind the live token to exact
Scene, owner, journal phase and source; update also binds the exact release patch.
Only original dotted or exact host-expanded hidden/staging-removal patches pass.
Revocation occurs after each awaited native operation, including failure. This is
a scoped editing exception, not a general lock bypass or a security boundary
against trusted code running in the same client.

Fresh fixtures verified hidden native creation under the inherited lock, exact
final source release while that lock remained, and compensation deletion of locked
hidden staging with exact prior tree/Level restoration. Ordinary native create,
update and delete calls using fabricated permission tokens returned no changed
documents before/after release and before compensation; complete Scene snapshots
were unchanged and standard lock errors were surfaced. All four fixtures removed,
11 source/import files reread/verified and retained, both clients on the unchanged
original Scene. This closes bounded inherited-layer recovery-hook acceptance;
ordinary optimization Restore through locked layers is not certified by this run.
Full-frame/transition fidelity, public recovery dialogs,
release-phase partial recovery and compensated-receipt clearing remain gated.

Internal reviewed portable ZIP download is now implemented and passed bounded
Foundry 14.365 acceptance. Review binds the full source snapshot, current GM,
immutable collected bytes and SHA-256 fingerprint. Explicit approval grants one
download only; changed source, fabricated/reused authority, cancellation and
download errors refuse. The localized modal warns that recovery ancestry may
contain historical GM-private artwork, fonts/modules are not embedded, and all
server files must remain. No uploads, Scene writes or exposure authority result,
and no public toolbar control is registered.

A disposable two-generation Consolidate project produced a 15,847-byte ZIP.
The owner-saved file matched the approved download receipt byte count and hash,
and strict disk decoding verified both complete generations, their parent link
and all four recovery files. The browser automation did not report a download
event; actual disk verification, not the `download-initiated` receipt, established
completion. Separate collections may produce different ZIP container hashes;
verification compares the saved bytes with their own exact approved receipt.
Live modal cancellation left the source unchanged. All four server files were
reread/verified and retained, the disposable Scene removed, both clients returned
to the exact original Scene, and the owner-saved ZIP preserved. Public exchange
wiring and complete keyboard/accessibility acceptance remain gated.

Internal release-phase recovery now supports a separately reviewed, single-use
resume approval after fresh strict evidence inspection. It accepts only exact
retained `releasing`, `history-installed`, `native-released` or `complete` state;
normal hidden-staging finalization approval cannot authorize resume. The review
reports the phase and already-final native IDs and requires renewed Tile/background
visibility decisions. Execution rereads evidence, installs only missing history,
updates only still-staged artwork, skips an already-final Level background and
clears intent only after exact final verification. Edited/ambiguous state refuses;
another interruption retains evidence and requires another fresh review.
No automatic retry, rollback, owner takeover or public control is added.
Regression coverage includes phase/acknowledgement-loss cases for Drawing, Tile
and background, mixed and partially released collections, stale context, corrupt
evidence and repeated interruption. Bounded deployed Drawing release-resume
acceptance now passes: controlled cancellation after native release retained
`history-installed`; fresh inspection after ordinary GM reload and separately
approved resume completed without rewriting the final Drawing, history or Level.
A second fixture cancelled after history installation at `releasing`; fresh resume
released the still-staged Drawing exactly once and verified completed evidence.
Both two-generation fixtures were removed after exact receipt verification;
10 server files verified/retained and the full original Scene unchanged.
Tile/background and mixed/partial-collection live resume acceptance remains
pending; real crashes/network outages remain owner-deferred.

Internal compensated-receipt clearing is now a separate fresh-review operation.
It requires complete hash-verified evidence and an exact compensated destination:
no owned native staging, prior layers/Level restored and no optimization history.
Explicit single-use approval clears only the import journal, returns its retained
receipt and keeps every file. Evidence and context are checked again before
removal; exact post-removal state and evidence are verified afterward. Uncertain
removal returns an error with the receipt for read-only inspection, never an
automatic retry. Clearing authorizes neither uploads nor another import.
A new attempt must prepare fresh identities/paths against a current retained-file
inventory and obtain new import approvals; tests cover new intent and asset
persistence while retaining the previous files. Cleared-receipt inspection refuses
subsequent imports or changed destination/evidence. Live clearing/retry acceptance
and user-facing receipt retention/recovery dialogs remain pending.

Internal localized recovery review adapters now cover hidden staging,
compensation, finalization, explicit release resume and compensated-receipt
clearing. They display exact token/plan identities, native IDs and retained paths;
release review also shows retained phase, already-final IDs and exact Level
before/target data. Required decisions have separate initially unchecked controls,
including independent native Tile and background visibility acknowledgements.
`promptRecoveryImportApproval` obtains a fresh guarded service review and returns
only its single-use capability; it does not execute, upload, store receipts or
register public controls. Cancel/close or any missing acknowledgement refuses;
source/owner/context changes during the modal cannot grant stale authority.
Receipt clearing explicitly requires the caller to retain the receipt before
execution. Full import entry dialogs, end-user receipt discovery/retention,
public wiring and live keyboard/tablet acceptance remain unfinished.

Internal durable receipt storage now supports complete and compensated receipts
in strict version-1 JSON envelopes. Separate localized review binds exact
path/size/SHA-256, full Scene context and file-retention consent. Immutable storage
uses the receipt's evidence root, refuses occupied paths, verifies upload bytes,
and does not change the Scene or clear its journal. Explicit receipt-byte limits
apply to encoding and reading; non-terminal or lossy receipts refuse.
Uncertain persistence returns the exact reference and receipt for read-only
inspection rather than automatic retry. Keep that reference alongside the file:
hash integrity is not authenticity or write authority.

Stored receipt inspection rechecks unchanged Scene/owner context across reads,
strictly decodes the envelope and verifies all original evidence/native state.
It supports compensated receipts before/after clearing and complete receipts
before/after finalization journal removal, but refuses later edits or new imports.
Regression tests cover persistence, cleared-state inspection, completed-state
inspection, byte thresholds, corruption, collision and lost upload acknowledgement.
Receipt storage is an internal primitive with no catalog/toolbar registration;
live storage acceptance and public exchange wiring remain gates. Internal
persistence-before-clearing and exact-reference lookup are described below.

Internal `retireCompensatedRecoveryImport` now connects separately reviewed
receipt persistence, verified receipt inspection and separately reviewed journal
clearing. No clearing starts without durable evidence of the exact receipt.
The clearing service rereads the receipt after approval immediately before
removal. Cancellation or uncertain writes retain the receipt/reference in an
explicit workflow error; no automatic retry or new-import approval follows.
Supplying that exact retained reference on a later attempt skips uploading only
after fresh byte/native/evidence verification.

`findStoredRecoveryImportReceipt` provides read-only exact lookup from a supplied
complete/compensated receipt, deriving its deterministic path/size/hash. It returns
explicit `not-found` or verified evidence, rejects ambiguous/case/encoded aliases,
and never scans/adopts arbitrary receipts or grants writes. Keep receipt references
for inspection when the original journal is absent. Production UI integration,
general receipt browsing and live retirement/storage acceptance remain gated.

Internal `importReviewedRecoveryProject` now connects the full destination-bound
entry workflow from supplied strict ZIP bytes and explicit Level/storage/budgets.
Fresh detached preparation precedes a localized exact-plan review showing
destination, coordinate/elevation policy, upload paths/count/bytes, required
fonts/modules and before/target Level data. Each required decision has separate
unchecked consent, including empty metadata replacement and native visibility.
The complete receipt's size is preflighted before any write.

After approval, durable intent precedes verified asset uploads. Hidden staging,
final release and completed-receipt storage each require their own fresh review;
final Tile/background visibility consent is renewed. Success returns the exact
complete receipt and verified immutable receipt reference. Cancellation after
intent or uncertain writes produces an explicit error with the stopped step,
token and any available receipt/reference; it never retries, compensates or
releases automatically. If storage is cancelled after finalization, the completed
import remains complete and the error carries its receipt for read-only checking
and later separately reviewed storage. Initial review cancellation writes nothing.
Drawing/Tile/background and interruption boundaries are regression-covered.
This internal bytes-based entry point does not register public toolbar controls
or certify live accessibility; the optional setup UI is described below.

`promptReviewedRecoveryImport` now adds an opt-in setup dialog to that workflow:
native browser ZIP-file selection, explicit Level choice within the supplied
Scene, an existing shared data-folder path and unchecked empty-metadata replacement.
File size/extension/count and explicit evidence/receipt/time budgets are checked
before reading; strict ZIP contents are validated later by detached preparation.
The shared folder uses existing permission/privacy/target preflight and captures
the current collision inventory. Owner, cancellation and exact Scene context
remain checked across the dialog, folder reads and file read. No Scene creation/
activation, settings writes, directory creation or uploads occur during setup.
Storage supports manual data-path entry and a native data-source folder picker.
Picker errors appear in a live status area and standard notification; stale/late
callbacks cannot change the selected path, and setup close cleans up the picker
even if rendering is still pending. Selecting a folder grants no write authority;
shared-folder preflight remains mandatory. Public registration and live native
picker/modal interaction, entry/accessibility acceptance remain gated.

Internal `promptRecoveryImportActions` now offers a read-only-default action
selector based on fresh native/file evidence. It offers hidden staging only from
complete assets-verified state, finalization only from complete hidden staging,
explicit release resume only from verified release state, and compensation only
for supported complete hidden/pre-native states. Missing upload evidence offers
inspection only, never upload retry. Completed/compensated receipt inspection can
use an exact supplied receipt or stored reference after journal removal.

Each selected write requires its own independent dialog/service approval, and
one write attempt consumes the action review. Terminal native actions separately
verify or review durable receipt retention; storage cancellation carries the
terminal receipt without rolling back native work. Compensation retains its
journal. Later retirement discovers/verifies an already-retained exact receipt
before separate clearing approval, without reuploading. Unsupported actions,
stale review state and corrupt evidence refuse; no owner handoff, automatic
retry/rollback or public registration is added. Live action-panel/accessibility
and end-to-end acceptance remain gates.

For a multi-Level package, import explicitly chooses one source Level or
**Combine full project onto active Level**. No best-effort matching by Level
name/ID occurs, and no destination Levels are created or changed. Single-Level
import retains numeric Drawing elevation and reports excluded other-Level
artwork. Combine moves every imported Drawing to the active Level's ground:
layer/group order stays authoritative; within each drawing layer, fresh sorts
follow original elevation, then native sort, with stable package-order ties.
Higher values are on top. Cross-floor overlaps are a new composition, not a
pixel-identical conversion. Existing destination Drawings/sorts remain untouched;
incompatible render modes or insufficient sort space refuse.

The final review reports included/excluded counts and the elevation policy.
Imported artwork stays beneath the existing hidden presentation wrapper.
Full library-project saves continue to retain all source Levels; their import
uses these same explicit choices. Deployed disposable-Scene acceptance verified
active-Level export defaults/filtering, explicit upper-floor import with numeric
elevation retained, and additive combine at ground 7 with original elevation
ordering taking precedence over source native sort. Complete geometry/styles,
existing control artwork and destination Level settings stayed exact. Aroh's
visible client concealed the imported wrapper until its Imported Presentation
preset was explicitly applied; red/blue overlap then showed blue on top. Final
review cancellation left the complete destination Scene unchanged.

Export approval fulfilled, but actual disk-download completion was not observed.
Existing global managed-order rules still reject mixed elevations, including
across separate native Levels; an incompatible additive combine refused before
journaling without changing existing artwork. This is not certification of the
whole multi-Level layer-ordering UX or full-frame artwork fidelity. All disposable
fixtures were removed and the complete original Scene remained unchanged.

**Moving a scrawled map to a prepared Scene:**

1. On the original Scene, select the Drawing strokes that make up the map.
2. Open **Export Project JSON** and choose **Selected Drawings only**. This option
   appears when native Drawings are selected. The package includes only those
   strokes, not every Drawing in their layers; required layer ancestors and
   scoped presentation presets are retained. Selected Unassigned strokes are
   supported. Optional thumbnails show only exported artwork. Selection or source
   changes during export refuse the download rather than exporting a stale set.
3. Switch to the prepared Scene and choose **Import Project JSON**. Use additive
   mode if it already contains Drawings. Enter the X/Y translation in scene
   pixels: destination position minus original position. Import preserves
   relative geometry and styles, maps to the displayed Level, creates fresh
   identities and does not alter existing destination Drawings.
4. Review resources, placement and presentation before confirming. Additive
   import creates a player-hidden wrapper; deliberately enable the intended
   presentation when ready. Keep the original Scene and JSON as editable backups.

This copies, never cuts or merges strokes. Source coordinates, brush styles and
module flags remain intact. Layer locks and originally hidden strokes remain
preserved. **50% private reference-layer opacity is not enabled yet**; use
ordinary layer visibility for comparisons until that compositing gate is solved.
Reversible stroke consolidation is also separate and not performed by transfer.

**Consolidation status:** reversible image Drawing consolidation is the planned
best-effort option for mass freehand strokes. A narrow straight-line analyser
and detached tests found endpoint rasterization differences, so no lossless
vector-merge command is exposed. The originals-archive service preserves native
source IDs/authors/geometry/styles/flags and validates checksums and restore
conflicts, but does not yet persist files or execute document swaps. No
Consolidate/Restore UI is enabled and no original strokes are deleted.

**Shared project/shape library:** configure an existing **Project library folder** in
the toolbox Settings tab or Foundry module settings. Put portable project JSON
files there with Foundry's file tools or save them directly below. In Library, **Refresh library** validates
the folder's immediate JSON files and builds a session index; filter Projects/
Shapes and search by name, filename, category or saved tags. Cards show embedded full-artwork thumbnails on white, Drawing
counts and explicit missing-thumbnail/file-error states. **Review import** re-reads
and validates the selected file, requires its exact SHA-256 content fingerprint
to match the card, then opens the normal mode/translation/resource/dry-run workflow.
Cancellation creates no artwork. Shape cards instead offer **Place shape**, which
re-reads the fingerprinted file, loads the stamp preview and uses existing
scale/rotation/Repeat controls. Shapes scale to the destination grid.

### WEBP publication

**Export artwork WEBP** in Library downloads artwork directly to your browser;
no library folder or upload permission is needed. Choose **Player-presented**
or **My GM workspace** explicitly, then the whole drawing map on the displayed
Level or one layer/group including descendants. Ordinary Unassigned artwork is
included in whole-map export. Player export respects ancestor presentation gates,
native hidden state and unresolved membership. GM export respects your private
workspace gates and may include player-withheld/native-hidden content. Native
hidden geometry uses Foundry's half-opacity; its text retains native text opacity.
Orphan membership follows native GM visibility. Locks do not exclude artwork.

Output defaults to **transparent**. Alternatively choose **Displayed Level
background** to include its base color and static PNG/JPEG/WEBP background image,
using native fit, anchor, offset, signed scale, rotation and tint. Foregrounds,
other-Level imagery, padding, grid, fog, tokens, walls, lighting, selection handles
and UI remain excluded. A dedicated render surface never changes Scene artwork,
workspace or player presentation. Background-only exports are supported; videos,
invalid/blocked resources and primary artwork below the background elevation fail
explicitly. Strict vector SVG is available separately below; subtree/targeted
JSON exchange is available above. Explicit one-Level/combined import replaces
automatic multi-Level matching; deployment acceptance remains a follow-up.

Choose content bounds (including the transformed background when selected and a
1 Scene-pixel margin), a custom crop rectangle in Scene pixels, or **Scene
rectangle** with a Level background to clip to the map area. Scale determines pixel dimensions:
`ceil(crop width * scale)` by `ceil(crop height * scale)`, without stretching.
Scale defaults to 1 and supports 0.1-4. Numeric fields support native arrows and
wheel adjustment while focused; quality is a touch-friendly slider with a live
percentage. The default WEBP quality is 90%. No silent rescaling or MIME fallback.
Downloaded names include the chosen audience.

Current input bounds reuse the validated renderer: 1,000 Drawings, 100,000
coordinates, 4 MiB snapshot, 16 textures and one elevation/interface mode.
Static PNG/JPEG/WEBP textures use independent file/decoded-pixel bounds and
external-request consent. Backgrounds allow 8,192px axes (also GPU-limited) and
16 MiB compressed files; artwork textures retain 4,096px axes and 16 million
decoded pixels collectively. All composed textures share a 64-million decoded-
pixel budget, with shared paths loaded once. Output is capped at 8,192px per axis, 16 million pixels
and 32 MiB encoded bytes, subject to the browser/GPU maximum texture size.
Text bitmap bounds remain explicit. These are publication limits, not a promise
that every larger saved project can render. Reduce scope/scale if needed;
unsupported geometry/resources/fonts fail rather than disappear.

Export verifies actual WEBP encoding and dimensions. Clamped premultiplied-alpha
conversion avoids a PIXI 7 extraction overflow that otherwise turns saturated
partially transparent colors black. Artwork, raw layer metadata, workspace,
Level source/background transforms, Scene rectangle, authority and window/abort state are checked across review/render/
download. Unfinished/staged imports block export. JSON remains the editable,
layer-preserving interchange format; WEBP cannot recover layers or strokes.

### Strict vector SVG publication

**Export vector SVG** in Library shares WEBP's explicit player/GM audience,
displayed-Level whole-map or layer/group scope, content/custom crop, scale and
stale-source/authority/cancellation guards. It does not need a library folder,
upload permission or network resources. Scale controls the SVG viewport size;
the `viewBox` preserves Scene-pixel coordinates and standard SVG aspect ratio.

Rectangles, ellipses and open/closed polygon paths remain vector. The exporter
records public native smoothing calls as quadratic/cubic SVG curves, rather than
rasterizing them or maintaining a second smoothing algorithm. Geometry uses
native centered rotation, stroke inset, miter joins/butt caps (miter limit 10),
nonzero fill rule and separate fill/stroke/text opacity. GM native-hidden geometry
is half-opacity; text keeps its own opacity. Actual Drawing sort order is retained.
Escaped drawing/layer/group names appear in standard SVG groups; ancestor groups
repeat when needed to preserve interleaved stack order instead of regrouping ink.
Unassigned and unresolved membership are explicitly named.

This is **strictly vector-only**: textured fills, texture references and image
stamps block the entire export with named diagnostics, never partial output.
Degenerate rectangles/ellipses whose stroke consumes their dimensions also block
export because SVG cannot preserve native stroke behavior. Use WEBP or a supported
scope. Level backgrounds and raster embedding are not part of this first SVG slice.

Labels use currently loaded native fonts and wrapping metrics, with escaped text
spans and explicit outlines/shadows. **Fonts are not embedded**: viewers need the
font installed. A required fidelity acknowledgement explains that text baselines,
outlines/shadows, antialiasing and complex/self-intersecting filled paths can differ
from native rendering or across viewers. Unsupported text styles, unavailable
fonts, oversized text and invalid XML characters stop export explicitly.

SVG retains the existing bounded snapshot and output-size limits (1,000 Drawings,
100,000 coordinates, 4 MiB snapshot, one elevation/interface mode, 8,192px output
axes, 16 million output pixels and 32 MiB encoded bytes). Native display bounds
include text; temporary measurement objects are disposed. Downloads include the
audience and `.svg` extension. SVG is export-only, not a backup of native metadata,
locks, presentation presets or recovery data; **JSON remains authoritative**.

### Project and shape saving

**Save current project** saves every Scene Drawing, nested layers, their defaults
and presentation presets as a fresh project JSON file. It needs GM file-browse/
upload permissions, not a Drawing selection. Enter a project name; hidden
artwork and GM-only presentation content are included. This is not a full Scene
backup: tokens, walls, lights and backgrounds are excluded. Current limits remain
one source Level, 10,000 Drawings, 1,000,000 points and 20 MiB. Resolve unfinished
imports first; unsupported recovery content is refused, not omitted. Full project
saves retain multi-Level associations for explicitly scoped import.
Project saves use a fresh `project-ID.json` filename and never intentionally
overwrite a previous project. Artwork/layers/presets, Scene/Level/grid, authority
and folder are rechecked across review, rendering, upload and verification.

**Save selection** creates a new reusable shape file from selected visible,
native-unlocked Drawings. Enter a name/category and optional comma-separated
tags (up to 12, 40 characters each). Requires GM Drawing access plus file browse
and upload permissions. Saving does not edit Scene artwork or replace the
session copy/armed stamp. The metadata prompt can be canceled without uploading.
Selection, artwork, Scene/Level, grid, permissions and folder are rechecked before
upload and after verification.

Shapes are centered and normalized to 100px per nominal grid square, with
relative order, transforms, text, colors, textures and repeat proportions
retained. Scene membership, author, Levels and provenance are not retained;
elevation is normalized to zero. Limits: 100 Drawings, 100,000 points, 4 MiB,
20 squares per footprint axis and source grid size 5-2,000px (gridless: 100px).
Mixed elevation/interface modes, native-hidden/locked content, pending imports
and unsupported metadata are refused. Text scaling still must fit supported
native font limits when placed.

Each shape has a stable ID in its file and a new `shape-ID.json` filename.
Existing filenames are never intentionally overwritten; a detected collision
blocks saving. Foundry uploads are not atomic create-if-absent, so avoid external
tools concurrently writing the same generated path. Saved bytes are fetched
back and SHA-256 verified before success; then the library is reindexed.
Unverified uploads explicitly report the path where a file may remain, without
automatically deleting it. A verified save followed by a refresh failure is
reported separately: refresh rather than saving another copy. Refresh after
reload discovers saved files; duplicate external copies with the same shape ID
produce explicit error cards.

Texture paths are references, not copied/embedded assets. Project and selection
saves default to a generated **256x192 embedded WEBP thumbnail**, using the same
bounded artwork renderer as JSON export. It shows all saved artwork, not the
player view; a project thumbnail can include hidden content. External texture
requests require explicit consent. You can uncheck thumbnail generation; if it
fails, a separate **Save without a thumbnail** confirmation is required before
any upload. Declining leaves storage untouched. Stale artwork/context cannot
use this fallback.

Saved shape thumbnails survive reload and placement as portable package metadata;
the browser displays them without scheduling a redundant live render. Older
thumbnail-free shapes still generate lazy previews, and older projects retain
their explicit missing-thumbnail disclosure. Artwork remains authoritative.

This first browser is GM-only and independently requires `FILES_BROWSE`; it reads
only the configured `data` folder, never recursively or from arbitrary URLs.
Limits are 100 JSON files, 20 MiB per file, 64 MiB streamed per refresh and a
10-second timeout per file. Reads are serial, same-origin, no-store and reject
redirects. Invalid files get error cards, never import buttons. Refresh reindexes
external file changes. The session index holds only file identity/fingerprint,
name, counts and bounded thumbnail metadata, not duplicate Drawing geometry.
**Manage saved files** exposes **Edit file metadata** and **Duplicate saved file**
on saved project/shape cards, not built-in examples. Name, category and tags are
updated **inside the portable JSON**, not merely overridden in this browser.
Projects carry optional bounded `library: {id, category, tags}` metadata; their
existing project name remains authoritative. Editing preserves the filename and
stable identity; an older project receives an identity on its first metadata edit.
Art, layer/default/preset trees, resource references and embedded thumbnails are
preserved. Duplication creates a fresh identity/filename and leaves the source
unchanged. Both operations re-read the source fingerprint and independently
require GM file-browse/upload permissions.

Editing additionally requires world-setting permission and a separate
**Replace file metadata** confirmation. Back up files first. The module persists
a bounded world repair record containing the path and before/after hashes
before replacement, then verifies exact uploaded bytes before clearing it.
Foundry uploads lack atomic compare-and-swap; simultaneous edits of the same
file in other browsers/external tools are unsupported. Revision/read-back checks
are not cross-client locks. Replacement is not an automatic backup or rollback.

An uncertain replacement remains explicitly blocked from import, placement,
editing or duplication, including after reload. **Review unfinished replacement**
re-reads and validates the file, discloses its SHA-256 and whether it matches the
original, intended or neither version, then requires explicit acceptance.
Acceptance verifies the reviewed fingerprint again and only clears the marker;
it never uploads, deletes or restores artwork. Missing/malformed files cannot be
accepted: restore or repair them externally, then refresh and review. Verified
operations followed by refresh failures are reported separately.

### Shared library removal and restoration

In **Manage saved files**, **Remove from shared library** requires confirmation
and hides a saved project/shape for **all GMs in this world**. It does not delete
or alter its JSON, textures or Scene artwork. Built-in examples cannot be removed.
**Removed items** switches to the removed-file view and enables management.
**Restore to shared library** explicitly accepts the current validated file and
returns it to ordinary browsing/import/placement. Both actions require GM file
browse and world-setting permissions, but do not require upload permission.

A separate bounded world catalog persists removal across refresh/reload.
It stores only root/path, kind, stable identity (when available), name and the
removal-time SHA-256 fingerprint, never Drawing geometry or thumbnail bytes.
At most **100 removed records across all folders** are retained. Folder changes
do not discard earlier removals; returning to a folder restores its removed view.
Missing files retain named error cards. Malformed/missing files cannot be restored
until repaired externally and refreshed. Files changed or replaced externally
stay removed with an explicit warning; restoring requires review of their current
JSON and a matching current fingerprint, rather than restoring older contents.
Records follow the removed path; moving/copying a file elsewhere creates a
separate discovered entry, not automatic suppression by identity.

Removed entries have no import/place/edit/duplicate action, including through a
stale card. Unfinished replacement warnings remain visible in either view and
must be resolved separately; accepting a repaired file does not restore its
catalog entry. Writes verify expected catalog revision/state and read back the
setting before reporting success. If verification fails, removal/restoration
may have persisted: refresh and inspect Removed items before retrying.
These checks are not atomic cross-client locks; simultaneous catalog edits by
multiple GMs remain unsupported pending the concurrency milestone.

File deletion is separate and remains deferred. Foundry v14's supported
FilePicker API has no file-deletion method; use existing external file
administration rather than an unsupported module workaround. Removal is reversible
while the file remains available; deleting it externally is not.

The export dialog defaults to including a generated **256x192 WEBP thumbnail**.
It shows all packaged artwork, including hidden content, without the Scene
background. Uncheck the option for an artwork-only package. External texture
requests require explicit acknowledgement; otherwise they are refused. Missing
resources, unsupported geometry or preview limits produce an explicit warning
with a separate **Export without thumbnail** confirmation, never a silent fallback.
Changing the Scene, authority, layer revision or artwork before download refuses
the export rather than saving a stale thumbnail.

The optional version-1 `thumbnail` field has MIME `image/webp`, scope
`full-artwork`, integer dimensions, and canonical base64 `data` (no URL).
It is bounded to 256 KiB, 512px per axis and 262,144 pixels; metadata, static WEBP
headers, RIFF chunks and bitstream dimensions are checked before image decoding.
These checks do not certify the compressed image's decodability or the artwork's
validity. Older packages without thumbnails remain supported. Thumbnails are
advisory metadata, never imported as Scene artwork or used in artwork verification.
Export regenerates them; the import review still renders the validated artwork
with resource replacements, never the embedded image.

To import:

1. Choose **Empty Drawing project** (the default, refusing existing Drawings) or
   explicitly choose **Add to existing project**. Tokens, Walls, background,
   dimensions, grid, and other Scene content are never changed by import.
   A copied Scene can retain Foundryshop layers/presets after deleting its Drawings.
   Empty mode offers a separate confirmation to replace that metadata, followed by
   the normal dry-run/final confirmation. Cancellation writes nothing. Replacement
   is allowed only while there are zero Drawings; otherwise use additive mode.
   Failed-import cleanup restores the old metadata when safe.
2. Display the destination Level, select the JSON file, and choose a translation
   in pixels (zero preserves coordinates). Every Drawing maps to that Level;
   elevation and interface rendering mode are preserved.
3. Review the dry-run counts, conservative geometry bounds, texture/font/module
   dependencies, and Level mapping. Texture replacements can be entered as a JSON
   object such as `{"art/quarry.webp":"shared/quarry.webp"}`. Font replacements use
   source-to-loaded-family mappings such as `{"MissingFont":"Signika"}`.
4. Resource preflight checks same-server textures with HEAD requests and checks
   loaded Foundry font families. Missing/inaccessible local images, unverified MIME
   responses, redirects, and missing fonts block import. **Resolve Project
   Resources** shows each failure, available fonts, and replacement fields; recheck
   or cancel without writing anything. Required metadata modules must be active.
   Their opaque flag values remain preserved, but unknown internal references are
   not remapped automatically.
5. Review the imported artwork inside its player-hidden wrapper group. Originally
   Unassigned Drawings are assigned to **Imported Unassigned** inside that group.
   All IDs are fresh and author is the importing GM. Native hidden/locked values
   remain unchanged, and per-GM workspace settings are not imported.
6. Explicitly apply **Imported Presentation** to restore the package's saved
   player gates and open its wrapper. Imported original presets also open the
   wrapper, but leave originally Unassigned artwork hidden unless explicitly shown.

**Additive behavior:** each import creates a fresh player-hidden wrapper, by
default at top level above the existing layer stack. Optionally choose an existing
**Destination group** in additive mode: it must be unlocked with unlocked
ancestors, and the new wrapper becomes its top child. Existing Drawing data, IDs, membership, sort,
native locks, nodes, player gates and presets are preserved. Imported sorts are
allocated above existing managed artwork at top level, or into the integer gap
above the target group's existing children and below managed artwork above that
group. Incompatible elevation/render modes,
invalid existing order or exhausted integer sort space are refused, not repaired
implicitly. Unassigned existing artwork retains native ordering.
Additive imports fingerprint existing Drawings using browser SHA-256, which
requires a secure context (HTTPS or localhost). If unavailable, import reports an
error before any writes; use a secure Foundry URL rather than bypassing protection.

Imported presets capture the existing nodes' player gates at import time, so
applying them restores those captured gates alongside the imported presentation.
They are still full snapshots: later manual changes to existing player gates may
be reset by applying an imported preset. Existing presets are untouched and hide
the newer imported nodes when applied. Conflicting imported preset names receive
numeric suffixes; repeated imports always use fresh IDs. Targeted imported presets
retain destination ancestor gates: applying Imported Presentation does **not**
implicitly open a hidden destination parent. Select a different target or explicitly
manage its presentation separately. Target group selection is disabled/reset in
empty-project mode. The final review names the destination group.

Textures/fonts remain external references, not embedded resources. Same-server
checks use at most four concurrent requests, a five-second timeout per resource,
and a limit of 128 distinct local texture destinations. Checks run again just
before journaling/creation. They verify availability and image MIME, not image
decoding, exact font metrics, or pixel-level fidelity.

External HTTP(S) texture URLs are **never contacted by preflight**. Replace them
with local paths, or explicitly check the acknowledgement in the resource repair
dialog. The final review labels them unverified; Foundry may contact those hosts
when the imported Drawings render. Unsafe schemes/credential-bearing URLs are
rejected and cannot be bypassed with acknowledgement. Redirects are not followed;
use a direct resource path instead. Cancel either resource repair or final review
to leave the destination unchanged.

Import journals exact generated IDs before creation, suppresses staging artwork
on all clients, and verifies persisted fields before releasing staging. Failures
attempt to remove only this operation's artwork and restore the prior
project. If cleanup cannot be verified, a journal remains and the panel offers
**Discard Interrupted Import** after confirmation. Cleanup refuses when unrelated
artwork, changed tree state, changed ownership, or SHA-256-detected edits/deletion of existing
Drawings appear; inspect the Scene rather
than retrying blindly. Cleanup is the only new operation that deletes artwork,
and only artwork belonging to that failed/interrupted import. It is not a server
transaction; avoid concurrent GM edits during transfer.

**Current format limits:** Foundry v14; full-project/subtree export, empty or additive import;
one source Level; 20 MiB JSON, 2,000 nodes, 200 presets, 10,000 Drawings, and
1,000,000 point coordinates. Import reserves space for its wrapper, optional
Unassigned layer, and added presentation preset. Coordinates/geometry are bounded
to 10,000,000 pixels. Native validation that would silently change data is rejected.
Recovery-bearing packages and unknown Foundryshop metadata are refused rather than
discarded. Combined imported/existing counts must fit the limits. Explicit
multi-Level mapping and recovery exchange remain later milestones. WEBP and strict
vector SVG publication are available separately as described above.
JSON remains the editable-project import format. PNG/JPEG/WEBP image stamps are
now supported separately; image bytes are persistent assets, not embedded in JSON.
SVG/vector import remains out of scope. Reversible Level-background baking is
planned separately and is not part of JSON import or enabled in this build.

**Limits:** this first slice provides Drawing-only ordering for managed drawings
with the same elevation and rendering mode (`interface`). It rejects mixed
combinations rather than rewriting those properties. Unassigned artwork is not
part of the managed stack. Native visibility and lock flags are not overwritten.
Hidden artwork is presentation-only, **not confidential storage**; Drawing data
and Scene flags may still be available to player clients.

Writes are serialized on each client and stale revisions are rejected where
available. Foundry's separate document operations are not a server transaction;
simultaneous edits by different GMs are not guaranteed atomic. Avoid concurrent
shared-tree editing in this initial slice. If a reorder fails after persistence,
refresh the panel and use **Repair Drawing Order**. Partial membership operations
report an error: inspect the selected drawings and retry assignment explicitly.
Ordinary layer operations never delete artwork; journaled failed-import cleanup
removes only artwork created by that import.

Destructive layer/artwork deletion, expanded JSON exchange, WEBP/SVG export,
and reversible flattening are still pending. There is no Canvas Layers dependency,
legacy importer, or migration. Automated service/toolbox tests cover the foundation,
but native v14 rendering, drag/drop, Scene switching, and real GM/player reconnects
must be checked in a disposable v14 world before normal use. Preliminary foundation
tests have been reported passing by the user; the newly added hierarchy needs its
full live matrix. Basic preset tests have also been reported passing.

For the hierarchy milestone, test a group containing visible and hidden children
with both GM and player clients: hide/show the group, confirm the mixed settings
return, try Show All beneath a still-hidden ancestor, and fold/unfold without
changing canvas output. Move a whole nested group, reject a cyclic drop, and remove
a populated group into another layer while verifying the Drawing count is unchanged.
Also test cancellation and a Scene switch while a move/removal dialog is open.

For presets, save two locations with different child gates, switch them with a
connected player, and verify your GM workspace, brush, active layer, and selection
are unchanged. Add a player-visible layer after saving and verify applying the
older snapshot hides it. Remove a saved node, check Apply is disabled, then review
and replace the snapshot. Test cancellation, a Scene switch/stale change during
confirmation, player reconnect, and reopening the Scene after reload.

For locks, select a Drawing, lock its containing group, and verify it is released.
Try selection/drag, palette or Drawing-sheet edits, text changes, deletion, paste/
undo with managed membership, and assignment. Verify protected documents remain
unchanged and an explicit error is shown for rejected writes. Unlock the group and
confirm native locked Drawings remain locked while other strokes are editable.
Repeat with an independently locked child, another GM/player client, and after
Scene reload. Confirm presets and layer reordering still work while locked.

For JSON, export a disposable project with nested groups, native locked/hidden
Drawings, text, textures, presets, and Unassigned artwork. Import as a different GM
into an empty Drawing project, verifying fresh IDs, Level/author remapping, visual
styles/order, and unchanged Scene configuration. With a connected player, confirm
there is no staging flash and nothing is presented until a preset is applied.
Test translation, missing resources, cancellation, a Scene/Level switch during
dialogs, nonempty-target rejection, and export/import again after reload.
Copy the Scene and delete its Drawings while retaining layers/presets. In empty
mode, verify the separate replacement warning, cancellation at both confirmations,
and successful import without retaining duplicate old layers/presets.
For additive import, save a baseline project, add the same JSON twice, and verify
fresh IDs, unique preset names and new hidden groups above unchanged existing
artwork. Apply imported presets and verify existing gates restore their captured
values; apply an original preset and verify imported nodes become hidden. Test
incompatible render/order rejection and interrupted-import cleanup; existing
artwork must never be deleted or have its style/membership/sort rewritten.
For resource preflight, use a missing local texture and unavailable font, verify
import is blocked with no journal/artwork, then supply replacements and recheck.
Confirm replacements persist through re-export. Test a server HTML fallback,
redirect, timeout, and cancelled repair dialog. External URLs should generate no
preflight requests; check their acknowledgement is off by default and clearly
reported before import. Resource availability remains client/server-dependent.

## Stroke and Fill Settings

Foundry's native drag edge auto-pan can shift the map rapidly when drawing near
the screen border. Foundryshop disables it for new Drawing previews by default.
Enable **Auto-pan at Screen Edges While Drawing** in module settings to restore
the native behavior on your client. Normal navigation, moving/resizing existing
objects, and creation in other canvas layers are unchanged. Test a freehand stroke
near each edge after reload; it should no longer move the map beneath your pen.

The left side of the panel has Stroke and Fill configuration:

- **Color input** — 6-digit hex format (`#RRGGBB`). Invalid input is treated as black.
- **Opacity slider** — ranges from 0 to 1 with 0.1 step size.
- **Stroke width** — enter a number directly or use the +/- buttons (shift-click for +/- 5). Minimum 0.
- **Fill type** — None, Solid, or Pattern. Pattern paths must still be set through Foundry's default drawing configuration.

The color buttons at the top of each section toggle which tool (Stroke or Fill) the color selector modifies. The last edited tool is remembered across opens.

<img src="images/stroke_fill_button_example.png" width=40%>

## Color Selector

The right side of the panel provides a visual color picker:

- **Color canvas** — click and drag to pick colors by saturation and value.
- **Hue slider** — vertical slider on the right adjusts the hue.
- **RGB inputs** — individual 2-digit hex fields for fine-tuning red, green, and blue components.
- **Dropper tool** — sample a color directly from the game canvas. A preview grid follows your cursor showing the pixels around it. Left-click to grab a color, any other key or mouse button cancels.
- **Random button** — generates a random color.
- **Color swatches** — preset colors (configurable) and a recent color history.

<img src="images/dropper_preview_example.png" width=60%>

## Saved Colors

Choose **My Colors** or **Campaign Colors** in the Saved Colors section below the
picker. Click **Save Current Color** to save the active Stroke or Fill color,
with an optional name. The hex field is prefilled and read-only when saving;
you do not need to type the current color. A blank name uses the hex code.

- **My Colors:** per-user settings in the current world, available when that user
  signs in from another browser/computer. This is not a global cross-world palette.
- **Campaign Colors:** shared world settings. Everyone can select swatches;
  only GMs can save, edit, import, or delete campaign colors.
- Each saved row shows a solid color block. Click it to apply the color to the active Stroke/Fill target for new drawings.
  Hover to see its name and hex value.
- Use the pencil to rename or change a color; both fields start with the saved values. Use the trash button to delete,
  with confirmation.
- Each palette keeps one entry per color, case-insensitively. Saving a duplicate
  offers to rename the existing entry, preserving its position.
- **Import Preset Swatches** adds missing colors from your browser's preset
  setting without removing existing entries or modifying the original presets.
  Repeating the import does not create duplicates.

Changes are saved immediately; closing the panel is not required. Names are
limited to 80 characters and each palette to 256 colors. Saved palette updates
refresh the list without rebuilding the picker. Stale edit/delete dialogs are
rejected if the entry has changed before submission. Writes from one client are
serialized; simultaneous edits from different clients are not transactional, so
avoid editing the same palette concurrently.

Saved colors are separate from the existing presets and recent colors. Recent
history still saves final stroke/fill colors on close; improved history,
JSON import/export, style presets, and selected-drawing actions are future work.
The module keeps the original MIT license and attribution (see [Credits and history](#credits-and-history)).

## Drawing Toolbox

A small floating toolbox opens automatically whenever the **Drawings** controls
are active and hides when you switch layers or scenes. It is built for live map
sketching with a pen tablet: large tap targets, no hover/right-click/double-click
only actions, and buttons never take keyboard focus away from the canvas.

- **Tools** — Select, Rectangle, Ellipse, Polygon, Freehand, and Text, using
  Foundry's own tool activation (the highlight follows the scene controls).
- **Style** — Stroke/Fill chips choose which color a swatch sets; swap colors,
  toggle **No fill**, change line width (Shift = ±5, or scroll the mouse wheel
  over the Width row), and adjust opacity. Color chips and swatches are filled
  with the color they represent.
- **Colors** — tap a saved color (My Colors or Campaign Colors). **More colors**
  opens the detailed Quick Draw Config panel for picking and managing colors.
- **Labels** — click a saved label preview to arm a text-only cursor ghost.
  Click the canvas once to place it; successful placement disarms automatically.
  Escape or **Cancel placement** removes the ghost without creating artwork.
  Over the canvas, **Shift+wheel** rotates by 15 degrees and **Ctrl+wheel** changes
  font size by 1px. Visible rotation/font-size controls provide the same choices
  without modifiers; the textarea does not rotate. There is no label Next/Repeat
  mode or independent zoom. Click another label to replace the armed choice.
  **Manage labels** adds, edits and deletes entries and can explicitly restore
  starter labels. Defaults initialize once, so deleted examples stay deleted:
  Entrance, Hall, Storage,
  Stairs Up/Down, Cave, River, Ruins, Whispering Woods, Silver River, Old Watchtower,
  THE SUNKEN KEEP, THE WAYFARER'S REST and a multiline passage note.
  **My Labels** are per user; **Campaign Labels**
  are shared and editable only by a GM.
- **Selected** — with exactly one drawing selected, edit, apply the chosen
  label to, or clear its text (locked drawings and drawings you cannot edit are
  refused).

Close the toolbox to hide it until the next time you open the Drawings
controls, or reopen it with the toolbox button in the Drawings toolbar. The
chevron collapses it to the tool row; position and collapsed state are
remembered per browser. Settings: **Show Drawing Toolbox Automatically** and
**Drawing Toolbox Size** (Compact / Comfortable / Tablet). **Configure
Controls** offers unbound shortcuts for *Toggle Drawing Toolbox* and *Turn Off
Armed Label*, suitable for tablet express keys.

Plain labels use the drawing defaults' font, size and text color. Styled labels
save font, size, color and optional opacity explicitly. The **Labels** tab starts
with a font selector (each option uses its own typeface), a multiline text area,
size (8-256px), color and opacity controls. Text size has minus/plus buttons and
mouse-wheel adjustment over the size control: 1px per tick/click, or 5px with
Shift. Ctrl/Alt/Meta wheel gestures remain untouched. Adjustments update the draft
and preview immediately without writing brush defaults.
The parchment-backed textarea is
also the live preview: type directly in the selected font at the requested size,
color and opacity. Only the text fades; the background and caret remain visible,
including at zero opacity, and selection uses contrasting colors. The bounded
100-240px-high area resizes vertically and scrolls for large fonts. It previews
typography, not exact canvas wrapping or Foundry's outline/shadow effects.
Changes update in place without losing typing focus. Text/font/color/opacity editing
disarms placement; font-size changes update an armed ghost. **Place label** arms the
draft. Save copies it to the selected bank; Apply updates the one editable
selected Drawing without arming canvas placement. No brush-default writes occur.
Saved labels, including the default examples, appear below as clickable font-rendered words
with keyboard focus and selected states, rather than conventional button tiles.
The saved-label editor also offers the registered fonts and text-style fields. Choosing
"Use current Drawing text defaults" removes the saved style. Styled labels carry
their style through cursor placement and explicit application to selected
artwork without changing the brush defaults. Label editing/clearing on an
existing Drawing changes only its text; applying a styled label also changes its
font, size, color and any saved opacity. Missing fonts produce an error rather than silent substitution.
Add Starter Labels is additive and keeps existing same-text entries unchanged.
Saved-label samples show actual size from 16-64px, using a disclosed readable
representative scale outside that range. Collection samples omit opacity for
readability; the editor and cursor use the actual saved/draft opacity. Cursor size/
rotation changes do not silently overwrite saved entries.

The examples use **Signika** (24px room names and 22px notes), **Amiri** (36-48px
landscape names), and **Modesto Condensed** (48-64px headings). These font files
already ship with Foundry; Foundryshop does not redistribute or download them.
Other stock options in Foundry v14 are **Bruno Ace** (geometric sci-fi lettering)
and system-font choices **Arial**, **Courier**, **Courier New**, **Times**, and
**Times New Roman**. System-font appearance depends on the client's installed
fonts. Fonts registered through Foundry's Font Configuration are also offered.
The same 14 examples appear in the Library's Labels category as editable text
Drawings with font dependencies retained in JSON packages.
Numbered labels, bulk editing and pen pressure remain future work.

## Keyboard Shortcut

The Quick Draw Config window can be toggled with a keyboard shortcut. The default is **Ctrl+D**. The shortcut can be customized through Foundry's built-in **Configure Controls** menu (Game Settings > Configure Controls).

The current shortcut is displayed in the toolbar button tooltip.

## Settings

Module settings are found under **Game Settings > Module Settings**:

- **Color Selector Size** — size of the color picker canvas in pixels (minimum 100).
- **Dropper Preview Size** — size of the dropper preview window in pixels (minimum 20).
- **Dropper Read Radius** — how many pixels around the cursor are shown in the dropper preview.
- **Preset Color Swatches** — comma-separated hex color codes (`#RRGGBB` format). Displayed as clickable swatches below the color selector.
- **Recent Color History** — how many recently used colors to track and display as swatches.

<img src="images/settings.png" width=50%>
