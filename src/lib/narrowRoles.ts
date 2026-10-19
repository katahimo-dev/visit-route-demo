// 狭い画面でカードに組み替える表（.narrow-cards。PRD D220・ADR-0033）に付ける role。
// table を block、tbody・tr を flex にすると、WebKit（Safari・iOS）は表の role を落とし、読み上げで表として読めなくなる。
// そこで table・rowgroup・row・cell・columnheader を明示する。広い画面では要らない（ブラウザが同じ role を付ける）が、
// 害は無いので幅で分けない。JSX に role="cell" と直に書くとリント（noRedundantRoles）に止められるので、ここから展開する
export const narrowRole = {
  table: { role: 'table' },
  rowgroup: { role: 'rowgroup' },
  row: { role: 'row' },
  cell: { role: 'cell' },
  columnheader: { role: 'columnheader' },
} as const;
