// ホーム「今日やること」（PRD D141〜D145。ADR-0025・ADR-0053）を本物のブラウザで確かめる：
// 起動（#/・知らない URL）でホームへ、ほかの画面の URL（人の画面など）はそのまま、カードの並び（作業の順。PRD D263：要対応 →
// 月ごとに担当を AI で組む → 確定していない日（今月 → 来月）→ 今日）・先頭の「まずこれ」・同じ月の「担当なしの訪問がある日 N日」は
// 組むカードだけ、今日のカードで日の画面（選んでいる日付が今日）、「担当を AI で組む」のカードで月の画面の欄が開き ?do= が消える、
// 月の画面の ?do=attention・?do=unconfirmed で右の欄、確定したらホームの今日のカードが「確定済み」に、
// いつでもの入口（欠勤・空き状況・探す）、何も無いデータで「今日の準備はできています」、
// メニューの先頭の「ホーム」（1400px）、スマホ（390×844）で縦に並び横にはみ出さない・先頭に欠勤・キャンセルの入口（PRD D247）・下のタブの「ホーム」、印刷で出さない。
// 初期データ（版2。今日から7日分に担当が入り、まだ伝えていない）、月の「問題の無い日をまとめて確定」
// （PRD D223。N日・確認に日付と残す日・確定済みになりホームの数が減る・担当が休みの訪問のある日は外れ確認に日付が出る・
// 未連絡の変更のある日は外れる・0日なら押せず理由）、確定した日の「次の確定していない日へ」（PRD D224）、
// 訪問の無い人の欠勤は要対応に数えない。
//
// 使い方：npm run build && npx vite preview --port 4183 のあとで node scripts/e2e-home.cjs
// 環境変数は scripts/lib/env.cjs（PLAYWRIGHT・CHROMIUM・BASE・OUT_DIR・FAKE_NOW）
// 終了コード：全部通れば 0、通らないものがあれば 1。ページのエラー（pageerror）も失敗に数える
const path = require('node:path');
const { answerConfirms } = require('./lib/confirmDialog.cjs');
const { BASE, OUT_DIR, NOW, TODAY, STORAGE_KEY, check, hashOf, runSteps, settle } = require('./lib/env.cjs');
const { sharedPage, openPage } = require('./lib/steps.cjs');

const YM = TODAY.slice(0, 7);

/** 並びの順（PRD D263）：要対応 → 月ごとに（作る → 確認）→ 今日。月は題名の「N月」から（今月 → 来月） */
const RANK = { attention: 0, create: 1, confirm: 2, today: 9 };
/** カードの並びの鍵：要対応は先頭、今日は最後、そのほかは 月 → 作る・確認 の順（年をまたぐ月は今月より後に数える） */
function orderKey(t, ym = YM) {
  // 組み方の標準を登録していなければ、その案内がいちばん先（PRD D354）
  if (t.kind === 'standard') return -1;
  if (t.kind === 'attention') return 0;
  if (t.kind === 'today') return 1e6;
  const m = Number(/(\d+)月/.exec(t.title)?.[1] ?? 0);
  const base = Number(ym.slice(5, 7));
  const rel = (m - base + 12) % 12;
  return 10 + rel * 10 + RANK[t.kind];
}
/** d から n 日後（YYYY-MM-DD） */
function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** 初期データに案が入る日（今日から7日。PRD D225） */
const SEED_DAYS = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));
/**
 * 初期データの担当・まとめて確定を確かめる月：今月に初期データで組んだ日が3日以上あれば今月、無ければ（月末）翌月
 * （月末の日は今月の組んだ日が今日だけになり、問題のある日・未連絡の変更のある日・確定する日を作れないため）
 */
const SYM = SEED_DAYS.filter((d) => d.slice(0, 7) === YM).length >= 3 ? YM : SEED_DAYS[6].slice(0, 7);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
/** 「10/22（木）」（アプリの lib/confirmDay の dayLabel と同じ） */
const dayLabel = (d) =>
  `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}）`;

/**
 * 画面を新しく開く。同じ文書の中で hash を移すと、読み直す前に `?do=` が処理されて消えることがあるので、
 * いったん about:blank に移ってから開く（読み直しはしない）。固定の秒数で待たず、目印と見出しの文が出るのを待つ
 */
