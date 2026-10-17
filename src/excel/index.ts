// 入口（実装は excel 担当。ADR-0006・design.md §4 excel）
// DemoData ⇔ Excel のブックの変換。データは書き換えない。画面からは動的 import で読む（ExcelJS を初期表示に入れない）
export { exportRosterWorkbook, exportWorkbook, XLSX_MIME } from './exportBook';
export { importWorkbook } from './importBook';
// 名簿（〈利用者さん〉・〈スタッフ〉のシート1枚）の書き出し・読み込み（PRD D103〜D107。ADR-0020）
export { importRoster, rosterRetiresMost, rosterSummary, rosterWarning } from './importRoster';
