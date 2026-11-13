// World lists for "where does your business operate" — every country, every
// currency, and a sensible default currency for each country. Built from the
// browser's own Intl data so the lists stay current; the country → currency map
// is ISO 4217 as at 2026 (a starting suggestion only — the person can pick any
// currency). Shared by the sign-up form and Company basics.

/** Main currency per ISO 3166 country (shared currencies such as EUR, XCD, XOF included). */
export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  AD: "EUR", AE: "AED", AF: "AFN", AG: "XCD", AI: "XCD", AL: "ALL", AM: "AMD", AO: "AOA", AR: "ARS", AS: "USD", AT: "EUR", AU: "AUD", AW: "AWG", AX: "EUR", AZ: "AZN",
  BA: "BAM", BB: "BBD", BD: "BDT", BE: "EUR", BF: "XOF", BG: "BGN", BH: "BHD", BI: "BIF", BJ: "XOF", BL: "EUR", BM: "BMD", BN: "BND", BO: "BOB", BQ: "USD", BR: "BRL", BS: "BSD", BT: "BTN", BW: "BWP", BY: "BYN", BZ: "BZD",
  CA: "CAD", CD: "CDF", CF: "XAF", CG: "XAF", CH: "CHF", CI: "XOF", CK: "NZD", CL: "CLP", CM: "XAF", CN: "CNY", CO: "COP", CR: "CRC", CU: "CUP", CV: "CVE", CW: "ANG", CY: "EUR", CZ: "CZK",
  DE: "EUR", DJ: "DJF", DK: "DKK", DM: "XCD", DO: "DOP", DZ: "DZD", EC: "USD", EE: "EUR", EG: "EGP", ER: "ERN", ES: "EUR", ET: "ETB", FI: "EUR", FJ: "FJD", FK: "FKP", FM: "USD", FO: "DKK", FR: "EUR",
  GA: "XAF", GB: "GBP", GD: "XCD", GE: "GEL", GF: "EUR", GG: "GBP", GH: "GHS", GI: "GIP", GL: "DKK", GM: "GMD", GN: "GNF", GP: "EUR", GQ: "XAF", GR: "EUR", GT: "GTQ", GU: "USD", GW: "XOF", GY: "GYD",
  HK: "HKD", HN: "HNL", HR: "EUR", HT: "HTG", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IM: "GBP", IN: "INR", IQ: "IQD", IR: "IRR", IS: "ISK", IT: "EUR", JE: "GBP", JM: "JMD", JO: "JOD", JP: "JPY",
  KE: "KES", KG: "KGS", KH: "KHR", KI: "AUD", KM: "KMF", KN: "XCD", KR: "KRW", KW: "KWD", KY: "KYD", KZ: "KZT", LA: "LAK", LB: "LBP", LC: "XCD", LI: "CHF", LK: "LKR", LR: "LRD", LS: "LSL", LT: "EUR", LU: "EUR", LV: "EUR", LY: "LYD",
  MA: "MAD", MC: "EUR", MD: "MDL", ME: "EUR", MF: "EUR", MG: "MGA", MH: "USD", MK: "MKD", ML: "XOF", MM: "MMK", MN: "MNT", MO: "MOP", MP: "USD", MQ: "EUR", MR: "MRU", MS: "XCD", MT: "EUR", MU: "MUR", MV: "MVR", MW: "MWK", MX: "MXN", MY: "MYR", MZ: "MZN",
  NA: "NAD", NC: "XPF", NE: "XOF", NG: "NGN", NI: "NIO", NL: "EUR", NO: "NOK", NP: "NPR", NR: "AUD", NZ: "NZD", OM: "OMR", PA: "PAB", PE: "PEN", PF: "XPF", PG: "PGK", PH: "PHP", PK: "PKR", PL: "PLN", PR: "USD", PS: "ILS", PT: "EUR", PW: "USD", PY: "PYG",
  QA: "QAR", RE: "EUR", RO: "RON", RS: "RSD", RU: "RUB", RW: "RWF", SA: "SAR", SB: "SBD", SC: "SCR", SD: "SDG", SE: "SEK", SG: "SGD", SI: "EUR", SK: "EUR", SL: "SLE", SM: "EUR", SN: "XOF", SO: "SOS", SR: "SRD", SS: "SSP", ST: "STN", SV: "USD", SX: "ANG", SY: "SYP", SZ: "SZL",
  TC: "USD", TD: "XAF", TG: "XOF", TH: "THB", TJ: "TJS", TL: "USD", TM: "TMT", TN: "TND", TO: "TOP", TR: "TRY", TT: "TTD", TV: "AUD", TW: "TWD", TZ: "TZS", UA: "UAH", UG: "UGX", US: "USD", UY: "UYU", UZ: "UZS",
  VA: "EUR", VC: "XCD", VE: "VES", VG: "USD", VI: "USD", VN: "VND", VU: "VUV", WS: "WST", XK: "EUR", YE: "YER", YT: "EUR", ZA: "ZAR", ZM: "ZMW", ZW: "ZWG",
};

/** Every country the browser can name, as [code, name], sorted by name. */
export function countryOptions(locale = "en"): [string, string][] {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([locale], { type: "region" }); } catch { /* old browser */ }
  return Object.keys(CURRENCY_BY_COUNTRY)
    .map((c) => [c, names?.of(c) ?? c] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

/** The currencies countries actually use (one or more per country, from the
 *  map above), as [code, "CODE — Name"], sorted by code. Not the browser's
 *  whole ISO 4217 list, which adds fund and settlement codes ("US Dollar (Next
 *  day)", "WIR Euro"), precious metals, test codes and retired currencies. */
export function currencyOptions(locale = "en"): [string, string][] {
  const codes = Array.from(new Set(Object.values(CURRENCY_BY_COUNTRY))).sort();
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([locale], { type: "currency" }); } catch { /* old browser */ }
  return codes.map((c) => [c, `${c} — ${names?.of(c) ?? c}`]);
}

/** The visitor's own country and time zone, as a starting guess. */
export function guessRegion(): { country: string; timezone: string } {
  let timezone = "UTC";
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }
  let country = "";
  try {
    const langs = typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
    for (const l of langs) {
      const region = new Intl.Locale(l).maximize().region;
      if (region && CURRENCY_BY_COUNTRY[region]) { country = region; break; }
    }
  } catch { /* no guess */ }
  return { country, timezone };
}
