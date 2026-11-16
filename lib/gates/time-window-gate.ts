import { violatesCurfew, ZONE_TIMEZONE } from '../curfew'
import { supabaseAdmin } from '../supabase-admin'
import { fail, pass, type GateContext, type GateResult } from './types'

const MS_PER_MIN = 60_000
const MS_PER_HOUR = 60 * MS_PER_MIN
const MS_PER_DAY = 24 * MS_PER_HOUR

export async function evaluateTimeWindowGate(
  ctx: GateContext,
  excludeRequestId?: string
): Promise<GateResult> {
  const { zone, aircraft, flightRequest, evaluatedAt } = ctx
  const windowStart = new Date(flightRequest.window_start)
  const windowEnd = new Date(flightRequest.window_end)

  // docs/06-business-rules.md §1.4 (TSD-4 §2.1 / §2.2): lead time and
  // advance-booking window are measured against the evaluation instant —
  // "submission time" for `submit`, "now" for the `validate` dry-run.
  const leadTimeMs = windowStart.getTime() - evaluatedAt.getTime()
  if (leadTimeMs < 6 * MS_PER_HOUR) {
    return fail('TIME_WINDOW', 'TSD-4 §2.1', 'Window starts less than 6 hours from now.')
  }
  if (leadTimeMs > 60 * MS_PER_DAY) {
    return fail('TIME_WINDOW', 'TSD-4 §2.2', 'Window is booked more than 60 days in advance.')
  }

  const durationMin = (windowEnd.getTime() - windowStart.getTime()) / MS_PER_MIN
  if (durationMin < 15 || durationMin > 180) {
    return fail('TIME_WINDOW', 'TSD-4 §3', 'Flight duration must be between 15 and 180 minutes.')
  }

  const curfewRuleReference =
    zone.code === 'KBP-CTR-3' || zone.code === 'ODS-CTR-5' ? 'A-7 §1' : 'ZC-2026.1 §3'
  if (violatesCurfew(windowStart, windowEnd, zone.curfew_start, zone.curfew_end, ZONE_TIMEZONE)) {
    return fail(
      'TIME_WINDOW',
      curfewRuleReference,
      `Window falls within the curfew for zone ${zone.code}.`
    )
  }

  // docs/06-business-rules.md §1.4 (TSD-4 §5): only APPROVED / UNDER_REVIEW
  // requests for the same aircraft count; boundary touches don't overlap,
  // hence strict lt/gt rather than lte/gte.
  let overlapQuery = supabaseAdmin
    .from('flight_requests')
    .select('id', { count: 'exact', head: true })
    .eq('aircraft_id', aircraft.id)
    .in('state', ['APPROVED', 'UNDER_REVIEW'])
    .lt('window_start', flightRequest.window_end)
    .gt('window_end', flightRequest.window_start)

  if (excludeRequestId) {
    overlapQuery = overlapQuery.neq('id', excludeRequestId)
  }

  const { count, error } = await overlapQuery
  if (error) throw error
  if ((count ?? 0) > 0) {
    return fail(
      'TIME_WINDOW',
      'TSD-4 §5',
      'Overlaps another approved or under-review request for the same aircraft.'
    )
  }

  return pass()
}
