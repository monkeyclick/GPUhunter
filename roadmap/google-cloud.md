# Google Cloud Platform Support — Implementation Roadmap

## Overview

Add GCP as a second cloud provider alongside AWS. Users will be able to scan GCP zones
for GPU instance availability, view results on the same world map, filter by cloud, and
probe capacity — all from the existing GPU Hunter UI.

**Estimated total effort:** 6–8 days of focused work across 5 phases.

---

## Architecture Decision: Cloud Selector (Recommended)

Two possible models:

| Model | Description | Pros | Cons |
|---|---|---|---|
| **Cloud selector** | Sidebar toggle: AWS / GCP / Both. One cloud's state at a time, or merged. | Clean, ships faster | Can't compare side-by-side until "Both" is done |
| **Side-by-side** | Always scan both simultaneously | Most powerful | 2× complexity on first ship |

**Recommendation: build Cloud Selector with a "Both" option in Phase 4.**
Ship AWS + GCP independently first, then merge in the final phase. Each phase is
independently useful and releasable.

---

## GCP Instance Families (Catalog)

| Family | GPU | VRAM/GPU | Sizes |
|---|---|---|---|
| `a2-highgpu` | NVIDIA A100 (40 GB) | 40 GB | 1g, 2g, 4g, 8g |
| `a2-megagpu` | NVIDIA A100 (40 GB) | 40 GB | 16g |
| `a2-ultragpu` | NVIDIA A100 (80 GB) | 80 GB | 1g, 2g, 4g, 8g |
| `g2-standard` | NVIDIA L4 | 24 GB | 4, 8, 12, 16, 24, 32, 48, 96 |
| `a3-highgpu` | NVIDIA H100 (80 GB SXM) | 80 GB | 1g, 2g, 4g, 8g |
| `a3-megagpu` | NVIDIA H100 (80 GB SXM5) | 80 GB | 8g |
| `a3-ultragpu` | NVIDIA H200 (141 GB) | 141 GB | 8g |

Full instance type strings follow the pattern `{family}-{size}` — e.g. `a2-highgpu-4g`,
`g2-standard-48`.

---

## GCP Regions to Add

Only regions where GCP GPU types are generally available or in preview:

```
us-central1       Iowa
us-east1          S. Carolina
us-east4          N. Virginia
us-east5          Columbus
us-south1         Dallas
us-west1          Oregon
us-west4          Las Vegas
northamerica-northeast1  Montréal
southamerica-east1       São Paulo
europe-west1      Belgium
europe-west2      London
europe-west3      Frankfurt
europe-west4      Netherlands
europe-west6      Zürich
europe-west9      Paris
asia-east1        Taiwan
asia-northeast1   Tokyo
asia-northeast3   Seoul
asia-south1       Mumbai
asia-southeast1   Singapore
australia-southeast1     Sydney
me-central1       Doha
```

GCP zones append a letter suffix: `us-central1-a`, `us-central1-b`, etc.

---

## Authentication Model

GCP uses **Application Default Credentials (ADC)** — different from AWS named profiles.

Three ADC sources, tried in order:
1. `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to a service account JSON file
2. `gcloud auth application-default login` (user credentials on developer machines)
3. GCE metadata server (when running on GCP itself)

**In the UI:** add a "GCP credentials" text field in the sidebar that accepts either:
- A path to a service account JSON file
- A GCP project ID (required for all API calls)

The project ID is mandatory for GCP Compute API calls — there is no account-global
equivalent to AWS's `DescribeRegions`.

---

## Phase 1 — Catalog & Region Data

**Effort:** 0.5 days  
**Files touched:** `renderer/catalog.js`  
**Releasable:** No (foundation only)

### Tasks

1. Add `cloud` field to `INSTANCE_FAMILIES` entries (`"aws"` or `"gcp"`)
2. Add all GCP GPU families to `INSTANCE_FAMILIES`
3. Add GCP regions to the `REGIONS` map with lat/lon coordinates
4. Export a `cloudOf(instanceType)` helper (or derive from the `cloud` field in the family)
5. Update `familyOf()` to handle GCP naming — GCP types use hyphens throughout
   (`a2-highgpu-4g.split(".")` returns the full string; need a different split strategy)

### familyOf() Fix for GCP

Current implementation splits on `.` which works for AWS (`g5.2xlarge` → `g5`).
GCP types have no `.` — the type IS the family + size with hyphens. The fix:

```js
// Map full GCP type → family key, e.g. "a2-highgpu-4g" → "a2-highgpu"
const GCP_TYPE_TO_FAMILY = Object.fromEntries(
  Object.entries(INSTANCE_FAMILIES)
    .filter(([, m]) => m.cloud === "gcp")
    .flatMap(([fam, m]) => m.sizes.map(s => [s, fam]))
);

