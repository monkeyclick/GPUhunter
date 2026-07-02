#!/usr/bin/env node
// GPU Hunter CLI — a terminal front-end over the same scan/probe logic the
// Electron app uses. Zero runtime deps beyond the cloud SDKs already in the project.

const readline = require("readline");
const { runScan } = require("./core/scan");
const aws = require("./aws");
const gcp = require("./gcp");
const {
  INSTANCE_FAMILIES,
  ALL_INSTANCE_TYPES,
  REGIONS,
  GCP_REGIONS,
  cloudOf,
} = require("./renderer/catalog");
const { toCsv, odLabel } = require("./renderer/format");

// ---- tiny arg parser ------------------------------------------------------
// Supports: --flag value, --flag=value, and boolean --flag.
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      let key = a.slice(2);
      let val;
      const eq = key.indexOf("=");
      if (eq !== -1) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        val = argv[++i];
      } else {
        val = true; // boolean flag
      }
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const list = (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);
const err = (msg) => {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
};

// ---- output helpers -------------------------------------------------------
function renderTable(rows, columns) {
  const widths = columns.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => String(c.get(r) ?? "").length), 0)
  );
  const pad = (s, w) => String(s ?? "").padEnd(w);
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  const out = [line(columns.map((c) => c.label))];
  out.push(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) out.push(line(columns.map((c) => c.get(r))));
  return out.join("\n");
}

// ---- commands -------------------------------------------------------------
async function cmdScan(args) {
  const cloud = args.cloud || "both";
  const mode = args.mode || "both";
  let types = list(args.types);
  const families = list(args.families);
  if (families.length) {
    for (const f of families) {
      const meta = INSTANCE_FAMILIES[f];
      if (!meta) err(`Unknown family "${f}". Run "gpuhunter list-types" to see options.`);
      types.push(...meta.sizes);
    }
  }
  if (!types.length) {
    err('Select instance types with --types or --families (e.g. --families g5,p5). See "gpuhunter list-types".');
  }
  types = [...new Set(types)];

  // A typo'd type silently matches nothing in the cloud APIs — warn up front.
  const known = new Set(ALL_INSTANCE_TYPES);
  const unknown = types.filter((t) => !known.has(t));
  if (unknown.length) {
    process.stderr.write(
      `warn: unknown instance type(s): ${unknown.join(", ")} — not in the catalog; they will still be sent to the cloud APIs.\n`
    );
  }

  const onProgress = (phase, done, total, label) => {
    const t = total ? `${done}/${total}` : `${done}`;
    process.stderr.write(`\r${phase}: ${t}${label ? ` (${label})` : ""}        `);
  };

  let result;
  try {
    result = await runScan({
      cloud,
      mode,
      instanceTypes: types,
      targetCapacity: parseInt(args["target-capacity"], 10) || 1,
      profile: args.profile || null,
      gcpProjectId: args["gcp-project"] || null,
      gcpKeyFile: args["gcp-key"] || null,
      preferredRegions: list(args.regions),
      includeOptIn: !!args["include-opt-in"],
      onProgress,
    });
  } catch (e) {
    process.stderr.write("\n");
    err(e.message || String(e));
  }
  process.stderr.write("\r" + " ".repeat(60) + "\r"); // clear progress line

  // ---- client-side filters (mirror the GUI detail table) ----
  let rows = result.rows;
  const minScore = args["min-score"] != null ? Number(args["min-score"]) : null;
  if (minScore != null) rows = rows.filter((r) => (r.spotScore ?? -1) >= minScore);
  if (args.region) rows = rows.filter((r) => r.region.includes(String(args.region)));
  if (args.family) rows = rows.filter((r) => r.family === args.family);

  // ---- sort ----
  const sortKey = args.sort || "spotScore";
  const dir = args.asc ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  // ---- output ----
  if (args.json) {
    process.stdout.write(JSON.stringify({ rows, errors: result.errors }, null, 2) + "\n");
    return;
  }
  if (args.csv != null) {
    const csv = toCsv(rows);
    if (typeof args.csv === "string") {
      require("fs").writeFileSync(args.csv, csv);
      process.stderr.write(`Wrote ${rows.length} rows to ${args.csv}\n`);
    } else {
      process.stdout.write(csv + "\n");
    }
    return;
  }

  if (!rows.length) {
    process.stderr.write("No matching capacity found.\n");
  } else {
    const columns = [
      { label: "CLOUD", get: (r) => r.cloud || "aws" },
      { label: "REGION", get: (r) => r.region },
      { label: "AZ", get: (r) => r.az || "" },
      { label: "TYPE", get: (r) => r.instanceType },
      { label: "FAMILY", get: (r) => r.family },
      { label: "SPOT", get: (r) => (r.spotScore ?? "–") },
      { label: "OD", get: (r) => odLabel(r.ondemandOffered) || "?" },
    ];
    process.stdout.write(renderTable(rows, columns) + "\n");
  }
  let summary = `\n${rows.length} (region, AZ, type) rows`;
  if (result.errors.length) summary += ` · ${result.errors.length} warnings`;
  process.stderr.write(summary + "\n");
  if (result.errors.length && args.verbose) {
    for (const e of result.errors) process.stderr.write(`  warn: ${e.message || JSON.stringify(e)}\n`);
  }
}