async function open(page, hash, ready = '[data-testid="home-tasks"]') {
  await page.goto('about:blank');
  await page.goto(`${BASE}#${hash}`);
  await page.locator(ready).first().waitFor({ timeout: 30000 });
  await page.locator('h1').filter({ hasText: /\S/ }).first().waitFor({ timeout: 30000 });
}
/** 文が出るまで待つ（出なければ時間切れで続け、呼ぶ側の check で落とす） */
async function waitText(locator, text, timeout = 10000) {
  await locator
    .filter({ hasText: text })
    .first()
    .waitFor({ timeout })
    .catch(() => {});
}
/** 次の一手のカード（種類・色・題名） */
async function tasks(page) {
  return page.getByTestId('home-task').evaluateAll((els) =>
    els.map((el) => ({
      kind: el.dataset.kind,
      tone: el.dataset.tone,
      title: el.querySelector('strong').textContent,
    })),
  );
}

/**
 * 先頭の「まずこれ」（PRD D263）：先頭の1枚だけが幅いっぱい・主ボタンの塗りで札「まずこれ」。ほかのカードは今のまま。
 * 同じ月の「担当なしの訪問がある日 N日」は組むカードにだけ書く
 */
async function checkLead(page, list) {
  const lead = await page.locator('[data-testid="home-task"][data-lead]').evaluateAll((els) =>
    els.map((el) => {
      const li = el.closest('li').getBoundingClientRect();
      const ul = el.closest('ul').getBoundingClientRect();
      return {
        first: el.closest('li') === el.closest('ul').firstElementChild,
        full: Math.abs(li.width - ul.width) <= 2,
        badge: el.querySelector('[data-testid="home-lead"]')?.textContent,
        warn: el.dataset.tone === 'warn',
        warnBadge: el.querySelector('[data-testid="home-lead-warn"]')?.textContent ?? null,
        bg: getComputedStyle(el).backgroundColor,
      };
    }),
  );
  const want = list[0] && list[0].tone !== 'info' ? 1 : 0;
  check(
    lead.length === want && lead.every((x) => x.first && x.full && x.badge === 'まずこれ'),
    '先頭の1枚だけ「まずこれ」（幅いっぱい・札）。知らせだけなら出さない',
    lead,
  );
  check(
    lead.every((x) => (x.warn ? x.warnBadge === '要対応' : x.warnBadge === null)),
    '「まずこれ」が要対応なら要対応の印（札「要対応」）を残す',
    lead,
  );
  const months = [...new Set(list.map((t) => /^(\d+)月/.exec(t.title)?.[1]).filter(Boolean))];
  const dup = [];
  for (const m of months) {
    const same = await page
      .locator('[data-testid="home-task"]')
      .filter({ has: page.locator('strong', { hasText: new RegExp(`^${m}月`) }) })
      .evaluateAll((els) =>
        els.filter((el) => /担当なしの訪問がある日 \d+日/.test(el.textContent)).map((el) => el.dataset.kind),
      );
    if (same.length > 1) dup.push({ m, same });
  }
  check(dup.length === 0, '同じ月の「担当なしの訪問がある日 N日」は作るカードにだけ書く（PRD D263）', dup);
}

async function start(page) {
  await open(page, '/');
  check(hashOf(page) === '#/home', '起動（#/）でホームへ', hashOf(page));
  check((await page.locator('h1').innerText()) === 'ホーム', '見出し「ホーム」（メニューの名前と同じ。PRD D230）');
  check(
    (await page.locator('.page-lead').first().innerText()).startsWith('今日やること'),
    '見出しの下の文は「今日やること」から',
  );
  await open(page, '/nowhere');
  check(hashOf(page) === '#/home', '知らない URL もホームへ', hashOf(page));
  await open(page, '/staff/s1', '[data-testid="person-view"]');
  check(hashOf(page).startsWith('#/staff/s1'), 'ほかの画面の URL（人の画面）はそのまま', hashOf(page));
  await open(page, '/schedule', '.app-header');
  check(hashOf(page).startsWith('#/plan'), '古い #/schedule は今までどおり日の予定へ', hashOf(page));
}

