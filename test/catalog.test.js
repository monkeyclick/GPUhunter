const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INSTANCE_FAMILIES,
  ALL_INSTANCE_TYPES,
  REGIONS,
  GCP_REGIONS,
  familyOf,
  cloudOf,
  regionLabel,
  isOptIn,
} = require("../renderer/catalog");

test("every size resolves back to its own family via familyOf", () => {
  for (const [fam, meta] of Object.entries(INSTANCE_FAMILIES)) {
    for (const size of meta.sizes) {
      assert.equal(familyOf(size), fam, `familyOf(${size})`);
    }
  }
});

test("instance types are globally unique", () => {
  assert.equal(new Set(ALL_INSTANCE_TYPES).size, ALL_INSTANCE_TYPES.length);
});

test("AWS types use '.', GCP types use '-' only", () => {
  for (const [fam, meta] of Object.entries(INSTANCE_FAMILIES)) {
    for (const size of meta.sizes) {
      if (cloudOf(meta) === "gcp") {
        assert.ok(!size.includes("."), `GCP type ${size} must not contain "."`);
      } else {
        assert.ok(size.includes("."), `AWS type ${size} must contain "."`);
      }
    }
  }
});

test("GCP_REGIONS detection matches the catalog's cloud split", () => {
  // GCP region codes end in letter+digits (us-central1); AWS end in -digit (us-east-1).
  for (const code of Object.keys(REGIONS)) {
    const looksGcp = GCP_REGIONS.has(code);
    assert.equal(looksGcp, !/-\d+$/.test(code), `region ${code}`);
  }
});

test("GCP families' sizes land in GCP zone-derived regions (smoke: familyOf on hyphenated)", () => {
  assert.equal(familyOf("a3-highgpu-8g"), "a3-highgpu");
  assert.equal(familyOf("g2-standard-96"), "g2-standard");
  assert.equal(familyOf("g5.xlarge"), "g5");
});

test("regionLabel and isOptIn behave for known and unknown regions", () => {
  assert.equal(regionLabel("us-east-1"), "us-east-1 (N. Virginia)");
  assert.equal(regionLabel("nowhere-1"), "nowhere-1");
  assert.equal(isOptIn("ap-east-1"), true);
  assert.equal(isOptIn("us-east-1"), false);
  assert.equal(isOptIn("nowhere-1"), false);
});
