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
    return { screen: s.screen, busy: s.busy, cameraMode: s.cameraMode, settings: s.settings, game: s.session?.game ?? null, known: s.session?.known ?? [], modal: s.modal };
  });
async function settle(page) {
  for (let i = 0; i < 60; i++) {
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

/** Set up seats in the setup screen: kinds is e.g. ['human','human','bot']. */
async function setupSeats(page, kinds) {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const count = async () => Number((await page.locator('.stepper span').innerText()).split(' ')[0]);
  while ((await count()) > kinds.length) await page.getByRole('button', { name: 'Fewer players' }).click();
  while ((await count()) < kinds.length) await page.getByRole('button', { name: 'More players' }).click();
  for (let i = 0; i < kinds.length; i++) {
    const group = page.getByRole('group', { name: `Player ${i + 1} is played by` });
    await group.getByRole('button', { name: kinds[i] === 'human' ? 'Person' : /greedy/ }).click();
  }
}

/** Pass-and-play secret placement for every human seat. */
async function placeAll(page) {
  for (let k = 0; k < 6; k++) {
    const show = page.getByRole('button', { name: /show me the map/ });
    if (!(await show.count())) break;
    await show.click();
    const node = [18, 26, 2, 30, 6, 21][k];
    await page.getByRole('button', { name: `Space ${node}` }).click();
    await page.getByRole('button', { name: /Curse space/ }).click();
    await page.getByRole('button', { name: /Hide it/ }).click();
  }
  await page.waitForTimeout(400);
}

/** Rewrite the saved game, reload and resume through the real UI. */
async function loadScenario(page, mutate) {
  const save = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY));
  const g = save.session.game;
  Object.assign(g, { phase: 'turnStart', turn: 0, dice: null, selection: { moveDie: 0, dest: null }, event: null, pick: null, challenge: null, lastOutcome: null, decoy: null, ghostBonus: 0, log: [], ghost: 16, round: 2, turnNumber: 5 });
  g.players.forEach((p) => Object.assign(p, { node: 0, carried: 0, alive: true, protectedUntil: null, decoyUsed: false, facingFrom: null, bounty: 0 }));
  g.piles = g.piles.map(() => 0);
  mutate(g);
  g.turnDirty = false;
  save.session.turnStart = g;
  save.session.previousTurnStart = null;
  save.session.known = g.traps.filter((t) => t.revealed).map((t) => t.node);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(save)]);
  await page.reload();
  await page.getByRole('button', { name: 'Resume game' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
}

/** Plays the on-screen survival game like a person would: by watching the screen. */
async function autoplay(page) {
  await page.evaluate(() => {
    const stop = { v: false };
    window.__autoplayStop = stop;
    const key = (k, code) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: code ?? k }));
    let lastRope = 1;
    let seen = [];
    let lastArrow = null;
    const loop = () => {
      if (stop.v) return;
      const ring = document.querySelector('.escape-game svg');
      if (ring) {
        const zone = ring.querySelector('path');
        const marker = ring.querySelector('circle[fill="#fff1b8"]');
        if (zone && marker) {
          const d = zone.getAttribute('d').match(/M([\d.-]+),([\d.-]+) A[\d.]+,[\d.]+ 0 0 1 ([\d.-]+),([\d.-]+)/);
          const ang = (x, y) => (Math.atan2(x - 110, 110 - y) * 180) / Math.PI;
          const a1 = ang(+d[1], +d[2]);
          const a2 = ang(+d[3], +d[4]);
          let z = (a1 + a2) / 2;
          if (Math.abs(a1 - a2) > 180) z += 180;
          const m = ang(+marker.getAttribute('cx'), +marker.getAttribute('cy'));
          const diff = Math.abs(((m - z + 540) % 360) - 180);
          if (diff < 14) key(' ', 'Space');
        }
      }
      const show = document.querySelector('.dance-show .big-arrow:not(.dim)');
      if (show && show.textContent !== lastArrow) {
        lastArrow = show.textContent;
        seen.push(show.textContent);
      }
      if (!show) lastArrow = null;
      const pad = document.querySelector('.dance-pad .pad:not([disabled])');
      if (pad && seen.length >= 4) {
        const map = { '⬆': 'ArrowUp', '➡': 'ArrowRight', '⬇': 'ArrowDown', '⬅': 'ArrowLeft' };
        const moves = seen.slice(-4);
        seen = [];
        moves.forEach((a, i) => setTimeout(() => key(map[a]), 150 + i * 250));
      }
      const rope = document.querySelector('.rope-game path');
      if (rope) {
        const c = +rope.getAttribute('d').match(/Q[\d.]+,(-?[\d.]+)/)[1];
        const h = (200 - (c + 110) / 2) / 170;
        if (h < 0.42 && h < lastRope) key(' ', 'Space');
        lastRope = h;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
async function stopAutoplay(page) {
  await page.evaluate(() => window.__autoplayStop && (window.__autoplayStop.v = true)).catch(() => {});
}

/** Wait for a challenge to resolve (phase leaves 'challenge'). */
async function waitChallengeDone(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await S(page);
    if (st.game?.phase !== 'challenge') return st;
    const ready = page.getByRole('button', { name: /^Ready$/ });
    if (await ready.count()) await ready.first().click().catch(() => {});
    await page.waitForTimeout(250);
  }
  return S(page);
}

try {
  // ── 1. Local: setup, secret placement, both cameras ──────────────────
  if (run(1)) {
    const page = await newPage();
    await clearStorage(page);
    await page.evaluate(() => localStorage.setItem('unrelated-key', 'keep-me'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/01-title.png` });
    check('title offers Play, Host a phone room, How to play', (await page.getByRole('button', { name: 'Play', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'Host a phone room' }).count()) === 1);
    await page.getByRole('button', { name: 'How to play' }).click();
    const rules = (await page.locator('.rules').innerText()).toLowerCase();
    check('rules cover curses, survival games, protection, ghosts, bounties and scoring', ['curse the mansion', 'break the curse', 'dance for death', 'super reaper', 'protection', 'becoming a ghost', 'bounty', 'survival bonus'].every((w) => rules.includes(w)));
    check('rules no longer promise the old half-bag catch', !/drop half/.test(rules));
    await page.keyboard.press('Escape');

    await setupSeats(page, ['human', 'human', 'bot']);
    await page.getByLabel('Player 1 name').fill('<b>Ana</b>');
    await page.screenshot({ path: `${OUT}/02-setup.png` });
    await page.getByRole('button', { name: /Start game/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/03-placement-curtain.png` });
    const curtain = await page.locator('.curtain-card').innerText();
    check('placement curtain asks others to look away', /look away/.test(curtain));
    await page.getByRole('button', { name: /show me the map/ }).click();
    await page.getByRole('button', { name: 'Space 18' }).click();
    await page.screenshot({ path: `${OUT}/04-placement-map.png` });
    await page.getByRole('button', { name: /Curse space 18/ }).click();
    check('a brief private confirmation names the pick', /space 18/.test(await page.locator('.curtain-card').innerText()));
    await page.getByRole('button', { name: /Hide it/ }).click();
    check('after hiding, the next curtain never shows the previous pick', !/18/.test(await page.locator('.curtain-card').innerText()));
    await placeAll(page);
    let st = await S(page);
    check('placement ends with six hidden traps and play begins', st.game.phase === 'turnStart' && st.game.traps.length === 6 && st.game.traps.every((t) => !t.revealed));
    check('the human pick is among the six', st.game.traps.some((t) => t.node === 18));
    check('custom name renders as text', (await page.locator('.pname', { hasText: '<b>Ana</b>' }).count()) > 0);
    await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});

    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    check('a generic reminder about unknown corridors is shown', (await page.locator('.reminder').count()) === 1);
    const hiddenNodes = st.game.traps.map((t) => t.node);
    const destText = await page.locator('.dest-list').innerText();
    check('destination list never flags an unrevealed trap', !/Reaper/.test(destText.replace(/Super Reaper/g, '')), hiddenNodes.join(','));
    const dest = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('.dest .dmeta')].map((e) => Number(e.textContent.match(/#(\d+)/)[1]));
      for (const id of ids.reverse()) {
        const p = window.__omr.project(id);
        if (p.visible && p.x > 300 && p.x < 1000 && p.y > 120 && p.y < 860) return { id, ...p };
      }
      return null;
    });
    if (dest) {
      await page.mouse.click(dest.x, dest.y);
      await page.waitForTimeout(200);
      st = await S(page);
      check('clicking a glowing 3D space in follow view selects it', st.game.selection.dest === dest.id, `node ${dest.id}`);
    }
    await page.screenshot({ path: `${OUT}/05-follow-preview.png` });
    await page.keyboard.press('v');
    await page.waitForTimeout(900);
    st = await S(page);
    check('V switches to the overview', st.cameraMode === 'overview');
    await page.waitForTimeout(1200);
    const offFrame = await page.evaluate(() => Array.from({ length: 32 }, (_, i) => [i, window.__omr.project(i)]).filter(([, p]) => !p.visible).map(([i]) => i));
    check('the overview frames all 32 spaces', offFrame.length === 0, offFrame.join(','));
    await page.screenshot({ path: `${OUT}/06-overview.png` });
    await page.getByRole('button', { name: /^(Confirm|Risk)/ }).click();
    await settle(page);
    st = await S(page);
    if (st.game.phase === 'challenge') {
      await autoplay(page);
      st = await waitChallengeDone(page);
      await stopAutoplay(page);
    }
    check('overview choice persists after the move', st.cameraMode === 'overview');
    await page.keyboard.press('v');
    check('saving never touched unrelated storage', (await page.evaluate(() => localStorage.getItem('unrelated-key'))) === 'keep-me');
    check('no console errors (local setup)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 2. Encounters through crafted saves ──────────────────────────────
  if (run(2)) {
    const page = await newPage({ width: 1440, height: 900 });
    await clearStorage(page, '?quality=low');
    await setupSeats(page, ['human', 'human', 'bot']);
    await page.getByRole('button', { name: /Start game/ }).click();
    await placeAll(page);
    const TRAPS = (nodes) => nodes.map((node) => ({ node, revealed: false }));

    // Escape: the resident ghost catches player 1 in the attic.
    await loadScenario(page, (g) => {
      g.players[0].node = 15;
      g.players[0].carried = 5;
      g.traps = TRAPS([2, 4, 6, 9, 19, 21]);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /Stay put/ }).click();
    check('forecast previews a survival challenge, not an automatic loss', /escape challenge/.test(await page.locator('.forecast').innerText()));
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    await page.locator('.ghost-btn').click();
    await settle(page);
    let st = await S(page);
    check('the ghost starts Break the Curse', st.game.phase === 'challenge' && st.game.challenge.kind === 'escape');
    await page.getByRole('button', { name: /^Ready$/ }).click();
    await autoplay(page);
    await page.waitForTimeout(4300);
    await page.screenshot({ path: `${OUT}/10-escape-ring.png` });
    st = await waitChallengeDone(page);
    await stopAutoplay(page);
    await settle(page);
    const p0 = st.game.players[0];
    if (p0.alive) check('a successful escape keeps candy, moves away and protects', p0.carried === 5 && p0.node !== 15 && p0.protectedUntil !== null, `node ${p0.node}`);
    else check('a failed escape drops all carried candy and transforms', p0.carried === 0 && st.game.piles[15] === 5);
    await page.screenshot({ path: `${OUT}/11-after-escape.png` });

    // A failed escape → spectral ghost with its own objective.
    await loadScenario(page, (g) => {
      g.players[0].node = 15;
      g.players[0].carried = 4;
      g.players[0].banked = 3;
      g.traps = TRAPS([2, 4, 6, 9, 19, 21]);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /Stay put/ }).click();
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    await page.locator('.ghost-btn').click();
    await settle(page);
    await page.getByRole('button', { name: /^Ready$/ }).click();
    st = await waitChallengeDone(page); // no presses → fails
    await settle(page);
    check('no press: transformed, bank kept, all carried candy dropped', !st.game.players[0].alive && st.game.players[0].banked === 3 && st.game.piles[15] === 4);
    check('the summary explains the changed objective', /haunt/.test(await page.locator('.action').innerText()));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/12-transformed.png` });
    await page.locator('.phase .btn.primary').click();
    await page.waitForTimeout(400);
    st = await S(page);
    check('no immediate bonus ghost turn: play passes to the next seat', st.game.turn === 1);

    // Ghost turn: one die, wall links.
    await loadScenario(page, (g) => {
      g.players[0].alive = false;
      g.players[0].node = 7;
      g.players[1].node = 3;
      g.traps = TRAPS([2, 4, 6, 9, 19, 21]);
    });
    await page.getByRole('button', { name: /Roll the ghost die/ }).click();
    await settle(page);
    st = await S(page);
    check('a player ghost rolls one die', st.game.dice.length === 1);
    check('the ghost-only wall link to the conservatory is offered', (await page.getByRole('option', { name: /Conservatory/ }).count()) > 0);
    await page.screenshot({ path: `${OUT}/13-ghost-turn.png` });

    // Hidden trap: land, reveal, perform; reload keeps the same challenge; undo keeps knowledge.
    await loadScenario(page, (g) => {
      g.players[0].node = 10;
      g.players[0].carried = 2;
      g.traps = TRAPS([9, 2, 4, 19, 21, 30]);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /#9 / }).click();
    const pv = await page.locator('.forecast').innerText();
    check('the preview does not reveal the hidden trap', !/Reaper/.test(pv));
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    st = await S(page);
    check('landing reveals the trap and starts a Reaper performance', st.game.traps.find((t) => t.node === 9).revealed && st.game.phase === 'challenge' && ['dance', 'rope'].includes(st.game.challenge.kind));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/14-reaper-reveal.png` });
    const chId = st.game.challenge?.id;
    await page.reload();
    await page.getByRole('button', { name: 'Resume game' }).click();
    await page.waitForTimeout(500);
    st = await S(page);
    check('reload during a challenge resumes the same challenge', st.game.phase === 'challenge' && st.game.challenge.id === chId);
    await page.getByRole('button', { name: /^Ready$/ }).click();
    await autoplay(page);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/15-reaper-game.png` });
    st = await waitChallengeDone(page, 90000);
    await stopAutoplay(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/16-after-reaper.png` });
    await page.getByRole('button', { name: /^Undo/ }).click();
    await page.getByRole('button', { name: /^Undo to/ }).click();
    st = await S(page);
    check('undo restores the mechanics but the table keeps the reveal', !st.game.traps.find((t) => t.node === 9).revealed && st.known.includes(9));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/17-undo-keeps-reveal.png` });

    // Two humans on one keyboard: ready keys, then a duel.
    await loadScenario(page, (g) => {
      g.players[0].node = 2;
      g.players[0].carried = 1;
      g.players[1].node = 3;
      g.players[1].carried = 2;
      g.traps = TRAPS([4, 6, 9, 19, 21, 30]);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /#3 / }).click();
    check('a duel is warned before confirming', /Duel with/.test(await page.locator('.forecast').innerText()));
    await page.getByRole('button', { name: /^Risk it/ }).click();
    await settle(page);
    const intro = await page.locator('.challenge-card').innerText();
    check('the duel shows two key mappings and waits for both', /key F\b/i.test(intro) && /key J\b/i.test(intro), intro.replace(/\s+/g, ' ').slice(0, 200));
    await page.screenshot({ path: `${OUT}/18-duel-ready.png` });
    await page.keyboard.press('f');
    await page.keyboard.press('j');
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${OUT}/19-duel-rope.png` });
    st = await waitChallengeDone(page, 60000);
    check('without jumps both duelists fail the early threshold', !st.game.players[0].alive && !st.game.players[1].alive);
    await settle(page);

    // Super Reaper warning.
    await loadScenario(page, (g) => {
      g.players[0].node = 4;
      g.players[1].node = 22;
      g.traps = TRAPS([2, 6, 9, 19, 21, 30]);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /Super Reaper/ }).click();
    check('the Super Reaper warns that the arriving player risks death', /Super Reaper/.test(await page.locator('.forecast .warn').innerText()));
    await page.screenshot({ path: `${OUT}/20-super-reaper-warning.png` });

    // Results breakdown.
    await loadScenario(page, (g) => {
      g.round = 10;
      g.turn = 2;
      g.phase = 'summary';
      g.dice = [1, 1];
      g.players[0].banked = 7;
      g.players[0].carried = 3;
      g.players[0].node = 3;
      g.players[1].alive = false;
      g.players[1].banked = 4;
      g.players[1].bounty = 6;
      g.players[1].node = 20;
      g.players[2].banked = 5;
    });
    // Seat 3 is a bot, so it may close its own summary; otherwise click through.
    if ((await S(page)).game.phase === 'summary') await page.locator('.phase .btn.primary').click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__omr.getState().session?.game?.phase === 'gameOver', null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const rows = await page.locator('.results tbody tr').allInnerTexts();
    check('results show survival bonus and bounty with the right totals', rows.some((r) => /\+5/.test(r) && /13/.test(r)) && rows.some((r) => /\+6/.test(r) && /10/.test(r)), rows.join(' / '));
    const fit = await page.locator('.results').evaluate((el) => el.scrollWidth - el.clientWidth);
    check('the results table fits its panel without sideways scrolling', fit <= 1, `${fit}px`);
    await page.screenshot({ path: `${OUT}/21-results.png` });
    check('no console errors (encounters)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 3. One human with five bots, to the end ──────────────────────────
  if (run(3)) {
    const page = await newPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });
    await clearStorage(page, '?quality=low');
    await page.evaluate(() => localStorage.setItem('one-more-room/settings', JSON.stringify({ fastBots: true, reducedMotion: true, lowGraphics: true })));
    await page.reload();
    await setupSeats(page, ['human', 'bot', 'bot', 'bot', 'bot', 'bot']);
    await page.getByRole('button', { name: /Start game/ }).click();
    await placeAll(page);
    await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
    const t0 = Date.now();
    let sawChallenge = false;
    for (let i = 0; i < 4000; i++) {
      const st = await S(page);
      if (!st.game || st.game.phase === 'gameOver') break;
      if (Date.now() - t0 > 25 * 60 * 1000) break;
      if (st.game.phase === 'challenge') {
        sawChallenge = true;
        const ready = page.getByRole('button', { name: /^Ready$/ });
        if (await ready.count()) await ready.first().click().catch(() => {});
        await page.waitForTimeout(300);
        continue;
      }
      if (st.game.turn === 0 && !st.busy) {
        if (st.game.phase === 'choose') {
          const o = page.getByRole('option');
          if ((await o.count()) > 1 && st.game.selection.dest === null) await o.nth(1).click().catch(() => {});
        }
        if (st.game.phase === 'event' || st.game.phase === 'pick') await page.locator('.choices button').first().click().catch(() => {});
        const b = page.locator('.action .btn.primary.big').first();
        if ((await b.count()) && (await b.isEnabled())) await b.click().catch(() => {});
      }
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1200);
    const st = await S(page);
    check('one person plus five bots reaches the results', st.game.phase === 'gameOver', `${Math.round((Date.now() - t0) / 1000)}s`);
    check('survival challenges happened along the way', sawChallenge);
    const fit6 = await page.locator('.results').evaluate((el) => el.scrollWidth - el.clientWidth);
    check('six-player results fit their panel without sideways scrolling', fit6 <= 1, `${fit6}px`);
    await page.screenshot({ path: `${OUT}/30-bots-results.png` });
    check('no console errors (bots)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
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
    check('the TV shows a room code, a QR code and a join link that is not localhost', /^[A-Z]{4}$/.test(code) && (await tv.locator('img.qr').count()) === 1 && !/localhost|127\.0\.0\.1/.test(joinUrl), joinUrl);
    const phones = [];
    for (const [name, ch] of [['Ana', 'Witch'], ['Ben', 'Knight']]) {
      const p = await newPage({ width: 390, height: 844 });
      await p.goto(URL + '#/join?room=' + code);
      await p.getByLabel('Your name').fill(name);
      await p.getByRole('button', { name: 'Join' }).click();
      await p.getByRole('button', { name: new RegExp(ch) }).click();
      phones.push(p);
    }
    await tv.locator('select[aria-label="Bot costume"]').selectOption('goblin');
    await tv.getByRole('button', { name: 'Add bot' }).click();
    await tv.waitForTimeout(300);
    await tv.screenshot({ path: `${OUT}/40-tv-lobby.png` });
    await phones[0].screenshot({ path: `${OUT}/41-phone-lobby.png` });
    await tv.getByRole('button', { name: /Start with 3/ }).click();
    for (const [i, p] of phones.entries()) {
      await p.getByRole('button', { name: i ? 'Space 18' : 'Space 26' }).click();
      await p.getByRole('button', { name: /Curse space/ }).click();
      if (i === 0) await p.screenshot({ path: `${OUT}/42-phone-curse-set.png` });
      await p.getByRole('button', { name: 'Hide it' }).click();
    }
    await tv.waitForTimeout(1500);
    const tvGame = (await S(tv)).game;
    check('the TV never receives hidden traps, the seed or the deck order', tvGame.traps.length === 0 && tvGame.rng === 0 && tvGame.deck.every((c) => c === -1));
    const other = await phones[1].evaluate(() => document.body.innerText);
    check('a phone never shows another phone’s pick', !/space 26/.test(other));
    let challenges = 0;
    let reloaded = false;
    for (let step = 0; step < 260; step++) {
      const st = await tv.evaluate(() => {
        const s = window.__omr.getState();
        const g = s.session?.game;
        return g ? { phase: g.phase, turn: g.turn, round: g.round, parts: g.challenge?.participants ?? [] } : null;
      });
      if (!st) {
        await tv.waitForTimeout(300);
        continue;
      }
      if (st.phase === 'gameOver' || st.round > 3) break;
      if (st.phase === 'challenge') {
        for (const [i, p] of phones.entries()) {
          if (!st.parts.includes(i)) continue;
          const ready = p.getByRole('button', { name: /I’m ready/ });
          if (await ready.count()) {
            await ready.click();
            challenges++;
          }
          const press = p.locator('.press-btn').first();
          if (await press.count()) await press.click({ force: true }).catch(() => {});
          if (challenges === 1) await p.screenshot({ path: `${OUT}/43-phone-challenge.png` }).catch(() => {});
        }
        if (challenges === 1) await tv.screenshot({ path: `${OUT}/44-tv-challenge.png` });
        await tv.waitForTimeout(250);
        continue;
      }
      if (st.turn < 2) {
        const p = phones[st.turn];
        if (!reloaded && st.round === 2) {
          reloaded = true;
          const before = await p.locator('.phead b').first().innerText();
          await p.reload();
          await p.waitForTimeout(1500);
          const after = await p.locator('.phead b').first().innerText().catch(() => '');
          check('a refreshed phone rejoins its own seat', before === after, `${before} → ${after}`);
        }
        const opts = p.locator('.pdest');
        if (st.phase === 'choose' && (await opts.count()) > 1 && !(await p.locator('.pdest.on').count())) await opts.nth(1).click();
        const btn = p.locator('.pbtn.primary').first();
        if ((await btn.count()) && (await btn.isEnabled())) await btn.click().catch(() => {});
        else {
          const any = p.locator('.pbtn').first();
          if (await any.count()) await any.click().catch(() => {});
        }
        if (step === 10) await p.screenshot({ path: `${OUT}/45-phone-turn.png` });
      }
      await tv.waitForTimeout(300);
    }
    const fin = (await S(tv)).game;
    check('phones and a bot played several rounds through the service', fin.round >= 3 || fin.phase === 'gameOver', `round ${fin.round}, ${challenges} phone challenges`);
    await tv.screenshot({ path: `${OUT}/46-tv-room-game.png` });
    check('the phone controller has no horizontal overflow', await phones[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('no console errors (rooms)', [tv, ...phones].every((p) => p.errors.length === 0), [tv, ...phones].flatMap((p) => p.errors).slice(0, 3).join(' | '));
    for (const p of [tv, ...phones]) await p.context().close();
  }

  // ── 5. Screen sizes and failure states ───────────────────────────────
  if (run(5)) {
    for (const vp of [
      { width: 1440, height: 900, name: 'desktop' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 800, height: 600, name: 'small' },
      { width: 390, height: 844, name: 'phone-portrait' },
    ]) {
      const page = await newPage({ width: vp.width, height: vp.height }, { reducedMotion: vp.name === 'tablet' ? 'reduce' : 'no-preference' });
      await clearStorage(page, '?quality=low');
      await setupSeats(page, ['human', 'bot', 'bot', 'bot']);
      await page.getByRole('button', { name: /Start game/ }).click();
      await placeAll(page);
      await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
      await page.getByRole('button', { name: /Roll dice/ }).click();
      await settle(page);
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
      if (vp.name === 'desktop') {
        await page.getByRole('button', { name: 'Sound and motion settings' }).click();
        await page.getByLabel('Mute all sound').check();
        await page.keyboard.press('Escape');
        check('mute persists', (await page.evaluate(() => JSON.parse(localStorage.getItem('one-more-room/settings')).muted)) === true);
      }
      await page.context().close();
    }
    const page = await newPage();
    await page.goto(URL);
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ schema: 1, session: {} })), SAVE_KEY);
    await page.reload();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Details' }).click();
    check('an original-rules save is refused with a fresh-start offer', /different version/.test(await page.locator('.dialog').innerText()));
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
  try { await (await browser.contexts())[0]?.pages()[0]?.screenshot({ path: `${OUT}/zz-crash.png` }); } catch {}
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
