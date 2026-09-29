// End-to-end checks that drive the real, built game in headless Chromium.
//
//   npm run build && node tests/browser/e2e.mjs
//
// Starts `vite preview` itself unless URL is set. Uses Playwright's Chromium
// (or CHROME=/path/to/chrome) with SwiftShader so WebGL works without a GPU.
// Screenshots land in test-results/ for a human to look over.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(Boolean);
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SAVE_KEY = 'one-more-room/save';

let server = null;
let URL = process.env.URL;
if (!URL) {
  URL = 'http://localhost:4174/';
  server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
}

const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const run = (n) => !ONLY || ONLY.includes(n);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Same generator as src/engine/rng.ts, used to pick an RNG state with known dice.
function nextFloat(state) {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}
function rngFor(a, b) {
  for (let s = 1; s < 1e6; s++) {
    const [v1, s1] = nextFloat(s);
    const [v2] = nextFloat(s1);
    if (1 + Math.floor(v1 * 6) === a && 1 + Math.floor(v2 * 6) === b) return s;
  }
  throw new Error('no rng');
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

const S = (page) => page.evaluate(() => {
  const s = window.__omr.getState();
  return { screen: s.screen, busy: s.busy, cameraMode: s.cameraMode, settings: s.settings, game: s.session?.game ?? null, modal: s.modal };
});

async function settle(page) {
  for (let i = 0; i < 80; i++) {
    const st = await S(page);
    if (!st.busy) return;
    const skip = page.getByRole('button', { name: /Skip animation/ });
    if (i > 2 && (await skip.count())) await skip.click().catch(() => {});
    await page.waitForTimeout(100);
  }
}

async function startGame(page, count, query = '') {
  if (process.env.VERBOSE) console.log('      startGame', count, query);
  await page.goto(URL + query);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('one-more-room/')) localStorage.removeItem(k);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const cur = async () => Number((await page.locator('.stepper span').innerText()).split(' ')[0]);
  while ((await cur()) > count) await page.getByRole('button', { name: 'Fewer players' }).click();
  while ((await cur()) < count) await page.getByRole('button', { name: 'More players' }).click();
  await page.getByRole('button', { name: /Start game/ }).click();
  await page.waitForTimeout(600);
}

/** Rewrite the saved game, reload and resume it through the real UI. */
async function loadScenario(page, mutate) {
  const raw = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
  const save = JSON.parse(raw);
  Object.assign(save.session.game, {
    phase: 'turnStart', turn: 0, dice: null, selection: { moveDie: 0, dest: null },
    event: null, decoy: null, ghostBonus: 0, log: [], ghost: 16,
  });
  save.session.game.players.forEach((p) => Object.assign(p, { node: 0, carried: 0, decoyUsed: false, facingFrom: null }));
  save.session.game.piles = save.session.game.piles.map(() => 0);
  mutate(save.session.game);
  save.session.game.turnDirty = false;
  save.session.turnStart = save.session.game;
  save.session.previousTurnStart = null;
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(save)]);
  await page.reload();
  await page.getByRole('button', { name: 'Resume game' }).click();
  await page.waitForTimeout(500);
}

async function playTurnViaUI(page, { pick = 'far' } = {}) {
  const t0 = Date.now();
  const v = (m) => process.env.VERBOSE && console.log(`        ${m} +${Date.now() - t0}ms`);
  page.setDefaultTimeout(15000);
  let st = await S(page);
  const turnNo = st.game.turnNumber;
  await page.getByRole('button', { name: /Roll dice/ }).click();
  v('rolled');
  await settle(page);
  v('settled');
  st = await S(page);
  const opts = page.getByRole('option');
  const n = await opts.count();
  if (n > 1) await opts.nth(pick === 'near' ? 1 : n - 1).click();
  else await opts.first().click();
  v('picked');
  await page.getByRole('button', { name: /^Confirm/ }).click();
  v('confirmed');
  await settle(page);
  for (let i = 0; i < 3; i++) {
    st = await S(page);
    if (st.game.phase !== 'event') break;
    const choices = page.locator('.choices button');
    await choices.first().click();
    await settle(page);
  }
  st = await S(page);
  if (st.game.phase === 'ghost') {
    await page.locator('.ghost-btn').click();
    await settle(page);
  }
  st = await S(page);
  if (st.game.phase === 'summary') {
    await page.locator('.phase .btn.primary').click();
    await page.waitForTimeout(150);
  }
  return { turnNo, after: await S(page) };
}