/** 保存したデータを消して初期データから始める */
async function reset(page) {
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

/** 担当なしの訪問がある月（作るカードの月。無ければ null） */
function createMonthOf(list) {
  const t = list.find((x) => x.kind === 'create');
  const m = t && /^(\d+)月の担当を AI で組む$/.exec(t.title);
  if (!m) return null;
  const mm = Number(m[1]);
  const y = Number(YM.slice(0, 4)) + (mm < Number(YM.slice(5, 7)) ? 1 : 0);
  return { ym: `${y}-${String(mm).padStart(2, '0')}`, title: t.title };
}

async function firstState(page) {
  // 初期データ：今日から7日は担当が入っている（まだ伝えていない）。繰り返しの回は繰り返しの担当で最初から入る（版2。ADR-0053）
  await reset(page);
  await open(page, '/home');
  const list = await tasks(page);
  const keys = list.map((t) => orderKey(t));
  check(
    keys.every((k, i) => i === 0 || keys[i - 1] <= k),
    '並び：組み方の標準 → 要対応 → 月ごとに担当を組む → 確定していない日（今月 → 来月）→ 今日（PRD D263）',
    list,
  );
  await checkLead(page, list);
  const today = list.find((t) => t.kind === 'today');
  check(!!today && /（まだ伝えていない）/.test(today.title), '今日のカード：まだ伝えていない', today);
  const todayText = await page.locator('[data-kind="today"] .sub').innerText();
  check(/^訪問 \d+件・担当 \d+人・要対応 \d+件/.test(todayText), '今日の要約：訪問・担当・要対応', todayText);
  const create = createMonthOf(list);
  check(!!create, '担当なしの日が多い月の「N月の担当を AI で組む」のカード', list);
  check(
    !(await page
      .getByTestId('home-ready')
      .isVisible()
      .catch(() => false)),
    'やることがあるので「準備はできています」は出さない',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-first.png'), fullPage: true });

  if (create) {
    // 「担当を AI で組む」→ 月の画面で欄が開き、?do= は消える
    await page.getByTestId('home-task').filter({ hasText: create.title }).click();
    await page.waitForURL(/#\/month/);
    const panel = page.getByRole('dialog', { name: create.title });
    await panel.waitFor({ timeout: 10000 });
    check(true, '担当を AI で組むの欄が開く');
    await settle(page, 300);
    // カードは変更のモードで開く（?mode=change は残る。PRD D348）
    check(
      hashOf(page) === `#/month?ym=${create.ym}&mode=change` &&
        (await page.getByTestId('mode-switch').getAttribute('data-mode')) === 'change',
      '月の予定：?ym= の月を変更のモードで、?do= は消える',
      hashOf(page),
    );
    await page.goBack();
    await settle(page, 500);
    check(hashOf(page) === '#/home', '戻るでホームへ（?do= を残さないので欄を繰り返し開かない）', hashOf(page));
  }

  // 今日のカード → 日の画面（今日）
  await open(page, '/home');
  await page.locator('[data-testid="home-task"][data-kind="today"]').click();
  await page.waitForURL(/#\/plan/);
  await page.getByTestId('confirm-state').waitFor({ timeout: 60000 });
  const picked = await page.locator('.date-switch select').inputValue();
  check(picked === TODAY, '今日のカード：日の予定で今日を選んでいる', picked);
  // 今月のカードだけ見る（15日以降は来月のカードも並ぶ。PR #38 のレビュー。PRD D255）
  await open(page, '/home');
  const MONTH = Number(YM.slice(5, 7));
  const confTitle = `${MONTH}月の確定していない日`;
  const confDays = async () => {
    const t = (await tasks(page)).find((x) => x.kind === 'confirm' && x.title.startsWith(confTitle));
    const m = t && /確定していない日 (\d+)日/.exec(t.title);
    return m ? Number(m[1]) : 0;
  };
  const n2 = await confDays();
  check(n2 >= 1, '確定していない日のカード', n2);
  const confCard = page.locator('[data-kind="confirm"]').filter({ hasText: confTitle });
  if (n2 >= 2) {
    // カード → 月の画面の右の欄。同じ日数が並び、帯の確定していない日数も同じ
    await confCard.click();
    await page.waitForURL(/#\/month/);
    await page.getByTestId('month-unconfirmed').waitFor({ timeout: 10000 });
    await settle(page, 300);
    const listed = await page.getByTestId('month-unconfirmed').locator('li').count();
    const band = Number(await page.getByTestId('band-confirm').getAttribute('data-unconfirmed'));
    check(listed === n2 && band === n2, 'ホームの日数＝月の右の欄の日数＝帯の確定していない日数', {
      home: n2,
      listed,
      band,
    });
  } else {
    await confCard.click();
    await page.waitForURL(/#\/plan/);
    await page.locator('[data-testid="progress-band"][data-ym]').waitFor({ timeout: 30000 });
    const picked2 = await page.locator('.date-switch select').inputValue();
    const band = Number(await page.getByTestId('band-confirm').getAttribute('data-unconfirmed'));
    check(picked2 === TODAY && band === 1, '確定していない日が1日だけ：日の予定のその日へ（帯も1日）', {
      picked: picked2,
      band,
    });
  }
  // 確定すると今日のカードは「確定済み」、確定していない日は1日減る
  await page.goto(`${BASE}#/plan`);
  await page.getByTestId('adopt').click();
  await settle(page, 400);
  await open(page, '/home');
  const today3 = (await tasks(page)).find((t) => t.kind === 'today');
  check(!!today3 && /（確定済み）/.test(today3.title), '確定したら今日のカードは「確定済み」', today3);
  const after = await confDays();
  check(after === n2 - 1, '確定したら確定していない日は1日減る', { after, n2 });
  check(
    (await page.getByTestId('home-anytime').locator('a').count()) === 4,
    'いつでもの入口が4つ（固定の data-testid）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-after.png'), fullPage: true });
}

/** その月（既定は今月）の日のマスの状態（日付 → data-state） */
async function cellStates(page, ym = YM) {
  await open(page, `/month?ym=${ym}&layout=calendar`, '[data-testid="month-day"]');
  await page.locator('[data-testid="month-aside"]').waitFor();
  return page
    .locator('[data-testid="month-day"]')
    .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.date, e.dataset.state])));
}

