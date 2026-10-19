// ファイルとして保存させる（データの画面の書き出し・例外の画面の控え）

/** 控え（バックアップ）の JSON のファイル名。date は日本時間の YYYY-MM-DD */
export function backupFileName(date: string): string {
  return `visit-route-demo-${date}.json`;
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