export function familyOf(instanceType) {
  return GCP_TYPE_TO_FAMILY[instanceType] ?? instanceType.split(".")[0];
}
```

---

## Phase 2 — GCP API Facade (`gcp.js`)

**Effort:** 2–2.5 days  
**Files touched:** `gcp.js` (new), `package.json`  
**Releasable:** No (backend only)

### New dependency

```
@google-cloud/compute   ^4.x   (REST wrapper around Compute Engine API v1)
```

### Functions to implement (mirroring `aws.js`)

#### `listEnabledZones(projectId, credentials)`
Calls `compute.zones.list` for the project. Returns `{ region, zone }` objects.
GCP zones are first-class; regions are derived by stripping the last `-{letter}`.

```js
// GET https://compute.googleapis.com/compute/v1/projects/{project}/zones
// Filter: status == "UP"
```

#### `getOfferingsForZone(projectId, zone, machineTypes, credentials)`
Calls `compute.machineTypes.list` for the zone and filters to requested types.
Returns `Set<string>` of available types in that zone.

```js
// GET .../zones/{zone}/machineTypes
// Filter by name in the requested list
// A type being present = it CAN be provisioned (not necessarily has current capacity)
```

#### `getOfferingsMultiZone(projectId, zones, machineTypes, credentials, onProgress)`
Same bounded-concurrency pattern as AWS version (8 workers). Each worker
calls `getOfferingsForZone` and fires `onProgress(done, total, zone)`.

#### `getSpotAvailability(projectId, zones, machineTypes, credentials)`
**No GCP equivalent to `GetSpotPlacementScores`.** Best proxy:
- Call `compute.machineTypes.get` per zone/type (cheap read)  
- If the machine type exists in that zone → mark Spot as "available" (binary, no score)
- Return a synthetic score of `null` with an `available: true/false` flag

This means the Spot score column will show `—` for GCP rows. Document this clearly
in the UI with a tooltip: *"GCP does not expose a Spot placement score."*

#### `probeCapacity({ projectId, zone, machineType, count, credentials })`
GCP does not support short-lived capacity reservations for probing. Two options:
1. **Dry-run insert** — send a `compute.instances.insert` with `?dryRun=true`.
   Returns 200 if schedulable, 4xx if not. Zero cost, no instance created.
2. **Skip** — disable the Probe button for GCP rows and show a tooltip explaining why.

Recommendation: implement dry-run first (less surprising), fall back to "not supported"
if the dry-run API proves unreliable.

### `gcp.js` outline

```js
const { GoogleAuth } = require("google-auth-library");
const { ZonesClient, MachineTypesClient, InstancesClient } = require("@google-cloud/compute");

function makeClients(projectId, keyFilePath) {
  const authOpts = keyFilePath ? { keyFilename: keyFilePath } : {};
  return {
    zones:    new ZonesClient(authOpts),
    machines: new MachineTypesClient(authOpts),
    instances: new InstancesClient(authOpts),
    project: projectId,
  };
}

module.exports = {
  listEnabledZones,
  getOfferingsMultiZone,
  getSpotAvailability,
  probeCapacity,
};
```

---

## Phase 3 — IPC Bridge & Preload

**Effort:** 0.5 days  
**Files touched:** `main.js`, `preload.js`  
**Releasable:** No

### New IPC handlers in `main.js`

```js
const gcp = require("./gcp");

