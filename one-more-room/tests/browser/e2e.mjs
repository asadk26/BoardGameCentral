// End-to-end checks that drive the real, built game in headless Chromium.
//
//   npm run build && node tests/browser/e2e.mjs
//
// Starts the room service (which also serves dist/) unless URL is set. Uses
// Playwright's Chromium (or CHROME=/path/to/chrome) with SwiftShader, so WebGL
// works without a GPU — slowly. Run one part with ONLY=1,3 etc.
// Screenshots land in test-results/ for a human to look over.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SAVE_KEY = 'one-more-room/save';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const run = (n) => !ONLY || ONLY.includes(n);
const TRAPS = [
  { node: 9, effect: 'reaper', revealed: false, spent: false },
  { node: 14, effect: 'seance', revealed: false, spent: false },
  { node: 19, effect: 'poltergeist', revealed: false, spent: false },
  { node: 21, effect: 'reaper', revealed: false, spent: false },
  { node: 26, effect: 'seance', revealed: false, spent: false },
  { node: 30, effect: 'poltergeist', revealed: false, spent: false },
];

let server = null;
let URL = process.env.URL;
if (!URL) {
  URL = 'http://localhost:8795/';
  server = spawn('node', ['dist-server/main.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: '8795' } });
  await new Promise((r) => setTimeout(r, 1500));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
async function newPage(viewport = { width: 1440, height: 900 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}
const S = (page) =>
  page.evaluate(() => {
    const s = window.__omr.getState();
    return { screen: s.screen, busy: s.busy, cameraMode: s.cameraMode, settings: s.settings, game: s.session?.game ?? null, known: s.session?.known ?? [], modal: s.modal, seats: s.seats };
  });
const living = (g) => g.pieces.findIndex((p) => p.alive);
const acting = (g) => g.schedule[g.slot];
async function settle(page) {
  for (let i = 0; i < 80; i++) {
    if (!(await S(page)).busy) return;
    const skip = page.getByRole('button', { name: /Skip animation/ });
    if (i > 2 && (await skip.count())) await skip.click().catch(() => {});
    await page.waitForTimeout(100);
  }
}
async function clearStorage(page, query = '') {
  await page.goto(URL + query);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('one-more-room/')) localStorage.removeItem(k);
  });
  await page.reload();
}

/** Set up pieces on the setup screen: kinds like ['human','bot'], optional costumes. */
async function setupPieces(page, kinds, costumes = []) {
  await page.getByRole('button', { name: /Play on this screen|New game/ }).first().click();
  const count = async () => Number((await page.locator('.stepper span').innerText()).split(' ')[0]);
  while ((await count()) > kinds.length) await page.getByRole('button', { name: 'Fewer pieces' }).click();
  while ((await count()) < kinds.length) await page.getByRole('button', { name: 'More pieces' }).click();
  for (let i = 0; i < kinds.length; i++) {
    const group = page.getByRole('group', { name: `Piece ${i + 1} is played by` });
    await group.getByRole('button', { name: kinds[i] === 'human' ? /^(Person|People)$/ : /greedy/ }).click();
    if (costumes[i]) await page.getByRole('radiogroup', { name: `Piece ${i + 1} costume` }).getByRole('radio', { name: new RegExp(`^${costumes[i]}`) }).click();
  }
}

/** Pass-and-play secret placement for every human piece. */
async function placeAll(page) {
  for (let k = 0; k < 4; k++) {
    const show = page.getByRole('button', { name: /show the map/ });
    if (!(await show.count())) break;
    await show.click();
    const node = [18, 26, 2, 30][k];
    await page.getByRole('button', { name: `Space ${node}`, exact: true }).click();
    await page.getByRole('button', { name: /Set a trap/ }).click();
    await page.getByRole('button', { name: /Hide it/ }).click();
  }
  await page.waitForTimeout(400);
}

/**
 * Plays Haunted Jump Rope like a person watching the screen: presses a lane's
 * Jump button when its marker reaches the middle of that lane's green zone.
 * `lanes` limits which lanes (by position) are played; the others never jump.
 */
async function autoplay(page, lanes = null) {
  await page.evaluate((lanes) => {
    const stop = { v: false };
    window.__autoplayStop = stop;
    const state = new Map();
    const loop = () => {
      if (stop.v) return;
      document.querySelectorAll('.rope-lane').forEach((lane, k) => {
        if (lanes && !lanes.includes(k)) return;
        const zone = lane.querySelector('.meter .zone');
        const marker = lane.querySelector('.meter .marker');
        const btn = lane.querySelector('.press-btn');
        if (!zone || !marker || !btn) return;
        const zl = parseFloat(zone.style.left);
        const zw = parseFloat(zone.style.width);
        const m = parseFloat(marker.style.left);
        const st = state.get(k) ?? { armed: true, last: 0 };
        if (m < st.last - 20) st.armed = true; // a new sweep
        if (st.armed && m >= zl + zw * 0.45 && m <= zl + zw) {
          btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          st.armed = false;
        }
        st.last = m;
        state.set(k, st);
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, lanes);
}
async function stopAutoplay(page) {
  await page.evaluate(() => window.__autoplayStop && (window.__autoplayStop.v = true)).catch(() => {});
}

/** Local challenge: press every Ready, play the given lanes, wait until it is over. */
async function playLocalChallenge(page, lanes = null, ms = 90000) {
  await autoplay(page, lanes);
  const t0 = Date.now();
  let st = await S(page);
  while (Date.now() - t0 < ms) {
    st = await S(page);
    if (st.game?.phase !== 'challenge') break;
    const ready = page.locator('.ch-participants button', { hasText: /^Ready$/ });
    for (let i = (await ready.count()) - 1; i >= 0; i--) await ready.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await stopAutoplay(page);
  await settle(page);
  return S(page);
}

/**
 * Rewrite the saved game into a crafted position and resume it through the
 * real UI. `set` gives pieces (alive/node/streak/score), schedule, acting
 * piece, and optionally a die (to start in 'choose').
 */
async function scenario(page, set) {
  const save = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY));
  const g = save.session.game;
  g.pieces.forEach((p, i) =>
    Object.assign(p, { alive: i === set.living, node: set.nodes[i], streak: set.streaks?.[i] ?? 0, score: set.scores?.[i] ?? 0, facingFrom: null, item: set.items?.[i] ?? null, itemAwardedAt: set.items?.[i] ? -1 : null }),
  );
  const n = g.pieces.length;
  g.round = set.round ?? 2;
  g.schedule = set.schedule ?? [set.living, ...Array.from({ length: n }, (_, k) => k).filter((k) => k !== set.living)];
  g.slot = g.schedule.indexOf(set.acting ?? set.living);
  g.traps = (set.traps ?? TRAPS).map((t) => ({ ...t }));
  g.seancesUsed = set.seancesUsed ?? 0;
  Object.assign(g, { challenge: null, pick: null, lastOutcome: null, minigameUsed: false, log: [], turnDirty: false, origin: set.nodes[set.acting ?? set.living], selection: { dest: null } });
  Object.assign(g, { rollInfo: null, itemUsed: null, options: null, battlesThisRound: [], pendingReward: null });
  if (set.rewardRng !== undefined) g.rewardRng = set.rewardRng;
  if (set.die) {
    const me = g.pieces[g.schedule[g.slot]];
    Object.assign(g, { phase: 'choose', die: set.die, allowance: me.alive ? set.die : Math.max(3, set.die), rollInfo: { kind: 'die' } });
  } else Object.assign(g, { phase: set.phase ?? 'turnStart', die: null, allowance: 0 });
  save.session.game = g;
  save.session.turnStart = { ...g, phase: 'turnStart', die: null, allowance: 0 };
  save.session.previousTurnStart = null;
  save.session.known = g.traps.filter((t) => t.revealed).map((t) => ({ node: t.node, effect: t.effect }));
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(save)]);
  await page.reload();
  await page.getByRole('button', { name: 'Resume game' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
  await settle(page);
}

/** The engine's seeded generator (mulberry32), to predict a reward or a reroll from a crafted save. */
function nextFloat(state) {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}
const itemFromDraw = (u) => (u < 0.4 ? 'secondRoll' : u < 0.8 ? 'ghostSwitch' : 'ghostlyStride');

async function confirmMove(page, dest) {
  if (dest === 'stay') await page.getByRole('option', { name: /Stay here/ }).click();
  else await page.getByRole('option', { name: new RegExp(`#${dest} `) }).click();
  await page.locator('.bottom .btn.primary.big').click();
  await settle(page);
}

try {
  // ── 1. Local: setup, placement, life roll, a full two-piece game ─────
  if (run(1)) {
    const page = await newPage();
    await clearStorage(page);
    await page.evaluate(() => localStorage.setItem('unrelated-key', 'keep-me'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/01-title.png` });
    check('title pitches One Life and offers local play, a phone room and the rules', /One life in the mansion/.test(await page.locator('.title-card').innerText()) && (await page.getByRole('button', { name: /Host a phone room/ }).count()) === 1);
    await page.getByRole('button', { name: 'How to play' }).click();
    const rules = await page.locator('.rules').innerText();
    check('rules explain one life, rounds, curse, traps and teams', /one life/i.test(rules) && /curse/i.test(rules) && /Séance/.test(rules) && /Poltergeist/.test(rules) && /Team Battle/.test(rules));
    check('rules contain no candy-game leftovers', !/candy|bank|bounty|decoy|protected|Trick or Treat/i.test(rules));
    await page.keyboard.press('Escape');
    await setupPieces(page, ['human', 'bot'], ['Vampire', 'Skeleton']);
    await page.screenshot({ path: `${OUT}/02-setup.png` });
    await page.getByRole('button', { name: /Start game/ }).click();
    await page.waitForTimeout(800);
    check('the placement curtain asks others to look away', /look away/.test(await page.locator('.curtain-card').innerText()));
    await page.screenshot({ path: `${OUT}/03-placement-curtain.png` });
    await page.getByRole('button', { name: /show the map/ }).click();
    await page.getByRole('button', { name: 'Space 18', exact: true }).click();
    await page.screenshot({ path: `${OUT}/04-placement-map.png` });
    await page.getByRole('button', { name: /Set a trap/ }).click();
    check('the private confirmation names the space but not an effect', /space 18/.test(await page.locator('.curtain-card').innerText()) && !/Poltergeist|Séance|Reaper’s/.test(await page.locator('.curtain-card').innerText()));
    await page.getByRole('button', { name: /Hide it/ }).click();
    await page.waitForTimeout(800);
    let st = await S(page);
    check('placement ends with six hidden traps; nobody is alive before the roll', st.game.phase === 'lifeRoll' && st.game.traps.length === 6 && st.game.pieces.every((p) => !p.alive));
    await page.screenshot({ path: `${OUT}/05-life-roll.png` });
    await page.getByRole('button', { name: /Roll for life/ }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
    st = await S(page);
    check('the life roll leaves exactly one living piece at the entrance, ghosts elsewhere', living(st.game) >= 0 && st.game.pieces.filter((p) => p.alive).length === 1 && st.game.pieces[living(st.game)].node === 0 && st.game.pieces.filter((p) => !p.alive).every((p) => [8, 16, 24].includes(p.node)));
    check('the living piece acts first and the order is shown', acting(st.game) === living(st.game) && (await page.locator('.topbar .order .ord').count()) === 2);
    await page.screenshot({ path: `${OUT}/06-first-action.png` });
    await page.keyboard.press('v');
    await page.waitForTimeout(1500);
    const off = await page.evaluate(() => Array.from({ length: 32 }, (_, i) => [i, window.__omr.project(i)]).filter(([, p]) => !p.visible).map(([i]) => i));
    check('the overview frames all 32 spaces', off.length === 0, off.join(','));
    await page.screenshot({ path: `${OUT}/07-overview.png` });
    // Play the whole game: the person through the real UI, the bot by itself.
    let transfers = 0;
    let challenges = 0;
    let shotDest = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 900000) {
      st = await S(page);
      const g = st.game;
      if (g.phase === 'gameOver') break;
      if (st.busy) {
        await page.waitForTimeout(150);
        continue;
      }
      const me = acting(g);
      const human = st.seats[me]?.kind === 'human';
      if (g.phase === 'challenge') {
        challenges++;
        const before = living(g);
        const lane = g.challenge.participants.indexOf(g.pieces.findIndex((_, i) => st.seats[i]?.kind === 'human'));
        if (challenges === 1) await page.waitForTimeout(400), await page.screenshot({ path: `${OUT}/08-challenge-intro.png` });
        const after = await playLocalChallenge(page, lane >= 0 ? [lane] : []);
        if (living(after.game) !== before) transfers++;
        continue;
      }
      if (!human) {
        await page.waitForTimeout(250);
        continue;
      }
      if (g.phase === 'turnStart') await page.getByRole('button', { name: /Roll the die/ }).click();
      else if (g.phase === 'choose') {
        const opts = page.locator('.dest-list [role=option]');
        const hunt = page.locator('.dest-list [role=option].haunt');
        const pickIdx = (await hunt.count()) ? -1 : Math.min(2, (await opts.count()) - 1);
        if (pickIdx < 0) await hunt.first().click();
        else await opts.nth(pickIdx).click();
        if (!shotDest) {
          shotDest = true;
          await page.screenshot({ path: `${OUT}/09-choose.png` });
        }
        await page.locator('.bottom .btn.primary.big').click();
      } else if (g.phase === 'hunt') await page.getByRole('button', { name: /Challenge for the life/ }).click();
      else if (g.phase === 'pick') await page.locator('.choices .btn').first().click();
      else if (g.phase === 'summary') await page.locator('.bottom .btn.primary.big').click();
      await settle(page);
      if ((await S(page)).cameraMode !== 'overview') {
        check('the chosen camera survives life changing hands', false, `round ${g.round}`);
        await page.keyboard.press('v');
      }
    }
    st = await S(page);
    check('a full two-piece game reaches the results', st.game.phase === 'gameOver', `${Math.round((Date.now() - t0) / 1000)}s, ${challenges} challenges, ${transfers} transfers`);
    check('exactly ten points were handed out, and one piece is alive at the end', st.game.pieces.reduce((a, p) => a + p.score, 0) === 10 && st.game.pieces.filter((p) => p.alive).length === 1);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/10-results-2p.png` });
    const rows = await page.locator('.results tbody tr').allInnerTexts();
    check('the results table lists rounds held for every piece', rows.length === 2 && rows.every((r) => /\d/.test(r)), rows.join(' / '));
    check('the chosen camera stayed on the overview all game', st.cameraMode === 'overview');
    check('saving never touched unrelated storage', (await page.evaluate(() => localStorage.getItem('unrelated-key'))) === 'keep-me');
    check('no console errors (two-piece game)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 2. Four bots, fast-forwarded, to the end ─────────────────────────
  if (run(2)) {
    const page = await newPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });
    await clearStorage(page, '?quality=low');
    await page.evaluate(() => localStorage.setItem('one-more-room/settings', JSON.stringify({ fastBots: true, reducedMotion: true, muted: true })));
    await page.reload();
    await setupPieces(page, ['bot', 'bot', 'bot', 'bot']);
    await page.getByRole('button', { name: /Start game/ }).click();
    const t0 = Date.now();
    let sawSeance = false;
    let maxAlive = 0;
    let st;
    while (Date.now() - t0 < 900000) {
      st = await S(page);
      if (st.game?.challenge?.kind === 'seance') sawSeance = true;
      if (st.game) maxAlive = Math.max(maxAlive, st.game.pieces.filter((p) => p.alive).length);
      if (st.game?.phase === 'gameOver') break;
      await page.waitForTimeout(400);
    }
    check('four bots play a full game to the results', st.game?.phase === 'gameOver', `${Math.round((Date.now() - t0) / 1000)}s`);
    check('four-piece totals: ten points, never more than one living piece', st.game.pieces.reduce((a, p) => a + p.score, 0) === 10 && maxAlive === 1);
    check('the four-piece game included at least one Séance', sawSeance);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/20-results-4p.png` });
    const fit = await page.locator('.results').evaluate((el) => el.scrollWidth - el.clientWidth);
    check('the results panel fits without sideways scrolling', fit <= 1, `${fit}px`);
    check('no console errors (bots)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 3. Crafted positions: transfers, traps, curse, reload, undo ──────
  if (run(3)) {
    const page = await newPage();
    await clearStorage(page, '?quality=low');
    await setupPieces(page, ['human', 'human', 'human', 'human'], ['Knight', 'Goblin', 'Witch', 'Zombie']);
    await page.getByRole('button', { name: /Start game/ }).click();
    await placeAll(page);
    await page.getByRole('button', { name: /Roll for life/ }).click();
    await settle(page);

    // Several transfers in one round: B steals from A, then C steals from B.
    await scenario(page, { living: 0, nodes: [6, 5, 4, 20], acting: 1, die: 3 });
    await confirmMove(page, 'stay');
    check('a ghost in range is offered the challenge', /within reach/.test(await page.locator('.bottom').innerText()));
    await page.getByRole('button', { name: /Challenge for the life/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/30-duel-intro.png` });
    let st = await playLocalChallenge(page, [1]);
    check('the challenger who jumps better steals the life and the space', living(st.game) === 1 && st.game.pieces[1].node === 6);
    check('the loser retreats two ordinary steps to a free space', st.game.pieces[0].node === 8, `node ${st.game.pieces[0].node}`);
    await page.screenshot({ path: `${OUT}/31-after-steal.png` });
    await page.locator('.bottom .btn.primary.big').click();
    await settle(page);
    st = await S(page);
    check('the next scheduled piece acts; the old holder gets no bonus action', acting(st.game) === 2);
    await page.getByRole('button', { name: /Roll the die/ }).click();
    await settle(page);
    await confirmMove(page, 5);
    await page.getByRole('button', { name: /Challenge for the life/ }).click();
    st = await playLocalChallenge(page, [1]);
    check('a second transfer in the same round', living(st.game) === 2 && st.game.round === 2, `living ${living(st.game)}`);
    await page.screenshot({ path: `${OUT}/32-second-steal.png` });

    // A four-piece Séance from a hidden tile.
    await scenario(page, { living: 0, nodes: [0, 13, 25, 20], acting: 1, die: 1 });
    await confirmMove(page, 14);
    st = await S(page);
    check('landing on a hidden Séance reveals it and calls all four pieces', st.game.phase === 'challenge' && st.game.challenge.kind === 'seance' && st.game.challenge.participants.length === 4 && st.game.traps.find((t) => t.node === 14).revealed);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/33-seance-intro.png` });
    st = await playLocalChallenge(page, [3]);
    check('the Séance winner holds the life and nobody moves', living(st.game) === 3 && st.game.pieces.map((p) => p.node).join() === '0,14,25,20');
    check('the Séance tile is spent and one of two Séances is used', st.game.traps.find((t) => t.node === 14).spent && st.game.seancesUsed === 1);
    await page.screenshot({ path: `${OUT}/34-after-seance.png` });

    // A ghost on a hidden Reaper: a remote duel. Reload mid-challenge, then undo.
    await scenario(page, { living: 0, nodes: [30, 6, 16, 20], acting: 1, die: 3 });
    await confirmMove(page, 9);
    st = await S(page);
    const id = st.game.challenge?.id;
    check('a ghost landing on a Reaper challenges the living piece from anywhere', st.game.phase === 'challenge' && st.game.challenge.host === 'reaper' && !st.game.challenge.contact);
    await page.reload();
    await page.getByRole('button', { name: 'Resume game' }).click();
    await page.waitForTimeout(800);
    st = await S(page);
    check('reload during a challenge resumes the same challenge', st.game.phase === 'challenge' && st.game.challenge.id === id);
    st = await playLocalChallenge(page, [0]);
    check('after a remote duel both pieces keep their spaces', st.game.pieces[0].node === 30 && st.game.pieces[1].node === 9 && living(st.game) === 0);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await page.getByRole('button', { name: /^Undo to/ }).click();
    await page.waitForTimeout(800);
    st = await S(page);
    check('undo restores the action but the table keeps the reveal', !st.game.traps.find((t) => t.node === 9).revealed && st.known.some((k) => k.node === 9 && k.effect === 'reaper'));
    await page.screenshot({ path: `${OUT}/35-undo-keeps-reveal.png` });

    // The living piece on a revealed Reaper picks its opponent.
    await scenario(page, { living: 0, nodes: [8, 6, 16, 20], acting: 0, die: 1, traps: TRAPS.map((t) => (t.node === 9 ? { ...t, revealed: true } : t)) });
    await page.getByRole('option', { name: /#9 / }).click();
    check('the forecast warns about a known Reaper before confirming', /Reaper/.test(await page.locator('.forecast').innerText()));
    await page.locator('.bottom .btn.primary.big').click();
    await settle(page);
    check('the living piece chooses which ghost to duel', (await page.locator('.choices .btn').count()) === 3);
    await page.locator('.choices .btn').nth(1).click();
    st = await S(page);
    check('the chosen ghost is the opponent', st.game.challenge?.participants.join() === '0,2');
    st = await playLocalChallenge(page, [0]);

    // A Poltergeist throws a ghost away; nothing triggers where it lands.
    await scenario(page, { living: 0, nodes: [0, 18, 16, 24], acting: 1, die: 1 });
    await confirmMove(page, 19);
    st = await S(page);
    check('a Poltergeist throws the piece far away without a minigame', st.game.traps.find((t) => t.node === 19).revealed && st.game.pieces[1].node !== 19 && st.game.pieces[1].node !== 0 && st.game.phase !== 'challenge');
    await page.screenshot({ path: `${OUT}/36-poltergeist.png` });

    // With both Séances used: a dormant Séance tile and a Reaper-mode Super Reaper.
    await scenario(page, { living: 0, nodes: [0, 23, 16, 4], acting: 1, die: 3, seancesUsed: 2 });
    await confirmMove(page, 26);
    st = await S(page);
    check('a Séance tile found after both Séances are used is revealed cold', st.game.traps.find((t) => t.node === 26).spent && st.game.phase !== 'challenge' && /cold/.test(await page.locator('.bottom').innerText()));
    await scenario(page, { living: 0, nodes: [0, 16, 13, 4], acting: 3, die: 1, seancesUsed: 2 });
    await page.getByRole('option', { name: /#12 / }).click();
    check('the Super Reaper forecast shows its current effect', /Super Reaper: Reaper’s Challenge/.test(await page.locator('.forecast').innerText()));
    await page.screenshot({ path: `${OUT}/37-super-reaper-forecast.png` });

    // The curse: shown before play, and each lane shows its own window.
    await scenario(page, { living: 0, nodes: [6, 5, 16, 20], acting: 1, die: 3, streaks: [3, 0, 0, 0], scores: [3, 0, 0, 0], round: 5 });
    await confirmMove(page, 'stay');
    await page.getByRole('button', { name: /Challenge for the life/ }).click();
    await page.waitForTimeout(400);
    check('the curse is announced before play', /Alive for 3 rounds • Jump window 20% narrower/.test(await page.locator('.challenge-card').innerText()));
    await autoplay(page, []);
    for (let k = 0; k < 4 && (await page.locator('.ch-participants button', { hasText: /^Ready$/ }).count()); k++) await page.locator('.ch-participants button', { hasText: /^Ready$/ }).first().click().catch(() => {});
    await page.waitForTimeout(4500);
    const widths = await page.locator('.rope-lane .meter .zone').evaluateAll((els) => els.map((e) => parseFloat(e.style.width)));
    check('the living lane’s jump window is visibly narrower', widths.length === 2 && widths[0] < widths[1] * 0.85, widths.map((w) => w.toFixed(1)).join(' vs '));
    await page.screenshot({ path: `${OUT}/38-curse-rope.png` });
    st = await playLocalChallenge(page, [1]);

    // The last bell with a three-way tie: shared win, ten points in all.
    await scenario(page, { living: 2, nodes: [0, 16, 8, 24], acting: 3, round: 10, scores: [3, 3, 2, 1], schedule: [2, 0, 1, 3], phase: 'summary' });
    await page.locator('.bottom .btn.primary.big').click();
    await settle(page);
    await page.waitForTimeout(1200);
    st = await S(page);
    const title = await page.locator('.results h1').innerText();
    check('tied top scores share the win; exactly ten points in total', /share the win/.test(title) && st.game.pieces.reduce((a, p) => a + p.score, 0) === 10, title);
    await page.screenshot({ path: `${OUT}/39-shared-win.png` });
    check('no console errors (scenarios)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 4. Phone rooms with the real room service ────────────────────────
  if (run(4) && server) {
    const tv = await newPage({ width: 1280, height: 800 });
    await tv.goto(URL + '?quality=low');
    await tv.getByRole('button', { name: 'Host a phone room' }).click();
    await tv.locator('.room-code').waitFor({ timeout: 15000 });
    const code = (await tv.locator('.room-code').innerText()).trim();
    const joinUrl = await tv.locator('.join-url').innerText();
    check('the TV shows a room code, a QR code and a LAN join link (not localhost)', /^[A-Z]{4}$/.test(code) && (await tv.locator('img.qr').count()) === 1 && !/localhost|127\.0\.0\.1/.test(joinUrl), joinUrl);
    await tv.getByRole('radio', { name: 'Team Battle' }).click();
    const phones = {};
    for (const name of ['Ana', 'Ben', 'Cy']) {
      const p = await newPage({ width: 390, height: 844 });
      await p.goto(URL + '#/join?room=' + code);
      await p.getByLabel('Your name').fill(name);
      await p.getByRole('button', { name: 'Join' }).click();
      await p.locator('.pchars').waitFor();
      phones[name] = p;
    }
    await phones.Ana.getByRole('button', { name: /^Witch/ }).click();
    await phones.Cy.getByRole('button', { name: /^Knight/ }).click();
    await phones.Ben.getByRole('button', { name: /Join Ana’s Witch/ }).click();
    await tv.locator('select[aria-label="Bot costume"]').selectOption('goblin');
    await tv.getByRole('button', { name: 'Add bot' }).click();
    await tv.waitForTimeout(500);
    await tv.screenshot({ path: `${OUT}/40-tv-lobby.png` });
    await phones.Ben.screenshot({ path: `${OUT}/41-phone-lobby.png` });
    check('phones chose characters and Ben joined Ana’s team', /Ana & Ben/.test(await tv.locator('.setup-players').innerText()) && /Knight/.test(await tv.locator('.setup-players').innerText()));
    await tv.getByRole('button', { name: /Start: 3 pieces, 3 phones/ }).click();
    await phones.Ben.waitForTimeout(800);
    check('only the first teammate confirms the team’s trap', /Ana confirms your team’s trap/.test(await phones.Ben.locator('body').innerText()));
    await phones.Ana.getByRole('button', { name: 'Space 26', exact: true }).click();
    await phones.Ana.getByRole('button', { name: /Set the trap/ }).click();
    await phones.Cy.getByRole('button', { name: 'Space 18', exact: true }).click();
    await phones.Cy.getByRole('button', { name: /Set the trap/ }).click();
    await phones.Ben.waitForTimeout(800);
    check('both teammates see their team’s pick; the other phone never does', /space 26/.test(await phones.Ben.locator('body').innerText()) && /space 26/.test(await phones.Ana.locator('body').innerText()) && !/space 26/.test(await phones.Cy.locator('body').innerText()));
    await phones.Ana.screenshot({ path: `${OUT}/42-phone-trap-set.png` });
    for (const p of Object.values(phones)) await p.getByRole('button', { name: 'Hide it' }).click().catch(() => {});
    await tv.waitForTimeout(3000);
    const tvGame = (await S(tv)).game;
    check('the TV never receives hidden traps, nominations or the seed', tvGame.traps.every((t) => t.revealed) && tvGame.rng === 0 && tvGame.nominations.every((n) => n === -1));
    const controller = (g, piece) => (piece === 0 ? (g.round % 2 === 1 ? phones.Ana : phones.Ben) : piece === 1 ? phones.Cy : null);
    const other = (g) => (g.round % 2 === 1 ? phones.Ben : phones.Ana);
    let challenges = 0;
    let reloaded = false;
    let checkedInactive = new Set();
    let droppedMid = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 900000) {
      const st = await S(tv);
      const g = st.game;
      if (!g || g.phase === 'placement' || g.phase === 'lifeRoll') {
        await tv.waitForTimeout(400);
        continue;
      }
      if (g.phase === 'gameOver' || g.round > 4) break;
      if (g.phase === 'challenge') {
        for (const piece of g.challenge.participants) {
          const p = controller(g, piece);
          if (!p) continue;
          if (!droppedMid && piece === 0 && (await p.getByRole('button', { name: /I’m ready/ }).count())) {
            // Drop mid-challenge: the room freezes it and restarts on return.
            droppedMid = true;
            await p.getByRole('button', { name: /I’m ready/ }).click();
            await p.reload();
            await p.waitForTimeout(2000);
            check('a controller reconnecting mid-challenge gets the challenge back', /I’m ready|Haunted Jump Rope/.test(await p.locator('body').innerText()));
          }
          const ready = p.getByRole('button', { name: /I’m ready/ });
          if (await ready.count()) {
            await ready.click().catch(() => {});
            challenges++;
            await autoplay(p);
          }
          if (challenges === 1) await p.screenshot({ path: `${OUT}/43-phone-challenge.png` }).catch(() => {});
        }
        if (challenges === 1) await tv.screenshot({ path: `${OUT}/44-tv-challenge.png` });
        await tv.waitForTimeout(400);
        continue;
      }
      const piece = g.phase === 'reward' ? g.pendingReward.piece : acting(g);
      const p = controller(g, piece);
      if (p) {
        if (piece === 0 && g.phase !== 'reward' && !checkedInactive.has(g.round)) {
          checkedInactive.add(g.round);
          await tv.waitForTimeout(600);
          const idle = other(g);
          const idleText = await idle.locator('body').innerText();
          check(`round ${g.round}: the inactive teammate sees the turn but has no controls`, /controls it this round/.test(idleText) && (await idle.locator('.pbtn.primary').count()) === 0);
        }
        if (!reloaded && g.round === 2 && piece === 1) {
          reloaded = true;
          const before = await p.locator('.phead b').first().innerText();
          await p.reload();
          await p.waitForTimeout(1800);
          const after = await p.locator('.phead b').first().innerText().catch(() => '');
          check('a refreshed phone rejoins its own piece', before === after, `${before} → ${after}`);
        }
        if (g.phase === 'choose') {
          const opts = p.locator('.pdest');
          const hunt = p.locator('.pdest', { hasText: '👻' });
          if (!(await p.locator('.pdest.on').count())) await ((await hunt.count()) ? hunt.first() : opts.nth(Math.min(2, (await opts.count()) - 1))).click().catch(() => {});
        }
        const btn = p.locator('.pbtn.primary').first();
        if ((await btn.count()) && (await btn.isEnabled().catch(() => false))) await btn.click().catch(() => {});
        else {
          const any = p.locator('.pbtn').first();
          if (await any.count()) await any.click().catch(() => {});
        }
      }
      await tv.waitForTimeout(350);
    }
    const fin = (await S(tv)).game;
    check('a pair, a solo phone and a bot played several rounds through the service', fin.round >= 4 || fin.phase === 'gameOver', `round ${fin.round}, ${challenges} phone challenges`);
    check('room scores equal completed rounds; one living piece', fin.pieces.reduce((a, q) => a + q.score, 0) === (fin.phase === 'gameOver' ? 10 : fin.round - 1) && fin.pieces.filter((q) => q.alive).length === 1);
    check('both teammates controlled the pair in their rounds', checkedInactive.size >= 2, [...checkedInactive].join(','));
    await tv.screenshot({ path: `${OUT}/45-tv-room-game.png` });
    await phones.Ana.screenshot({ path: `${OUT}/46-phone-watch.png` });
    check('the phone controller has no horizontal overflow', await phones.Ana.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const all = [tv, ...Object.values(phones)];
    check('no console errors (rooms)', all.every((q) => q.errors.filter((e) => !/WebSocket/.test(e)).length === 0), all.flatMap((q) => q.errors).slice(0, 3).join(' | '));
    for (const q of all) await q.context().close();
  }

  // ── 6. Ghost battles and items on one screen ─────────────────────────
  if (run(6)) {
    const page = await newPage();
    await clearStorage(page, '?quality=low');
    await setupPieces(page, ['human', 'human', 'human'], ['Knight', 'Goblin', 'Witch']);
    await page.getByRole('button', { name: /Start game/ }).click();
    await placeAll(page);
    await page.getByRole('button', { name: /Roll for life/ }).click();
    await settle(page);
    const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).session.game, SAVE_KEY);

    // Same-space battle, won by the ghost that was called out.
    await scenario(page, { living: 0, nodes: [16, 1, 3], acting: 1, die: 4 });
    const pv = await page.locator('.dest-list').innerText();
    check('the destination list marks a ghost-occupied space and a Versus space', /⚔ ghost here/.test(pv) && /⚔ Versus/.test(pv));
    await confirmMove(page, 3);
    const enc = await page.locator('.bottom').innerText();
    check('landing on a ghost offers “Battle ghost • win an item” and ending the action', /Battle ghost • win an item/.test(enc) && /End the action/.test(enc) && !/steal life/.test(enc));
    await page.screenshot({ path: `${OUT}/60-battle-offer.png` });
    await page.locator('button.battle').first().click();
    await page.waitForTimeout(500);
    check('a ghost battle is titled as one, with neutral lanes (no curse, no life lane)', /Ghost Battle/.test(await page.locator('body').innerText()) && (await page.locator('.rope-lane.living').count()) === 0);
    await page.screenshot({ path: `${OUT}/61-battle-rope.png` });
    let st = await playLocalChallenge(page, [1]);
    const o = st.game.lastOutcome;
    check('the defender wins the battle and one item; nobody moves; the life stays put', o?.winner === 2 && !!o.reward && st.game.pieces[2].item === o.reward && st.game.pieces[1].item === null && living(st.game) === 0 && st.game.pieces[1].node === 3 && st.game.pieces[2].node === 3 && st.game.pieces.every((p) => p.score === 0));
    check('the reward is revealed with a card', (await page.locator('.reward-reveal .item-card').count()) === 1);
    check('the held item is shown on the piece card', (await page.locator('.pcard .item-badge').count()) === 1);
    await page.screenshot({ path: `${OUT}/62-battle-reward.png` });

    // Versus: call out a ghost anywhere; a different item asks keep or replace.
    const g0 = await saved();
    const offered = itemFromDraw(nextFloat(g0.rewardRng)[0]);
    const current = offered === 'secondRoll' ? 'ghostlyStride' : 'secondRoll';
    await scenario(page, { living: 0, nodes: [16, 2, 28], acting: 1, die: 3, items: [null, current, null], rewardRng: g0.rewardRng });
    await confirmMove(page, 5);
    check('a Versus space invites any ghost, wherever it is', /anywhere/.test(await page.locator('.bottom').innerText()));
    await page.locator('button.battle').first().click();
    st = await playLocalChallenge(page, [0]);
    check('a winner holding a different item gets the keep-or-replace choice', st.game.phase === 'reward' && (await page.locator('.reward-cards .item-card').count()) === 2);
    await page.screenshot({ path: `${OUT}/63-keep-or-replace.png` });
    await page.getByRole('button', { name: /^Take / }).click();
    await settle(page);
    st = await S(page);
    check('taking the new item replaces the old one; exactly one item is held', st.game.pieces[1].item === offered && st.game.phase === 'summary');

    // Second Roll: after the die, before moving; the new result stands.
    await scenario(page, { living: 0, nodes: [16, 1, 28], acting: 1, die: 2, items: [null, 'secondRoll', null] });
    const g1 = await saved();
    const newDie = 1 + Math.floor(nextFloat(g1.rng)[0] * 6);
    await page.getByRole('button', { name: /Use Second Roll/ }).click();
    await settle(page);
    st = await S(page);
    check('Second Roll replaces the die with one fresh roll and shows old and new', st.game.die === newDie && st.game.rollInfo?.rerolledFrom === 2 && st.game.allowance === Math.max(3, newDie) && st.game.pieces[1].item === null && new RegExp(`Second Roll: 2 → ${newDie}`).test(await page.locator('.bottom').innerText()));
    check('no second item use in the same action', (await page.locator('.item-use').count()) === 0);
    await page.screenshot({ path: `${OUT}/64-second-roll.png` });

    // Ghost Switch: before rolling; swap with a ghost on a hidden trap — nothing triggers.
    await scenario(page, { living: 0, nodes: [16, 1, 21], acting: 1, items: [null, 'ghostSwitch', null] });
    check('Ghost Switch never offers the living piece', !(await page.locator('.item-use').allInnerTexts()).some((t) => t.includes(st.game.pieces[0].name)));
    await page.locator('.item-use').first().click();
    await settle(page);
    st = await S(page);
    check('Ghost Switch swaps two ghosts and triggers nothing; the ghost then rolls', st.game.pieces[1].node === 21 && st.game.pieces[2].node === 1 && st.game.phase === 'turnStart' && !st.game.traps.find((t) => t.node === 21).revealed && (await page.getByRole('button', { name: /Roll the die/ }).count()) === 1);
    await page.screenshot({ path: `${OUT}/65-ghost-switch.png` });

    // Ghostly Stride: instead of rolling; no die.
    await scenario(page, { living: 0, nodes: [16, 1, 28], acting: 1, items: [null, 'ghostlyStride', null] });
    const rngBefore = (await saved()).rng;
    await page.getByRole('button', { name: /Use Ghostly Stride/ }).click();
    await settle(page);
    st = await S(page);
    const bottom = await page.locator('.bottom').innerText();
    check('Ghostly Stride moves up to 6 without rolling and shows no fake die', st.game.rollInfo?.kind === 'stride' && st.game.die === null && st.game.allowance === 6 && st.game.rng === rngBefore && /Ghostly Stride • 6 spaces/.test(bottom) && (await page.locator('.bottom .die').count()) === 0);
    await page.screenshot({ path: `${OUT}/66-ghostly-stride.png` });
    await confirmMove(page, 7);
    st = await S(page);
    check('a Stride move of six lands normally', st.game.pieces[1].node === 7);

    // Rules describe it all.
    await page.getByRole('button', { name: 'Rules' }).click();
    const rules = await page.locator('.rules').innerText();
    check('rules explain ghost battles, Versus spaces, weights and all three items', /Ghost battles and items/.test(rules) && /Versus/.test(rules) && /Second Roll 40%/.test(rules) && /Ghost Switch 40%/.test(rules) && /Ghostly Stride 20%/.test(rules));
    await page.keyboard.press('Escape');
    check('no console errors (battles and items)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 7. Ghost battles and items through phones (a pair, a solo phone, a bot) ──
  if (run(7) && server) {
    const tv = await newPage({ width: 1280, height: 800 });
    await tv.goto(URL + '?quality=low');
    await tv.getByRole('button', { name: 'Host a phone room' }).click();
    await tv.locator('.room-code').waitFor({ timeout: 15000 });
    const code = (await tv.locator('.room-code').innerText()).trim();
    await tv.getByRole('radio', { name: 'Team Battle' }).click();
    const phones = {};
    for (const name of ['Ana', 'Ben', 'Cy']) {
      const p = await newPage({ width: 390, height: 844 });
      await p.goto(URL + '#/join?room=' + code);
      await p.getByLabel('Your name').fill(name);
      await p.getByRole('button', { name: 'Join' }).click();
      await p.locator('.pchars').waitFor();
      phones[name] = p;
    }
    await phones.Ana.getByRole('button', { name: /^Witch/ }).click();
    await phones.Cy.getByRole('button', { name: /^Knight/ }).click();
    await phones.Ben.getByRole('button', { name: /Join Ana’s Witch/ }).click();
    await tv.locator('select[aria-label="Bot costume"]').selectOption('goblin');
    await tv.getByRole('button', { name: 'Add bot' }).click();
    await tv.waitForTimeout(500);
    await tv.getByRole('button', { name: /Start: 3 pieces, 3 phones/ }).click();
    await phones.Ana.getByRole('button', { name: 'Space 26', exact: true }).click();
    await phones.Ana.getByRole('button', { name: /Set the trap/ }).click();
    await phones.Cy.getByRole('button', { name: 'Space 18', exact: true }).click();
    await phones.Cy.getByRole('button', { name: /Set the trap/ }).click();
    await phones.Ben.waitForTimeout(800);
    for (const p of Object.values(phones)) await p.getByRole('button', { name: 'Hide it' }).click().catch(() => {});
    const controller = (g, piece) => (piece === 0 ? (g.round % 2 === 1 ? phones.Ana : phones.Ben) : piece === 1 ? phones.Cy : null);
    const other = (g) => (g.round % 2 === 1 ? phones.Ben : phones.Ana);
    const seen = { battle: false, phoneReward: false, phoneUse: false, choice: false, idleChecked: false };
    const t0 = Date.now();
    while (Date.now() - t0 < 900000) {
      const g = (await S(tv)).game;
      if (!g || g.phase === 'placement' || g.phase === 'lifeRoll') {
        await tv.waitForTimeout(400);
        continue;
      }
      if (g.phase === 'gameOver' || (seen.battle && seen.phoneReward && seen.phoneUse) || g.round > 9) break;
      if (g.pieces.some((p, i) => i < 2 && p.item)) seen.phoneReward = true;
      if (g.log.some((e) => e.kind === 'itemUsed' && e.piece < 2)) seen.phoneUse = true;
      if (g.phase === 'challenge') {
        if (g.challenge.host === 'ghostBattle' || g.challenge.host === 'versus') {
          if (!seen.battle) await tv.screenshot({ path: `${OUT}/70-tv-ghost-battle.png` });
          seen.battle = true;
        }
        for (const piece of g.challenge.participants) {
          const p = controller(g, piece);
          const ready = p?.getByRole('button', { name: /I’m ready/ });
          if (ready && (await ready.count())) {
            await ready.click().catch(() => {});
            await autoplay(p);
          }
        }
        await tv.waitForTimeout(400);
        continue;
      }
      const piece = g.phase === 'reward' ? g.pendingReward.piece : acting(g);
      const p = controller(g, piece);
      if (p) {
        await p.waitForTimeout(300);
        if (g.phase === 'reward') {
          seen.choice = true;
          await p.screenshot({ path: `${OUT}/71-phone-keep-or-replace.png` });
          await p.getByRole('button', { name: /^Take / }).click().catch(() => {});
        } else if (g.phase === 'turnStart' || (g.phase === 'choose' && !(await p.locator('.pdest.on').count()))) {
          const use = p.locator('.item-use:enabled');
          if (await use.count()) {
            if (piece === 0 && !seen.idleChecked) {
              seen.idleChecked = true;
              const idle = other(g);
              check('the inactive teammate sees the team’s item but has no item controls', (await idle.locator('.item-badge').count()) > 0 && (await idle.locator('.item-use').count()) === 0);
            }
            await p.screenshot({ path: `${OUT}/72-phone-item.png` });
            await use.first().click().catch(() => {});
            await tv.waitForTimeout(500);
            continue;
          }
        }
        if (g.phase === 'choose' && !(await p.locator('.pdest.on').count())) {
          const opts = p.locator('.pdest');
          const battle = p.locator('.pdest', { hasText: '⚔' });
          const hunt = p.locator('.pdest', { hasText: '👻' });
          const pick = (await battle.count()) ? battle.first() : (await hunt.count()) ? hunt.first() : opts.nth(Math.min(2, (await opts.count()) - 1));
          await pick.click().catch(() => {});
        } else if (g.phase === 'hunt') {
          const battle = p.locator('button.battle');
          await ((await battle.count()) ? battle.first() : p.locator('.pbtn').first()).click().catch(() => {});
          await tv.waitForTimeout(350);
          continue;
        }
        const btn = p.locator('.pbtn.primary').first();
        if ((await btn.count()) && (await btn.isEnabled().catch(() => false))) await btn.click().catch(() => {});
      }
      await tv.waitForTimeout(350);
    }
    const fin = (await S(tv)).game;
    check('phones started a ghost battle through the room service', seen.battle);
    check('a phone piece won an item, visible to the table', seen.phoneReward);
    check('a phone controller used an item', seen.phoneUse);
    check('the TV never receives the reward stream', fin.rewardRng === 0);
    check('room scores still equal completed rounds', fin.pieces.reduce((a, q) => a + q.score, 0) === (fin.phase === 'gameOver' ? 10 : fin.round - 1));
    await tv.screenshot({ path: `${OUT}/73-tv-items.png` });
    await phones.Cy.screenshot({ path: `${OUT}/74-phone-items.png` });
    const all = [tv, ...Object.values(phones)];
    check('no console errors (phone battles)', all.every((q) => q.errors.filter((e) => !/WebSocket/.test(e)).length === 0), all.flatMap((q) => q.errors).slice(0, 3).join(' | '));
    for (const q of all) await q.context().close();
  }

  // ── 5. Screen sizes and failure states ───────────────────────────────
  if (run(5)) {
    for (const vp of [
      { width: 1440, height: 900, name: 'laptop' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 800, height: 600, name: 'small' },
      { width: 390, height: 844, name: 'mobile' },
    ]) {
      const page = await newPage({ width: vp.width, height: vp.height }, { reducedMotion: vp.name === 'tablet' ? 'reduce' : 'no-preference' });
      await clearStorage(page, '?quality=low');
      await setupPieces(page, ['human', 'bot', 'bot', 'bot']);
      await page.getByRole('button', { name: /Start game/ }).click();
      await placeAll(page);
      await page.getByRole('button', { name: /Roll for life/ }).click();
      await settle(page);
      await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/50-${vp.name}.png` });
      const overflow = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('.hud button, .hud .pcard, .action, .topbar')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > innerWidth + 1 || r.left < -1)) bad.push(el.className || el.tagName);
        }
        return { scroll: document.documentElement.scrollWidth > innerWidth, bad };
      });
      check(`${vp.name}: no horizontal clipping`, !overflow.scroll && overflow.bad.length === 0, overflow.bad.slice(0, 4).join(','));
      if (vp.name === 'tablet') check('reduced motion is honoured by default', (await S(page)).settings.reducedMotion === true);
      if (vp.name === 'laptop') {
        await page.getByRole('button', { name: 'Sound and motion settings' }).click();
        await page.getByLabel('Mute all sound').check();
        await page.keyboard.press('Escape');
        check('mute persists', (await page.evaluate(() => JSON.parse(localStorage.getItem('one-more-room/settings')).muted)) === true);
      }
      await page.context().close();
    }
    const page = await newPage();
    await page.goto(URL);
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ schema: 2, session: {} })), SAVE_KEY);
    await page.reload();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Details' }).click();
    check('a candy-rules save is refused with a clear fresh-start explanation', /old candy rules/.test(await page.locator('.dialog').innerText()));
    await page.getByRole('button', { name: 'Clear saved game' }).click();
    // A One Life save from before ghost battles, with a trap on a new Versus space.
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ schema: 3, session: { game: { schema: 3, traps: [{ node: 5 }] }, turnStart: { schema: 3, traps: [{ node: 5 }] }, previousTurnStart: null, known: [] } })), SAVE_KEY);
    await page.reload();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Details' }).click();
    check('a pre-battle save with a trap on a Versus space is refused with a clear fresh start', /Versus space/.test(await page.locator('.dialog').innerText()) && (await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) !== null);
    await page.getByRole('button', { name: 'Clear saved game' }).click();
    await page.context().close();
    const pg = await newPage({ width: 390, height: 844 });
    await pg.goto(URL + '#/join');
    await pg.waitForTimeout(800);
    check('the Join page loads directly (hash route) and finds the service', /Join One More Room/.test(await pg.locator('body').innerText()));
    await pg.screenshot({ path: `${OUT}/55-phone-join.png` });
    await pg.context().close();
    // A static host like GitHub Pages: same files under a sub-path, no room service.
    const { mkdtempSync, symlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const siteRoot = mkdtempSync(path.join(tmpdir(), 'omr-pages-'));
    mkdirSync(path.join(siteRoot, 'BoardGameCentral'));
    symlinkSync(path.join(ROOT, 'dist'), path.join(siteRoot, 'BoardGameCentral', 'one-more-room'));
    const staticServer = spawn('python3', ['-m', 'http.server', '8796', '--bind', '127.0.0.1', '--directory', siteRoot], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const PAGES = 'http://127.0.0.1:8796/BoardGameCentral/one-more-room/';
      const sp = await newPage();
      await sp.goto(PAGES);
      await sp.getByRole('button', { name: /Host a phone room/ }).click();
      await sp.waitForTimeout(1500);
      const lobby = await sp.locator('.room-lobby').innerText();
      check('static hosting: hosting a room explains the missing service and shows no join code or QR', /no room service/.test(lobby) && (await sp.locator('.room-lobby img.qr, .room-code').count()) === 0, lobby.replace(/\s+/g, ' ').slice(0, 160));
      await sp.screenshot({ path: `${OUT}/56-static-no-service.png` });
      await sp.context().close();
      const sj = await newPage({ width: 390, height: 844 });
      await sj.goto(PAGES + '#/join');
      await sj.waitForTimeout(1500);
      check('static hosting: the Join page says phone rooms need the service', /not connected to one/.test(await sj.locator('body').innerText()));
      await sj.screenshot({ path: `${OUT}/57-static-join.png` });
      await sj.getByRole('link', { name: 'Play on this screen' }).click();
      await sj.waitForTimeout(1500);
      check('static hosting: the Join page links back to one-screen play', (await sj.getByRole('button', { name: /Host a phone room/ }).count()) === 1);
      await sj.context().close();
    } finally {
      staticServer.kill();
    }
    const noGl = await chromium.launch({ executablePath: CHROME, args: ['--disable-webgl', '--disable-3d-apis', '--disable-gpu'] });
    const p2 = await noGl.newPage();
    await p2.goto(URL);
    await p2.waitForTimeout(800);
    check('clear message when WebGL is unavailable', (await p2.locator('.nowebgl').count()) === 1);
    await noGl.close();
  }
} catch (e) {
  check('suite ran to completion', false, e.message.split('\n')[0] + ' @ ' + (e.stack.split('\n').find((l) => l.includes('e2e.mjs')) ?? '').trim());
  try {
    for (const ctx of browser.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: `${OUT}/zz-crash-${Date.now()}.png` });
  } catch {}
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
