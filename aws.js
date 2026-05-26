// AWS facade - all SDK calls live here, invoked from the main process via IPC.

const {
  EC2Client,
  DescribeRegionsCommand,
  DescribeInstanceTypeOfferingsCommand,
  DescribeAvailabilityZonesCommand,
  GetSpotPlacementScoresCommand,
  CreateCapacityReservationCommand,
  CancelCapacityReservationCommand,
} = require("@aws-sdk/client-ec2");
const { fromIni, fromEnv, fromNodeProviderChain } = require("@aws-sdk/credential-providers");

const SPS_CHUNK = 25;       // GetSpotPlacementScores caps InstanceTypes per call.
const SPS_CONCURRENCY = 4;  // Parallel chunk requests.

function makeClient(region, profile) {
  const cfg = {
    region,
    maxAttempts: 4,
  };
  if (profile && profile.trim() !== "") {
    cfg.credentials = fromIni({ profile: profile.trim() });
  } else {
    cfg.credentials = fromNodeProviderChain();
  }
  return new EC2Client(cfg);
}

async function listEnabledRegions(profile) {
  const ec2 = makeClient("us-east-1", profile);
  const resp = await ec2.send(new DescribeRegionsCommand({ AllRegions: false }));
  return (resp.Regions || []).map((r) => r.RegionName).sort();
}

async function getOfferingsForRegion(region, instanceTypes, profile) {
  const ec2 = makeClient(region, profile);
  const out = {}; // { az: Set<type> }
  let nextToken;
  do {
    const resp = await ec2.send(
      new DescribeInstanceTypeOfferingsCommand({
        LocationType: "availability-zone",
        Filters: [{ Name: "instance-type", Values: instanceTypes }],
        NextToken: nextToken,
      })
    );
    for (const o of resp.InstanceTypeOfferings || []) {
      if (!out[o.Location]) out[o.Location] = new Set();
      out[o.Location].add(o.InstanceType);
    }
    nextToken = resp.NextToken;
  } while (nextToken);
  // Convert sets to arrays for IPC serialization.
  const ser = {};
  for (const az of Object.keys(out)) ser[az] = Array.from(out[az]);
  return ser;
}

async function getOfferingsMultiRegion(regions, instanceTypes, profile, onProgress) {
  const out = {};
  let done = 0;
  // Bounded concurrency.
  const concurrency = 8;
  const queue = [...regions];
  async function worker() {
    while (queue.length) {
      const region = queue.shift();
      try {
        out[region] = await getOfferingsForRegion(region, instanceTypes, profile);
      } catch (e) {
        out[region] = { _error: e.message || String(e) };
      }
      done++;
      if (onProgress) onProgress(done, regions.length, region);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, regions.length) }, () => worker())
  );
  return out;
}

async function getSpotPlacementScores(instanceTypes, targetCapacity, regions, profile, onProgress) {
  const ec2 = makeClient("us-east-1", profile);
  const results = [];
  const errors = [];

  const chunks = [];
  for (let i = 0; i < instanceTypes.length; i += SPS_CHUNK) {
    chunks.push(instanceTypes.slice(i, i + SPS_CHUNK));
  }

  let done = 0;
  const queue = [...chunks];

  async function worker() {
    while (queue.length) {
      const chunk = queue.shift();
      let nextToken;
      do {
        try {
          const resp = await ec2.send(
            new GetSpotPlacementScoresCommand({
              InstanceTypes: chunk,
              TargetCapacity: targetCapacity,
              SingleAvailabilityZone: true,
              RegionNames: regions,
              NextToken: nextToken,
            })
          );
          for (const s of resp.SpotPlacementScores || []) {
            results.push({
              region: s.Region,
              azId: s.AvailabilityZoneId,
              score: s.Score,
              instanceTypes: chunk,
            });
          }
          nextToken = resp.NextToken;
        } catch (e) {
          errors.push({ chunk, message: e.message || String(e) });
          nextToken = undefined;
          break;
        }
      } while (nextToken);
      done++;
      if (onProgress) onProgress(done, chunks.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SPS_CONCURRENCY, chunks.length || 1) }, () => worker())
  );

  return { results, errors };
}

async function getAzIdNameMap(regions, profile) {
  const out = {};
  await Promise.all(
    regions.map(async (region) => {
      try {
        const ec2 = makeClient(region, profile);
        const resp = await ec2.send(new DescribeAvailabilityZonesCommand({}));
        for (const az of resp.AvailabilityZones || []) {
          if (az.ZoneId && az.ZoneName) out[az.ZoneId] = az.ZoneName;
        }
      } catch {
        // skip - region may be disabled
      }
    })
  );
  return out;
}

async function probeCapacity({ region, az, instanceType, count, profile }) {
  const ec2 = makeClient(region, profile);
  // Min CR duration is 1 minute; use 2 for clock-skew safety.
  const end = new Date(Date.now() + 2 * 60 * 1000);
  let crId;
  try {
    const resp = await ec2.send(
      new CreateCapacityReservationCommand({
        InstanceType: instanceType,
        InstancePlatform: "Linux/UNIX",
        AvailabilityZone: az,
        InstanceCount: count,
        EndDateType: "limited",
        EndDate: end,
        InstanceMatchCriteria: "targeted",
        Tenancy: "default",
      })
    );
    crId = resp.CapacityReservation?.CapacityReservationId;
  } catch (e) {
    const code = e.name || e.Code || "";
    if (code === "InsufficientInstanceCapacity" || code === "InsufficientCapacityError") {
      return { success: false, message: "No capacity right now (InsufficientInstanceCapacity)" };
    }
    return { success: false, message: `${code}: ${e.message || e}` };
  }
  try {
    await ec2.send(new CancelCapacityReservationCommand({ CapacityReservationId: crId }));
  } catch (e) {
    return {
      success: true,
      message: `Available, but cancel failed (CR ${crId}). Cancel manually! Details: ${e.message || e}`,
    };
  }
  return { success: true, message: `Available (probed CR ${crId}, cancelled)` };
}

module.exports = {
  listEnabledRegions,
  getOfferingsMultiRegion,
  getSpotPlacementScores,
  getAzIdNameMap,
  probeCapacity,
};
