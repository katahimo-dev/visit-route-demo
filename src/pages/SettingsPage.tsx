import { CircleCheck, LayoutTemplate, Settings } from 'lucide-react';
import { useId } from 'react';
import { flushSync } from 'react-dom';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/ui';
import type { Terms } from '../contracts/documents';
import type { FeatureId, Features } from '../contracts/features';
import { jstDate } from '../domain/time';
import {
  applyTemplate,
  FEATURE_GROUPS,
  FEATURES,
  type FeatureDef,
  type FeatureGroup,
  featureLabel,
  fillTerms,
  isOn,
  isSwitchOn,
  matchTemplate,
  TEMPLATES,
  type TemplateDef,
  templateDiff,
  turnOffImpact,
  withFeature,
} from '../lib/features';
import { useDemoData } from '../store';
import '../components/features.css';
import { SettingsTabs } from '../components/SettingsTabs';

/**
 * 管理者設定（`#/settings`。PRD D210〜D212。ADR-0028）：機能の入り切り。だれでも開ける（ログイン・鍵なし）。
 * 上にひな形の4つ（今と同じひな形に「いまの設定」の印。どれとも違えば見出しの横に「カスタム」）。「適用」は独自の確認ダイアログで
 * 入る機能・切れる機能を出してから書く。下にグループごとのスイッチ（押すとすぐ保存。主ボタンは置かない）。
 * 書くのは store の update(fn) だけ。切った機能のデータは消さない。呼び方は org.terms
 */
