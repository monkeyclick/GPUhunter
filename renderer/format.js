// Shared row-formatting helpers — imported by the renderer (ESM) and the CLI
// (require(esm), Node >= 22.12).

export const CSV_HEADER = [
  "cloud", "region", "az", "instance_type", "family", "spot_score", "ondemand_offered",
];

export const odLabel = (v) => (v === true ? "yes" : v === false ? "no" : "");

export function toCsv(rows) {
  const data = [
    CSV_HEADER,
    ...rows.map((r) => [
      r.cloud || "aws",
      r.region,
      r.az || "",
      r.instanceType,
      r.family,
      r.spotScore ?? "",
      odLabel(r.ondemandOffered),
    ]),
  ];
  return data
    .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}