/** ホームのその月（既定は今月）の「確定していない日」の日数（カードが無ければ 0） */
async function homeConfirmDays(page, ym = YM) {
  await open(page, '/home');
  const title = `${Number(ym.slice(5, 7))}月の確定していない日`;
  const t = (await tasks(page)).find((x) => x.kind === 'confirm' && x.title.startsWith(title));
  const m = t && /確定していない日 (\d+)日/.exec(t.title);
  return m ? Number(m[1]) : 0;
}

/** データで、その日に担当のある〈スタッフ〉（保存した訪問の担当と、その曜日の繰り返しの担当） */
function busyStaff(data, d) {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  const busy = new Set();
  for (const v of data.visits) if (v.date === d && !v.cancelled && v.staffId) busy.add(v.staffId);
  for (const p of data.patterns)
    if (p.usualStaffId && p.weekdays.includes(wd) && p.from <= d && (!p.to || p.to >= d)) busy.add(p.usualStaffId);
  return busy;
}
/** 別のタブで localStorage のデータを読み、node の中で書き換えて書き戻す（fn の戻り値を返す） */
async function editInOtherTab(page, fn) {
  const other = await page.context().newPage();
  await other.goto(`${BASE}#/data`);
  const data = await other.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
  const out = fn(data);
  await other.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: STORAGE_KEY, v: JSON.stringify(data) });
  await other.close();
  return out;
}

/**
 * 初期データの担当（PRD D225）・問題の無い日をまとめて確定（D223）・次の確定していない日へ（D224）。
 * 確認ダイアログを開いたまま見るので、自動で答えない別のページで確かめる（同じ文脈なので localStorage は同じ）
 */
