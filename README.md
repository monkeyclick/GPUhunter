# GPU Hunter

A desktop app for finding AWS G-series GPU instance capacity across regions and availability zones.

![GPU Hunter screenshot](renderer/gpulogo.png)

## What it does

GPU Hunter queries your AWS account in real time to show:

- **On-Demand availability** — which AZs actually offer a given instance type
- **Spot Placement Scores** (1–10) — AWS's signal for how likely a Spot request will succeed
- **Active capacity probing** — creates a short-lived Capacity Reservation to confirm real-time availability (costs < $0.01 per probe)

Results are shown on an interactive world map and a sortable/filterable detail table. You can export results to CSV or send rows directly to the probe queue.

## Supported instance families

| Family | GPU | VRAM |
|--------|-----|------|
| g3 | NVIDIA M60 | 8 GB |
| g4ad | AMD Radeon Pro V520 | 8 GB |
| g4dn | NVIDIA T4 | 16 GB |
| g5 | NVIDIA A10G | 24 GB |
| g5g | NVIDIA T4G (ARM) | 16 GB |
| g6 | NVIDIA L4 | 24 GB |
| gr6 | NVIDIA L4 (memory-optimized) | 24 GB |
| g6e | NVIDIA L40S | 48 GB |

Also includes I-series NVMe storage instances (i3, i4i, i4g, i7i, i7ie) for reference.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- AWS credentials configured (any of: `~/.aws/credentials` profiles, environment variables, SSO, or instance role)
- IAM permissions: `ec2:DescribeRegions`, `ec2:DescribeInstanceTypeOfferings`, `ec2:DescribeAvailabilityZones`, `ec2:GetSpotPlacementScores`
- For probing: `ec2:CreateCapacityReservation`, `ec2:CancelCapacityReservation`

## Installation

```bash
git clone https://github.com/monkeyclick/GPUhunter.git
cd GPUhunter
npm install
npm start
```

## Usage

1. **AWS profile** — enter a named profile from `~/.aws/credentials`, or leave blank to use environment variables / SSO / instance role.
2. **Instance types** — check the families and sizes you want to scan.
3. **Capacity & mode** — set target instance count and choose On-Demand, Spot, or both.
4. **Regions** — optionally include opt-in regions.
5. Click **Scan AWS for capacity**.

### Map tab

Circles represent regions; color and size reflect the best Spot score found. Click a circle for a popup with per-AZ details. The **Region summary** panel (top-right) lets you filter and sort, and clicking a row jumps to the Detail table.

### Detail table tab

Full row-level data with filters for family, region, Spot score floor, and OD availability. Select rows and click **Send to Probe** to queue them for capacity probing.

### Probe tab

Each probe creates a 2-minute On-Demand Capacity Reservation, then immediately cancels it.
- **Available** — the reservation was accepted; capacity exists right now.
- **No capacity** — AWS returned `InsufficientInstanceCapacity`.

Tick the confirmation checkbox before running probes. Cost is typically < $0.01 per probe (per-second billing while the CR is active).

## Notes

- Spot Placement Scores require at least one instance type and target capacity. The AWS API caps 25 instance types per call; GPU Hunter chunks automatically.
- Offerings data is fetched in parallel across up to 8 regions concurrently.
- All AWS calls go through your local credential chain — no credentials are stored or transmitted by this app.

## License

MIT
