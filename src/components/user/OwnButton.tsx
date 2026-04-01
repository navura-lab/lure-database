import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface OwnButtonProps {
  lureSlug: string;
  manufacturerSlug: string;
  initialCount: number;
}

export default function OwnButton({ lureSlug, manufacturerSlug, initialCount }: OwnButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('castlog_user_id');
    if (stored) {
      setUserId(stored);
      checkOwnership(stored);
    }

    // ログインイベントを監視
    const handler = (e: CustomEvent<{ userId: string }>) => {
      setUserId(e.detail.userId);
      checkOwnership(e.detail.userId);
    };
    window.addEventListener('castlog:login', handler as EventListener);
    return () => window.removeEventListener('castlog:login', handler as EventListener);
  }, []);

  async function checkOwnership(uid: string) {
    try {
      const { data, error } = await supabase
        .from('user_owns')
        .select('id')
        .eq('user_id', uid)
        .eq('lure_slug', lureSlug)
        .eq('manufacturer_slug', manufacturerSlug)
        .maybeSingle();

      if (error) {
        // テーブル未作成等
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          setReady(false);
        }
        return;
      }
      setOwned(!!data);
    } catch {
      setReady(false);
    }
  }

  async function handleClick() {
    if (!userId) {
      // 未ログイン: ログインモーダルを開く
      window.dispatchEvent(new CustomEvent('castlog:open-login'));
      return;
    }

    if (loading) return;
    setLoading(true);

    try {
      if (owned) {
        // 解除
        const { error } = await supabase
          .from('user_owns')
          .delete()
          .eq('user_id', userId)
          .eq('lure_slug', lureSlug)
          .eq('manufacturer_slug', manufacturerSlug);

        if (error) throw error;
        setOwned(false);
        setCount((c) => Math.max(0, c - 1));
      } else {
        // 登録
        const { error } = await supabase
          .from('user_owns')
          .insert({
            user_id: userId,
            lure_slug: lureSlug,
            manufacturer_slug: manufacturerSlug,
          });

        if (error) throw error;
        setOwned(true);
        setCount((c) => c + 1);
      }
    } catch {
      // エラー時は何もしない（UIは壊さない）
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <button
        disabled
        className="bg-white border border-gray-200 rounded px-4 py-2 text-sm font-mono text-gray-400 cursor-not-allowed"
      >
        準備中
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`
        bg-white border rounded px-4 py-2 text-sm font-mono
        transition-colors duration-150 ease-in-out
        ${owned
          ? 'border-[#00C78A] text-[#00C78A]'
          : 'border-gray-200 text-[#1A1A1A] hover:border-[#00C78A]'
        }
        ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
      `}
    >
      {owned ? '✅' : '🎣'} 持ってる（{count}人）
    </button>
  );
}
