import { FolderOpen } from 'lucide-react';
import { useId, useState } from 'react';
import { FILE_PICK_LABEL, fileNameText } from '../lib/filePick';
import './filePick.css';

/**
 * ファイルを選ぶ部品（PRD D191。ADR-0025 追記）。ブラウザ標準の「Choose File／No file chosen」（英語）の代わりに、
 * 日本語のボタン「ファイルを選ぶ」と選んだファイル名（未選択の文）を出す。
 * input は見えない形で残し（display: none にしない）、見た目のボタン（input の label）と同じ大きさで重ねる。Tab で届き Space・Enter で開ける。
 * 入力欄の名前は「〈何を読み込むか〉 ファイルを選ぶ」（aria-labelledby）、選んだファイルの文は aria-describedby。
 * 選んだら onPick を呼び、input の値は空に戻す（同じファイルをもう一度選べる。文は最後に選んだ名前のまま）
 */
export function FilePick({
  caption,
  accept,
  onPick,
  disabled = false,
  testId,
}: {
  /** 何を読み込むか（見える見出し。例「読み込む控え（JSON）」） */
  caption: string;
  accept: string;
  onPick: (file: File) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="file-pick" data-testid={testId}>
      <span id={`${id}-caption`} className="file-pick-caption">
        {caption}
      </span>
      <div className="file-pick-row">
        {/* input は見えないまま見た目のボタンと同じ大きさで重ねる（押す・VoiceOver で触れるのは input） */}
        <span className="file-pick-hit">
          <input
            id={id}
            type="file"
            className="file-pick-input"
            accept={accept}
            disabled={disabled}
            aria-labelledby={`${id}-caption ${id}-label`}
            aria-describedby={`${id}-name`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setName(f.name);
              onPick(f);
            }}
            data-testid={testId ? `${testId}-input` : undefined}
          />
          <label id={`${id}-label`} htmlFor={id} className="btn file-pick-btn" aria-hidden="true">
            <FolderOpen size={16} aria-hidden="true" />
            {FILE_PICK_LABEL}
          </label>
        </span>
        <span
          id={`${id}-name`}
          className={`file-pick-name${name ? '' : ' sub'}`}
          data-testid={testId ? `${testId}-name` : undefined}
        >
          {fileNameText(name)}
        </span>
      </div>
    </div>
  );
}
