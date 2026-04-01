import { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ErrorReportProps {
  lureSlug: string;
  manufacturerSlug: string;
  lureName: string;
}

type ErrorCategory = 'target_fish' | 'type' | 'spec' | 'color' | 'price' | 'other';

const CATEGORIES: { value: ErrorCategory; label: string }[] = [
  { value: 'target_fish', label: '対象魚' },
  { value: 'type', label: 'タイプ' },
  { value: 'spec', label: 'スペック' },
  { value: 'color', label: 'カラー' },
  { value: 'price', label: '価格' },
  { value: 'other', label: 'その他' },
];

export default function ErrorReportButton({ lureSlug, manufacturerSlug, lureName }: ErrorReportProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ErrorCategory | null>(null);
  const [correctInfo, setCorrectInfo] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !correctInfo.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const userId = localStorage.getItem('castlog_user_id') || 'anonymous';

      const { error: dbError } = await supabase
        .from('error_reports')
        .insert({
          user_id: userId,
          lure_slug: lureSlug,
          manufacturer_slug: manufacturerSlug,
          lure_name: lureName,
          category,
          correct_info: correctInfo.trim(),
          source_url: sourceUrl.trim() || null,
        });

      if (dbError) {
        // テーブル未作成の場合
        if (dbError.code === '42P01' || dbError.message?.includes('does not exist')) {
          setError('この機能は準備中です');
        } else {
          throw dbError;
        }
        return;
      }

      setSubmitted(true);
    } catch {
      setError('送信に失敗しました。時間を置いて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setOpen(false);
    // リセット
    setTimeout(() => {
      setCategory(null);
      setCorrectInfo('');
      setSourceUrl('');
      setSubmitted(false);
      setError(null);
    }, 200);
  }

  if (submitted) {
    return (
      <div className="text-sm font-mono text-[#00C78A]">
        ご報告ありがとうございます。確認いたします。
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-mono text-[#999999] hover:text-[#555555] transition-colors duration-150 cursor-pointer"
      >
        ⚠️ この情報に間違いがありますか？
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-sans font-medium text-[#1A1A1A]">
                情報の間違いを報告
              </h3>
              <button
                onClick={handleClose}
                className="text-[#999999] hover:text-[#555555] text-xl leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <p className="text-sm font-mono text-[#555555] mb-4">
              {lureName}
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* カテゴリ選択 */}
              <fieldset>
                <legend className="text-sm font-sans text-[#1A1A1A] mb-2">
                  何が間違っていますか？
                </legend>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((cat) => (
                    <label
                      key={cat.value}
                      className={`
                        inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm font-mono cursor-pointer
                        transition-colors duration-150
                        ${category === cat.value
                          ? 'border-[#00C78A] text-[#00C78A] bg-[#00C78A]/5'
                          : 'border-gray-200 text-[#555555] hover:border-[#00C78A]'
                        }
                      `}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={cat.value}
                        checked={category === cat.value}
                        onChange={() => setCategory(cat.value)}
                        className="sr-only"
                      />
                      {cat.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* 正しい情報 */}
              <div>
                <label className="text-sm font-sans text-[#1A1A1A] mb-1 block">
                  正しい情報
                </label>
                <textarea
                  value={correctInfo}
                  onChange={(e) => setCorrectInfo(e.target.value)}
                  placeholder="正しいと思われる情報を記入してください"
                  rows={3}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-sans text-[#1A1A1A] placeholder-[#CCCCCC] focus:outline-none focus:border-[#00C78A] transition-colors duration-150 resize-none"
                />
              </div>

              {/* 根拠URL */}
              <div>
                <label className="text-sm font-sans text-[#999999] mb-1 block">
                  根拠（任意）
                </label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-mono text-[#1A1A1A] placeholder-[#CCCCCC] focus:outline-none focus:border-[#00C78A] transition-colors duration-150"
                />
              </div>

              {error && (
                <p className="text-sm text-red-500 font-sans">{error}</p>
              )}

              <button
                type="submit"
                disabled={!category || !correctInfo.trim() || submitting}
                className={`
                  rounded px-4 py-2 text-sm font-mono text-white
                  transition-colors duration-150
                  ${!category || !correctInfo.trim() || submitting
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-[#00C78A] hover:bg-[#00B07A] cursor-pointer'
                  }
                `}
              >
                {submitting ? '送信中...' : '送信'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
