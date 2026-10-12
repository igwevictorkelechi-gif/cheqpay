/**
 * Where to place a user on the admin map before the app has seen them from a
 * located request: the capital of the state on their KYC address. Coordinates
 * are city-level and approximate on purpose.
 */
const STATES: Record<string, [lat: number, lon: number, capital: string]> = {
  abia: [5.53, 7.49, "Umuahia"],
  adamawa: [9.2, 12.48, "Yola"],
  "akwa ibom": [5.03, 7.93, "Uyo"],
  anambra: [6.21, 7.07, "Awka"],
  bauchi: [10.31, 9.84, "Bauchi"],
  bayelsa: [4.92, 6.27, "Yenagoa"],
  benue: [7.73, 8.54, "Makurdi"],
  borno: [11.83, 13.15, "Maiduguri"],
  "cross river": [4.96, 8.33, "Calabar"],
  delta: [6.2, 6.73, "Asaba"],
  ebonyi: [6.32, 8.11, "Abakaliki"],
  edo: [6.34, 5.63, "Benin City"],
  ekiti: [7.62, 5.22, "Ado-Ekiti"],
  enugu: [6.46, 7.55, "Enugu"],
  fct: [9.06, 7.49, "Abuja"],
  gombe: [10.29, 11.17, "Gombe"],
  imo: [5.48, 7.03, "Owerri"],
  jigawa: [11.76, 9.34, "Dutse"],
  kaduna: [10.52, 7.44, "Kaduna"],
  kano: [12.0, 8.52, "Kano"],
  katsina: [12.99, 7.6, "Katsina"],
  kebbi: [12.45, 4.2, "Birnin Kebbi"],
  kogi: [7.8, 6.74, "Lokoja"],
  kwara: [8.5, 4.55, "Ilorin"],
  lagos: [6.52, 3.38, "Lagos"],
  nasarawa: [8.49, 8.52, "Lafia"],
  niger: [9.61, 6.56, "Minna"],
  ogun: [7.15, 3.35, "Abeokuta"],
  ondo: [7.25, 5.19, "Akure"],
  osun: [7.77, 4.56, "Osogbo"],
  oyo: [7.38, 3.94, "Ibadan"],
  plateau: [9.9, 8.86, "Jos"],
  rivers: [4.82, 7.03, "Port Harcourt"],
  sokoto: [13.06, 5.24, "Sokoto"],
  taraba: [8.89, 11.36, "Jalingo"],
  yobe: [11.75, 11.97, "Damaturu"],
  zamfara: [12.17, 6.66, "Gusau"],
};

/** "Lagos State", "lagos", "Abuja", "FCT - Abuja" → Lagos/Abuja coordinates. */
export function stateLocation(state: string | null | undefined): { lat: number; lon: number; city: string } | null {
  if (!state) return null;
  let key = state.toLowerCase().replace(/\bstate\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(fct|abuja|federal capital)\b/.test(key)) key = "fct";
  if (key === "akwa-ibom" || key === "akwaibom") key = "akwa ibom";
  if (key === "crossriver") key = "cross river";
  const hit = STATES[key];
  return hit ? { lat: hit[0], lon: hit[1], city: hit[2] } : null;
}
