// ファイルとして保存させる（データの画面の書き出し・例外の画面の控え）

/** 控え（バックアップ）の JSON のファイル名。date は日本時間の YYYY-MM-DD。broken は壊れて退避したデータ */
export function backupFileName(date: string, kind: 'current' | 'broken' = 'current'): string {
  return kind === 'broken' ? `visit-route-demo-${date}-broken.json` : `visit-route-demo-${date}.json`;
}

/**
 * 例外の画面で控えを書き出したあとの文。
 * source：いまのデータの出どころ（memory＝画面の最新・storage＝保存してあった文字・null＝無い）、saveError：保存の失敗の文言、
 * brokenName：壊れて退避したデータも書き出したときのファイル名
 */
export function backupNote({
  source,
  saveError,
  brokenName,
}: {
  source: 'memory' | 'storage' | null;
  saveError: string | null;
  brokenName: string | null;
}): string {
  const parts: string[] = [];
  if (source === null && brokenName === null) {
    return '書き出せるデータがありません（画面のデータも、このブラウザに保存したデータもありません）';
  }
  if (source !== null) {
    if (!saveError) parts.push('書き出しました');
    else if (source === 'memory')
      parts.push(`保存に失敗していましたが、画面で使っていた最新の状態を書き出しました（${saveError}）`);
    else parts.push(`保存に失敗していたため、最後に保存できた状態を書き出しました（${saveError}）`);
  }
  if (brokenName !== null) {
    parts.push(
      source === null
        ? `壊れて読めなかったデータを ${brokenName} に書き出しました`
        : `壊れて読めなかったデータも別のファイル（${brokenName}）に書き出しました。ブラウザが複数のファイルの保存を尋ねたら許可してください`,
    );
  }
  return parts.join('。');
}

/** Blob をファイルとして保存させる */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