try {
  // ── 1. Title, setup, a two-player game through both cameras ──────────
  if (run(1)) {
    const page = await newPage();
    await page.goto(URL);
    await page.evaluate(() => localStorage.setItem('unrelated-key', 'keep-me'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/01-title.png` });
    check('title shows Play and How to play, no Resume without a save', (await page.getByRole('button', { name: 'Play', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'Resume game' }).count()) === 0);

    await page.getByRole('button', { name: 'How to play' }).click();
    const rulesText = await page.locator('.rules').innerText();
    check(
      'rules explain banking, targeting, dice, captures, decoys, scoring',
      ['banks', 'carrying', 'moves the ghost', 'Getting caught', 'Decoy', 'rounded down', 'Entrance Hall'].every((w) => rulesText.includes(w)),
    );
    await page.keyboard.press('Escape');
    check('Escape closes the rules dialog', (await page.locator('.dialog').count()) === 0);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Fewer players' }).click();
    await page.getByRole('button', { name: 'Fewer players' }).click();
    const nameInput = page.getByLabel('Player 1 name');
    await nameInput.fill('<b>Ana</b>');
    await page.keyboard.press('v'); // typing "v" in a name must not toggle anything
    await nameInput.fill('<b>Ana</b>');
    await page.getByRole('radiogroup', { name: 'Player 1 costume' }).getByRole('radio', { name: /Witch/ }).click();
    await page.screenshot({ path: `${OUT}/02-setup.png` });
    await page.getByRole('button', { name: /Start game/ }).click();
    await page.waitForTimeout(800);
    let st = await S(page);
    check('two-player game starts with chosen costume and literal name', st.game.players.length === 2 && st.game.players[0].character === 'witch' && st.game.players[0].name === '<b>Ana</b>');
    check('custom name renders as text, not HTML', (await page.locator('.pname', { hasText: '<b>Ana</b>' }).count()) > 0);
    check('first-turn explanation is shown', (await page.locator('.tip').count()) === 1);
    await page.screenshot({ path: `${OUT}/03-first-turn.png` });
    await page.getByRole('button', { name: 'Got it' }).click();
    check('round/turn header reads correctly', (await page.locator('.round').innerText()).includes('Round 1 / 10 • Player 1 / 2'));

    // Keyboard: Tab to Roll dice and press Enter.
    await page.locator('body').click({ position: { x: 5, y: 895 } }).catch(() => {});
    await page.getByRole('button', { name: /Roll dice/ }).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    st = await S(page);
    check('keyboard Enter rolls the dice', st.game.phase === 'choose' && st.game.dice);
    const moveLabel = await page.locator('.die-btn.move b').innerText();
    check('dice panel shows the engine’s movement die', Number(moveLabel) === st.game.dice[st.game.selection.moveDie]);

    // Pick a destination by clicking the actual 3D node in follow view.
    const dest = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.dest .dmeta')].map((e) => Number(e.textContent.match(/#(\d+)/)[1]));
      for (const id of opts.reverse()) {
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
    } else check('clicking a glowing 3D space in follow view selects it', false, 'no visible reachable node');
    await page.screenshot({ path: `${OUT}/04-follow-preview.png` });
    const forecast = await page.locator('.forecast').innerText();
    check('forecast names the ghost’s target and distance', /hunts|waits|chases/.test(forecast) && /space/.test(forecast + ' space'));

    // Swap dice without rerolling.
    const diceBefore = st.game.dice;
    if (diceBefore[0] !== diceBefore[1]) {
      await page.getByRole('button', { name: /Swap dice/ }).click();
      st = await S(page);
      check('swapping dice keeps the same roll', JSON.stringify(st.game.dice) === JSON.stringify(diceBefore) && st.game.selection.moveDie === 1);
      await page.getByRole('button', { name: /Swap dice/ }).click();
      if (dest) await page.getByRole('option', { name: new RegExp(`#${dest.id} `) }).click();
    }
    const preview = await page.evaluate(() => document.querySelector('.forecast .ghostline')?.textContent ?? '');
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/05-follow-moving.png` });
    await settle(page);
    st = await S(page);
    check('confirming moves the piece to the chosen space', st.game.players[0].node === (dest?.id ?? st.game.players[0].node));
    const ghostLine = await page.locator('.ghostline.big').innerText().catch(() => '');
    if (!preview.includes('forecast only')) check('ghost forecast before the move matches the committed plan', ghostLine.replace(/\s+/g, ' ').includes(preview.replace(/.*👻\s*/, '').trim().split(' — ')[0]), `${preview} | ${ghostLine}`);
    await page.locator('.ghost-btn').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/06-ghost-moving.png` });
    await settle(page);
    await page.screenshot({ path: `${OUT}/07-summary.png` });
    await page.locator('.phase .btn.primary').click();
    await page.waitForTimeout(300);

    // Player 2 in the overview.
    await page.keyboard.press('v');
    await page.waitForTimeout(1200);
    st = await S(page);
    check('V switches to the board overview', st.cameraMode === 'overview');
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    const od = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.dest .dmeta')].map((e) => Number(e.textContent.match(/#(\d+)/)[1]));
      const id = opts[opts.length - 1];
      return { id, ...window.__omr.project(id) };
    });
    await page.mouse.click(od.x, od.y);
    await page.waitForTimeout(200);
    st = await S(page);
    check('clicking a space in the overview selects it', st.game.selection.dest === od.id, `node ${od.id}`);
    await page.screenshot({ path: `${OUT}/08-overview-preview.png` });
    const allVisible = await page.evaluate(() => Array.from({ length: 32 }, (_, i) => window.__omr.project(i)).every((p) => p.visible));
    check('overview frames all 32 spaces', allVisible);
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    for (let i = 0; i < 2; i++) {
      const s2 = await S(page);
      if (s2.game.phase === 'event') {
        await page.locator('.choices button').first().click();
        await settle(page);
      }
    }
    await page.locator('.ghost-btn').click();
    await settle(page);
    await page.locator('.phase .btn.primary').click();
    await page.waitForTimeout(500);
    st = await S(page);
    check('overview choice persists into the next turn', st.cameraMode === 'overview' && st.game.round === 2 && st.game.turn === 0);
    await page.screenshot({ path: `${OUT}/09-overview-next-turn.png` });

    // Undo the just-finished turn (player 2) and replay: same dice.
    await page.getByRole('button', { name: /^Undo/ }).click();
    const undoText = await page.locator('.dialog').innerText();
    check('undo names the turn it restores', undoText.includes('Player 2') || /round 1/.test(undoText));
    await page.getByRole('button', { name: /^Undo to/ }).click();
    st = await S(page);
    check('undo restores player 2’s turn start', st.game.turn === 1 && st.game.round === 1 && st.game.phase === 'turnStart');
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    const replay = (await S(page)).game.dice;
    await page.getByRole('button', { name: /^Undo/ }).click();
    await page.getByRole('button', { name: /^Undo to/ }).click();
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    const replay2 = (await S(page)).game.dice;
    check('replaying an undone turn rolls the same dice', JSON.stringify(replay) === JSON.stringify(replay2), JSON.stringify(replay));

    // Reload mid-turn and resume.
    const before = await S(page);
    await page.reload();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Resume game' }).click();
    await page.waitForTimeout(500);
    const after = await S(page);
    check('reload + resume keeps the same phase, dice and positions', after.game.phase === before.game.phase && JSON.stringify(after.game.dice) === JSON.stringify(before.game.dice) && JSON.stringify(after.game.players) === JSON.stringify(before.game.players));
    check('saving never touched unrelated storage', (await page.evaluate(() => localStorage.getItem('unrelated-key'))) === 'keep-me');
    check('no console errors in the two-player run', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 2. Scenarios loaded through real saves: catch, decoy, event, banking ─
  if (run(2)) {
    const page = await newPage();
    await startGame(page, 3);
    await page.getByRole('button', { name: 'Got it' }).click();

    // Catch: player 1 in the attic next to the ghost carrying 7.
    await loadScenario(page, (g) => {
      g.players[0].node = 15; g.players[0].carried = 7; g.players[0].banked = 2;
      g.players[1].node = 3; g.players[1].carried = 2;
      g.rng = rngFor(1, 3);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /Stay put/ }).click();
    const catchForecast = await page.locator('.forecast .ghostline').innerText();
    check('forecast warns of a catch', /catches/.test(catchForecast), catchForecast);
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    await page.locator('.ghost-btn').click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/10-catch.png` });
    await settle(page);
    let st = await S(page);
    check('catch drops ceil(7/2)=4 on the space and banks the other 3', st.game.players[0].node === 0 && st.game.players[0].banked === 5 && st.game.players[0].carried === 0 && st.game.piles[15] === 4);
    check('summary reports the catch', (await page.locator('.summary').innerText()).includes('caught'));

    // Decoy: player 1 at 20 with nothing; player 2 carries more at 13.
    await loadScenario(page, (g) => {
      g.players[0].node = 20; g.players[0].carried = 0;
      g.players[1].node = 13; g.players[1].carried = 5;
      g.rng = rngFor(2, 2);
    });
    await page.getByRole('button', { name: /Use decoy/ }).click();
    check('decoy explains its effect before committing', (await page.locator('.decoy-confirm').innerText()).includes('chases the wrapped sweet'));
    await page.getByRole('button', { name: 'Place decoy' }).click();
    await settle(page);
    st = await S(page);
    check('decoy is placed on the player’s space and spent', st.game.decoy === 20 && st.game.players[0].decoyUsed);
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option').nth(1).click();
    const dText = await page.locator('.forecast .ghostline').innerText();
    check('ghost forecast chases the decoy', /decoy/.test(dText), dText);
    await page.screenshot({ path: `${OUT}/11-decoy.png` });
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    await page.locator('.ghost-btn').click();
    await settle(page);
    st = await S(page);
    check('decoy disappears after the ghost phase', st.game.decoy === null && st.game.players[1].node === 13);

    // Event: stack a Secret Passage card and land on space 5.
    await loadScenario(page, (g) => {
      g.players[0].node = 4; g.players[0].carried = 3;
      const card = g.deck.find((c) => Math.floor(c / 3) === 0);
      g.deck = [card, ...g.deck.filter((c) => c !== card)];
      g.rng = rngFor(1, 2);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /Trick or Treat/ }).click();
    check('event destination forecast is labelled provisional', (await page.locator('.forecast').innerText()).includes('card may change this'));
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    await page.screenshot({ path: `${OUT}/12-event-card.png` });
    st = await S(page);
    check('landing on Trick or Treat draws a card with a choice', st.game.phase === 'event' && st.game.event.type === 'secretPassage');
    await page.getByRole('button', { name: /Go to Secret Passage A · 24/ }).click();
    await settle(page);
    st = await S(page);
    check('secret passage card relocates without collecting', st.game.players[0].node === 24 && st.game.players[0].carried === 3 && st.game.phase === 'ghost');
    check('after the card, the exact ghost path and Move ghost are shown', (await page.locator('.ghost-btn').count()) === 1 && !(await page.locator('.ghostline.big').innerText()).includes('forecast'));
    await page.locator('.ghost-btn').click();
    await settle(page);

    // Banking: carrying 5 two spaces from the entrance.
    await loadScenario(page, (g) => {
      g.players[0].node = 2; g.players[0].carried = 5; g.players[0].banked = 1;
      g.rng = rngFor(4, 3);
    });
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.getByRole('option', { name: /Entrance Hall/ }).click();
    check('forecast shows banking', (await page.locator('.forecast').innerText()).includes('bank 5'));
    await page.getByRole('button', { name: /^Confirm/ }).click();
    await settle(page);
    st = await S(page);
    check('arriving at the entrance banks carried candy', st.game.players[0].banked === 6 && st.game.players[0].carried === 0);

    // Multi-piece occupancy picture.
    await loadScenario(page, (g) => {
      g.players.forEach((p) => { p.node = 3; });
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/13-shared-space.png` });
    check('no console errors in scenarios', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 3. Six players through midnight, every turn through the UI ────────
  // Low graphics and reduced motion keep 60 turns quick under software GL.
  if (run(3)) {
    const page = await newPage({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });
    await startGame(page, 6, '?quality=low');
    await page.getByRole('button', { name: 'Got it' }).click();
    const t0 = Date.now();
    const turns = new Array(6).fill(0);
    let uiTurns = 0;
    let sawMidnight = false;
    const engineTurn = async () => {
      // Same store → engine → save path as the buttons, without clicking.
      const act = (a) => page.evaluate((x) => { window.__omr.act(x); window.__omr.director.skip(); }, a);
      await act({ type: 'roll' });
      await page.waitForTimeout(40);
      const ids = await page.evaluate(() => [...document.querySelectorAll('.dest .dmeta')].map((e) => Number(e.textContent.match(/#(\d+)/)[1])));
      await act({ type: 'select', dest: ids.length ? ids[(turns.reduce((x, y) => x + y) * 7) % ids.length] : 'stay' });
      await act({ type: 'confirmMove' });
      let st = await S(page);
      if (st.game.phase === 'event') {
        await act(st.game.event.canDecline && st.game.event.type !== 'costumeMixup' ? { type: 'eventDecline' } : { type: 'eventChoose', option: st.game.event.options[0] });
      }
      await act({ type: 'moveGhost' });
      await act({ type: 'nextTurn' });
    };
    for (let i = 0; i < 70; i++) {
      const st = await S(page);
      if (st.game.phase === 'gameOver') break;
      turns[st.game.turn]++;
      if (process.env.VERBOSE) console.log(`      turn ${i}: round ${st.game.round} player ${st.game.turn + 1} (${Math.round((Date.now() - t0) / 1000)}s)`);
      const viaUI = st.game.round === 1 || st.game.round === 10;
      if (viaUI) {
        uiTurns++;
        await playTurnViaUI(page, { pick: i % 3 === 0 ? 'near' : 'far' });
      } else await engineTurn();
      const after = await S(page);
      if (!sawMidnight && after.game.round === 8) {
        const banner = await page.evaluate(() => window.__omr.getState().banner?.text ?? '');
        sawMidnight = banner.includes('Three rounds until midnight') && after.game.midnight;
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/14-midnight.png` });
      }
      if (i === 30) await page.screenshot({ path: `${OUT}/15-midgame.png` });
    }
    console.log(`      ${uiTurns} of 60 turns were played by clicking through the UI`);
    await page.waitForTimeout(1500);
    const st = await S(page);
    check('six-player game reaches the results after exactly ten turns each', st.game.phase === 'gameOver' && turns.every((t) => t === 10), JSON.stringify(turns));
    check('midnight warning appeared once round 7 ended', sawMidnight && st.game.midnight);
    const rows = await page.locator('.results tbody tr').allInnerTexts();
    const scores = st.game.players.map((p) => p.banked + Math.floor(p.carried / 2));
    const best = Math.max(...scores);
    const winners = st.game.players.filter((_, i) => scores[i] === best).map((p) => p.name);
    const heading = await page.locator('.results h1').innerText();
    check('results list every player with banked + ⌊carried/2⌋', rows.length === 6 && rows.every((r) => r.includes('÷ 2')));
    const totals = (await page.locator('.results tbody td:nth-child(5) b').allInnerTexts()).map(Number);
    check('shown totals equal banked + floor(carried / 2)', JSON.stringify(totals) === JSON.stringify(scores.slice().sort((a, b) => b - a)), JSON.stringify(totals));
    check('results name the winner(s) correctly', winners.every((w) => heading.includes(w)), `${heading} vs ${winners.join(',')}`);
    await page.screenshot({ path: `${OUT}/16-results.png` });
    console.log(`      six-player game took ${Math.round((Date.now() - t0) / 1000)}s of scripted play`);
    await page.getByRole('button', { name: /Play again/ }).click();
    await page.waitForTimeout(500);
    const again = await S(page);
    check('play again keeps the same players', again.game.round === 1 && again.game.players.map((p) => p.name).join() === st.game.players.map((p) => p.name).join());
    check('no console errors in the six-player run', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 4. Screen sizes, reduced motion, audio settings ──────────────────
  for (const vp of !run(4) ? [] : [
    { width: 1440, height: 900, name: 'desktop' },
    { width: 1024, height: 768, name: 'tablet' },
    { width: 800, height: 600, name: 'small' },
    { width: 390, height: 844, name: 'phone-portrait' },
  ]) {
    const page = await newPage({ width: vp.width, height: vp.height }, { reducedMotion: vp.name === 'tablet' ? 'reduce' : 'no-preference' });
    await startGame(page, 4);
    await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await settle(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/20-${vp.name}.png` });
    const overflow = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('.hud button, .hud .pcard, .action, .topbar')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > innerWidth + 1 || r.left < -1)) bad.push(el.className || el.tagName);
      }
      return { scroll: document.documentElement.scrollWidth > innerWidth, bad };
    });
    check(`${vp.name}: no horizontal clipping of controls`, !overflow.scroll && overflow.bad.length === 0, overflow.bad.slice(0, 4).join(','));
    const confirmVisible = await page.getByRole('button', { name: /Choose where to go|^Confirm/ }).isVisible();
    check(`${vp.name}: primary action reachable`, confirmVisible);
    if (vp.name === 'tablet') {
      const st = await S(page);
      check('reduced-motion preference is honoured by default', st.settings.reducedMotion === true);
    }
    if (vp.name === 'desktop') {
      await page.getByRole('button', { name: 'Sound and motion settings' }).click();
      await page.getByLabel('Mute all sound').check();
      await page.keyboard.press('Escape');
      const st = await S(page);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('one-more-room/settings')));
      check('mute toggle applies and persists', st.settings.muted && stored.muted);
    }
    await page.context().close();
  }

  // ── 5. Corrupt save and WebGL-unavailable states ─────────────────────
  if (run(5)) {
    const page = await newPage();
    await page.goto(URL);
    await page.evaluate((k) => localStorage.setItem(k, '{broken'), SAVE_KEY);
    await page.reload();
    await page.waitForTimeout(800);
    check('corrupt save shows a recoverable notice', (await page.locator('.notice').count()) === 1);
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByRole('button', { name: 'Clear saved game' }).click();
    check('clearing removes only the broken save', (await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) === null);
    await page.context().close();

    const noGl = await chromium.launch({ executablePath: CHROME, args: ['--disable-webgl', '--disable-3d-apis', '--disable-gpu'] });
    const p2 = await noGl.newPage();
    await p2.goto(URL);
    await p2.waitForTimeout(800);
    check('clear message when WebGL is unavailable', (await p2.locator('.nowebgl').count()) === 1);
    await p2.screenshot({ path: `${OUT}/30-no-webgl.png` });
    await noGl.close();
  }
} catch (e) {
  check('suite ran to completion', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
