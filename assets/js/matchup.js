// Any pairing priced with the betting model (pipeline/model.py), for the Head-to-head page.
// data/matchup.json (written by pipeline/betting.py) holds each player's model inputs as of the last update; the
// match-context factors (rest, fatigue, travel, home crowd, qualifier/wildcard) are neutral.
import { pMatchBo3 } from './data.js';

const logit = p => { const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return Math.log(q / (1 - q)); };
const sigmoid = z => 1 / (1 + Math.exp(-z));
const r3 = x => Math.round(x * 1000) / 1000;

/** Feature differences (player a minus player b) exactly as Model.features() builds them. */
export function matchupFeatures(MU, a, b, surface, h2h = [0, 0]) {
  const A = MU.players[a], B = MU.players[b], si = MU.surfaces.indexOf(surface);
  if (!A || !B || si < 0) return null;
  const [ea, ga, na, ma, lra, tra, fa, ia, ya, sa] = A, [eb, gb, nb, mb, lrb, trb, fb, ib, yb, sb] = B;
  const [sea, nsa, pfa, sva, rta] = sa[si], [seb, nsb, pfb, svb, rtb] = sb[si];
  const ts = MU.tour[surface];
  const qa = Math.min(0.95, Math.max(0.3, ts + (sva - ts) - (rtb - (1 - ts))));
  const qb = Math.min(0.95, Math.max(0.3, ts + (svb - ts) - (rta - (1 - ts))));
  const pm = pMatchBo3(r3(qa), r3(qb));
  const f = {
    elo: (ea - eb) / 100, selo: (sea - seb) / 100, gelo: (ga - gb) / 100,
    spec: ((sea - ea) * Math.min(1, nsa / 15) - (seb - eb) * Math.min(1, nsb / 15)) / 100,
    surfexp: Math.log1p(nsa) - Math.log1p(nsb), rank: lrb - lra, markov: logit(pm), form: fa - fb,
    h2h: (h2h[0] - h2h[1]) / (h2h[0] + h2h[1] + 2), surface: pfa - pfb, youth: (ya - yb) / 3,
    exp: Math.log1p(na) - Math.log1p(nb), trend: tra - trb, inj: ia - ib,
  };
  for (const k of MU.context) f[k] = 0;
  if (MU.inter) { const mn = Math.min(ma, mb), c = mn / (mn + 15); f.elo_c = f.elo * c; f.markov_c = f.markov * c; }
  return {
    f, raw: { qa, qb, pm, elo: [ea, eb], selo: [sea, seb], gelo: [ga, gb], nsurf: [nsa, nsb], spw: [sva, svb], rpw: [rta, rtb],
      form: [fa, fb], inj: [ia, ib], matches: [ma, mb], rankLog: [lra, lrb], h2h },
  };
}

/** Win probability for a, plus each factor's effect in percentage points (holding the others fixed). */
export function matchupPredict(MU, a, b, surface, h2h) {
  const r = matchupFeatures(MU, a, b, surface, h2h);
  if (!r) return null;
  const x = MU.names.map(k => r.f[k] || 0);
  const z = x.reduce((s, xi, i) => s + MU.coef[i] * xi, 0);
  const p = sigmoid(z);
  const factors = MU.names.map((k, i) => ({ f: k, label: (MU.labels || [])[i] || k, pts: 100 * (p - sigmoid(z - MU.coef[i] * x[i])) }))
    .filter(c => Math.abs(c.pts) >= 0.05).sort((u, v) => Math.abs(v.pts) - Math.abs(u.pts));
  return { p, z, factors, raw: r.raw };
}