async function seedPlans(page) {
  await reset(page);
  const p = await page.context().newPage();
  await p.clock.setFixedTime(NOW);
  const native = [];
  p.on('dialog', (d) => {
    native.push(d.message());
    d.dismiss();
  });
  try {
    await p.setViewportSize({ width: 1440, height: 1000 });
    // 確かめる月（SYM）：ふだんは今月、月末は翌月
    const inMonth = SEED_DAYS.filter((d) => d.slice(0, 7) === SYM);
    const states = await cellStates(p, SYM);
    check(
      inMonth.length > 0 && inMonth.every((d) => states[d] === 'none' || states[d] === 'empty'),
      '初めて開くと今日から7日分（今月の分）の日のマスは「まだ伝えていない」（確定はしない）',
      inMonth.map((d) => `${d}:${states[d]}`),
    );
    const stored = await p.evaluate(
      ({ k, days, today }) => {
        const d = JSON.parse(localStorage.getItem(k));
        const saved = d.visits.filter((v) => days.includes(v.date) && !v.cancelled);
        return {
          version: d.version,
          snapshots: Object.keys(d.snapshots).filter((x) => x >= today).length,
          past: Object.keys(d.snapshots).filter((x) => x < today).length,
          saved: saved.length,
          assigned: saved.filter((v) => v.staffId).length,
          usual: d.patterns.filter((x) => x.usualStaffId).length,
          patterns: d.patterns.length,
          old: ['aiPlans', 'manualPlans', 'aiRuns'].filter((x) => x in d),
        };
      },
      { k: STORAGE_KEY, days: SEED_DAYS, today: TODAY },
    );
    check(
      stored.version === 2 &&
        stored.snapshots === 0 &&
        stored.past > 0 &&
        stored.old.length === 0 &&
        stored.saved > 0 &&
        stored.assigned >= stored.saved * 0.8 &&
        stored.usual >= stored.patterns * 0.5,
      '初期データ（版2）：今日から7日は組んだ担当を保存し（変わった回だけ）、繰り返しは繰り返しの担当を持つ。過去の日は伝えた状態・今日からは伝えていない',
      stored,
    );
    await p.screenshot({ path: path.join(OUT_DIR, 'month-first-run-1440.png'), fullPage: true });
    // ホーム：今日のカードはまだ伝えていない、確定していない日は今日以降の訪問のある日
    const unconfirmed = Object.entries(states).filter(
      ([d, st]) => d >= TODAY && d.slice(0, 7) === SYM && st !== 'empty' && st !== 'told',
    ).length;
    const n0 = await homeConfirmDays(p, SYM);
    check(
      n0 === unconfirmed && n0 >= inMonth.filter((d) => states[d] !== 'empty').length,
      '初めて開いたホームの確定していない日＝月の今日以降の確定していない日数',
      { home: n0, month: unconfirmed },
    );

    // 別のタブで、今日の次の日の担当1人を終日の欠勤にする（担当が休みの訪問＝要対応）。
    // もう1日（今月の最後の日）は伝えた内容を今と違うものにする（未連絡の変更あり）
    const bad = inMonth.find((d) => d > TODAY && states[d] !== 'empty') ?? inMonth[0];
    const rest = inMonth.filter((d) => d !== bad && d !== TODAY && states[d] !== 'empty');
    const changed = rest.length >= 2 ? rest[rest.length - 1] : null;
    const sid = await editInOtherTab(p, (data) => {
      const s = [...busyStaff(data, bad)][0];
      data.absences = [
        ...data.absences,
        { id: 'e2e-home-absent', staffId: s, date: bad, from: null, to: null, note: '' },
      ];
      // 伝えた内容に訪問が1件も無い（今の担当はどれも「入る」＝未連絡の変更あり）
      if (changed) data.snapshots[changed] = { date: changed, at: 1, visits: [] };
      return s;
    });
    check(!!sid, '欠勤にする担当のいる日がある', { bad, sid });
    const good = inMonth.filter((d) => d !== bad && d !== changed && states[d] !== 'empty');

    // 要対応がある：先頭は要対応のカードで「まずこれ」と札「要対応」（PRD D263）
    await open(p, '/home');
    await p.locator('[data-kind="attention"]').first().waitFor({ timeout: 30000 });
    const withAttention = await tasks(p);
    // 組み方の標準の案内（登録していないとき）の次が要対応
    const firstWork = withAttention.find((t) => t.kind !== 'standard');
    check(firstWork?.kind === 'attention', '要対応があれば（標準の案内の次の）先頭は要対応のカード', withAttention);
    await checkLead(p, withAttention);

    // 月の右の欄の「確定していない日」：問題の無い日をまとめて確定（N日）。要対応の訪問のある日は数えない
    await open(p, `/month?ym=${SYM}&do=unconfirmed`, '[data-testid="month-unconfirmed"]');
    const btn = p.getByTestId('month-confirm-bulk');
    await btn.waitFor({ timeout: 10000 });
    await settle(p, 500);
    const targets = Number(await btn.getAttribute('data-count'));
    const now = await p
      .locator('[data-testid="month-day"]')
      .evaluateAll((els) =>
        Object.fromEntries(els.map((e) => [e.dataset.date, e.closest('td')?.classList.contains('is-care') ?? false])),
      );
    // 初期データでも担当の決まらない訪問のある日（要対応）はまとめて確定に入らない
    const okDays = good.filter((d) => !now[d]);
    check(
      targets === okDays.length && (await btn.innerText()).includes(`問題の無い日をまとめて確定（${targets}日）`),
      'まとめて確定：問題の無い日の数（担当が休みの訪問のある日・未連絡の変更のある日は数えない）',
      { targets, okDays, good, care: now },
    );
    if (targets > 0) {
      await btn.click();
      const dlg = p.getByTestId('confirm-dialog');
      await dlg.waitFor({ timeout: 5000 });
      const title = await p.getByTestId('confirm-title').innerText();
      const body = await p.getByTestId('confirm-body').innerText();
      check(
        title === `問題の無い ${targets}日を確定しますか？` &&
          okDays.every((d) => body.includes(dayLabel(d))) &&
          body.includes(`計 ${targets}日`),
        'まとめて確定の確認：見出しと日付（「10/22（木）・… 計 N日」）',
        { title, body },
      );
      check(
        body.includes(dayLabel(bad)) && /問題のある \d+日は残します/.test(body),
        'まとめて確定の確認：問題のある日は残し、日付を出す',
        body,
      );
      check(
        changed === null || body.includes('未連絡の変更のある 1日も残します'),
        'まとめて確定の確認：未連絡の変更のある日は残す',
        { changed, body },
      );
      check(
        (await p.evaluate(() => document.activeElement?.dataset.testid)) === 'confirm-cancel',
        'まとめて確定の確認：最初のフォーカスは取り消し（独自の確認）',
      );
      await settle(p, 400);
      await p.screenshot({ path: path.join(OUT_DIR, 'month-confirm-dialog.png') });
      // 取り消すと何も変わらない
      await p.getByTestId('confirm-cancel').click();
      await dlg.waitFor({ state: 'detached' });
      check(
        (await p.evaluate(
          ({ k, today }) => Object.keys(JSON.parse(localStorage.getItem(k)).snapshots).filter((x) => x >= today).length,
          { k: STORAGE_KEY, today: TODAY },
        )) === (changed ? 1 : 0),
        'まとめて確定の確認を取り消すと何も確定しない',
      );
      await btn.click();
      await p.getByTestId('confirm-ok').click();
      await p
        .locator('.toast')
        .filter({ hasText: `${targets}日を確定しました` })
        .waitFor({ timeout: 5000 });
      check(true, `知らせ「${targets}日を確定しました」`);
      await settle(p, 500);
      const after = await p
        .locator('[data-testid="month-day"]')
        .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.date, e.dataset.state])));
      check(
        okDays.every((d) => after[d] === 'told') && after[bad] === 'none' && (!changed || after[changed] === 'changed'),
        'まとめて確定：問題の無い日は確定済み、問題のある日はまだ伝えていない・未連絡の変更のある日はそのまま',
        { good: okDays.map((d) => after[d]), bad: after[bad], changed: changed && after[changed] },
      );
      check(
        (await btn.isDisabled()) &&
          /問題の無い日がありません/.test(await p.getByTestId('month-confirm-why').innerText()),
        'まとめて確定：0日になると押せず、理由を見せる',
        await p
          .getByTestId('month-confirm-why')
          .innerText()
          .catch(() => ''),
      );
      const n1 = await homeConfirmDays(p, SYM);
      check(n1 === n0 - targets, 'まとめて確定のあと、ホームの確定していない日が N日減る', { before: n0, after: n1 });

      // 確定した日の「次の確定していない日へ」（PRD D224）：その日より後の最初の確定していない日へ
      const from = okDays[0];
      await open(p, `/plan?date=${from}`, '[data-testid="confirm-state"]');
      const next = p.getByTestId('plan-next-unconfirmed');
      await next.waitFor({ timeout: 15000 });
      const want = Object.keys(after)
        .filter((d) => d > from && d >= TODAY && after[d] !== 'told' && after[d] !== 'empty')
        .sort()[0];
      check(
        (await p.getByTestId('confirm-state').innerText()).includes('確定済み') &&
          (await next.getAttribute('data-date')) === want &&
          (await next.innerText()).includes(`次の確定していない日へ（${dayLabel(want).replace(/（.）$/, '')}）`),
        '確定済みの日に「次の確定していない日へ（M/D）」',
        { date: await next.getAttribute('data-date'), want, text: await next.innerText() },
      );
      await next.click();
      await p.waitForFunction((d) => document.querySelector('.date-switch select')?.value === d, want, {
        timeout: 10000,
      });
      check(true, '「次の確定していない日へ」でその日が開く');
      await p.screenshot({ path: path.join(OUT_DIR, 'plan-next-unconfirmed.png') });
    }
    check(native.length === 0, 'まとめて確定でブラウザのダイアログを出さない', native);
  } finally {
    await p.close();
  }
}

