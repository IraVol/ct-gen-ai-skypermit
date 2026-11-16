import { describe, expect, it } from 'vitest'
import { evaluateAircraftGate } from '@/lib/gates/aircraft-gate'
import { makeAircraft, makeGateContext, makeZone } from '../../fixtures'

// docs/06-business-rules.md §1.2, as corrected by docs/07-clarifications.md
// item 1: the weight-band-vs-zone check fails the AIRCRAFT gate (not
// ZONE, despite ZC-2026.1 §2's literal "fails the zone gate" wording,
// which is a confirmed corpus error).

describe('evaluateAircraftGate — weight band vs zone.permitted_bands', () => {
  it('passes when the aircraft band is permitted in the zone', () => {
    const ctx = makeGateContext({
      aircraft: makeAircraft({ mtom_grams: 500 }), // C0
      zone: makeZone({ permitted_bands: ['C0', 'C1'] }),
    })
    expect(evaluateAircraftGate(ctx).pass).toBe(true)
  })

  it('fails when the aircraft band is not in the zone\'s permitted_bands, with gate=AIRCRAFT and the ZC-2026.1 §2 citation', () => {
    // ZTM-RST-7 permits only C0 (docs/06-business-rules.md §4) — a C1
    // aircraft (901-3000g) must fail here.
    const ctx = makeGateContext({
      aircraft: makeAircraft({ mtom_grams: 2000 }), // C1
      zone: makeZone({ code: 'ZTM-RST-7', permitted_bands: ['C0'] }),
    })
    const result = evaluateAircraftGate(ctx)
    expect(result.pass).toBe(false)
    if (!result.pass) {
      expect(result.failing_gate).toBe('AIRCRAFT')
      expect(result.rule_reference).toBe('ZC-2026.1 §2')
    }
  })

  it('checks the derived band, not raw mtom_grams — an aircraft just over a band boundary is evaluated in the higher band', () => {
    const ctx = makeGateContext({
      aircraft: makeAircraft({ mtom_grams: 901 }), // just over the C0 900g ceiling -> C1
      zone: makeZone({ permitted_bands: ['C0'] }),
    })
    expect(evaluateAircraftGate(ctx).pass).toBe(false)
  })

  it('a C3 aircraft passes in DNI-OPN-1 (C0-C3 permitted) but would fail in a C0-only zone', () => {
    const c3Aircraft = makeAircraft({ mtom_grams: 20000 })
    expect(
      evaluateAircraftGate(makeGateContext({ aircraft: c3Aircraft, zone: makeZone({ permitted_bands: ['C0', 'C1', 'C2', 'C3'] }) }))
        .pass
    ).toBe(true)
    expect(
      evaluateAircraftGate(makeGateContext({ aircraft: c3Aircraft, zone: makeZone({ permitted_bands: ['C0'] }) })).pass
    ).toBe(false)
  })
})
