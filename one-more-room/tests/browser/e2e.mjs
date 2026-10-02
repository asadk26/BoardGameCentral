// End-to-end checks that drive the real, built game in headless Chromium.
//
//   npm run build && node tests/browser/e2e.mjs
//
// Starts the room service (which also serves dist/) unless URL is set. Uses
// Playwright's Chromium (or CHROME=/path/to/chrome) with SwiftShader, so WebGL
// works without a GPU — slowly. Run one part with ONLY=1,3 etc.
// Screenshots land in test-results/ for a human to look over: a green run is
// not a substitute for looking at them, or for playing on real hardware.

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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let server = null;
let URL = process.env.URL;
if (!URL) {
  const port = process.env.PORT || '8795';
  URL = `http://localhost:${port}/`;
  server = spawn('node', ['dist-server/main.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: port } });
  await new Promise((r) => setTimeout(r, 1500));
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
    return { busy: s.busy, cameraMode: s.cameraMode, settings: s.settings, game: s.session?.game ?? null, seats: s.seats, modal: s.modal, ropePracticed: s.ropePracticed };
  });
const acting = (g) => g.schedule[g.slot];
const living = (g) => g.pieces.findIndex((p) => p.alive);
const arena = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__omrArena ?? {})));
async function settle(page, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await S(page)).busy) return;
    await page.waitForTimeout(100);
  }
}
async function clearStorage(page, query = '', settings = null) {
  await page.goto(URL + query);
  await page.evaluate((settings) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('one-more-room/')) localStorage.removeItem(k);
    if (settings) localStorage.setItem('one-more-room/settings', JSON.stringify(settings));
  }, settings);
  await page.reload();
}
/** Local game from the title screen with the default lineup (1 human + 3 bots), through traps and the life roll. */
async function startLocal(page) {
  await page.getByRole('button', { name: /Play on this screen|New game/ }).first().click();
  await page.getByRole('button', { name: /^Start/ }).click();
  await page.waitForTimeout(600);
  const show = page.getByRole('button', { name: /show the map/ });
  if (await show.count()) {
    await show.click();
    await page.getByRole('button', { name: 'Space 18', exact: true }).click();
    await page.getByRole('button', { name: /Set a trap/ }).click();
    await page.getByRole('button', { name: /Hide it/ }).click();
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Roll for life/ }).click();
  await settle(page);
  await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
}
/** Show a crafted position (local games only, via the test hook). */
async function craft(page, fn, arg) {
  await page.evaluate(
    ([src, arg]) => {
      const g = JSON.parse(JSON.stringify(window.__omr.getState().session.game));
      new Function('g', 'arg', src)(g, arg);
      window.__omr.setGame(g);
    },
    [fn, arg],
  );
  await page.waitForTimeout(400);
}
/** Keep pressing Jump (Space) like a person watching the rope, until the challenge is over. */
async function jumpThrough(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await S(page);
    if (st.game?.phase !== 'challenge') break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(600 + Math.floor(Math.random() * 150));
  }
  await settle(page);
}

