import type { PilotCurrencyStatus, WeightBand } from './types'

// docs/06-business-rules.md §2 (OH-1 v2.0 §2.3): current for 18 months from
// certified_on, no grace period. certified_on is a date (no time-of-day), so
// the expiry is treated as running through the end of the 18-months-out
// calendar day in UTC — one calendar day past that is lapsed.
export function pilotCurrencyExpiresOn(certifiedOn: string): Date {
  const [year, month, day] = certifiedOn.split('-').map(Number)
  const expiry = new Date(Date.UTC(year, month - 1 + 18, day))
  return expiry
}

export function computePilotCurrencyStatus(
  certifiedOn: string,
  asOf: Date
): PilotCurrencyStatus {
  const expiry = pilotCurrencyExpiresOn(certifiedOn)
  const expiryEndOfDay = new Date(expiry.getTime() + 24 * 60 * 60 * 1000 - 1)
  return asOf.getTime() <= expiryEndOfDay.getTime() ? 'CURRENT' : 'LAPSED'
}

// docs/06-business-rules.md §3 (OH-1 v2.0 §3): four bands, upper-bound
// inclusive. Registration already rejects > 30,000g, so the last band is a
// closed range in practice, but the check is written defensively.
export function computeWeightBand(mtomGrams: number): WeightBand {
  if (mtomGrams <= 900) return 'C0'
  if (mtomGrams <= 3000) return 'C1'
  if (mtomGrams <= 12000) return 'C2'
  return 'C3'
}
