const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../cli");
const { toCsv, odLabel, CSV_HEADER } = require("../renderer/format");
const { chunkByFamily } = require("../aws");

test("parseArgs handles --flag value, --flag=value, boolean flags, and positionals", () => {
  const args = parseArgs(["scan", "--families", "g5,p5", "--min-score=7", "--json", "--csv"]);
  assert.deepEqual(args._, ["scan"]);
  assert.equal(args.families, "g5,p5");
  assert.equal(args["min-score"], "7");
  assert.equal(args.json, true);
  assert.equal(args.csv, true);
});

test("parseArgs: a value starting with '--' is not swallowed as the previous flag's value", () => {
  const args = parseArgs(["--verbose", "--sort", "region"]);
  assert.equal(args.verbose, true);
  assert.equal(args.sort, "region");
});

test("toCsv escapes quotes and renders OD tri-state", () => {
  const rows = [
    { cloud: "aws", region: "us-east-1", az: 'a"b', instanceType: "g5.xlarge", family: "g5", spotScore: 7, ondemandOffered: true },
    { region: "us-west-2", az: null, instanceType: "p5.48xlarge", family: "p5", spotScore: null, ondemandOffered: null },
  ];
  const lines = toCsv(rows).split("\n");
  assert.equal(lines[0], CSV_HEADER.map((h) => `"${h}"`).join(","));
  assert.equal(lines[1], '"aws","us-east-1","a""b","g5.xlarge","g5","7","yes"');
  assert.equal(lines[2], '"aws","us-west-2","","p5.48xlarge","p5","",""');
});

test("odLabel tri-state", () => {
  assert.equal(odLabel(true), "yes");
  assert.equal(odLabel(false), "no");
  assert.equal(odLabel(null), "");
});

test("chunkByFamily never mixes families in one Spot score request", () => {
  const chunks = chunkByFamily(["g5.xlarge", "p5.48xlarge", "g5.2xlarge", "g6.xlarge"]);
  for (const chunk of chunks) {
    const fams = new Set(chunk.map((t) => t.split(".")[0]));
    assert.equal(fams.size, 1, `mixed chunk: ${chunk}`);
  }
  assert.equal(chunks.flat().length, 4);
  assert.equal(chunks.length, 3); // g5 (2 types), p5, g6
});

test("chunkByFamily splits an oversized family at the 25-type API cap", () => {
  const big = Array.from({ length: 30 }, (_, i) => `fake.${i}xlarge`);
  const chunks = chunkByFamily(big);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length <= 25));
  assert.equal(chunks.flat().length, 30);
});
