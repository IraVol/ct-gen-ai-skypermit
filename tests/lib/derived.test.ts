import { describe, expect, it } from 'vitest'
import { computePilotCurrencyStatus, computeWeightBand, pilotCurrencyExpiresOn } from '@/lib/derived'

// docs/06-business-rules.md §2 (OH-1 v2.0 §2.3): current for 18 months
// from certified_on, no grace period, checked against window_start.
describe('computePilotCurrencyStatus — §2 pilot currency (18 months)', () => {
  it('is CURRENT the day the pilot certified', () => {
    expect(computePilotCurrencyStatus('2026-01-15', new Date('2026-01-15T00:00:00Z'))).toBe('CURRENT')
  })

  it('is CURRENT on the exact 18-month anniversary date', () => {
    // 2026-01-15 + 18 months = 2027-07-15
    expect(computePilotCurrencyStatus('2026-01-15', new Date('2027-07-15T23:59:59Z'))).toBe('CURRENT')
  })

  it('is LAPSED the calendar day after the 18-month anniversary — no grace period', () => {
    expect(computePilotCurrencyStatus('2026-01-15', new Date('2027-07-16T00:00:00Z'))).toBe('LAPSED')
  })

  it('is LAPSED well past the anniversary', () => {
    expect(computePilotCurrencyStatus('2026-01-15', new Date('2028-01-01T00:00:00Z'))).toBe('LAPSED')
  })

  it('is evaluated against whichever instant is passed, not wall-clock "now" — same certified_on, different asOf, different result', () => {
    // certified_on 2026-01-01 -> expires 2027-07-01. A request submitted
    // well before that is still CURRENT; the same pilot checked against a
    // later flight window past the anniversary is LAPSED, exactly the
    // "current at submission but lapsed by the flight window" case
    // docs/06-business-rules.md §1.1 calls out explicitly.
    const certifiedOn = '2026-01-01'
    expect(computePilotCurrencyStatus(certifiedOn, new Date('2026-03-01T00:00:00Z'))).toBe('CURRENT')
    expect(computePilotCurrencyStatus(certifiedOn, new Date('2027-08-01T00:00:00Z'))).toBe('LAPSED')
  })
})

describe('pilotCurrencyExpiresOn', () => {
  it('adds exactly 18 months, rolling the year over correctly', () => {
    expect(pilotCurrencyExpiresOn('2026-01-15').toISOString().slice(0, 10)).toBe('2027-07-15')
  })

  it('rolls over a December certification into the following year correctly', () => {
    // 2025-12-01 + 18 months = 2027-06-01
    expect(pilotCurrencyExpiresOn('2025-12-01').toISOString().slice(0, 10)).toBe('2027-06-01')
  })
})

// docs/06-business-rules.md §3 (OH-1 v2.0 §3): four bands, upper-bound
// inclusive — 0-900 C0, 901-3000 C1, 3001-12000 C2, 12001-30000 C3.
describe('computeWeightBand — §3 weight band thresholds', () => {
  it('bands the lower boundary and interior of C0', () => {
    expect(computeWeightBand(0)).toBe('C0')
    expect(computeWeightBand(500)).toBe('C0')
  })

  it('900g is C0 (upper bound inclusive)', () => {
    expect(computeWeightBand(900)).toBe('C0')
  })

  it('901g is C1 (just above the C0/C1 boundary)', () => {
    expect(computeWeightBand(901)).toBe('C1')
  })

  it('3000g is C1 (upper bound inclusive)', () => {
    expect(computeWeightBand(3000)).toBe('C1')
  })

  it('3001g is C2', () => {
    expect(computeWeightBand(3001)).toBe('C2')
  })

  it('12000g is C2 (upper bound inclusive)', () => {
    expect(computeWeightBand(12000)).toBe('C2')
  })

  it('12001g is C3', () => {
    expect(computeWeightBand(12001)).toBe('C3')
  })

  it('30000g (the registration ceiling) is C3', () => {
    expect(computeWeightBand(30000)).toBe('C3')
  })
})
