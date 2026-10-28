// Methodology & glossary.
import { h, fmtInt, fmtPct } from '../util.js';
import { D, METRICS, METRIC_GROUPS, ACTIVE_WEEKS, SEASON, PAST, CURRENT_SEASON, seedLabel, seasonHref } from '../data.js';
import { pageHead } from '../components.js';
import { updatedLabel } from '../main.js';

export function render(root) {
  root.appendChild(pageHead('About', 'Data & methodology', null));
  const nEv = D.eventList.length, nM = D.matches.length;
  const carried = Object.values(D.players).filter(p => p.s0 != null).length;
  const K = D.K, withPts = D.matches.filter(m => m.hasMB && m.ws && m.ws[K.tp]);
  const clsOk = withPts.filter(m => (m.ws[K.mCls] || 0) / m.ws[K.tp] >= 0.8).length / (withPts.length || 1);
  const prose = h('div', { class: 'prose' });
  prose.innerHTML = `
    <p>Challenger Analytics covers <b>${fmtInt(nM)}</b> singles matches (main draw and qualifying) from <b>${nEv}</b> ATP Challenger Tour events in the ${SEASON} season${PAST ? ` (the complete season; switch to <a href="${seasonHref(CURRENT_SEASON, '#/about')}">${CURRENT_SEASON}</a> for the season in progress)` : `, last refreshed <b>${updatedLabel()}</b>. New results are added once a day`}. Walkovers are excluded (a walkover final still counts as a title); retirements are kept and flagged.</p>
    <h3>Quick guide</h3>
    <dl class="guide">
      <dt>Elo</dt><dd>A rating built from results: it rises with every win and falls with every loss, by more when the opponent is strong. About 1,500 is qualifier level, 1,750 a typical main-draw player, 1,900+ top-100 form. Two ratings give a win chance: 100 points apart is about 70% for the higher one.</dd>
      <dt>Win probability</dt><dd>On match pages, each player's chance of winning before every point. It starts from the Elo forecast and follows the score, so a break of serve or a saved match point shows up as a jump.</dd>
      <dt>Title odds</dt><dd>On tournament pages, each player's chance of winning the event, playing out the rest of the draw with Elo.</dd>
      <dt>Hold % and break %</dt><dd>Share of service games won, and share of the opponent's service games won.</dd>
      <dt>Dominance ratio</dt><dd>Return points won divided by serve points lost. Above 1.00 means winning more on return than giving away on serve; the best players sit around 1.3.</dd>
      <dt>Hawk-Eye</dt><dd>Ball tracking at some events: where serves land, how fast and how high shots travel.</dd>
    </dl>
    <p><b>Simple or Advanced:</b> the switch at the top changes how much you see. Simple shows the key numbers with plain labels; Advanced adds every stat column, the extra filters (category, draw, venue, region), the model checks and the Hawk-Eye Lab. Your choice is remembered on this device.</p>
    <p><b>Play:</b> the Play page has a daily mystery-player game, a match simulator that plays any pairing point by point (or 10,000 times), and an animated Elo race. On any tournament page, the "What if?" bracket lets you change results and see every title chance update.</p>
    <p><b>Tips:</b> the filter bar (period, surface, category and more) applies to every analysis page; on a phone it folds behind the Filters button. Every table has a "What the columns mean" button. Press <kbd>/</kbd> to search, and use the year button next to the logo to switch seasons.</p>
    <h3>Sources</h3>
    <ul>
      <li><b>ATP match stats</b> (the stats centre on atptour.com): serve, return and point totals per match and per set, scores, round, court, duration and umpire.</li>
      <li><b>Infosys point data</b> that powers the ATP stats centre: MatchBeats point-by-point (server, point winner, how each point ended, break points, game durations), key stats and stroke summaries.</li>
      <li><b>Hawk-Eye CourtVision</b> at events with Hawk-Eye Live: every serve's bounce position, and the hit / net-crossing / bounce positions, speed, spin and net clearance of each point-ending shot.</li>
      <li><b>Video ball tracking</b> for selected matches at events without Hawk-Eye: the Challenger TV broadcast is run through computer vision (ball and court detection, a 3D fit of every ball flight, both players' positions in every frame), giving each shot's speed, spin, height over the net, contact point and bounce, plus how far each player ran. Its points are lined up with ATP's official point-by-point record, which settles the score, server, winner and how each point ended; rally lengths and running only use points the video followed from serve to final shot. Speeds are within about 3-5% of stadium radar on serves (checked on other broadcasts) and less precise on shots hit straight away from the camera. Open such a match and choose the Ball tracking tab.</li>
      <li><b>ATP rankings</b>: every weekly singles ranking release of ${SEASON} (rank at match time, ranking history) and player bios (age, height, plays, backhand).</li>
    </ul>
    <h3>Win probability and title odds</h3>
    <ul>
      <li><b>Win probability during a match</b> (match page, "Momentum &amp; flow"): each player's chance of winning a point on serve is set so that, at 0-0, the model gives the pre-match Elo probability. From any score, the chance of winning the match then follows exactly from the scoring rules (best of three sets, 7-point tiebreak at 6-6). Points are treated as independent, so the line slightly understates comebacks driven by momentum or nerves. A match is only shown when its point-by-point record replays to the official score; about 4% of matches with point data have a missing or duplicated game and are left out.</li>
      <li><b>Great escapes, match points saved, drama</b> (Insights, Matches, player pages): an escape is a win after the chance fell below 10%; a slip is a loss after holding 90% or more. Drama adds up how far the win probability moved over the match: every point that shifts it by 5% adds 5.</li>
      <li><b>Title odds</b> (tournament pages): ATP numbers each main draw like a family tree (the final is match 1, the semifinals 2 and 3, and match k is fed by matches 2k and 2k+1), so the full draw is known from the first round. Every possible path through it is weighted by the Elo win chance of each match-up. "Before the main draw" uses ratings going into the first round; live odds fix the results so far and play out the rest with current ratings. Elo can underrate players returning from injury, so a few "long shots" were not really long shots.</li>
    </ul>
    <h3>Elo ratings</h3>
    <p>Ratings are updated after every match in date order. Each player starts the season at <code>1750 − 140 × ln(ATP rank on ${seedLabel()} ÷ 200)</code> (rank 200 = 1750, rank 50 ≈ 1944; unranked players start at 1300), so the first weeks are already informative.${carried ? ` Players with 5 or more Challenger matches in ${SEASON - 1} start from 70% of their final ${SEASON - 1} Elo plus 30% of that ranking seed (${fmtInt(carried)} players this season); this cut the log-loss of the season's pre-match predictions from 0.610 to 0.605, most of it in the first three months.` : ''} The update size is <code>K = 250 / (n + 5)^0.6</code>, where <i>n</i> counts rated matches plus a prior allowance by ranking, and win probabilities use a logistic scale of 275 Elo points. These parameters were tuned on the season itself by minimising the log-loss of pre-match predictions, which are always made from earlier matches only (see the calibration chart on the Insights page). Retirements count with half weight. Surface Elo starts from a player's overall rating the first time they appear on that surface. The head-to-head prediction blends surface-weighted Elo (60%) with a Markov model built from each player's serve and return points won (40%).</p>
    <h3>Data cleaning</h3>
    <ul>
      <li><b>Match length</b>: ATP's match clock runs from first ball to last, so a match suspended overnight (rain, darkness) can show 20+ hours. Matches with a set lasting more than 10 minutes per game are marked as suspended and left out of duration stats; the match page shows the elapsed time.</li>
      <li><b>Serve speed</b>: radar readings outside 60–250 km/h are dropped, and a player's fastest serve in a match must be backed up by another serve within 8 km/h, which removes isolated spikes (ATP's own feed lists a 392 km/h serve).</li>
      <li><b>Forehand / backhand</b> on Hawk-Eye shot maps comes from the official point feed; CourtVision's own hand field is not usable at Challenger events.</li>
      <li><b>Rally length</b> counts shots up to the last ball in play (an error is not a shot), so an odd length always means the server won the point; rally charts therefore group lengths in pairs or wider bins.</li>
      <li><b>Serve and return ratings</b> are ATP's formulas as published in the match-stats feed; the stats-centre page sometimes shows values a few points different.</li>
    </ul>
    <h3>Betting slate</h3>
    <ul>
      <li><b>Upcoming matches</b> come from each tournament's official order of play (the PDF linked from the ATP calendar). Start times use the scheduled times ("Starts At", "Not Before") and, for "Followed By" matches, an estimate from the previous match on that court; sportsbook start times replace estimates when available. Matches the books list before an order of play is published are included too.</li>
      <li><b>Odds</b> are read once a day from public feeds: Pinnacle, FanDuel, BetRivers (Kambi; Unibet and other Kambi books show the same prices), Bovada, and the Kalshi and Polymarket exchanges. Exchange prices are the cost of buying a contract (Kalshi's fee included); exchange prices with little money behind them are skipped. A source that is unavailable on a given day is simply left out.</li>
      <li><b>The stats model</b> is a logistic regression on 21 factors (Elo, surface Elo, a game-margin Elo that rewards dominant wins, ATP ranking and its trend, a serve/return Markov simulation, recent form against expectation, fatigue and match load, rest, travel across time zones, a recent retirement as an injury signal, head-to-head, home crowd, surface experience, age, qualifier and wildcard status). It is retrained daily on every completed ${CURRENT_SEASON} Challenger match and the ${CURRENT_SEASON - 1} season, using only information available before each match, and calibrated on held-out matches. When a player has little data on the surface, the model's share of our line is cut and the market gets more weight. Players new to the Challenger tour this season are rated from their official ATP ranking.</li>
      <li><b>Our line</b> combines the model with the no-vig market consensus (median across sources) in log-odds, because markets know things the model cannot. The weight starts at 30% model and is refitted from the live track record once 150 matches have settled. A <b>value spot</b> needs at least +5% expected value at the best available price using our line, and our line at least 3 points above the market.</li>
      <li><b>Track record</b>: every slate is locked in before the matches start and scored once results come in (retirements, defaults and walkovers are void). If the official ATP result is late, the settled Kalshi market is used as a provisional result (marked *) until it arrives. The Track record tab shows profit over time for several strategies at the best published price, profit and closing line value by expected-value bucket, calibration, model-versus-market disagreements, performance by segment, a daily log and every value spot. Closing line value compares each price with the final pre-match price on the Kalshi exchange.</li>
      <li><b>Self-improvement</b>: the model is retrained every night; five variants are scored on the last 8 weeks of matches they had not seen and the best is kept (switching only for a clear improvement); calibration is refitted; and the model-versus-market weight in our line is refitted from the settled record, damped by a prior worth 150 matches. Every change is logged on the Model & changes tab.</li>
      <li>This is an analytics project, not betting advice. Gamble responsibly; 21+. Help is available at 1-800-GAMBLER.</li>
    </ul>
    <h3>Filters and samples</h3>
    <p>The filter bar (period, surface, category, draw, venue, region) scopes every number on the Overview, Rankings, Players, Matches, Tournaments, Leaders, Compare and Insights pages. Leaderboards require a minimum number of matches and a minimum sample for each stat (e.g. break-point percentages need enough break points). Percentiles compare a player with everyone who has 10+ matches under the same filters. "Active" players (power rankings, overview top 10, head-to-head defaults) have played a Challenger match in the last ${ACTIVE_WEEKS} weeks of the period in view.</p>
    <h3>Point endings</h3>
    <p>Winners, unforced and forced errors come from the official point-by-point feed. Outside Hawk-Eye events they are logged during the match rather than tracked, so per-match point-ending stats only use matches where at least 80% of points are classified (${fmtPct(clsOk)} of the ${SEASON} matches${clsOk < 0.5 ? '; ATP logged how points ended at far fewer matches this season, so its point-ending numbers rest on a smaller sample' : ''}). "Winners" include aces, matching the ATP convention. Rally lengths and serve speeds are only used from Hawk-Eye tracked matches.</p>
    <h3>Hawk-Eye coordinates</h3>
    <p>Court positions are in metres with the net at 0, baselines at ±11.885 m and singles sidelines at ±4.115 m. Serve plots show the receiving box from behind the server; service-box thirds define T, Body and Wide. 3D flight paths are reconstructed from the tracked contact, net-crossing and bounce points (the full tracked trajectory is not published), so arcs are smooth approximations through measured positions.</p>
    <h3>Glossary</h3>`;
  const gl = h('div', { class: 'grid g2' });
  for (const g of METRIC_GROUPS) {
    const ms = Object.values(METRICS).filter(m => m.group === g);
    if (!ms.length) continue;
    gl.appendChild(h('div', { class: 'card' }, h('h3', {}, g), h('dl', { class: 'kv', style: { marginTop: '10px' } },
      ms.flatMap(m => [h('dt', {}, m.short), h('dd', { style: { fontWeight: 450 } }, m.label + (m.desc ? ' — ' + m.desc : ''))]))));
  }
  root.append(prose, gl);
}
