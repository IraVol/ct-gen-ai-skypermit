import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateTimeWindowGate } from '@/lib/gates/time-window-gate'
import { makeAircraft, makeFlightRequest, makeGateContext, EVALUATED_AT } from '../../fixtures'

// evaluateTimeWindowGate's overlap check queries supabaseAdmin directly —
// mock it so these stay unit tests. The mock is a minimal thenable that
// mimics the chainable PostgrestFilterBuilder shape the real code calls
// (.select().eq().in().lt().gt()[.neq()]), resolving to { count, error }
// when awaited, same as the real client does.
let overlapCount = 0
const queryCalls: { method: string; args: unknown[] }[] = []

function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'lt', 'gt', 'neq']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      queryCalls.push({ method, args })
      return builder
    })
  }
  builder.then = (resolve: (value: { count: number; error: null }) => void) =>
    resolve({ count: overlapCount, error: null })
  return builder
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeBuilder()),
  },
}))

beforeEach(() => {
  overlapCount = 0
  queryCalls.length = 0
})

// docs/06-business-rules.md §1.4 (TSD-4 §2.1/§2.2/§3/§4/§5).

describe('evaluateTimeWindowGate — lead time (TSD-4 §2.1: >= 6 hours)', () => {
  it('passes at exactly 6 hours of lead time', async () => {
    const windowStart = new Date(EVALUATED_AT.getTime() + 6 * 60 * 60 * 1000)
    const ctx = makeGateContext({
      flightRequest: makeFlightRequest({
        window_start: windowStart.toISOString(),
        window_end: new Date(windowStart.getTime() + 30 * 60 * 1000).toISOString(),
      }),
    })
    expect((await evaluateTimeWindowGate(ctx)).pass).toBe(true)
  })

  it('fails one minute short of 6 hours lead time, citing TSD-4 §2.1', async () => {
    const windowStart = new Date(EVALUATED_AT.getTime() + 6 * 60 * 60 * 1000 - 60 * 1000)
    const ctx = makeGateContext({
      flightRequest: makeFlightRequest({
        window_start: windowStart.toISOString(),
        window_end: new Date(windowStart.getTime() + 30 * 60 * 1000).toISOString(),
      }),
    })
    const result = await evaluateTimeWindowGate(ctx)
    expect(result.pass).toBe(false)
    if (!result.pass) {
      expect(result.failing_gate).toBe('TIME_WINDOW')
      expect(result.rule_reference).toBe('TSD-4 §2.1')
    }
  })
})

describe('evaluateTimeWindowGate — advance booking limit (TSD-4 §2.2: <= 60 days)', () => {
  it('passes at exactly 60 days out', async () => {
    const windowStart = new Date(EVALUATED_AT.getTime() + 60 * 24 * 60 * 60 * 1000)
    const ctx = makeGateContext({
      flightRequest: makeFlightRequest({
        window_start: windowStart.toISOString(),
        window_end: new Date(windowStart.getTime() + 30 * 60 * 1000).toISOString(),
      }),
    })
    expect((await evaluateTimeWindowGate(ctx)).pass).toBe(true)
  })

  it('fails one day past the 60-day limit, citing TSD-4 §2.2', async () => {
    const windowStart = new Date(EVALUATED_AT.getTime() + 61 * 24 * 60 * 60 * 1000)
    const ctx = makeGateContext({
      flightRequest: makeFlightRequest({
        window_start: windowStart.toISOString(),
        window_end: new Date(windowStart.getTime() + 30 * 60 * 1000).toISOString(),
      }),
    })
    const result = await evaluateTimeWindowGate(ctx)
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.rule_reference).toBe('TSD-4 §2.2')
  })
})

