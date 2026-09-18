/*
 * Bank names and local banking wording for the "Bank name" dropdowns and the
 * bank/payment fields, chosen by the company's country.
 *
 * Until V2.7.6 there was one hardcoded Australian list, so a Singapore company
 * was offered Commonwealth Bank and Westpac and nothing it actually banks with.
 * V2.7.9 widened it to the Asia-Pacific markets this business works in.
 *
 * A country with no list here gets only the two generic entries: a short honest
 * list beats a long wrong one. These are real bank names people file real money
 * against, so nothing is listed that isn't known to exist — a company whose bank
 * is missing picks "Others" and renames the card from the Bank Accounts page,
 * whose edit form takes free text. Ask before adding a country: guessing a bank
 * name here is worse than leaving the country out.
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
  Cambodia: [
    'ACLEDA Bank', 'ABA Bank', 'Canadia Bank', 'Wing Bank', 'Vattanac Bank', 'Cambodian Public Bank (Campu)',
    'Chip Mong Commercial Bank', 'Prince Bank', 'Sathapana Bank', 'Phillip Bank', 'Hattha Bank',
    'Maybank Cambodia', 'J Trust Royal Bank', 'Foreign Trade Bank of Cambodia (FTB)', 'Woori Bank Cambodia',
  ],
  Thailand: [
    'Bangkok Bank', 'Kasikornbank (KBank)', 'Siam Commercial Bank (SCB)', 'Krungthai Bank (KTB)',
    'Bank of Ayudhya (Krungsri)', 'TMBThanachart Bank (ttb)', 'Government Savings Bank (GSB)',
    'Kiatnakin Phatra Bank', 'CIMB Thai Bank', 'United Overseas Bank (Thai)', 'Land and Houses Bank',
    'Bank for Agriculture and Agricultural Co-operatives (BAAC)', 'Tisco Bank',
    'Standard Chartered Bank (Thai)',
  ],
  Vietnam: [
    'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'VPBank',
    'Asia Commercial Bank (ACB)', 'Sacombank', 'TPBank', 'VIB', 'SHB', 'HDBank', 'SeABank',
    'Orient Commercial Bank (OCB)', 'Eximbank', 'MSB',
  ],
  Philippines: [
    'BDO Unibank', 'Bank of the Philippine Islands (BPI)', 'Metrobank', 'Land Bank of the Philippines',
    'Philippine National Bank (PNB)', 'Security Bank', 'China Banking Corporation', 'RCBC',
    'Union Bank of the Philippines', 'EastWest Bank', 'Development Bank of the Philippines (DBP)',
    'Bank of Commerce', 'Maya Bank', 'GoTyme Bank', 'Tonik Bank',
  ],
  Indonesia: [
    'Bank Central Asia (BCA)', 'Bank Mandiri', 'Bank Rakyat Indonesia (BRI)', 'Bank Negara Indonesia (BNI)',
    'Bank Tabungan Negara (BTN)', 'CIMB Niaga', 'Bank Danamon', 'Permata Bank',
    'Bank Syariah Indonesia (BSI)', 'OCBC Indonesia', 'Panin Bank', 'Maybank Indonesia', 'Bank Mega',
    'Bank Jago', 'SeaBank Indonesia', 'Allo Bank', 'Bank Neo Commerce',
  ],
  'Hong Kong': [
    'HSBC Hong Kong', 'Hang Seng Bank', 'Bank of China (Hong Kong)', 'Standard Chartered Hong Kong',
    'Bank of East Asia', 'Citibank Hong Kong', 'DBS Bank (Hong Kong)', 'China Construction Bank (Asia)',
    'ICBC (Asia)', 'Nanyang Commercial Bank', 'Dah Sing Bank', 'CMB Wing Lung Bank',
    'Public Bank (Hong Kong)', 'ZA Bank', 'Mox Bank', 'livi Bank', 'WeLab Bank', 'Airstar Bank',
    'Fusion Bank', 'Ant Bank (Hong Kong)', 'PAObank',
  ],
  China: [
    'Industrial and Commercial Bank of China (ICBC)', 'China Construction Bank (CCB)',
    'Agricultural Bank of China (ABC)', 'Bank of China (BOC)', 'Bank of Communications (BOCOM)',
    'China Merchants Bank (CMB)', 'Postal Savings Bank of China (PSBC)', 'Industrial Bank (CIB)',
    'Shanghai Pudong Development Bank (SPDB)', 'China CITIC Bank', 'China Minsheng Bank',
    'China Everbright Bank', 'Ping An Bank', 'Hua Xia Bank', 'China Guangfa Bank (CGB)',
    'Bank of Beijing', 'Bank of Shanghai', 'Bank of Ningbo', 'Bank of Jiangsu',
  ],
  Taiwan: [
    'Bank of Taiwan', 'CTBC Bank', 'Cathay United Bank', 'E.SUN Bank', 'Taipei Fubon Bank',
    'First Commercial Bank', 'Hua Nan Bank', 'Chang Hwa Bank', 'Taishin International Bank',
    'Mega International Commercial Bank', 'Land Bank of Taiwan', 'Taiwan Cooperative Bank',
    'Bank SinoPac', 'Union Bank of Taiwan', 'Shanghai Commercial and Savings Bank',
    'Rakuten International Commercial Bank', 'LINE Bank Taiwan', 'Next Bank',
  ],
  Japan: [
    'MUFG Bank', 'Sumitomo Mitsui Banking Corporation (SMBC)', 'Mizuho Bank', 'Resona Bank',
    'Saitama Resona Bank', 'Japan Post Bank (Yucho)', 'Sumitomo Mitsui Trust Bank', 'SBI Shinsei Bank',
    'Rakuten Bank', 'SBI Sumishin Net Bank', 'PayPay Bank', 'Sony Bank', 'au Jibun Bank',
    'Aeon Bank', 'Seven Bank',
  ],
  'South Korea': [
    'KB Kookmin Bank', 'Shinhan Bank', 'Woori Bank', 'Hana Bank', 'NH NongHyup Bank',
    'Industrial Bank of Korea (IBK)', 'Korea Development Bank (KDB)', 'SC First Bank',
    'Suhyup Bank', 'Busan Bank', 'iM Bank (Daegu Bank)', 'Kakao Bank', 'K Bank', 'Toss Bank',
  ],
  India: [
    'State Bank of India (SBI)', 'HDFC Bank', 'ICICI Bank', 'Punjab National Bank (PNB)', 'Axis Bank',
    'Bank of Baroda', 'Kotak Mahindra Bank', 'Canara Bank', 'Union Bank of India', 'IndusInd Bank',
    'IDFC FIRST Bank', 'Yes Bank', 'Indian Bank', 'Bank of India', 'Central Bank of India',
    'IDBI Bank', 'Federal Bank', 'RBL Bank', 'AU Small Finance Bank',
  ],
};

// ---------------------------------------------------------------------------
// LOCAL WORDING for the two Australian terms on the bank/payment fields, plus
// the VPN field's example (it names a node in the country).
//
// BSB is Australian. Everywhere else the equivalent is a bank and/or branch
// code, so that is the neutral label. PayID is Australian too; its equivalent is
// whatever instant-transfer alias the country actually uses.
//
// ONLY a scheme that really exists is named. Where a country has no well-known
// bank-transfer alias (Japan, Korea, Taiwan, China, Vietnam, the Philippines,
// Indonesia, New Zealand) the neutral "Payment ID" is used rather than inventing
// a brand — same rule as the bank lists: don't make up facts that end up sitting
// next to someone's money.
//
// Only the WORDS change. The stored fields are still `bsb` and `payid` — the
// blacklist's duplicate check is a unique index on (country, bsb, account_no)
// and on (country, payid), and it works just as well on any country's values.
//
// Australia's entry is the exact original wording and is pinned by a test.
// ---------------------------------------------------------------------------
const NEUTRAL_TERMS = Object.freeze({
  bsb: 'Bank/branch code',             // short label: cards, popups, detail panels
  bsbField: 'Bank/branch code',        // form label (add / edit bank account)
  bsbInline: 'bank/branch code',       // mid-sentence, e.g. a search placeholder
  bsbExample: 'e.g. bank and branch code',
  payid: 'Payment ID',
  payidExample: 'e.g. mobile number or email',
  vpnExample: 'e.g. local node',
});

// Only the keys that differ from NEUTRAL_TERMS need listing.
const terms = (over) => Object.freeze({ ...NEUTRAL_TERMS, ...over });

export const TERMS_BY_COUNTRY = {
  Australia: Object.freeze({
    bsb: 'BSB', bsbField: 'BSB number', bsbInline: 'BSB', bsbExample: 'e.g. 062-000',
    payid: 'PayID', payidExample: 'e.g. name@company.com', vpnExample: 'e.g. Melbourne node',
  }),
  // 4-digit bank code + 3-digit branch code; 7171 is DBS / POSB.
  Singapore: terms({ bsbExample: 'e.g. 7171-001', payid: 'PayNow',
    payidExample: 'e.g. mobile number or UEN', vpnExample: 'e.g. Singapore node' }),
  Malaysia: terms({ payid: 'DuitNow ID', payidExample: 'e.g. mobile number or NRIC',
    vpnExample: 'e.g. Kuala Lumpur node' }),
  // NZ account numbers start with bank then branch, e.g. 12-3456-...
  'New Zealand': terms({ bsbExample: 'e.g. 12-3456', vpnExample: 'e.g. Auckland node' }),
  Cambodia: terms({ payid: 'Bakong ID', payidExample: 'e.g. mobile number or Bakong account',
    vpnExample: 'e.g. Phnom Penh node' }),
  Thailand: terms({ payid: 'PromptPay ID', payidExample: 'e.g. mobile number or national ID',
    vpnExample: 'e.g. Bangkok node' }),
  Vietnam: terms({ vpnExample: 'e.g. Ho Chi Minh City node' }),
  Philippines: terms({ vpnExample: 'e.g. Manila node' }),
  Indonesia: terms({ vpnExample: 'e.g. Jakarta node' }),
  'Hong Kong': terms({ payid: 'FPS ID', payidExample: 'e.g. mobile number, email or FPS ID',
    vpnExample: 'e.g. Hong Kong node' }),
  China: terms({ vpnExample: 'e.g. Shanghai node' }),
  Taiwan: terms({ vpnExample: 'e.g. Taipei node' }),
  Japan: terms({ vpnExample: 'e.g. Tokyo node' }),
  'South Korea': terms({ vpnExample: 'e.g. Seoul node' }),
  // IFSC is exactly India's bank-and-branch code.
  India: terms({ bsb: 'IFSC code', bsbField: 'IFSC code', bsbInline: 'IFSC code',
    bsbExample: 'e.g. HDFC0001234', payid: 'UPI ID', payidExample: 'e.g. name@bank',
    vpnExample: 'e.g. Mumbai node' }),
};

/*
 * A blank country is a company the provider hasn't assigned one yet. Every
 * company that predates the country field was Australian, and new companies
 * still default to the Australia/Sydney timezone, so a blank keeps the banks AND
 * the wording those companies have always had rather than changing under them.
 */
const DEFAULT_COUNTRY = 'Australia';
const resolveCountry = (country) => String(country || '').trim() || DEFAULT_COUNTRY;

/** Bank names for a country, generic entries last. */
export function bankChoicesFor(country) {
  return [...(BANKS_BY_COUNTRY[resolveCountry(country)] || []), ...COMMON];
}

/** The words to show for BSB / PayID / the VPN example in a given country. */
export function bankTermsFor(country) {
  return TERMS_BY_COUNTRY[resolveCountry(country)] || NEUTRAL_TERMS;
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
