/*
 * Bank names offered by the "Bank name" dropdowns (Add new bank account, and
 * Add / Edit bank detail), chosen by the company's country.
 *
 * Until V2.7.6 there was one hardcoded Australian list, so a Singapore company
 * was offered Commonwealth Bank and Westpac and nothing it actually banks with.
 *
 * The curated countries are the four this portal was originally set up for —
 * see the history note in countries.js. Any other country gets only the two
 * generic entries below: a short honest list beats a long wrong one. A company
 * whose bank is missing can pick "Others" and then rename the card from the
 * Bank Accounts page, whose edit form takes free text.
 *
 * DO NOT re-spell an entry that is already in use. A bank's name is saved as this
 * exact string, so renaming one here would leave existing cards showing a name
 * the dropdown no longer offers. (bankOptionsFor() still displays such a value,
 * but the list should not drift out from under saved data.) The Australian list
 * in particular is kept verbatim from the old hardcoded one.
 *
 * Keys are matched exactly against `companies.country`, which only ever holds a
 * value picked from COUNTRIES in countries.js — so spell them the same way.
 */

// Offered in every country, always last.
const COMMON = ['Payment Gateway', 'Others'];

export const BANKS_BY_COUNTRY = {
  Australia: [
    'Commonwealth Bank of Australia (CBA)', 'Westpac Banking Corporation', 'National Australia Bank (NAB)',
    'Australia and New Zealand Banking Group (ANZ)', 'Bank of Queensland (BOQ)', 'Bendigo and Adelaide Bank',
    'Suncorp Bank', 'Macquarie Bank', 'Bankwest', 'Bank of Melbourne', 'St.George', 'BankSA', 'Bank Australia',
    'Great Southern Bank', 'Beyond Bank', 'People First Bank', 'Newcastle Greater Mutual Group (NGM)',
    'Teachers Mutual Bank', 'ING Australia', 'HSBC Bank Australia', 'Judo Bank', 'Ubank', 'Up Bank',
  ],
  Singapore: [
    'DBS Bank', 'POSB Bank', 'Oversea-Chinese Banking Corporation (OCBC)', 'United Overseas Bank (UOB)',
    'Standard Chartered Bank Singapore', 'Citibank Singapore', 'HSBC Singapore', 'Maybank Singapore',
    'CIMB Bank Singapore', 'RHB Bank Singapore', 'Bank of China Singapore', 'ICBC Singapore',
    'State Bank of India Singapore', 'Trust Bank', 'GXS Bank', 'MariBank', 'ANEXT Bank',
    'Green Link Digital Bank',
  ],
  Malaysia: [
    'Maybank (Malayan Banking)', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank',
    'Alliance Bank', 'Affin Bank', 'Bank Islam Malaysia', 'Bank Muamalat', 'Bank Rakyat',
    'Bank Simpanan Nasional (BSN)', 'Agrobank', 'MBSB Bank', 'Kuwait Finance House Malaysia',
    'Al Rajhi Bank Malaysia', 'HSBC Bank Malaysia', 'Standard Chartered Bank Malaysia',
    'OCBC Bank Malaysia', 'UOB Malaysia', 'GXBank', 'AEON Bank', 'Boost Bank',
  ],
  'New Zealand': [
    'ANZ Bank New Zealand', 'ASB Bank', 'Bank of New Zealand (BNZ)', 'Westpac New Zealand', 'Kiwibank',
    'TSB Bank', 'SBS Bank', 'The Co-operative Bank', 'Heartland Bank', 'Rabobank New Zealand',
  ],
};

/*
 * A blank country is a company the provider hasn't assigned one yet. Every
 * company that predates the country field was Australian, and new companies
 * still default to the Australia/Sydney timezone, so a blank keeps the list
 * those companies have always had rather than suddenly offering nothing.
 */
const DEFAULT_COUNTRY = 'Australia';

/** Bank names for a country, generic entries last. */
export function bankChoicesFor(country) {
  const key = String(country || '').trim() || DEFAULT_COUNTRY;
  return [...(BANKS_BY_COUNTRY[key] || []), ...COMMON];
}

/*
 * Ready-made FluidDropdown options.
 *
 * `current` is the value already in the form. If it isn't in this country's list
 * — a card added before its company's country was changed, say — it is kept as
 * the first real option. Without that the dropdown finds no match, shows the
 * "— Select bank —" placeholder and LOOKS empty even though the saved name is
 * still there underneath, which invites someone to pick a different bank.
 */
export function bankOptionsFor(country, current) {
  const choices = bankChoicesFor(country);
  const cur = String(current || '');
  const list = cur && !choices.includes(cur) ? [cur, ...choices] : choices;
  return [{ value: '', label: '— Select bank —' }, ...list.map((b) => ({ value: b, label: b }))];
}

// ---------------------------------------------------------------------------
// BSB and PayID are Australian terms. Singapore identifies an account by bank
// and branch code, and its instant-payment alias is PayNow. Only the WORDS
// change: the stored fields are still `bsb` and `payid`, which is deliberate --
// the blacklist's duplicate check is a unique index on (country, bsb,
// account_no) and on (country, payid), and it works just as well on Singapore
// values. Renaming the fields themselves would break that for nothing.
//
// Singapore only, by request; every other country keeps the wording it has
// always had. The default block is those exact strings -- change one and every
// Australian company sees it.
// ---------------------------------------------------------------------------
const DEFAULT_TERMS = Object.freeze({
  bsb: 'BSB',                          // short label: cards, popups, detail panels
  bsbField: 'BSB number',              // form label (add / edit bank account)
  bsbInline: 'BSB',                    // mid-sentence, e.g. a search placeholder
  bsbExample: 'e.g. 062-000',
  payid: 'PayID',
  payidExample: 'e.g. name@company.com',
});

const TERMS_BY_COUNTRY = {
  // 4-digit bank code + 3-digit branch code; 7171 is DBS / POSB.
  Singapore: Object.freeze({
    bsb: 'Bank/branch code',
    bsbField: 'Bank/branch code',
    bsbInline: 'bank/branch code',
    bsbExample: 'e.g. 7171-001',
    payid: 'PayNow',
    payidExample: 'e.g. mobile number or UEN',
  }),
};

/** The words to show for BSB / PayID in a given country. */
export function bankTermsFor(country) {
  return TERMS_BY_COUNTRY[String(country || '').trim()] || DEFAULT_TERMS;
}

/*
 * For the label tables that are built once at module load (Bank Details fields,
 * the Blacklist form). Swaps a label only when it is EXACTLY "BSB" or "PayID" --
 * a whole-string match, never a substring replace, so nothing else can be caught.
 */
export function relabelBankTerm(label, country) {
  if (label === 'BSB') return bankTermsFor(country).bsb;
  if (label === 'PayID') return bankTermsFor(country).payid;
  return label;
}
