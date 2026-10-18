// ファイルを選ぶ部品（PRD D191。ADR-0025 追記。区切り8b）の純粋な部分：選んだファイルの文。
// ブラウザ標準の「Choose File／No file chosen」（英語）の代わりに、日本語のボタンと文を出す。画面は components/FilePick.tsx

/** 選んだファイルの文（まだ選んでいなければ未選択の文） */
export function fileNameText(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n === '' ? 'ファイルを選んでいません' : `選んだファイル：${n}`;
}

/** ボタンの文（どの部品でも同じ） */
export const FILE_PICK_LABEL = 'ファイルを選ぶ';