async function cmdProbe(args) {
  const cloud = args.cloud || (args.zone ? "gcp" : "aws");
  const type = args.type;
  const count = parseInt(args.count, 10) || 1;
  if (!type) err("--type is required.");

  if (cloud === "gcp") {
    const zone = args.zone;
    if (!zone) err("--zone is required for GCP probes (e.g. us-central1-a).");
    if (!args["gcp-project"]) err("--gcp-project is required for GCP probes.");
    process.stderr.write(`Probing GCP (dry-run, free, validates 1 instance): ${type} in ${zone}…\n`);
    const res = await gcp.probeCapacity({
      projectId: args["gcp-project"],
      zone,
      machineType: type,
      keyFile: args["gcp-key"] || null,
    });
    process.stdout.write((res.success ? "✓ " : "✗ ") + res.message + "\n");
    process.exit(res.success ? 0 : 2);
  }

  // AWS — creates a short-lived capacity reservation (costs <$0.01), then cancels it.
  const region = args.region;
  const az = args.az;
  if (!region) err("--region is required for AWS probes.");
  if (!az) err("--az is required for AWS probes (e.g. us-east-1a).");

  if (!args.yes) {
    const ok = await confirm(
      `This creates a 2-minute AWS capacity reservation for ${count}× ${type} in ${az} ` +
        `(cost <$0.01, auto-cancelled). Continue? [y/N] `
    );
    if (!ok) {
      process.stderr.write("Aborted.\n");
      process.exit(1);
    }
  }
  process.stderr.write(`Probing AWS: ${count}× ${type} in ${az}…\n`);
  const res = await aws.probeCapacity({ region, az, instanceType: type, count, profile: args.profile || null });
  process.stdout.write((res.success ? "✓ " : "✗ ") + res.message + "\n");
  process.exit(res.success ? 0 : 2);
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

function cmdListTypes(args) {
  if (args.json) {
    process.stdout.write(JSON.stringify(INSTANCE_FAMILIES, null, 2) + "\n");
    return;
  }
  const rows = Object.entries(INSTANCE_FAMILIES).map(([fam, m]) => ({
    family: fam,
    cloud: cloudOf(m),
    gpu: m.gpu || m.spec || "",
    vram: m.vramGb ? `${m.vramGb} GB` : "",
    sizes: m.sizes.join(", "),
  }));
  const columns = [
    { label: "FAMILY", get: (r) => r.family },
    { label: "CLOUD", get: (r) => r.cloud },
    { label: "GPU / SPEC", get: (r) => r.gpu },
    { label: "VRAM", get: (r) => r.vram },
    { label: "SIZES", get: (r) => r.sizes },
  ];
  process.stdout.write(renderTable(rows, columns) + "\n");
  process.stderr.write(`\n${rows.length} families · ${ALL_INSTANCE_TYPES.length} instance types\n`);
}

function cmdListRegions(args) {
  if (args.json) {
    process.stdout.write(JSON.stringify(REGIONS, null, 2) + "\n");
    return;
  }
  const rows = Object.entries(REGIONS).map(([code, [lat, lon, name, optIn]]) => ({
    code,
    cloud: GCP_REGIONS.has(code) ? "gcp" : "aws",
    name,
    optIn: optIn ? "yes" : "",
  }));
  const columns = [
    { label: "REGION", get: (r) => r.code },
    { label: "CLOUD", get: (r) => r.cloud },
    { label: "NAME", get: (r) => r.name },
    { label: "OPT-IN", get: (r) => r.optIn },
  ];
  process.stdout.write(renderTable(rows, columns) + "\n");
  process.stderr.write(`\n${rows.length} regions\n`);
}

const HELP = `GPU Hunter — find GPU instance capacity across AWS & GCP

Usage: gpuhunter <command> [options]

Commands:
  scan           Scan for on-demand offerings and Spot placement scores
  probe          Verify real capacity for one (region/az, type) — creates & cancels
                 a tiny AWS capacity reservation, or a free GCP dry-run
  list-types     List known instance families and sizes
  list-regions   List known AWS & GCP regions

scan options:
  --cloud aws|gcp|both         (default both)
  --mode ondemand|spot|both    (default both)
  --types t1,t2                AWS use ".", GCP use "-" (e.g. g5.xlarge,a3-highgpu-8g)
  --families f1,f2             expand a whole family (e.g. --families g5,p5)
  --target-capacity N          target for Spot placement scores (default 1)
  --profile NAME               AWS named profile (else default credential chain)
  --gcp-project ID             GCP project id (required for GCP)
  --gcp-key PATH               GCP service-account key file (else ADC)
  --regions r1,r2              restrict AWS scan to these regions
  --include-opt-in             include AWS opt-in regions
  --min-score N                filter rows to Spot score >= N
  --region SUBSTR              filter rows whose region contains SUBSTR
  --family F                   filter rows to one family
  --sort KEY [--asc]           sort key (default spotScore, descending)
  --json                       emit JSON to stdout
  --csv [FILE]                 emit CSV (to FILE, or stdout if omitted)
  --verbose                    print scan warnings

probe options:
  --cloud aws|gcp              (inferred from --az / --zone if omitted)
  --region R --az AZ           AWS target (e.g. --region us-east-1 --az us-east-1a)
  --zone Z                     GCP target (e.g. --zone us-central1-a)
  --type T --count N           instance type and count (default 1)
  --profile / --gcp-project / --gcp-key   credentials, as for scan
  --yes                        skip the AWS cost-confirmation prompt

Examples:
  gpuhunter scan --families p5,g5 --cloud both --gcp-project my-proj
  gpuhunter scan --families p5 --json | jq '.rows[] | select(.spotScore>7)'
  gpuhunter probe --region us-east-1 --az us-east-1a --type p5.48xlarge --yes
`;

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || args.help || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }
  switch (cmd) {
    case "scan": return cmdScan(args);
    case "probe": return cmdProbe(args);
    case "list-types": return cmdListTypes(args);
    case "list-regions": return cmdListRegions(args);
    default:
      err(`Unknown command "${cmd}". Run "gpuhunter --help".`);
  }
}

if (require.main === module) {
  main().catch((e) => err(e.stack || e.message || String(e)));
}

module.exports = { parseArgs };
