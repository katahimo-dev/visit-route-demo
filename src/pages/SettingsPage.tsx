import { CircleCheck, LayoutTemplate, Settings } from 'lucide-react';
import { useId } from 'react';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/ui';
import type { Terms } from '../contracts/documents';
import type { FeatureId, Features } from '../contracts/features';
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
  withFeature,
} from '../lib/features';
import { useDemoData } from '../store';
import '../components/features.css';

/**
 * 管理者設定（`#/settings`。PRD D210〜D212。ADR-0028）：機能の入り切り。だれでも開ける（ログイン・鍵なし）。
 * 上にひな形の4つ（今と同じひな形に「いまの設定」の印。どれとも違えば見出しの横に「カスタム」）。「当てる」は独自の確認ダイアログで
 * 入る機能・切れる機能を出してから書く。下にグループごとのスイッチ（押すとすぐ保存。主ボタンは置かない）。
 * 書くのは store の update(fn) だけ。切った機能のデータは消さない。呼び方は org.terms
 */
export default function SettingsPage() {
  const { data, update } = useDemoData();
  const features = data.org.features;
  const terms = data.org.terms;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const current = matchTemplate(features);
  const templatesId = useId();

  const names = (ids: readonly FeatureId[]) => ids.map((id) => featureLabel(id, terms)).join('、');

  /** ひな形を当てる（確認で入る機能・切れる機能を出す。PRD D212） */
  const apply = async (t: TemplateDef) => {
    const diff = templateDiff(features, t.id);
    const body = [
      diff.on.length > 0 ? `入る機能：${names(diff.on)}` : '入る機能：なし',
      diff.off.length > 0 ? `切れる機能：${names(diff.off)}` : '切れる機能：なし',
      '切った機能のデータは消えません。あとから1つずつ入り切りできます。',
    ].join('\n');
    const ok = await confirmDialog({
      title: `ひな形「${t.label}」を当てますか？`,
      body,
      confirmLabel: '当てる',
    });
    if (!ok) return;
    const next = applyTemplate(t.id);
    update((d) => ({ ...d, org: { ...d.org, features: next } }));
    toast(`ひな形「${t.label}」を当てました`);
  };

  /** スイッチを押す（すぐ保存。依存先が切なら押せない） */
  const toggle = (f: FeatureDef) => {
    if (f.requires && !isOn(features, f.requires)) return;
    const on = !isSwitchOn(features, f.id);
    update((d) => ({ ...d, org: { ...d.org, features: withFeature(d.org.features, f.id, on) } }));
    toast(`${featureLabel(f.id, terms)}を${on ? '入れました' : '切りました'}`);
  };

  return (
    <div className="stack settings-page" style={{ maxWidth: 880 }}>
      <PageHeader
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
        <p className="sub">よく使う組み合わせを一度に当てます。当てたあとも、下のスイッチで1つずつ直せます。</p>
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
                  aria-label={`ひな形「${t.label}」を当てる`}
                  data-testid="feature-template-apply"
                >
                  当てる
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
type RowProps = { features: Features; terms: Pick<Terms, 'client' | 'staff'>; onToggle: (f: FeatureDef) => void };

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
        onClick={() => onToggle(f)}
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