/** ホームのその月の「要対応 N件」（カードが無ければ 0） */
async function homeAttention(page, ym) {
  await open(page, '/home');
  const title = `${Number(ym.slice(5, 7))}月の要対応`;
  const t = (await tasks(page)).find((x) => x.kind === 'attention' && x.title.startsWith(title));
  const m = t && /要対応 (\d+)件/.exec(t.title);
  return m ? Number(m[1]) : 0;
}
/** 月の予定の要対応の欄（行の日付と種類・帯の要対応の数・その日のマス） */
async function monthAttention(page, ym, date) {
  await open(page, `/month?ym=${ym}&layout=calendar&do=attention`, '[data-testid="month-aside"]');
  await page.getByTestId('progress-band').locator('[data-testid="band-attention"]').waitFor({ timeout: 30000 });
  await settle(page, 300);
  const rows = await page
    .locator('[data-testid="month-attention"] .month-attention-btn')
    .evaluateAll((els) => els.map((e) => `${e.dataset.date}:${e.dataset.kind}`));
  const band = Number(await page.getByTestId('band-attention').getAttribute('data-count'));
  const cell = page.locator(`[data-testid="month-day"][data-date="${date}"]`);
  return {
    rows,
    band,
    state: await cell.getAttribute('data-state'),
    care: await cell.evaluate((el) => el.closest('td').classList.contains('is-care')),
    absent: (await cell.locator('[data-testid="month-absent"]').count()) === 1,
  };
}

