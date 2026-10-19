import { CircleSlash, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import './features.css';

/**
 * 切った機能の URL を開いてホームへ移したときの知らせ（PRD D213。ADR-0028）。トーストにはリンクが置けないので、
 * ホームの上に閉じられる帯で出す。name は切っている機能の名前。印刷では出さない
 */
export function FeatureOffNotice({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <output className="feature-off-notice" data-testid="feature-off-notice">
      <CircleSlash size={18} aria-hidden="true" />
      <span className="feature-off-text">
        この機能は管理者設定で切っています（{name}）。{' '}
        <Link to="/settings" data-testid="feature-off-settings">
          管理者設定を開く
        </Link>
      </span>
      <button type="button" className="icon-btn" aria-label="知らせを閉じる" onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
    </output>
  );
}
