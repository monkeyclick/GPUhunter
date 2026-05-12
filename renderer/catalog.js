// GPU/storage instance catalog + AWS region metadata (no GovCloud, no China).

export const INSTANCE_FAMILIES = {
  g3: {
    gpu: "NVIDIA M60",
    vramGb: 8,
    arch: "x86_64",
    sizes: ["g3.4xlarge", "g3.8xlarge", "g3.16xlarge"],
  },
  g3s: {
    gpu: "NVIDIA M60",
    vramGb: 8,
    arch: "x86_64",
    sizes: ["g3s.xlarge"],
  },
  g4ad: {
    gpu: "AMD Radeon Pro V520",
    vramGb: 8,
    arch: "x86_64",
    sizes: ["g4ad.xlarge", "g4ad.2xlarge", "g4ad.4xlarge", "g4ad.8xlarge", "g4ad.16xlarge"],
  },
  g4dn: {
    gpu: "NVIDIA T4",
    vramGb: 16,
    arch: "x86_64",
    sizes: [
      "g4dn.xlarge", "g4dn.2xlarge", "g4dn.4xlarge", "g4dn.8xlarge",
      "g4dn.12xlarge", "g4dn.16xlarge", "g4dn.metal",
    ],
  },
  g5: {
    gpu: "NVIDIA A10G",
    vramGb: 24,
    arch: "x86_64",
    sizes: [
      "g5.xlarge", "g5.2xlarge", "g5.4xlarge", "g5.8xlarge",
      "g5.12xlarge", "g5.16xlarge", "g5.24xlarge", "g5.48xlarge",
    ],
  },
  g5g: {
    gpu: "NVIDIA T4G (ARM)",
    vramGb: 16,
    arch: "arm64",
    sizes: ["g5g.xlarge", "g5g.2xlarge", "g5g.4xlarge", "g5g.8xlarge", "g5g.16xlarge", "g5g.metal"],
  },
  g6: {
    gpu: "NVIDIA L4",
    vramGb: 24,
    arch: "x86_64",
    sizes: [
      "g6.xlarge", "g6.2xlarge", "g6.4xlarge", "g6.8xlarge",
      "g6.12xlarge", "g6.16xlarge", "g6.24xlarge", "g6.48xlarge",
    ],
  },
  gr6: {
    gpu: "NVIDIA L4 (memory-optimized)",
    vramGb: 24,
    arch: "x86_64",
    sizes: ["gr6.4xlarge", "gr6.8xlarge"],
  },
  g6e: {
    gpu: "NVIDIA L40S",
    vramGb: 48,
    arch: "x86_64",
    sizes: [
      "g6e.xlarge", "g6e.2xlarge", "g6e.4xlarge", "g6e.8xlarge",
      "g6e.12xlarge", "g6e.16xlarge", "g6e.24xlarge", "g6e.48xlarge",
    ],
  },
  g7e: {
    gpu: "NVIDIA RTX PRO 6000 Blackwell",
    vramGb: 96,
    arch: "x86_64",
    sizes: [
      "g7e.2xlarge", "g7e.4xlarge", "g7e.8xlarge",
      "g7e.12xlarge", "g7e.24xlarge", "g7e.48xlarge",
    ],
  },
  p3: {
    gpu: "NVIDIA V100",
    vramGb: 16,
    arch: "x86_64",
    sizes: ["p3.2xlarge", "p3.8xlarge", "p3.16xlarge"],
  },
  p3dn: {
    gpu: "NVIDIA V100 (32 GB)",
    vramGb: 32,
    arch: "x86_64",
    sizes: ["p3dn.24xlarge"],
  },
  p4d: {
    gpu: "NVIDIA A100 (40 GB)",
    vramGb: 40,
    arch: "x86_64",
    sizes: ["p4d.24xlarge"],
  },
  p4de: {
    gpu: "NVIDIA A100 (80 GB)",
    vramGb: 80,
    arch: "x86_64",
    sizes: ["p4de.24xlarge"],
  },
  p5: {
    gpu: "NVIDIA H100",
    vramGb: 80,
    arch: "x86_64",
    sizes: ["p5.48xlarge"],
  },
  p5e: {
    gpu: "NVIDIA H200",
    vramGb: 141,
    arch: "x86_64",
    sizes: ["p5e.48xlarge"],
  },
  p5en: {
    gpu: "NVIDIA H200 (network-optimized)",
    vramGb: 141,
    arch: "x86_64",
    sizes: ["p5en.48xlarge"],
  },
  i3: {
    spec: "NVMe SSD · storage-optimized",
    arch: "x86_64",
    sizes: [
      "i3.large", "i3.xlarge", "i3.2xlarge", "i3.4xlarge",
      "i3.8xlarge", "i3.16xlarge", "i3.metal",
    ],
  },
  i4i: {
    spec: "Nitro NVMe SSD · Ice Lake",
    arch: "x86_64",
    sizes: [
      "i4i.large", "i4i.xlarge", "i4i.2xlarge", "i4i.4xlarge",
      "i4i.8xlarge", "i4i.12xlarge", "i4i.16xlarge", "i4i.24xlarge",
      "i4i.32xlarge", "i4i.metal",
    ],
  },
  i4g: {
    spec: "Nitro NVMe SSD · Graviton2",
    arch: "arm64",
    sizes: [
      "i4g.large", "i4g.xlarge", "i4g.2xlarge", "i4g.4xlarge",
      "i4g.8xlarge", "i4g.16xlarge",
    ],
  },
  i7i: {
    spec: "Nitro NVMe SSD · Sapphire Rapids",
    arch: "x86_64",
    sizes: [
      "i7i.large", "i7i.xlarge", "i7i.2xlarge", "i7i.4xlarge",
      "i7i.8xlarge", "i7i.12xlarge", "i7i.16xlarge", "i7i.24xlarge",
      "i7i.48xlarge", "i7i.metal-24xl", "i7i.metal-48xl",
    ],
  },
  i7ie: {
    spec: "Nitro NVMe SSD · storage-dense",
    arch: "x86_64",
    sizes: [
      "i7ie.large", "i7ie.xlarge", "i7ie.2xlarge", "i7ie.3xlarge",
      "i7ie.6xlarge", "i7ie.12xlarge", "i7ie.18xlarge", "i7ie.24xlarge",
      "i7ie.48xlarge",
    ],
  },
};

