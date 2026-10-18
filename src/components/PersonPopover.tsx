// 予定（月・週・日）の名前から開く〈スタッフ〉・〈利用者さん〉の詳細の吹き出し（PRD D122〜D126。ADR-0022 追記）。
// 開いている状態は画面全体で1つの入れ物（lib/personPopover）に持ち、名前のボタンは自分が開いているかだけを購読する
// （開け閉めで週の時間軸・日の画面の表全体を描き直さない）。吹き出しそのものは PersonPopoverProvider の中の
// 小さな部品が1つだけ出す（同時に1つ）。吹き出しの決まり（閉じ方・フォーカス・中を巻く）は DetailPopover のまま
import { Info } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPersonPopoverStore, type PersonKind, type PersonPopoverStore } from '../lib/personPopover';
import { useDemoData } from '../store';
import { DetailPopover } from './DetailPopover';
import { ClientDetail, StaffDetail } from './personDetail';
import './personPopover.css';

const StoreContext = createContext<PersonPopoverStore | null>(null);

/** 画面全体を包む（App）。中の名前のボタンが開く吹き出しを、ここで1つだけ出す */
export function PersonPopoverProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createPersonPopoverStore);
  return (
    <StoreContext.Provider value={store}>
      {children}
      <PersonPopoverHost store={store} />
    </StoreContext.Provider>
  );
}

/** 開いている吹き出し（開いている人が消えたら閉じる） */
function PersonPopoverHost({ store }: { store: PersonPopoverStore }) {
  const opened = useSyncExternalStore(store.subscribe, store.get);
  const { data } = useDemoData();
  const staff = opened?.kind === 'staff' ? data.staff.find((s) => s.id === opened.id) : undefined;
  const client = opened?.kind === 'client' ? data.clients.find((c) => c.id === opened.id) : undefined;
  const missing = !!opened && !staff && !client;
  useEffect(() => {
    if (missing) store.close();
  }, [missing, store]);
  if (!opened || (!staff && !client)) return null;
  const popId = `${opened.anchorId}-pop`;
  return (
    <DetailPopover
      key={opened.anchorId}
      id={popId}
      anchorId={opened.anchorId}
      title={staff ? staff.name : client?.displayName}
      titleId={`${popId}-title`}
      onClose={store.close}
      testId="person-pop"
    >
      {staff ? <StaffDetail staff={staff} data={data} /> : client && <ClientDetail client={client} data={data} />}
    </DetailPopover>
  );
}

/** 名前のボタンに付ける共通の props（Provider の外では null：ただの文字にする） */
function usePersonTrigger(kind: PersonKind, id: string, name: string) {
  const store = useContext(StoreContext);
  const anchorId = `person-${useId()}`;
  const open = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.get()?.anchorId === anchorId,
    () => false,
  );
  // 見出しが消えたら閉じる（絞り込み・表示の切り替え・訪問の選び直しで名前のボタンが無くなったとき）
  useEffect(() => () => store?.closeIf(anchorId), [store, anchorId]);
  if (!store) return null;
  return {
    id: anchorId,
    type: 'button' as const,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'aria-controls': open ? `${anchorId}-pop` : undefined,
    'aria-label': `${name}の詳細`,
    'data-kind': kind,
    'data-id': id,
    onClick: () => store.toggle({ kind, id, anchorId }),
  };
}
const noSubscribe = () => () => {};

/**
 * 名前そのものを押して詳細を開くボタン（名前の文字が今は操作になっていない所）。children は名前の見た目（無ければ name）。
 * Provider の外（印刷の画面など）ではボタンにせず、children をそのまま出す
 */
export function PersonButton({
  kind,
  id,
  name,
  className,
  testId = 'person-btn',
  children,
}: {
  kind: PersonKind;
  id: string;
  name: string;
  className?: string;
  testId?: string;
  children?: ReactNode;
}) {
  const props = usePersonTrigger(kind, id, name);
  if (!props) return <>{children ?? name}</>;
  return (
    <button {...props} className={`person-btn${className ? ` ${className}` : ''}`} data-testid={testId}>
      {children ?? name}
    </button>
  );
}

/**
 * 名前の横の小さな「i」（押すと別の動きがある所：ドラッグできるカード・選ぶチップ・列を絞るボタンの横）。
 * ボタンの中には置かない（ボタンの入れ子にしない）
 */
export function PersonInfo({
  kind,
  id,
  name,
  className,
  testId = 'person-info',
}: {
  kind: PersonKind;
  id: string;
  name: string;
  className?: string;
  testId?: string;
}) {
  const props = usePersonTrigger(kind, id, name);
  if (!props) return null;
  return (
    <button
      {...props}
      className={`person-info${className ? ` ${className}` : ''}`}
      title={`${name}の詳細`}
      data-testid={testId}
    >
      <Info size={14} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