/**
 * 欠勤があっても、その人に訪問が無ければ要対応に数えない（版2：要対応は訪問ごと。ADR-0053）：担当の無い〈スタッフ〉の欠勤を
 * 別のタブで足し、マスに「欠」は出るが、ホーム・進み具合の帯・月の要対応の欄の数は変わらないことを確かめる
 */
async function handledAbsence(page) {
  await reset(page);
  const day = SEED_DAYS[1];
  const ym = day.slice(0, 7);
  const before = await monthAttention(page, ym, day);
  const homeBefore = await homeAttention(page, ym);
  check(
    before.band === before.rows.length && homeBefore === before.rows.length,
    'ホーム・進み具合の帯・月の要対応の欄が同じ数（欠勤の前）',
    { home: homeBefore, band: before.band, rows: before.rows.length },
  );
  const setup = await editInOtherTab(page, (data) => {
    const busy = busyStaff(data, day);
    const free = data.staff.find((s) => !busy.has(s.id));
    if (!free) return { ok: false, why: '担当の無い人がいない' };
    // その日に勤務がある人の欠勤にする（マスの「欠」は勤務のある人の欠勤に出す）
    data.availability = [
      ...data.availability.filter((a) => !(a.staffId === free.id && a.date === day)),
      { staffId: free.id, date: day, slots: [{ start: '09:00', end: '17:00' }] },
    ];
    data.absences = [...data.absences, { id: 'e2e-free', staffId: free.id, date: day, from: null, to: null, note: '' }];
    return { ok: true, name: free.name };
  });
  check(setup.ok, '要対応の数え方：前提（担当の無い人の欠勤）', setup);
  const after = await monthAttention(page, ym, day);
  const homeAfter = await homeAttention(page, ym);
  check(
    after.absent && JSON.stringify(after.rows) === JSON.stringify(before.rows) && after.care === before.care,
    '訪問の無い人の欠勤：マスに「欠」は出るが、要対応には数えない',
    { before, after },
  );
  check(
    after.band === after.rows.length && homeAfter === after.rows.length,
    'ホーム・進み具合の帯・月の要対応の欄が同じ数（欠勤のあと）',
    { home: homeAfter, band: after.band, rows: after.rows.length },
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'month-free-absence.png') });
}

