/*
 * Time zones offered when a provider creates or edits a company.
 * Values are IANA names (what the browser's Intl APIs expect). The list is
 * curated (Australia first, then nearby regions, then the rest) — extend freely.
 * New companies default to Sydney.
 */
export const DEFAULT_TIMEZONE = 'Australia/Sydney';

export const TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne / Canberra (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST, no DST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur' },
  { value: 'Asia/Jakarta', label: 'Jakarta' },
  { value: 'Asia/Bangkok', label: 'Bangkok' },
  { value: 'Asia/Manila', label: 'Manila' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Shanghai', label: 'China (Beijing / Shanghai)' },
  { value: 'Asia/Taipei', label: 'Taipei' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Asia/Seoul', label: 'Seoul' },
  { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (Paris / Berlin)' },
  { value: 'America/New_York', label: 'New York (Eastern)' },
  { value: 'America/Chicago', label: 'Chicago (Central)' },
  { value: 'America/Denver', label: 'Denver (Mountain)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific)' },
  { value: 'UTC', label: 'UTC' },
];

/** Friendly label for a stored timezone value (falls back to the raw value). */
export const tzLabel = (value) => (TIMEZONES.find((t) => t.value === value) || {}).label || value || DEFAULT_TIMEZONE;