describe('evaluateTimeWindowGate — duration (TSD-4 §3: 15-180 minutes inclusive)', () => {
  function ctxWithDurationMinutes(minutes: number) {
    const windowStart = new Date(EVALUATED_AT.getTime() + 7 * 24 * 60 * 60 * 1000)
    return makeGateContext({
      flightRequest: makeFlightRequest({
        window_start: windowStart.toISOString(),
        window_end: new Date(windowStart.getTime() + minutes * 60 * 1000).toISOString(),
      }),
    })
  }

  it('passes at exactly 15 minutes', async () => expect((await evaluateTimeWindowGate(ctxWithDurationMinutes(15))).pass).toBe(true))
  it('passes at exactly 180 minutes', async () => expect((await evaluateTimeWindowGate(ctxWithDurationMinutes(180))).pass).toBe(true))

  it('fails at 14 minutes, citing TSD-4 §3', async () => {
    const result = await evaluateTimeWindowGate(ctxWithDurationMinutes(14))
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.rule_reference).toBe('TSD-4 §3')
  })

  it('fails at 181 minutes, citing TSD-4 §3', async () => {
    const result = await evaluateTimeWindowGate(ctxWithDurationMinutes(181))
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.rule_reference).toBe('TSD-4 §3')
  })
})

describe('evaluateTimeWindowGate — curfew citation depends on zone (TSD-4 §4, A-7 §1)', () => {
  const windowStart = new Date('2026-06-08T20:30:00.000Z') // 23:30 Kyiv local in June (UTC+3)
  function ctxForZone(code: string) {
    return makeGateContext({
      zone: {
        code,
        name: 'Test',
        zone_class: 'CONTROLLED',
        ceiling_metres: 120,
        permitted_bands: ['C0', 'C1', 'C2'],
        required_authorisation_level: 'L1',
        curfew_start: '23:00',
        curfew_end: '05:00',
        active: true,
      },
      flightRequest: makeFlightRequest({
        window_start: windowStart.toISOString(),
        window_end: new Date(windowStart.getTime() + 15 * 60 * 1000).toISOString(),
      }),
    })
  }

  it('cites A-7 §1 for KBP-CTR-3', async () => {
    const result = await evaluateTimeWindowGate(ctxForZone('KBP-CTR-3'))
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.rule_reference).toBe('A-7 §1')
  })

  it('cites A-7 §1 for ODS-CTR-5', async () => {
    const result = await evaluateTimeWindowGate(ctxForZone('ODS-CTR-5'))
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.rule_reference).toBe('A-7 §1')
  })

  it('cites ZC-2026.1 §3 for every other zone', async () => {
    const result = await evaluateTimeWindowGate(ctxForZone('LVV-RST-2'))
    expect(result.pass).toBe(false)
    if (!result.pass) expect(result.rule_reference).toBe('ZC-2026.1 §3')
  })
})

describe('evaluateTimeWindowGate — aircraft schedule overlap (TSD-4 §5)', () => {
  it('passes when the overlap query finds no conflicting rows', async () => {
    overlapCount = 0
    const ctx = makeGateContext()
    expect((await evaluateTimeWindowGate(ctx)).pass).toBe(true)
  })

  it('fails when the overlap query finds a conflicting row, citing TSD-4 §5', async () => {
    overlapCount = 1
    const ctx = makeGateContext()
    const result = await evaluateTimeWindowGate(ctx)
    expect(result.pass).toBe(false)
    if (!result.pass) {
      expect(result.failing_gate).toBe('TIME_WINDOW')
      expect(result.rule_reference).toBe('TSD-4 §5')
    }
  })

  it('only counts APPROVED and UNDER_REVIEW — the query filters state to exactly that pair', async () => {
    overlapCount = 0
    const ctx = makeGateContext({ aircraft: makeAircraft({ id: 'aircraft-42' }) })
    await evaluateTimeWindowGate(ctx)
    const inCall = queryCalls.find((c) => c.method === 'in')
    expect(inCall?.args).toEqual(['state', ['APPROVED', 'UNDER_REVIEW']])
    const eqCall = queryCalls.find((c) => c.method === 'eq')
    expect(eqCall?.args).toEqual(['aircraft_id', 'aircraft-42'])
  })

  it('excludes the request\'s own id when validating/re-submitting an already-persisted request', async () => {
    overlapCount = 0
    const ctx = makeGateContext({ flightRequest: makeFlightRequest({ id: 'this-request' }) })
    await evaluateTimeWindowGate(ctx, 'this-request')
    const neqCall = queryCalls.find((c) => c.method === 'neq')
    expect(neqCall?.args).toEqual(['id', 'this-request'])
  })

  it('does not call .neq() when no excludeRequestId is given', async () => {
    overlapCount = 0
    const ctx = makeGateContext()
    await evaluateTimeWindowGate(ctx)
    expect(queryCalls.find((c) => c.method === 'neq')).toBeUndefined()
  })
})
