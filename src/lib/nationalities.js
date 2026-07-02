// Shared by Console.jsx (create/edit account) and FinTrack.jsx (off-day counts) —
// the value stored on the account is the full name; the code is the short form
// shown everywhere space is tight.
export const NATIONALITIES = [
  { value: 'Malaysia', code: 'MY' },
  { value: 'Indonesia', code: 'ID' },
  { value: 'Philippine', code: 'PH' },
  { value: 'Cambodia', code: 'CA' },
  { value: 'Thailand', code: 'TH' },
  { value: 'Others', code: 'Other' },
];

export const nationalityCode = (value) => NATIONALITIES.find((n) => n.value === value)?.code || '';
