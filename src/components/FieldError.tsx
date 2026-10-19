import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { formError, formErrorField } from '../lib/common';

/**
 * フォームの共通の決まり（PRD D250〜D252）。
 * - エラー文は FieldError で出す（role="alert" で読み上げる。見た目は今までの .error のまま）
 * - 誤った入力欄には invalidAttrs で aria-invalid="true" と aria-describedby（エラー文の id）を付ける
 * - 必須の欄は見出しに RequiredMark（「必須」の札）を添え、入力欄に required を付ける（フォームは noValidate なので
 *   ブラウザの吹き出しは出さず、読み上げに必須と伝わる。検査は保存の処理が行う）
 * - 保存は `<form onSubmit={submitHandler(save)} noValidate>`。Enter で保存（textarea は除く）し、
 *   誤りがあれば最初の誤った欄（aria-invalid="true"）へフォーカスを移す
 */

/** フォームのエラー：文と、誤った欄の名前（欄と結ばない誤りは field 無し） */
export type FormErr = { text: string; field?: string } | null;

/** 例外（契約の検査の誤りなど）をフォームのエラーにする。誤った欄は検査の path の先頭 */
export function toFormErr(e: unknown): FormErr {
  return { text: formError(e), field: formErrorField(e) };
}

/** エラー文（無ければ何も出さない）。対応する入力欄の aria-describedby に id を渡す */
export function FieldError({
  id,
  children,
  as = 'p',
  className,
  style,
  testId,
}: {
  /** 入力欄の aria-describedby から指す id（入力欄と結ばないエラー文は省いてよい） */
  id?: string;
  children?: ReactNode;
  /** 置く場所の流れに合わせる（文の段落なら p、ボタンの横なら span） */
  as?: 'p' | 'span';
  /** .error に足すクラス（plan-band など） */
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  if (children === null || children === undefined || children === false || children === '') return null;
  const Tag = as;
  return (
    <Tag id={id} className={className ? `error ${className}` : 'error'} role="alert" style={style} data-testid={testId}>
      {children}
    </Tag>
  );
}

/** 誤った入力欄に付ける属性（誤りが無ければ何も付けない） */
export function invalidAttrs(
  invalid: boolean,
  errorId: string | undefined,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  if (!invalid) return {};
  return errorId ? { 'aria-invalid': true, 'aria-describedby': errorId } : { 'aria-invalid': true };
}

/** 必須の欄の見出しに添える札（読み上げは入力欄の aria-required に任せ、札は読まない） */
export function RequiredMark() {
  return (
    <span className="req-mark" aria-hidden="true">
      必須
    </span>
  );
}

/** 中の最初の誤った欄（aria-invalid="true"）へフォーカスを移す。移したら true */
export function focusFirstInvalid(root: ParentNode | null | undefined): boolean {
  const el = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!el) return false;
  el.focus();
  return true;
}

/**
 * フォームの onSubmit（PRD D251）。既定の送信を止めて保存を呼び、描き終えたら最初の誤った欄へフォーカスを移す
 * （保存できて閉じたフォームは何もしない）
 */
export function submitHandler(save: () => unknown) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void Promise.resolve(save()).then(() => {
      requestAnimationFrame(() => {
        if (form.isConnected) focusFirstInvalid(form);
      });
    });
  };
}

/**
 * 大きなフォームの中の小さな入力のまとまり（〈利用者さん〉の欄の中の定期パターン・休みなど。PRD D251）の onKeyDown。
 * まとまりの入力欄での Enter は外のフォームの保存に渡さず、まとまりの保存を呼ぶ（textarea・ボタン・変換中は何もしない）
 */
export function enterToSave(save: () => unknown) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || ['button', 'submit', 'reset', 'image', 'file'].includes(t.type)) return;
    e.preventDefault();
    e.stopPropagation();
    save();
  };
}
