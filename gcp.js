// GCP Compute API facade — mirrors the structure of aws.js.
// All functions are invoked from the main process via IPC.

const { MachineTypesClient } = require("@google-cloud/compute");
const { GoogleAuth } = require("google-auth-library");

// Returns client options for the given optional key file path.
function clientOpts(keyFile) {
  return keyFile ? { keyFilename: keyFile } : {};
}

// Returns { zone: string[] } — which of the requested machine types are offered
// in each zone. Uses aggregatedList for a single multi-zone API pass.
async function getOfferingsAggregated(projectId, machineTypes, keyFile, onProgress) {
  const client = new MachineTypesClient(clientOpts(keyFile));
  const wantSet = new Set(machineTypes);
  const out = {};
  let done = 0;

  for await (const [zoneKey, zoneData] of client.aggregatedListAsync({ project: projectId })) {
    if (!zoneKey.startsWith("zones/")) continue;
    const zone = zoneKey.replace("zones/", "");
    const available = (zoneData.machineTypes || [])
      .map((m) => m.name)
      .filter((n) => wantSet.has(n));
    if (available.length) out[zone] = available;
    done++;
    if (onProgress) onProgress(done, null, zone);
  }

  return out;
}

// Probes capacity via a dry-run instance insert (no actual instance is created).
// Returns { success: bool, message: string }.
async function probeCapacity({ projectId, zone, machineType, count, keyFile }) {
  try {
    const auth = new GoogleAuth({
      ...clientOpts(keyFile),
      scopes: ["https://www.googleapis.com/auth/compute"],
    });
    const authClient = await auth.getClient();
    const { token } = await authClient.getAccessToken();

    const url =
      `https://compute.googleapis.com/compute/v1/projects/${projectId}` +
      `/zones/${zone}/instances?dryRun=true`;

    const body = {
      name: `gpu-hunter-probe-${Date.now()}`,
      machineType: `zones/${zone}/machineTypes/${machineType}`,
      disks: [{
        boot: true,
        autoDelete: true,
        initializeParams: {
          sourceImage: "projects/debian-cloud/global/images/family/debian-12",
        },
      }],
      networkInterfaces: [{ accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] }],
      scheduling: { onHostMaintenance: "TERMINATE" },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      return {
        success: true,
        message: `Capacity available — dry-run confirmed (${count}× ${machineType} in ${zone})`,
      };
    }

    const errBody = await resp.json().catch(() => ({}));
    const reason =
      errBody?.error?.errors?.[0]?.reason ||
      errBody?.error?.message ||
      resp.statusText;

    if (
      reason === "ZONE_RESOURCE_POOL_EXHAUSTED" ||
      reason === "RESOURCE_EXHAUSTED" ||
      String(reason).includes("EXHAUSTED")
    ) {
      return { success: false, message: `No capacity right now (${reason})` };
    }
    return { success: false, message: reason };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

module.exports = { getOfferingsAggregated, probeCapacity };
