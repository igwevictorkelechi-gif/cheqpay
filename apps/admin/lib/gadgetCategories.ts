// Canonical gadget categories and their spec templates.
//
// Categories are stored on the product as a plain string (the label), so this
// list can grow or be reordered without a migration. The templates seed the
// specification editor with the fields that matter for each kind of device, so
// products go up with consistent, comparable specs instead of ad-hoc notes.

export interface SpecTemplate {
  label: string;
  /** Placeholder hint shown in the value box, e.g. "6.7-inch AMOLED". */
  hint?: string;
}

export interface GadgetCategory {
  /** Stored value and display label (kept identical for simplicity). */
  label: string;
  /** Spec fields pre-loaded when this category is chosen. */
  template: SpecTemplate[];
}

const COMMON_TAIL: SpecTemplate[] = [
  { label: "Colour", hint: "e.g. Graphite" },
  { label: "Warranty", hint: "e.g. 12 months" },
  { label: "In the box", hint: "e.g. Charger, cable, manual" },
];

export const GADGET_CATEGORIES: GadgetCategory[] = [
  {
    label: "Phones",
    template: [
      { label: "Display", hint: "6.7-inch AMOLED, 120Hz" },
      { label: "Processor", hint: "e.g. Snapdragon 8 Gen 3" },
      { label: "RAM", hint: "e.g. 8 GB" },
      { label: "Storage", hint: "e.g. 256 GB" },
      { label: "Rear camera", hint: "e.g. 50MP + 12MP + 10MP" },
      { label: "Front camera", hint: "e.g. 32MP" },
      { label: "Battery", hint: "e.g. 5000 mAh" },
      { label: "Operating system", hint: "e.g. Android 14" },
      { label: "Network", hint: "e.g. 5G, Dual SIM" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Laptops",
    template: [
      { label: "Display", hint: '14-inch, 2.8K, 90Hz' },
      { label: "Processor", hint: "e.g. Intel Core i7-1360P" },
      { label: "RAM", hint: "e.g. 16 GB" },
      { label: "Storage", hint: "e.g. 512 GB SSD" },
      { label: "Graphics", hint: "e.g. RTX 4050" },
      { label: "Battery", hint: "e.g. Up to 12 hours" },
      { label: "Operating system", hint: "e.g. Windows 11" },
      { label: "Weight", hint: "e.g. 1.4 kg" },
      { label: "Ports", hint: "e.g. 2× USB-C, HDMI" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Tablets",
    template: [
      { label: "Display", hint: "11-inch, 120Hz" },
      { label: "Processor", hint: "e.g. Apple M2" },
      { label: "RAM", hint: "e.g. 8 GB" },
      { label: "Storage", hint: "e.g. 128 GB" },
      { label: "Battery", hint: "e.g. Up to 10 hours" },
      { label: "Operating system", hint: "e.g. iPadOS 17" },
      { label: "Connectivity", hint: "e.g. Wi-Fi + Cellular" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Smartwatches",
    template: [
      { label: "Case size", hint: "e.g. 45 mm" },
      { label: "Display", hint: "e.g. AMOLED, always-on" },
      { label: "Battery life", hint: "e.g. Up to 18 hours" },
      { label: "Water resistance", hint: "e.g. 5 ATM" },
      { label: "Connectivity", hint: "e.g. GPS, Bluetooth" },
      { label: "Sensors", hint: "e.g. Heart rate, SpO2, ECG" },
      { label: "Compatibility", hint: "e.g. Android / iOS" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Audio",
    template: [
      { label: "Type", hint: "e.g. In-ear, Over-ear" },
      { label: "Battery life", hint: "e.g. 8h + 24h case" },
      { label: "Noise cancellation", hint: "e.g. Active (ANC)" },
      { label: "Connectivity", hint: "e.g. Bluetooth 5.3" },
      { label: "Water resistance", hint: "e.g. IPX4" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Gaming",
    template: [
      { label: "Platform", hint: "e.g. PlayStation 5" },
      { label: "Storage", hint: "e.g. 1 TB SSD" },
      { label: "Resolution", hint: "e.g. Up to 4K, 120fps" },
      { label: "Includes", hint: "e.g. 1 controller" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Cameras",
    template: [
      { label: "Sensor", hint: "e.g. 24.2MP APS-C" },
      { label: "Video", hint: "e.g. 4K 60fps" },
      { label: "Lens mount", hint: "e.g. Sony E-mount" },
      { label: "Stabilisation", hint: "e.g. 5-axis IBIS" },
      { label: "Connectivity", hint: "e.g. Wi-Fi, Bluetooth" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Smart Home",
    template: [
      { label: "Type", hint: "e.g. Security camera" },
      { label: "Connectivity", hint: "e.g. Wi-Fi, 2.4GHz" },
      { label: "Power", hint: "e.g. Wired / Battery" },
      { label: "Works with", hint: "e.g. Alexa, Google Home" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Power & Charging",
    template: [
      { label: "Capacity / Output", hint: "e.g. 20000 mAh / 65W" },
      { label: "Ports", hint: "e.g. 2× USB-C, 1× USB-A" },
      { label: "Fast charging", hint: "e.g. PD 3.0, QC 4+" },
      ...COMMON_TAIL,
    ],
  },
  {
    label: "Accessories",
    template: [
      { label: "Type", hint: "e.g. Case, Cable, Stand" },
      { label: "Compatibility", hint: "e.g. iPhone 15 Pro" },
      { label: "Material", hint: "e.g. Silicone" },
      ...COMMON_TAIL,
    ],
  },
];

export const CATEGORY_LABELS = GADGET_CATEGORIES.map((c) => c.label);

export function templateFor(category: string): SpecTemplate[] {
  return GADGET_CATEGORIES.find((c) => c.label === category)?.template ?? [];
}
