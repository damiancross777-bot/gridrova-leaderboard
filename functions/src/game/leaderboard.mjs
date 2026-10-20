export const PODIUM_PRIZES = Object.freeze({1: 500, 2: 300, 3: 150});
export const PODIUM_NAMES = Object.freeze({1: "Gold", 2: "Silver", 3: "Bronze"});
export function utcDay(time = Date.now()) { return new Date(time).toISOString().slice(0, 10); }
export function validPodiumReceipt(r, playerId, now = Date.now()) {
  if (!r || typeof playerId !== "string" || !playerId || r.playerId !== playerId || r.finalized !== true) return false;
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
  const stamp = Date.parse(r.date + "T00:00:00Z");
  if (!Number.isFinite(stamp) || utcDay(stamp) !== r.date || r.date >= utcDay(now)) return false;
  return Number.isInteger(r.rank) && r.rank >= 1 && r.rank <= 3 && r.coins === PODIUM_PRIZES[r.rank] && r.awardId === `daily:${r.date}:${playerId}`;
}
export function podiumSummary(state) {
  const receipts = Object.values(state.podium?.receipts || {});
  const counts = {1: 0, 2: 0, 3: 0};
  for (const r of receipts) if (PODIUM_PRIZES[r.rank]) counts[r.rank]++;
  return {counts, total: receipts.length, receipts: receipts.sort((a,b) => b.date.localeCompare(a.date)), badges: [
    {id:"first-podium", name:"First podium", detail:"Earn your first daily medal", earned:receipts.length >= 1},
    {id:"daily-champion", name:"Daily champion", detail:"Finish first in a daily challenge", earned:counts[1] >= 1},
    {id:"podium-regular", name:"Podium regular", detail:"Collect five daily medals", earned:receipts.length >= 5},
    {id:"golden-trio", name:"Golden trio", detail:"Win three daily gold medals", earned:counts[1] >= 3},
  ]};
}

export function journeyProgress(state) {
  return new Set((state.completed || []).filter(id => Number.isInteger(id) && id >= 1 && id <= 300)).size;
}
export function hasCompletedJourney(state) { return journeyProgress(state) === 300; }
export function validChampionsPage(data) {
  return !!data && Array.isArray(data.entries) && data.entries.length <= 100 &&
    (data.nextCursor == null || (typeof data.nextCursor === "string" && data.nextCursor.length <= 512)) &&
    data.entries.every(e => e && typeof e.playerId === "string" && e.playerId.length > 0 && e.playerId.length <= 128 && typeof e.displayName === "string" && e.displayName.trim().length > 0 && e.displayName.length <= 24 && e.verified === true && e.completedLevels === 300 && typeof e.completedAt === "string" && Number.isFinite(Date.parse(e.completedAt))) &&
    new Set(data.entries.map(e => e.playerId)).size === data.entries.length;
}