export default function SettingsPage() {
  const { data, update } = useDemoData();
  /** 今日（休み・希望休・欠勤は今日以降に掛かるものだけを数える。turnOffImpact） */
  // 切るときの影響は今日から数える（この画面には日付の選択を出さないので、見えない選択日付は使わない。PRD D267）
  const today = jstDate(Date.now());
  const features = data.org.features;
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const current = matchTemplate(features);
  const templatesId = useId();

  const names = (ids: readonly FeatureId[]) => ids.map((id) => featureLabel(id, terms)).join('、');

  /** ひな形を適用する（確認で入る機能・切れる機能を出す。PRD D212） */
  const apply = async (t: TemplateDef) => {
    const diff = templateDiff(features, t.id);
    // 切れる機能に入っているデータの件数と効き方（PRD D215。turnOffImpact）
    const impacts = diff.off.flatMap((id) => turnOffImpact(data, id, today)?.text ?? []);
    const body = [
      diff.on.length > 0 ? `入る機能：${names(diff.on)}` : '入る機能：なし',
      diff.off.length > 0 ? `切れる機能：${names(diff.off)}` : '切れる機能：なし',
      ...impacts.map((x) => `・${x}`),
      '切った機能のデータは消えません。あとから1つずつ入り切りできます。',
    ].join('\n');
    const ok = await confirmDialog({
      title: `ひな形「${t.label}」を適用しますか？`,
      body,
      confirmLabel: '適用',
    });
    if (!ok) return;
    const next = applyTemplate(t.id);
    update((d) => ({ ...d, org: { ...d.org, features: next } }), 'ひな形を反映する');
    toast(`ひな形「${t.label}」を適用しました`);
  };

  /**
   * スイッチを押す（すぐ保存。依存先が切なら押せない）。新しい値は update の中で最新の d.org.features から決め、
   * トーストの文も同じ値から作る（素早く2回押したとき、描画前の古い features で決めて同じ値を2回書かない）。
   * flushSync で update をその場で済ませ、決めた値を受け取る。
   * 切るときにその機能のデータがあれば、先に独自の確認ダイアログで件数と効き方を出す（PRD D215。turnOffImpact）。
   * 確認したあとは「切る」と決めて書く（確認の間に別のタブで切られていても入れ直さない）
   */
  const toggle = async (f: FeatureDef) => {
    let forced: boolean | null = null;
    if (isSwitchOn(features, f.id) && !(f.requires && !isOn(features, f.requires))) {
      const impact = turnOffImpact(data, f.id, today);
      if (impact) {
        const ok = await confirmDialog({
          title: `${featureLabel(f.id, terms)}を切りますか？`,
          body: `${impact.text}。\n切った機能のデータは消えません。入れ直せば元に戻ります。`,
          confirmLabel: '切る',
        });
        if (!ok) return;
        forced = false;
      }
    }
    /** update の中で決めた新しい値（依存先が切で押せなければ null） */
    const decided: { on: boolean | null } = { on: null };
    flushSync(() =>
      update((d) => {
        const cur = d.org.features;
        if (f.requires && !isOn(cur, f.requires)) {
          decided.on = null;
          return d;
        }
        const on = forced ?? !isSwitchOn(cur, f.id);
        decided.on = on;
        return { ...d, org: { ...d.org, features: withFeature(cur, f.id, on) } };
      }, '機能の入り切り'),
    );
    if (decided.on === null) return;
    toast(`${featureLabel(f.id, terms)}を${decided.on ? '入れました' : '切りました'}`);
  };

  return (
    <div className="stack settings-page" style={{ maxWidth: 880 }}>
      <PageHeader
        nav={<SettingsTabs />}
        icon={Settings}
        title="管理者設定"
        lead="使う機能だけを入れると、メニューと画面がすっきりします。切った機能のデータは消えません"
      />

      <section className="card stack" aria-labelledby={templatesId} data-testid="feature-templates">
        <h2 id={templatesId} className="feature-section-title">
          <LayoutTemplate size={18} aria-hidden="true" />
          ひな形
          {current === 'custom' && (
            <span className="feature-badge is-custom" data-testid="feature-custom">
              カスタム
            </span>
          )}
        </h2>
        <p className="sub">よく使う組み合わせを一度に適用します。適用したあとも、下のスイッチで1つずつ直せます。</p>
        <ul className="feature-templates">
          {TEMPLATES.map((t) => {
            const now = current === t.id;
            return (
              <li
                key={t.id}
                className={now ? 'feature-template is-now' : 'feature-template'}
                data-testid="feature-template"
                data-template={t.id}
              >
                <h3>
                  {t.label}
                  {now && (
                    <span className="feature-badge" data-testid="feature-template-now">
                      <CircleCheck size={14} aria-hidden="true" />
                      いまの設定
                    </span>
                  )}
                </h3>
                <p className="sub">{t.description}</p>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => void apply(t)}
                  aria-label={`ひな形「${t.label}」を適用する`}
                  data-testid="feature-template-apply"
                >
                  適用
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {FEATURE_GROUPS.map((g) => (
        <FeatureGroupCard key={g} group={g} features={features} terms={terms} onToggle={toggle} />
      ))}
    </div>
  );
}

/** グループごとのスイッチ（見出しはグループの名前） */
type RowProps = {
  features: Features;
  terms: Pick<Terms, 'client' | 'staff'>;
  onToggle: (f: FeatureDef) => Promise<void>;
};

function FeatureGroupCard({ group, ...props }: RowProps & { group: FeatureGroup }) {
  const titleId = useId();
  const list = FEATURES.filter((f) => f.group === group);
  return (
    <section className="card stack" aria-labelledby={titleId} data-testid="feature-group">
      <h2 id={titleId} className="feature-section-title">
        {group}
      </h2>
      <ul className="feature-list">
        {list.map((f) => (
          <FeatureRow key={f.id} f={f} {...props} />
        ))}
      </ul>
    </section>
  );
}

/** 機能の1行：名前・1行の説明・切ると隠れるもの・依存の注記とスイッチ */
function FeatureRow({ f, features, terms, onToggle }: RowProps & { f: FeatureDef }) {
  const baseId = useId();
  const on = isOn(features, f.id);
  const blocked = f.requires !== undefined && !isOn(features, f.requires);
  const reqName = f.requires ? featureLabel(f.requires, terms) : '';
  const label = featureLabel(f.id, terms);
  return (
    <li className="feature-row" data-testid="feature-row" data-feature={f.id}>
      <div className="feature-text">
        <strong id={`${baseId}-name`}>{label}</strong>
        <span id={`${baseId}-desc`} className="sub">
          {fillTerms(f.description, terms)}
        </span>
        <span id={`${baseId}-hides`} className="feature-hides">
          切ると隠れるもの：{fillTerms(f.hides, terms)}
        </span>
        {f.requires && (
          <span id={`${baseId}-req`} className={blocked ? 'feature-req is-blocked' : 'feature-req'}>
            {blocked ? `「${reqName}」を入れると使えます` : `「${reqName}」が入っているときに使えます`}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={blocked || undefined}
        aria-labelledby={`${baseId}-name`}
        aria-describedby={[`${baseId}-desc`, f.requires ? `${baseId}-req` : '', `${baseId}-hides`]
          .filter(Boolean)
          .join(' ')}
        className={on ? 'feature-switch is-on' : 'feature-switch'}
        onClick={() => void onToggle(f)}
        data-testid="feature-switch"
      >
        <span className="feature-switch-track" aria-hidden="true">
          <span className="feature-switch-knob" />
        </span>
        <span className="feature-switch-text" aria-hidden="true">
          {on ? '入' : '切'}
        </span>
      </button>
    </li>
  );
}