async function monthDo(page) {
  await open(page, `/month?ym=${YM}&do=attention`, '[data-testid="month-aside"]');
  await waitText(page.locator('.month-aside-title'), '要対応');
  await page
    .waitForFunction(() => document.activeElement?.dataset.testid === 'month-aside', null, { timeout: 5000 })
    .catch(() => {});
  check(
    hashOf(page) === `#/month?ym=${YM}` &&
      (await page.locator('.month-aside-title').first().innerText()).includes('要対応') &&
      (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'month-aside',
    '月の予定 ?do=attention：右の欄の要対応へ（フォーカス）、?do= は消える',
    hashOf(page),
  );
  await open(page, `/month?ym=${YM}&staff=s1&do=unconfirmed`, '[data-testid="month-aside"]');
  await waitText(page.locator('.month-aside-title'), '確定していない日');
  check(
    hashOf(page) === `#/month?ym=${YM}` &&
      (await page.locator('.month-aside-title').first().innerText()).includes('確定していない日'),
    '月の予定 ?do=unconfirmed：全体の表示にして確定していない日へ',
    hashOf(page),
  );
}

async function anytime(page) {
  await open(page, '/home');
  await page.getByTestId('home-absence').click();
  await page.waitForURL(/#\/plan/);
  await page.locator('.date-switch select').waitFor();
  check((await page.locator('.date-switch select').inputValue()) === TODAY, '欠勤・キャンセル → 今日の日の予定');
  await open(page, '/home');
  await page.getByTestId('home-vacancy').click();
  await page.waitForURL(/#\/vacancy/);
  check(true, '問い合わせ → 空き状況');
  await open(page, '/home');
  await page.getByTestId('home-clients').click();
  await page.waitForURL(/#\/clients/);
  await open(page, '/home');
  await page.getByTestId('home-staff').click();
  await page.waitForURL(/#\/staff/);
  check(true, '探す → 〈利用者さん〉・〈スタッフ〉の画面');
}

async function ready(page) {
  // 訪問も定期パターンも無いデータ：やることが無いので「今日の準備はできています」
  await reset(page);
  await open(page, '/home');
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    // 訪問を全部取り消し、繰り返しを消す
    d.visits = d.visits.map((v) => ({ ...v, cancelled: true }));
    d.patterns = [];
    d.snapshots = {};
    d.absences = [];
    // 組み方の標準は登録済み（標準の案内のカードを出さない。PRD D354）
    d.standard = { at: 1, presetId: d.scorePresetId ?? 'standard', from: d.baseDate, weeks: 1 };
    localStorage.setItem(key, JSON.stringify(d));
  }, STORAGE_KEY);
  await page.reload();
  await page.getByTestId('home-tasks').waitFor();
  await settle(page, 300);
  const list = await tasks(page);
  check(
    (await page.getByTestId('home-ready').isVisible()) &&
      list.length === 1 &&
      list[0].kind === 'today' &&
      list[0].tone === 'info',
    '何も無い：「今日の準備はできています」と今日の知らせだけ',
    list,
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-ready.png'), fullPage: true });
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

async function wide(page) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open(page, '/home');
  const first = page.locator('.side-nav .nav-link').first();
  check(
    (await first.innerText()).trim() === 'ホーム' && (await first.getAttribute('aria-current')) === 'page',
    '広い画面：メニューの先頭に「ホーム」（今の画面）',
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'home-wide.png'), fullPage: true });
}

async function mobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/home');
  check((await page.getByTestId('screen-name').innerText()) === 'ホーム', 'スマホ：上の帯の名前「ホーム」');
  const labels = await page.getByTestId('bottom-tab').allInnerTexts();
  check(
    JSON.stringify(labels) === JSON.stringify(['ホーム', '予定', '欠勤']),
    'スマホ：下のタブの先頭に「ホーム」（ホーム・予定・欠勤と探す・メニュー。PRD D336）',
    labels,
  );
  const active = await page.locator('.bottom-tab.active[aria-current="page"]').allInnerTexts();
  check(JSON.stringify(active) === '["ホーム"]', 'スマホ：ホームのタブが active', active);
  const boxes = await page
    .locator('.home-task')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  check(
    boxes.length >= 5 &&
      boxes.every((b) => b.x === boxes[0].x && b.right <= 390) &&
      boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y),
    'スマホ：カードが縦に1列で並び、画面に収まる',
    boxes.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.width)]),
  );
  const firstCard = await page.locator('.home-task').first().getAttribute('data-testid');
  const anytimeIds = await page
    .getByTestId('home-anytime')
    .locator('a')
    .evaluateAll((els) => els.map((el) => el.dataset.testid));
  check(
    firstCard === 'home-absence' &&
      (await page.getByTestId('home-absence').count()) === 1 &&
      !anytimeIds.includes('home-absence'),
    'スマホ：先頭に「欠勤・キャンセルを登録」（いつでもには重ねて出さない。PRD D247）',
    { firstCard, anytimeIds },
  );
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 390, 'スマホ：横にはみ出さない', scrollW);
  await page.screenshot({ path: path.join(OUT_DIR, 'home-mobile.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  check(!(await page.locator('.home-page').isVisible()), '印刷ではホームを出さない');
  await page.emulateMedia({ media: 'screen' });
}

const steps = sharedPage({
  open: async () => {
    const s = await openPage();
    // 確認は独自のダイアログで受ける（ネイティブのダイアログが出たら失敗。PRD D146）
    return { ...s, dlg: await answerConfirms(s.page) };
  },
  steps: [
    ['start', start],
    ['first-state', firstState],
    ['seed-plans', seedPlans],
    ['handled-absence', handledAbsence],
    ['month-do', monthDo],
    ['anytime', anytime],
    ['ready', ready],
    ['wide', wide],
    ['mobile', mobile],
  ],
  after: ({ dlg }) => check(dlg.native.length === 0, 'ブラウザのダイアログを出さない', dlg.native),
});

module.exports = { steps };
if (require.main === module) runSteps(steps);
