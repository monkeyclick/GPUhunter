const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeRows } = require("../core/scan");

test("merges AWS offerings and spot scores into one row per (cloud, region, az, type)", () => {
  const { rows } = mergeRows({
    offerings: {
      "us-east-1": { "us-east-1a": ["g5.xlarge", "g5.2xlarge"] },
    },
    spot: {
      results: [{ region: "us-east-1", azId: "use1-az1", score: 8, instanceTypes: ["g5.xlarge"] }],
    },
    azIdMap: { "use1-az1": "us-east-1a" },
    mode: "both",
  });

  const g5x = rows.find((r) => r.instanceType === "g5.xlarge");
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...g5x },
    {
      cloud: "aws",
      region: "us-east-1",
      az: "us-east-1a",
      instanceType: "g5.xlarge",
      family: "g5",
      ondemandOffered: true,
      spotScore: 8,
    }
  );
});

test("keeps the max spot score when multiple chunks report the same row", () => {
  const spotRow = (score) => ({
    region: "us-east-1", azId: "use1-az1", score, instanceTypes: ["p5.48xlarge"],
  });
  const { rows } = mergeRows({
    spot: { results: [spotRow(3), spotRow(7), spotRow(5)] },
    azIdMap: { "use1-az1": "us-east-1a" },
    mode: "spot",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotScore, 7);
});

test("OD is false when offerings were queried but absent, null when not queried", () => {
  const spot = {
    results: [{ region: "us-east-1", azId: "use1-az1", score: 5, instanceTypes: ["g6.xlarge"] }],
  };
  const azIdMap = { "use1-az1": "us-east-1a" };

  const queried = mergeRows({ offerings: {}, spot, azIdMap, mode: "both" });
  assert.equal(queried.rows[0].ondemandOffered, false);

  const notQueried = mergeRows({ offerings: {}, spot, azIdMap, mode: "spot" });
  assert.equal(notQueried.rows[0].ondemandOffered, null);
});

test("skips regions whose offerings errored", () => {
  const { rows } = mergeRows({
    offerings: {
      "us-east-1": { _error: "boom" },
      "us-west-2": { "us-west-2b": ["g5.xlarge"] },
    },
    mode: "ondemand",
  });
  assert.deepEqual(rows.map((r) => r.region), ["us-west-2"]);
});

test("GCP zones derive their region, keep cloud=gcp, and never get OD forced to false", () => {
  const { rows, warnings } = mergeRows({
    gcpOfferings: { "us-central1-a": ["a3-highgpu-8g"], "us-central1-b": ["a3-highgpu-8g"] },
    mode: "spot", // AWS OD not queried — GCP rows must be unaffected
  });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.cloud, "gcp");
    assert.equal(r.region, "us-central1");
    assert.equal(r.family, "a3-highgpu");
    assert.equal(r.ondemandOffered, true);
  }
  assert.equal(warnings.length, 0);
});

test("unknown GCP regions produce rows plus a catalog warning", () => {
  const { rows, warnings } = mergeRows({
    gcpOfferings: { "mars-central1-a": ["a3-highgpu-8g"] },
    mode: "both",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].region, "mars-central1");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /mars-central1/);
});

test("same type in AWS and GCP-style rows do not collide across clouds", () => {
  const { rows } = mergeRows({
    offerings: { "us-east-1": { "us-east-1a": ["g5.xlarge"] } },
    gcpOfferings: { "us-east1-b": ["g2-standard-4"] },
    mode: "ondemand",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((r) => r.cloud)), new Set(["aws", "gcp"]));
});
