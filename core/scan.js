// Shared scan orchestration — extracted from renderer/app.js so both the Electron
// GUI and the CLI can produce the same unified row list. Calls the aws.js / gcp.js
// facades directly (no Electron IPC).

const aws = require("../aws");
const gcp = require("../gcp");
const { REGIONS, familyOf, isOptIn } = require("../renderer/catalog");

// Runs an AWS + GCP capacity scan and returns merged rows.
//
// opts:
//   cloud            "aws" | "gcp" | "both"            (default "both")
//   mode             "ondemand" | "spot" | "both"      (default "both")
//   instanceTypes    string[]  — AWS use ".", GCP use "-"
//   targetCapacity   number    — for Spot placement scores (default 1)
//   profile          string|null — AWS named profile
//   gcpProjectId     string|null
//   gcpKeyFile       string|null
//   preferredRegions string[]  — if non-empty, restricts AWS scan to these
//   includeOptIn     bool      — include AWS opt-in regions when no preferred list
//   onProgress       (phase, done, total, label) => void   — emitted to caller (e.g. stderr)
//
// Returns { rows, errors, scanRegions }. Throws on fatal credential/region failures.
async function runScan({
  cloud = "both",
  mode = "both",
  instanceTypes = [],
  targetCapacity = 1,
  profile = null,
  gcpProjectId = null,
  gcpKeyFile = null,
  preferredRegions = [],
  includeOptIn = false,
  onProgress = () => {},
} = {}) {
  if (!instanceTypes.length) throw new Error("No instance types selected.");

  const wantAws = cloud === "aws" || cloud === "both";
  const wantGcp = cloud === "gcp" || cloud === "both";
  if (wantGcp && !gcpProjectId && cloud === "gcp") {
    throw new Error("A GCP project id is required (--gcp-project).");
  }

  // ---- AWS scan -----------------------------------------------------------
  let offerings = {};
  let spot = { results: [], errors: [] };
  let azIdMap = {};
  let scanRegions = [];

  if (wantAws) {
    let enabled;
    try {
      enabled = await aws.listEnabledRegions(profile);
    } catch (e) {
      throw new Error(`Failed to list AWS regions. Check credentials. ${e.message || e}`);
    }

    const preferred = (preferredRegions || []).filter(Boolean);
    scanRegions = enabled.filter((r) => {
      if (!REGIONS[r]) return false;
      if (preferred.length > 0) return preferred.includes(r);
      return includeOptIn || !isOptIn(r);
    });

    if (scanRegions.length === 0 && cloud === "aws") {
      throw new Error("No regions to scan — none of your preferred regions are enabled on this account.");
    }

    if (scanRegions.length > 0) {
      const awsTypes = instanceTypes.filter((t) => t.includes("."));
      if (awsTypes.length > 0) {
        const tasks = [];
        if (mode === "both" || mode === "ondemand") {
          tasks.push(
            aws
              .getOfferingsMultiRegion(scanRegions, awsTypes, profile, (done, total, region) =>
                onProgress("offerings", done, total, region)
              )
              .then((o) => (offerings = o))
          );
        }
        if (mode === "both" || mode === "spot") {
          tasks.push(
            aws
              .getSpotPlacementScores(awsTypes, targetCapacity, scanRegions, profile, (done, total) =>
                onProgress("spot", done, total)
              )
              .then((s) => (spot = s))
          );
        }
        await Promise.all(tasks);

        if (spot.results.length) {
          azIdMap = await aws.getAzIdNameMap(scanRegions, profile);
        }
      }
    }
  }

  // ---- GCP scan -----------------------------------------------------------
  let gcpOfferings = {};
  const extraErrors = [];

  if (wantGcp && gcpProjectId) {
    const gcpTypes = instanceTypes.filter((t) => !t.includes("."));
    if (gcpTypes.length === 0 && cloud === "gcp") {
      throw new Error("No GCP instance types selected (GCP types use hyphens, e.g. a3-highgpu-8g).");
    }
    if (gcpTypes.length > 0) {
      try {
        gcpOfferings = await gcp.getOfferingsAggregated(
          gcpProjectId,
          gcpTypes,
          gcpKeyFile,
          (done, total, zone) => onProgress("gcp", done, total, zone)
        );
      } catch (e) {
        if (cloud === "gcp") throw new Error(`GCP scan failed: ${e.message || e}`);
        extraErrors.push({ message: `GCP: ${e.message || e}` });
      }
    }
  }

  // ---- Merge into unified rows --------------------------------------------
  const map = new Map(); // key = cloud|region|az|type
  function upsert(region, az, type, patch) {
    const rowCloud = patch.cloud || "aws";
    const key = `${rowCloud}|${region}|${az || ""}|${type}`;
    const existing = map.get(key) || {
      cloud: rowCloud,
      region,
      az: az || null,
      instanceType: type,
      family: familyOf(type),
      ondemandOffered: null,
      spotScore: null,
    };
    if (patch.ondemandOffered === true) existing.ondemandOffered = true;
    else if (existing.ondemandOffered == null && patch.ondemandOffered === false)
      existing.ondemandOffered = false;
    if (patch.spotScore != null) {
      existing.spotScore =
        existing.spotScore == null ? patch.spotScore : Math.max(existing.spotScore, patch.spotScore);
    }
    map.set(key, existing);
  }

  const knowOd = mode === "both" || mode === "ondemand";

  for (const [region, azMap] of Object.entries(offerings)) {
    if (azMap && azMap._error) continue;
    for (const [az, types_] of Object.entries(azMap || {})) {
      for (const t of types_) upsert(region, az, t, { ondemandOffered: true });
    }
  }
  for (const s of spot.results) {
    const azName = azIdMap[s.azId] || s.azId || null;
    for (const t of s.instanceTypes || []) {
      upsert(s.region, azName, t, { spotScore: s.score });
    }
  }
  // GCP on-demand offerings — zone is both the AZ and the source of the region.
  for (const [zone, zoneTypes] of Object.entries(gcpOfferings)) {
    const region = zone.split("-").slice(0, -1).join("-");
    for (const t of zoneTypes) {
      upsert(region, zone, t, { ondemandOffered: true, cloud: "gcp" });
    }
  }

  const rows = [...map.values()].map((r) => ({
    ...r,
    ondemandOffered: r.cloud === "gcp" ? r.ondemandOffered : knowOd ? r.ondemandOffered === true : null,
  }));

  return { rows, errors: [...(spot.errors || []), ...extraErrors], scanRegions };
}

module.exports = { runScan };
