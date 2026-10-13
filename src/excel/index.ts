// 入口（実装は excel 担当。ADR-0006・design.md §4 excel）
// DemoData ⇔ Excel のブックの変換。データは書き換えない。画面からは動的 import で読む（ExcelJS を初期表示に入れない）
export { exportWorkbook, XLSX_MIME } from './exportBook';
export { importWorkbook } from './importBook';