export const ALL_INSTANCE_TYPES = Object.values(INSTANCE_FAMILIES).flatMap((f) => f.sizes);

export function familyOf(instanceType) {
  return instanceType.split(".")[0];
}

// [lat, lon, friendly name, optInRequired]
export const REGIONS = {
  "us-east-1":      [38.13,  -78.45,  "N. Virginia",    false],
  "us-east-2":      [40.42,  -82.91,  "Ohio",           false],
  "us-west-1":      [37.77, -122.42,  "N. California",  false],
  "us-west-2":      [45.87, -119.69,  "Oregon",         false],
  "ca-central-1":   [45.50,  -73.57,  "Canada Central", false],
  "ca-west-1":      [51.04, -114.07,  "Calgary",        true ],
  "sa-east-1":      [-23.55, -46.63,  "São Paulo",      false],
  "eu-west-1":      [53.35,   -6.26,  "Ireland",        false],
  "eu-west-2":      [51.51,   -0.13,  "London",         false],
  "eu-west-3":      [48.86,    2.35,  "Paris",          false],
  "eu-central-1":   [50.11,    8.68,  "Frankfurt",      false],
  "eu-central-2":   [47.37,    8.55,  "Zurich",         true ],
  "eu-north-1":     [59.33,   18.07,  "Stockholm",      false],
  "eu-south-1":     [45.46,    9.19,  "Milan",          true ],
  "eu-south-2":     [40.42,   -3.70,  "Spain",          true ],
  "ap-east-1":      [22.30,  114.17,  "Hong Kong",      true ],
  "ap-south-1":     [19.08,   72.88,  "Mumbai",         false],
  "ap-south-2":     [17.39,   78.49,  "Hyderabad",      true ],
  "ap-southeast-1": [ 1.35,  103.82,  "Singapore",      false],
  "ap-southeast-2": [-33.87, 151.21,  "Sydney",         false],
  "ap-southeast-3": [-6.21,  106.85,  "Jakarta",        true ],
  "ap-southeast-4": [-37.81, 144.96,  "Melbourne",      true ],
  "ap-southeast-5": [ 3.14,  101.69,  "Malaysia",       true ],
  "ap-northeast-1": [35.69,  139.69,  "Tokyo",          false],
  "ap-northeast-2": [37.57,  126.98,  "Seoul",          false],
  "ap-northeast-3": [34.69,  135.50,  "Osaka",          false],
  "me-south-1":     [26.07,   50.55,  "Bahrain",        true ],
  "me-central-1":   [25.20,   55.27,  "UAE",            true ],
  "af-south-1":     [-33.92,  18.42,  "Cape Town",      true ],
  "il-central-1":   [32.08,   34.78,  "Tel Aviv",       true ],
};

export function regionLabel(region) {
  const r = REGIONS[region];
  return r ? `${region} (${r[2]})` : region;
}

export function isOptIn(region) {
  return !!REGIONS[region]?.[3];
}
