// Connection-quality indicator from RTCPeerConnection.getStats().

export type Quality = 'good' | 'fair' | 'poor' | 'unknown'

export type LinkSample = {
  rttMs: number | null
  packetsReceived: number
  packetsLost: number
}

type StatLike = { type: string; [k: string]: unknown }

/** Pull round-trip time and inbound packet counters out of a stats report. */
export function sampleStats(stats: Iterable<StatLike>): LinkSample {
  let rttMs: number | null = null
  let packetsReceived = 0
  let packetsLost = 0
  for (const s of stats) {
    if (s.type === 'candidate-pair' && (s.nominated || s.selected) && typeof s.currentRoundTripTime === 'number') {
      rttMs = s.currentRoundTripTime * 1000
    }
    if (s.type === 'inbound-rtp') {
      packetsReceived += Number(s.packetsReceived ?? 0)
      packetsLost += Math.max(0, Number(s.packetsLost ?? 0))
    }
  }
  return { rttMs, packetsReceived, packetsLost }
}

/** Grade the link from the change between two samples (loss is measured per interval). */
export function grade(prev: LinkSample | null, cur: LinkSample): Quality {
  const received = cur.packetsReceived - (prev?.packetsReceived ?? 0)
  const lost = cur.packetsLost - (prev?.packetsLost ?? 0)
  const total = received + lost
  const lossPct = total > 0 ? (lost / total) * 100 : 0
  if (cur.rttMs === null && total === 0) return 'unknown'
  const rtt = cur.rttMs ?? 0
  if (lossPct > 8 || rtt > 600) return 'poor'
  if (lossPct > 2 || rtt > 300) return 'fair'
  return 'good'
}
