// e2e の共通：独自の確認ダイアログ（PRD D146〜D150。ADR-0026）に答える。
// 出たら見出しと本文を st.messages に記録し、st.answer（true＝確定・false＝取り消す）のボタンを押す。
// ブラウザのネイティブのダイアログ（confirm・alert・prompt）が出たら st.native に記録して閉じる（呼ぶ側で失敗にする）。
// beforeunload だけはブラウザの仕様で置き換えられないので受ける（再読込・タブを閉じるときの確認。ADR-0023）

/** ページを開く前に呼ぶ（page.goto の前） */
async function answerConfirms(page, init = {}) {
  const st = { answer: true, messages: [], native: [], ...init };
  await page.exposeBinding('__e2eConfirm', (_source, text) => {
    st.messages.push(text);
    return st.answer;
  });
  await page.addInitScript(() => {
    const seen = new WeakSet();
    const scan = () => {
      const d = document.querySelector('[data-testid="confirm-dialog"]');
      if (!d || seen.has(d)) return;
      seen.add(d);
      const title = d.querySelector('[data-testid="confirm-title"]')?.textContent ?? '';
      const body = d.querySelector('[data-testid="confirm-body"]')?.textContent ?? '';
      window.__e2eConfirm(body ? `${title}\n${body}` : title).then((ok) => {
        if (!d.isConnected) return;
        d.querySelector(ok ? '[data-testid="confirm-ok"]' : '[data-testid="confirm-cancel"]')?.click();
      });
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  });
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') {
      d.accept();
      return;
    }
    st.native.push(`${d.type()}: ${d.message()}`);
    d.dismiss();
  });
  return st;
}

module.exports = { answerConfirms };