try {
  // ── 1. One screen: four pieces by default, a whole match through the UI ─────
  if (run(1)) {
    const page = await newPage();
    await clearStorage(page, '?quality=low', { fastBots: true, musicVolume: 0, sfxVolume: 0, muted: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/01-title.png` });
    await page.getByRole('button', { name: /Play on this screen/ }).click();
    await page.waitForTimeout(400);
    check('setup defaults to four pieces: one human and three bots, labelled', (await page.locator('.lineup li').count()) === 4 && (await page.locator('.lineup li.is-bot').count()) === 3 && /1 human \+ 3 bots/.test(await page.getByRole('button', { name: /^Start/ }).innerText()));
    await page.getByRole('group', { name: 'Piece 2 is played by' }).getByRole('button', { name: 'HUMAN' }).click();
    check('a second person replaces a bot seat — still four pieces', (await page.locator('.lineup li').count()) === 4 && /2 humans \+ 2 bots/.test(await page.getByRole('button', { name: /^Start/ }).innerText()));
    await page.getByRole('group', { name: 'Piece 2 is played by' }).getByRole('button', { name: 'BOT' }).click();
    await page.screenshot({ path: `${OUT}/02-setup.png` });
    await page.getByRole('button', { name: /^Back/ }).click();
    await startLocal(page);
    let st = await S(page);
    check('the match starts with four pieces, three of them bots', st.game.pieces.length === 4 && st.seats.filter((x) => x.kind === 'bot').length === 3);
    const stats = { forks: 0, boardClicks: 0, keyPicks: 0, exact: 0, inexact: 0, challenges: 0, humanJumps: 0, autoNext: 0, rolls: 0 };
    const t0 = Date.now();
    let lastAction = -1;
    let shots = 0;
    while (Date.now() - t0 < 1500000) {
      st = await S(page);
      const g = st.game;
      if (!g || g.phase === 'gameOver') break;
      if (g.phase === 'challenge') {
        if (g.challenge.participants.includes(0)) {
          stats.challenges++;
          if (stats.challenges === 1) await page.waitForTimeout(1200), await page.screenshot({ path: `${OUT}/10-rope-ready.png` });
          const before = await arena(page);
          await jumpThrough(page);
          const after = await arena(page);
          if ((after[0]?.jumps ?? 0) > 0 || (before[0]?.jumps ?? 0) > 0) stats.humanJumps++;
        } else await page.waitForTimeout(300);
        continue;
      }
      // After an action of ours, check the move took exactly the roll.
      if (g.actionNumber !== lastAction && lastAction >= 0) lastAction = -1;
      const me = acting(g) === 0 && g.phase !== 'reward' ? 0 : -1;
      if (me !== 0 || st.busy) {
        await page.waitForTimeout(150);
        continue;
      }
      if (g.phase === 'turnStart') {
        stats.rolls++;
        if (stats.rolls === 1) await page.screenshot({ path: `${OUT}/03-my-turn.png` });
        await page.getByRole('button', { name: /^Roll/ }).click();
        await settle(page);
        continue;
      }
      if (g.phase === 'choose') {
        const remaining = g.move.remaining;
        const prompt = await page.locator('.bottom').innerText();
        const buttons = await page.locator('.fork-btn').count();
        if (!new RegExp(`${remaining} left`).test(prompt) || buttons < 1) check('a fork shows “N left · Choose a path” with numbered ways', false, prompt.slice(0, 80));
        stats.forks++;
        if (shots < 2) await page.screenshot({ path: `${OUT}/0${4 + shots++}-fork.png` });
        if (stats.boardClicks === 0) {
          // Pick a way by clicking its arrow on the board itself.
          const before = g.move.remaining;
          const arrows = await page.evaluate(() => window.__omr.forkArrows?.() ?? []);
          let advanced = false;
          if (arrows.length) {
            await page.mouse.click(arrows[0].x, arrows[0].y);
            await settle(page);
            const now = (await S(page)).game;
            advanced = now.phase !== 'choose' || now.move?.remaining !== before || now.pieces[0].node !== g.pieces[0].node;
          }
          if (advanced) stats.boardClicks++;
          else {
            await page.keyboard.press('1');
            stats.keyPicks++;
          }
        } else if (Math.random() < 0.5) {
          await page.keyboard.press(String(1 + Math.floor(Math.random() * buttons)));
          stats.keyPicks++;
        } else await page.locator('.fork-btn').nth(Math.floor(Math.random() * buttons)).click();
        await settle(page);
        const after = (await S(page)).game;
        if (after.phase !== 'choose' && after.actionNumber === g.actionNumber) {
          const walked = after.log.filter((e) => e.kind === 'move' && e.piece === 0).reduce((n, e) => n + e.path.length - 1, 0);
          if (walked === after.allowance) stats.exact++;
          else stats.inexact++;
        }
        continue;
      }
      if (g.phase === 'hunt') {
        const ch = page.locator('.encounter .btn.risky');
        if (await ch.count()) await ch.click();
        else await page.getByRole('button', { name: 'End turn' }).click();
        continue;
      }
      if (g.phase === 'pick') {
        await page.locator('.choices .btn').first().click();
        continue;
      }
      if (g.phase === 'reward') {
        await page.getByRole('button', { name: /^Take/ }).click();
        continue;
      }
      if (g.phase === 'summary') {
        // Routine turns move on by themselves.
        const n = g.actionNumber;
        await page.waitForTimeout(4200);
        const later = (await S(page)).game;
        if (later.actionNumber !== n || later.round !== g.round || later.phase === 'gameOver') stats.autoNext++;
        continue;
      }
      await page.waitForTimeout(150);
    }
    st = await S(page);
    check('a whole four-piece match reached the results through the UI', st.game?.phase === 'gameOver', `${Math.round((Date.now() - t0) / 1000)} s, ${JSON.stringify(stats)}`);
    check('exactly ten points were handed out', st.game.pieces.reduce((a, p) => a + p.score, 0) === 10);
    check('every move of ours walked exactly the number rolled', stats.exact > 0 && stats.inexact === 0, `${stats.exact} exact, ${stats.inexact} not`);
    check('forks were chosen on screen (board, keys and buttons)', stats.forks > 0 && stats.keyPicks + stats.boardClicks > 0);
    check('finished turns move on without a click', stats.autoNext > 0);
    await page.screenshot({ path: `${OUT}/09-results.png` });
    check('no console errors (local match)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 2. The rope on one screen: practice, real jumps, curse, four jumpers ─────
  if (run(2)) {
    const page = await newPage();
    await clearStorage(page, '?quality=low', { muted: true });
    await startLocal(page);
    // Piece 0 (the person) a ghost right next to the living bot.
    await craft(
      page,
      `g.pieces.forEach((p, i) => Object.assign(p, { alive: i === 1, node: [2, 1, 16, 24][i], streak: i === 1 ? 3 : 0, item: null, itemAwardedAt: null }));
       g.round = 2; g.schedule = [1, 0, 2, 3]; g.slot = 1;
       Object.assign(g, { phase: 'hunt', options: { living: true, sameSpace: [], versus: [], versusInactive: null }, challenge: null, lastOutcome: null, minigameUsed: false, log: [], move: null, die: 1, rollInfo: { kind: 'die' } });`,
    );
    await page.screenshot({ path: `${OUT}/11-challenge-offer.png` });
    check('a ghost next to the living piece is offered “Challenge … steal life”', /Challenge living • steal life/.test(await page.locator('.bottom').innerText()));
    await page.locator('.encounter .btn.risky').click();
    await page.waitForTimeout(1500);
    const ready = await page.locator('.arena-card').innerText();
    check('the first rope teaches in one line, and names the curse briefly', /Jump as the rope reaches your feet/.test(ready) && /Curse II: shorter jumps/.test(ready));
    check('the rope shows the real characters (one canvas arena) with their names', (await page.locator('.arena-view canvas').count()) === 1);
    await page.screenshot({ path: `${OUT}/12-rope-teach.png` });
    await page.keyboard.press('Space'); // ready
    await page.waitForTimeout(900);
    check('practice comes first, labelled and not scored', /Practice/.test(await page.locator('.arena-card').innerText()));
    // Press only in a calm moment of the rope cycle (feet on the floor, not stumbling,
    // well before the next pass) so slow software rendering can't shift the test.
    const calm = async () => {
      for (let i = 0; i < 80; i++) {
        const a = (await arena(page))[0];
        const sinceLast = a?.lastBottom == null ? Infinity : a.t - a.lastBottom;
        if (a && a.t > 0 && a.y === 0 && sinceLast > 450 && a.nextBottom != null && a.nextBottom - a.t > 700) return a;
        await page.waitForTimeout(40);
      }
      return (await arena(page))[0];
    };
    const a0 = await calm();
    await page.keyboard.press('Space');
    let a1 = a0;
    // Software WebGL draws a frame every few hundred ms; wait for the next drawn frame.
    for (const t0 = Date.now(); Date.now() - t0 < 2000 && (a1.t === a0.t || (a1.jumps === a0.jumps && a1.presses === a0.presses)); ) {
      await page.waitForTimeout(30);
      a1 = (await arena(page))[0];
    }
    // (Mid-air height is checked by the unit tests: software WebGL draws too rarely to sample it.)
    check('a press makes the character jump', a1.jumps === a0.jumps + 1 && a1.presses === a0.presses + 1, `frame gap ${Math.round(a1.t - a0.t)} ms`);
    await page.screenshot({ path: `${OUT}/13-rope-practice-jump.png` });
    // Holding the key (auto-repeat) and tapping mid-air add nothing.
    await page.waitForTimeout(700);
    const h0 = (await calm()).jumps;
    await page.keyboard.down('Space');
    for (let i = 0; i < 6; i++) await page.keyboard.down('Space'); // repeats while held
    await page.keyboard.up('Space');
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    let h = (await arena(page))[0];
    for (const t0 = Date.now(); Date.now() - t0 < 2000 && h.jumps === h0; ) {
      await page.waitForTimeout(30);
      h = (await arena(page))[0];
    }
    await page.waitForTimeout(400);
    const h1 = (await arena(page))[0].jumps;
    check('holding, key-repeat and mid-air taps make exactly one jump', h1 === h0 + 1, `${h0} → ${h1}`);
    await page.getByRole('button', { name: 'Skip practice' }).click().catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/14-rope-countdown.png` });
    const before = (await S(page)).game.challengeCount;
    await jumpThrough(page);
    const st = await S(page);
    check('the rope resolves and play goes on', st.game.phase !== 'challenge' && st.game.challengeCount === before && !st.game.challenge, `phase ${st.game.phase}`);
    // A second rope in the same match: no lesson, no practice.
    await craft(
      page,
      `g.pieces.forEach((p, i) => Object.assign(p, { alive: i === 1, node: [2, 1, 16, 24][i] }));
       g.schedule = [1, 0, 2, 3]; g.slot = 1;
       Object.assign(g, { phase: 'hunt', options: { living: true, sameSpace: [], versus: [], versusInactive: null }, challenge: null, lastOutcome: null, minigameUsed: false, log: [], move: null });`,
    );
    await page.locator('.encounter .btn.risky').click();
    await page.waitForTimeout(800);
    const second = await page.locator('.arena-card').innerText();
    check('later ropes skip the lesson', !/Jump as the rope reaches your feet/.test(second) && /when ready/.test(second));
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    check('…and the practice: straight to the countdown', !/Practice/.test(await page.locator('.arena-card').innerText()));
    await jumpThrough(page);
    // Four jumpers: walk onto the Super Reaper's Séance.
    await craft(
      page,
      `g.pieces.forEach((p, i) => Object.assign(p, { alive: i === 1, node: [11, 1, 16, 24][i] }));
       g.schedule = [1, 0, 2, 3]; g.slot = 1; g.seancesUsed = 0;
       Object.assign(g, { phase: 'choose', options: null, challenge: null, lastOutcome: null, minigameUsed: false, log: [], die: 1, allowance: 1, rollInfo: { kind: 'die' }, move: { remaining: 1, prev: null, path: [11], usedSecret: false, usedWall: false } });`,
    );
    await page.evaluate(() => (window.__omrArena = {}));
    await page.locator('.fork-btn', { hasText: 'Super Reaper' }).click();
    await page.waitForTimeout(3500);
    check('a Séance puts all four characters in the arena', /Séance/.test(await page.locator('.arena-card').innerText()) && Object.keys(await arena(page)).length === 4);
    await page.screenshot({ path: `${OUT}/15-rope-seance.png` });
    await jumpThrough(page);
    check('no console errors (rope)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 3. Items and ghost battles on one screen ────────────────────────────────
  if (run(3)) {
    const page = await newPage();
    await clearStorage(page, '?quality=low', { muted: true });
    await startLocal(page);
    const base = `g.pieces.forEach((p, i) => Object.assign(p, { alive: i === 1, node: arg.nodes[i], streak: 0, item: (arg.items ?? [])[i] ?? null, itemAwardedAt: (arg.items ?? [])[i] ? -1 : null }));
       g.round = 2; g.schedule = [1, 0, 2, 3]; g.slot = 1;
       Object.assign(g, { phase: 'turnStart', options: null, challenge: null, lastOutcome: null, minigameUsed: false, log: [], move: null, die: null, rollInfo: null, itemUsed: null, battlesThisRound: [], pendingReward: null });`;
    // Ghostly Stride: exactly six, no die.
    await craft(page, base, { nodes: [2, 16, 28, 24], items: ['ghostlyStride'] });
    await page.getByRole('button', { name: /Use Ghostly Stride/ }).click();
    await settle(page);
    let g = (await S(page)).game;
    check('Ghostly Stride moves exactly six with no die shown', g.rollInfo?.kind === 'stride' && g.allowance === 6 && /Ghostly Stride · 6 spaces/.test(await page.locator('.bottom').innerText()) && (await page.locator('.bottom .die').count()) === 0);
    await page.screenshot({ path: `${OUT}/20-stride.png` });
    // Second Roll: replaces the die before the first step.
    await craft(page, base + `Object.assign(g, { phase: 'choose', die: 2, allowance: 2, rollInfo: { kind: 'die' }, move: { remaining: 2, prev: null, path: [2], usedSecret: false, usedWall: false } });`, { nodes: [2, 16, 28, 24], items: ['secondRoll'] });
    await page.getByRole('button', { name: /Use Second Roll/ }).click();
    await settle(page);
    g = (await S(page)).game;
    check('Second Roll replaces the die and the move is exactly the new number', g.rollInfo?.rerolledFrom === 2 && g.move?.remaining === g.die && /Second Roll 2 →/.test(await page.locator('.bottom').innerText()));
    // Ghost Switch: swap onto a trap space, nothing triggers.
    await craft(page, base, { nodes: [2, 16, 21, 24], items: ['ghostSwitch'] });
    await page.locator('.item-use').first().click();
    await settle(page);
    g = (await S(page)).game;
    check('Ghost Switch swaps two ghosts and nothing triggers', g.phase === 'turnStart' && g.pieces[0].node !== 2 && g.traps.every((t) => !t.revealed));
    // Ghost battle won by the ghost called out; then keep or replace.
    await craft(page, base + `Object.assign(g, { phase: 'hunt', die: 1, rollInfo: { kind: 'die' }, options: { living: false, sameSpace: [2], versus: [], versusInactive: null } });`, { nodes: [3, 16, 3, 24] });
    check('landing on a ghost offers “Battle ghost • win an item”', /Battle ghost • win an item/.test(await page.locator('.bottom').innerText()));
    await page.locator('button.battle').first().click();
    await page.waitForTimeout(1200);
    check('the battle is shown as one on the TV arena', /Ghost battle/.test(await page.locator('.arena-card').innerText()));
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Skip practice' }).click().catch(() => {});
    await settle(page, 60000);
    for (let i = 0; i < 80 && (await S(page)).game.phase === 'challenge'; i++) await page.waitForTimeout(500); // the person never jumps: the bot wins
    g = (await S(page)).game;
    check('the defender won the battle and an item; nobody moved; life stayed put', g.lastOutcome?.winner === 2 && !!g.pieces[2].item && living(g) === 1 && g.pieces[0].node === 3);
    await craft(page, base + `Object.assign(g, { phase: 'reward', minigameUsed: true, pendingReward: { piece: 0, current: 'secondRoll', offered: 'ghostSwitch' } });`, { nodes: [3, 16, 3, 24], items: ['secondRoll'] });
    check('a different item asks “Keep or replace?”', /Keep or replace\?/.test(await page.locator('.bottom').innerText()));
    await page.getByRole('button', { name: /^Take/ }).click();
    await settle(page);
    check('taking the new item replaces the old one', (await S(page)).game.pieces[0].item === 'ghostSwitch');
    await page.getByRole('button', { name: 'Help' }).click();
    const rules = await page.locator('.rules').innerText();
    check('Help explains exact moves, forks, the jump rope, the curse and items', /exactly/.test(rules) && /fork/.test(rules) && /Curse/.test(rules) && /Second Roll 40%/.test(rules) && !/stay where/.test(rules));
    await page.keyboard.press('Escape');
    check('no console errors (items)', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await page.context().close();
  }

  // ── 4. Phones: lineup fills with bots; phones choose paths and press Jump ──
  if (run(4) && server) {
    const tv = await newPage({ width: 1440, height: 900 });
    await tv.goto(URL + '?quality=low');
    await tv.evaluate(() => localStorage.setItem('one-more-room/settings', JSON.stringify({ muted: true })));
    await tv.getByRole('button', { name: 'Host a phone room' }).click();
    await tv.locator('.room-code').waitFor({ timeout: 15000 });
    const code = (await tv.locator('.room-code').innerText()).trim();
    const joinUrl = await tv.locator('.join-url').innerText();
    check('the TV shows a room code, a QR code and a LAN join link (not localhost)', /^[A-Z]{4}$/.test(code) && (await tv.locator('img.qr').count()) === 1 && !/localhost|127\.0\.0\.1/.test(joinUrl), joinUrl);
    check('an empty room already shows four pieces, all bots', (await tv.locator('.lineup li.is-bot').count()) === 4);
    const phones = {};
    for (const name of ['Ana', 'Ben', 'Cy']) {
      const p = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
      await p.goto(URL + '#/join?room=' + code);
      await p.getByLabel('Your name').fill(name);
      await p.getByRole('button', { name: 'Join' }).click();
      await p.locator('.pchars').waitFor();
      phones[name] = p;
    }
    await tv.getByRole('button', { name: /Advanced/ }).click();
    await tv.getByRole('radio', { name: 'Teams of two' }).click();
    await phones.Ana.getByRole('button', { name: /^Witch/ }).click();
    await phones.Cy.getByRole('button', { name: /^Knight/ }).click();
    await phones.Ben.getByRole('button', { name: /Join Ana’s Witch/ }).click();
    await tv.waitForTimeout(600);
    await tv.screenshot({ path: `${OUT}/30-tv-lobby.png` });
    await phones.Ben.screenshot({ path: `${OUT}/31-phone-lobby.png` });
    check('three phones (a pair and a solo) leave two bot seats: still four pieces', (await tv.locator('.lineup li').count()) === 4 && (await tv.locator('.lineup li.is-bot').count()) === 2 && /2 humans \+ 2 bots/.test(await tv.getByRole('button', { name: /^Start/ }).innerText()));
    await tv.getByRole('button', { name: /^Start/ }).click();
    await phones.Ana.waitForTimeout(800);
    for (const [p, n] of [[phones.Ana, 26], [phones.Cy, 18]]) {
      await p.getByRole('button', { name: `Space ${n}`, exact: true }).click();
      await p.getByRole('button', { name: /Hide it on/ }).click();
    }
    for (const p of Object.values(phones)) await p.getByRole('button', { name: 'Got it' }).click().catch(() => {});
    const pieceOf = (g, name) => (name === 'Cy' ? g.pieces.findIndex((x) => x.name === 'Cy') : g.pieces.findIndex((x) => x.name.startsWith('Ana')));
    const controller = (g, piece) => {
      const ana = pieceOf(g, 'Ana');
      if (piece === ana) return g.round % 2 === 1 ? phones.Ana : phones.Ben;
      if (piece === pieceOf(g, 'Cy')) return phones.Cy;
      return null;
    };
    const seen = { forkPhone: false, jumpPhone: false, tvJump: false, reload: false, teammate: false, delays: [] };
    const t0 = Date.now();
    while (Date.now() - t0 < 900000) {
      const g = (await S(tv)).game;
      if (!g || g.phase === 'placement' || g.phase === 'lifeRoll') {
        await tv.waitForTimeout(400);
        continue;
      }
      if (g.phase === 'gameOver' || (g.round > 3 && seen.jumpPhone && seen.forkPhone)) break;
      if (g.phase === 'challenge') {
        for (const piece of g.challenge.participants) {
          const p = controller(g, piece);
          if (!p) continue;
          const btn = p.locator('.pjump');
          if (!(await btn.count())) continue;
          if (!seen.jumpPhone) {
            seen.jumpPhone = true;
            const body = await p.locator('body').innerText();
            check('during a rope the phone shows only a name and one Jump button — no rope', (await p.locator('canvas').count()) === 0 && (await p.locator('button').count()) === 1 && body.length < 120, body.replace(/\s+/g, ' '));
            await p.screenshot({ path: `${OUT}/33-phone-jump.png` });
          }
          if (!seen.reload) {
            seen.reload = true;
            await p.reload();
            await p.locator('.pjump').waitFor({ timeout: 15000 }).catch(() => {});
            check('a phone reloaded mid-rope gets its Jump button back', (await p.locator('.pjump').count()) === 1);
          }
          // Press, and time how soon the TV shows the jump.
          const before = (await arena(tv))[piece]?.jumps ?? 0;
          const t = Date.now();
          await p.locator('.pjump').dispatchEvent('pointerdown');
          for (let i = 0; i < 40; i++) {
            const a = (await arena(tv))[piece];
            if (a && a.jumps > before) {
              seen.tvJump = true;
              seen.delays.push(Date.now() - t);
              break;
            }
            await tv.waitForTimeout(25);
          }
        }
        if (seen.tvJump && !seen.tvShot) {
          seen.tvShot = true;
          await tv.screenshot({ path: `${OUT}/34-tv-rope-from-phones.png` });
        }
        await tv.waitForTimeout(500);
        continue;
      }
      const piece = g.phase === 'reward' ? g.pendingReward.piece : acting(g);
      const p = controller(g, piece);
      if (p) {
        if (piece === pieceOf(g, 'Ana') && !seen.teammate) {
          const idle = g.round % 2 === 1 ? phones.Ben : phones.Ana;
          await tv.waitForTimeout(500);
          const txt = await idle.locator('body').innerText();
          if (/teammate’s turn/.test(txt)) {
            seen.teammate = true;
            check('the inactive teammate sees “Your teammate’s turn” and no controls', (await idle.locator('.pbtn.primary').count()) === 0);
          }
        }
        const roll = p.getByRole('button', { name: /^Roll/ });
        const arrows = p.locator('.parrow');
        if (await arrows.count()) {
          if (!seen.forkPhone) {
            seen.forkPhone = true;
            const tvWays = await tv.locator('.fork-btn').count();
            check('the phone shows the same numbered ways as the TV', (await arrows.count()) === tvWays && tvWays > 0, `${await arrows.count()} vs ${tvWays}`);
            await p.screenshot({ path: `${OUT}/32-phone-fork.png` });
          }
          await arrows.nth(Math.floor(Math.random() * (await arrows.count()))).click().catch(() => {});
        } else if (await roll.count()) await roll.click().catch(() => {});
        else {
          const any = p.locator('.encounter .pbtn, .pbtn.primary').first();
          if (await any.count()) await any.click().catch(() => {});
        }
      }
      await tv.waitForTimeout(400);
    }
    const fin = (await S(tv)).game;
    check('phones chose paths at forks', seen.forkPhone);
    check('a phone’s Jump press made its character jump on the TV', seen.tvJump, `press → TV ${seen.delays.length ? Math.min(...seen.delays) + '–' + Math.max(...seen.delays) : '?'} ms (browser polling on one machine; not real Wi-Fi)`);
    check('room scores equal completed rounds; one living piece', fin.pieces.reduce((a, q) => a + q.score, 0) === (fin.phase === 'gameOver' ? 10 : fin.round - 1) && fin.pieces.filter((q) => q.alive).length === 1);
    await tv.screenshot({ path: `${OUT}/35-tv-room-game.png` });
    await phones.Cy.screenshot({ path: `${OUT}/36-phone-watch.png` });
    check('the phone controller has no horizontal overflow', await phones.Ana.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const all = [tv, ...Object.values(phones)];
    check('no console errors (rooms)', all.every((q) => q.errors.filter((e) => !/WebSocket/.test(e)).length === 0), all.flatMap((q) => q.errors).slice(0, 3).join(' | '));
    for (const q of all) await q.context().close();
  }

  // ── 5. Screen sizes and failure states ───────────────────────────────
  if (run(5)) {
    for (const vp of [
      { width: 1920, height: 1080, name: 'tv' },
      { width: 1440, height: 900, name: 'laptop' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 390, height: 844, name: 'mobile' },
    ]) {
      const page = await newPage({ width: vp.width, height: vp.height }, { reducedMotion: vp.name === 'tablet' ? 'reduce' : 'no-preference' });
      await clearStorage(page, '?quality=low');
      await startLocal(page);
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
        await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('button', { name: /Sound & motion/ }).click();
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
      check('static hosting: hosting a room explains the missing service and shows no join code or QR', /no room service/.test(lobby) && (await sp.locator('.room-lobby img.qr, .room-code').count()) === 0);
      await sp.context().close();
      const sl = await newPage();
      await sl.goto(PAGES + '?quality=low');
      await startLocal(sl);
      check('static hosting: one-screen play with bots starts a four-piece game', (await S(sl)).game?.pieces.length === 4);
      await sl.context().close();
      const sj = await newPage({ width: 390, height: 844 });
      await sj.goto(PAGES + '#/join');
      await sj.waitForTimeout(1500);
      check('static hosting: the Join page says phone rooms need the service', /not connected to one/.test(await sj.locator('body').innerText()));
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

  // ── 6. Every space, both cameras: the active piece stays in view ────────────
  if (run(6)) {
    const page = await newPage({ width: 1280, height: 800 });
    await clearStorage(page, '?quality=low', { muted: true });
    await startLocal(page);
    await page.evaluate(() => window.__omr.getState().seats.forEach((s) => (s.kind = 'human')));
    const off = [];
    for (const mode of ['follow', 'overview']) {
      if ((await S(page)).cameraMode !== mode) {
        await page.keyboard.press('v');
        await page.waitForTimeout(900);
      }
      for (let n = 0; n < 32; n++) {
        await craft(
          page,
          `const n = arg.n; const others = [n === 16 ? 0 : 16, n === 8 ? 24 : 8, n === 24 ? 8 : 24].map((x) => (x === n ? (n + 10) % 32 : x));
           g.pieces.forEach((p, i) => Object.assign(p, { alive: i === 1, node: i === 0 ? n : others[i - 1], facingFrom: n === 0 ? null : (n + 31) % 32 }));
           if ([4, 12, 16, 20, 28].includes(n)) g.pieces[2].node = n;
           g.schedule = [1, 0, 2, 3]; g.slot = 1;
           Object.assign(g, { phase: 'turnStart', move: null, die: null, rollInfo: null, options: null, challenge: null, log: [], lastOutcome: null });`,
          { n },
        );
        await page.waitForTimeout(mode === 'follow' ? 1700 : 500);
        const p = await page.evaluate((n) => window.__omr.project(n), n);
        if (!p.visible) off.push(`${mode}:${n}`);
        await page.screenshot({ path: `${OUT}/60-${mode}-${String(n).padStart(2, '0')}.png` });
      }
    }
    check('the active piece’s space is on screen at all 32 spaces in both cameras (look at test-results/60-*.png too)', off.length === 0, off.join(','));
    await page.context().close();
  }
} catch (e) {
  check('suite ran to completion', false, e.message.split('\n')[0] + ' @ ' + (e.stack.split('\n').find((l) => l.includes('e2e.mjs')) ?? '').trim());
} finally {
  await browser.close();
  server?.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