ipcMain.handle("gcp:listZones",    async (_e, { projectId, credentials }) => ...);
ipcMain.handle("gcp:getOfferings", async (e,  { projectId, zones, machineTypes, credentials }) => ...);
ipcMain.handle("gcp:getSpot",      async (_e, { projectId, zones, machineTypes, credentials }) => ...);
ipcMain.handle("gcp:probe",        async (_e, args) => ...);
```

Progress events reuse the existing `aws:progress` IPC channel — just add `cloud: "gcp"`
to the payload so the renderer can distinguish them.

### New methods in `preload.js`

```js
gcpListZones:    (args) => ipcRenderer.invoke("gcp:listZones",    args),
gcpGetOfferings: (args) => ipcRenderer.invoke("gcp:getOfferings", args),
gcpGetSpot:      (args) => ipcRenderer.invoke("gcp:getSpot",      args),
gcpProbe:        (args) => ipcRenderer.invoke("gcp:probe",        args),
```

---

## Phase 4 — UI: Cloud Selector & Credentials

**Effort:** 1.5 days  
**Files touched:** `renderer/index.html`, `renderer/app.js`, `renderer/styles.css`  
**Releasable:** Yes — this is the first user-visible phase

### Sidebar changes

Replace the single "AWS profile" section with a **Cloud** section:

```
┌─────────────────────────────┐
│  Cloud                       │
│  [AWS]  [GCP]  [Both]        │
│                              │
│  — AWS ─────────────────     │
│  Profile  [____________]     │
│                              │
│  — GCP ─────────────────     │
│  Project ID  [__________]    │
│  Key file    [__________]    │
└─────────────────────────────┘
```

- AWS section shows/hides based on cloud selection
- GCP section shows/hides based on cloud selection  
- "Both" shows both credential sections

### State changes in `app.js`

```js
const state = {
  rows: [],         // now includes { cloud: "aws" | "gcp", ... }
  scanRegions: [],
  mode: "both",
  cloud: "aws",     // NEW: "aws" | "gcp" | "both"
  errors: [],
};
```

### Filter changes

- Add `cloud` column to the Detail table (shown only when `state.cloud === "both"`)
- Add cloud filter chip to the filter bar
- Top Regions panel: add cloud breakdown

### Map changes

- Different marker shape or color border per cloud (e.g. circle = AWS, square = GCP)
- Popup shows which cloud(s) have data for that region

### Scan flow changes in `app.js`

```js
// In scanBtn click handler:
const tasks = [];
if (state.cloud === "aws" || state.cloud === "both") {
  tasks.push(runAwsScan(...));
}
if (state.cloud === "gcp" || state.cloud === "both") {
  tasks.push(runGcpScan(...));
}
await Promise.all(tasks);
// merge results into state.rows
```

---

## Phase 5 — Probe Tab: GCP Support

**Effort:** 0.5 days  
**Files touched:** `renderer/app.js`, `renderer/index.html`  
**Releasable:** Yes

### Changes

- Probe queue items get a `cloud` field
- The "Probe" button for GCP rows triggers `api.gcpProbe(...)` instead of `api.probe(...)`
- If dry-run is not available, disable the Probe button for GCP rows and show:
  *"GCP capacity probing uses dry-run instance insert. Enable in settings."*
- The manual-add form gets a Cloud selector that switches between:
  - AWS: region + AZ dropdown
  - GCP: project + zone dropdown

---

## Phase 6 — Defaults, Cache & Export

**Effort:** 0.5 days  
**Files touched:** `renderer/app.js`  
**Releasable:** Yes (polish)

### Changes

- `FACTORY_DEFAULTS` gets `cloud`, `gcpProjectId`, `gcpKeyFile`, `gcpDefaultZone`
- Defaults modal gets GCP credential fields and default cloud selection
- Scan cache (`SCAN_CACHE_KEY`) includes `cloud` field — restoring a GCP cache correctly
  selects GCP mode on load
- CSV export adds a `cloud` column
- `renderer/catalog.js` `familySpec()` — GCP families lack `.spec`, so the sidebar label
  falls through to `gpu · vramGb GB` which already works correctly

---

## File Change Summary

| File | Change type | Notes |
|---|---|---|
| `renderer/catalog.js` | Modify | Add `cloud` field, GCP families, GCP regions, fix `familyOf()` |
| `gcp.js` | **New** | GCP API facade (mirrors `aws.js`) |
| `main.js` | Modify | Add 4 GCP IPC handlers |
| `preload.js` | Modify | Expose 4 GCP methods |
| `renderer/index.html` | Modify | Cloud selector, GCP credential fields, probe form |
| `renderer/app.js` | Modify | State, scan flow, filters, map, probe, defaults, cache |
| `renderer/styles.css` | Modify | Cloud selector toggle, GCP marker style |
| `package.json` | Modify | Add `@google-cloud/compute` dependency |

---

## Dependencies

```
@google-cloud/compute   ^4.x    (production)
```

No new dev dependencies required. `@google-cloud/compute` bundles its own auth via
`google-auth-library` as a transitive dep.

---

## Known Limitations & Trade-offs

| Limitation | Impact | Mitigation |
|---|---|---|
| No Spot placement score on GCP | Spot score column is blank for GCP rows | Show tooltip; consider a binary available/unavailable indicator |
| GCP requires project ID | Users need to know their project ID | Pre-fill from `gcloud config get-value project` if available via child_process |
| Zone-level availability (not regional) | GCP results appear at zone granularity, AWS at AZ | Normalize: treat GCP zone = AWS AZ in `state.rows` |
| No short-lived reservations for probing | Probe works differently on GCP | Dry-run instance insert; document behavior clearly |
| GCP machine type naming has no `.` | `familyOf()` breaks for GCP types | Fixed in Phase 1 with lookup map |
| `a3-megagpu` / `a3-ultragpu` limited preview | Availability queries may return no results in most zones | Show gracefully as "not offered" |

---

## Suggested Release Sequence

```
v0.2  — Phases 1-3  (catalog + backend, no UI change, internal)
v0.3  — Phase 4     (cloud selector, GCP scan visible to users)
v0.4  — Phase 5     (GCP probe support)
v0.5  — Phase 6     (GCP in defaults, cache, export)
```

Each version is a GitHub Release tag that triggers the CI workflow already in place.
