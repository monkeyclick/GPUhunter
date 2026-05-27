# GPU Hunter

A desktop app for finding GPU instance capacity across **AWS and Google Cloud Platform** — regions, availability zones, and live capacity probing.

![GPU Hunter logo](renderer/gpulogo.png)

## What it does

GPU Hunter queries your cloud accounts in real time and shows:

- **On-Demand availability** — which AZs / GCP zones actually offer a given instance type
- **Spot Placement Scores** (1–10, AWS only) — AWS's signal for how likely a Spot request will succeed
- **Live capacity probing** — confirms real-time availability without launching a real instance
  - AWS: short-lived Capacity Reservation (costs < $0.01 per probe)
  - GCP: dry-run instance insert (`?dryRun=true`, free)
- **Interactive world map** — circles sized and colored by best Spot score; click for per-AZ/zone details
- **Sortable/filterable detail table** — filter by family, region, Spot score floor, OD availability, and free text
- **CSV export** — all results with cloud, region, AZ, family, Spot score, and OD status
- **Scan cache** — last scan results are persisted and restored on relaunch
- **Auto-update** — new releases download and install automatically (packaged builds only)

---

## Supported instance families

### AWS — 17 GPU families · 22 total families

| Family | GPU | VRAM | Notes |
|--------|-----|------|-------|
| g3 | NVIDIA M60 | 8 GB | |
| g3s | NVIDIA M60 | 8 GB | Single-GPU variant |
| g4ad | AMD Radeon Pro V520 | 8 GB | |
| g4dn | NVIDIA T4 | 16 GB | |
| g5 | NVIDIA A10G | 24 GB | |
| g5g | NVIDIA T4G (ARM) | 16 GB | Graviton2 |
| g6 | NVIDIA L4 | 24 GB | |
| gr6 | NVIDIA L4 | 24 GB | Memory-optimized |
| g6e | NVIDIA L40S | 48 GB | |
| g7e | NVIDIA RTX PRO 6000 Blackwell | 96 GB | |
| p3 | NVIDIA V100 | 16 GB | |
| p3dn | NVIDIA V100 | 32 GB | High-bandwidth variant |
| p4d | NVIDIA A100 | 40 GB | UltraClusters |
| p4de | NVIDIA A100 | 80 GB | |
| p5 | NVIDIA H100 | 80 GB SXM | |
| p5e | NVIDIA H200 | 141 GB | |
| p5en | NVIDIA H200 | 141 GB | Network-optimized |

Also includes I-series NVMe storage families (i3, i4i, i4g, i7i, i7ie) for reference.

### GCP — 7 GPU families

| Family | GPU | VRAM |
|--------|-----|------|
| a2-highgpu | NVIDIA A100 | 40 GB |
| a2-megagpu | NVIDIA A100 | 40 GB |
| a2-ultragpu | NVIDIA A100 | 80 GB |
| g2-standard | NVIDIA L4 | 24 GB |
| a3-highgpu | NVIDIA H100 | 80 GB SXM |
| a3-megagpu | NVIDIA H100 | 80 GB SXM5 |
| a3-ultragpu | NVIDIA H200 | 141 GB |

**129 total instance types across 52 regions (30 AWS + 22 GCP).**

---

## Prerequisites

### AWS
- AWS credentials configured (any of: `~/.aws/credentials` profiles, environment variables, SSO, or instance role)
- IAM permissions: `ec2:DescribeRegions`, `ec2:DescribeInstanceTypeOfferings`, `ec2:DescribeAvailabilityZones`, `ec2:GetSpotPlacementScores`
- For probing: `ec2:CreateCapacityReservation`, `ec2:CancelCapacityReservation`

### GCP
- A GCP Project ID
- Either Application Default Credentials (`gcloud auth application-default login`) or a service account key file
- IAM role: `roles/compute.viewer` for scanning; `roles/compute.instanceAdmin.v1` (or `compute.instances.create`) for probing

### Runtime
- [Node.js](https://nodejs.org/) 18 or later
- (Or download a pre-built release — no Node required)

---

## Installation

### From source

```bash
git clone https://github.com/monkeyclick/GPUhunter.git
cd GPUhunter
npm install
npm start
```

### Pre-built releases

Download the latest `.dmg` (macOS), `.exe` (Windows), or `.AppImage` (Linux) from the [Releases page](../../releases). The app auto-updates when new versions are published.

---

## Usage

### Cloud selector
Pick **AWS**, **GCP**, or **Both** in the sidebar before scanning. The selected cloud determines which instance families are shown and which credentials are used.

### AWS scan
1. Enter a named profile from `~/.aws/credentials`, or leave blank for environment variables / SSO.
2. Check the instance families and sizes to scan.
3. Set target capacity and pricing mode (On-Demand, Spot, or Both).
4. Click **Scan for capacity**.

### GCP scan
1. Enter your **GCP Project ID** in the sidebar.
2. Optionally provide a path to a service account key file (leave blank to use ADC).
3. Select GCP instance families.
4. Click **Scan for capacity**.

### Both clouds
Select **Both** to scan AWS and GCP simultaneously. Results are merged into a single map and detail table with a **Cloud** column (AWS / GCP) for context.

---

### Map tab

Circles represent regions; color and size reflect the best Spot score found (AWS) or availability (GCP). Click a circle for a popup with per-AZ/zone details. The **Region summary** panel lets you filter and sort; clicking a row jumps to the Detail table.

### Detail table tab

Full row-level data. Filters: family, region, Spot score floor, OD availability, and free text. Select rows and click **Send to Probe** to queue them for capacity probing. Export all results as CSV.

### Probe tab

Confirms real-time capacity without actually launching an instance:

| Cloud | Method | Cost |
|-------|--------|------|
| AWS | 2-minute On-Demand Capacity Reservation, immediately cancelled | < $0.01 per probe |
| GCP | Dry-run instance insert (`?dryRun=true`) | Free |

- **Available** — capacity confirmed right now.
- **No capacity** — AWS returned `InsufficientInstanceCapacity` / GCP returned `ZONE_RESOURCE_POOL_EXHAUSTED`.

Tick the confirmation checkbox before running probes.

### Defaults & Preferences

Click the ⚙ icon to open the Defaults modal:
- AWS profile, GCP project ID and key file
- Default cloud selector (AWS / GCP / Both)
- Default GPU types pre-checked on launch
- Preferred regions, pricing mode, target capacity
- Probe defaults

---

## Notes

- Spot Placement Scores are AWS-only. The API caps 25 types per call; GPU Hunter chunks and parallelizes automatically (4 concurrent workers).
- Offerings data is fetched in parallel across up to 8 regions concurrently.
- GCP uses `aggregatedList` for a single multi-zone API pass — no per-zone rate limits.
- All cloud calls go through your local credential chain — no credentials are stored or transmitted by this app.
- Scan results are cached in `localStorage` and restored on next launch.

---

## Building a release

```bash
npm run dist:mac    # macOS .dmg
npm run dist:win    # Windows .exe
npm run dist:linux  # Linux .AppImage
npm run release     # all platforms + publish to GitHub Releases
```

Releases published to GitHub automatically trigger the in-app auto-updater for existing installs.

---

## License

MIT

---

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?logo=buymeacoffee)](https://buymeacoffee.com/monkeydooz)
