import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface WantButtonProps {
  lureSlug: string;
  manufacturerSlug: string;
  initialCount: number;
  affiliateUrl?: string;
}

export default function WantButton({ lureSlug, manufacturerSlug, initialCount, affiliateUrl }: WantButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [wanted, setWanted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(true);
  const [showLinks, setShowLinks] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('castlog_user_id');
    if (stored) {
      setUserId(stored);
      checkWanted(stored);
    }

    const handler = (e: CustomEvent<{ userId: string }>) => {
      setUserId(e.detail.userId);
      checkWanted(e.detail.userId);
    };
    window.addEventListener('castlog:login', handler as EventListener);
    return () => window.removeEventListener('castlog:login', handler as EventListener);
  }, []);

  async function checkWanted(uid: string) {
    try {
      const { data, error } = await supabase
        .from('user_wants')
        .select('id')
        .eq('user_id', uid)
        .eq('lure_slug', lureSlug)
        .eq('manufacturer_slug', manufacturerSlug)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          setReady(false);
        }
        return;
      }
      if (data) {
        setWanted(true);
        setShowLinks(true);
      }
    } catch {
      setReady(false);
    }
  }

  async function handleClick() {
    if (!userId) {
      window.dispatchEvent(new CustomEvent('castlog:open-login'));
      return;
    }

    if (loading) return;
    setLoading(true);

    try {
      if (wanted) {
        // 解除
        const { error } = await supabase
          .from('user_wants')
          .delete()
          .eq('user_id', userId)
          .eq('lure_slug', lureSlug)
          .eq('manufacturer_slug', manufacturerSlug);

        if (error) throw error;
        setWanted(false);
        setShowLinks(false);
        setCount((c) => Math.max(0, c - 1));
      } else {
        // 登録
        const { error } = await supabase
          .from('user_wants')
          .insert({
            user_id: userId,
            lure_slug: lureSlug,
            manufacturer_slug: manufacturerSlug,
          });

        if (error) throw error;
        setWanted(true);
        setShowLinks(true);
        setCount((c) => c + 1);
      }
    } catch {
      // エラー時はUIを壊さない
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
    <div className="inline-flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`
          bg-white border rounded px-4 py-2 text-sm font-mono
          transition-colors duration-150 ease-in-out
          ${wanted
            ? 'border-[#00C78A] text-[#00C78A]'
            : 'border-gray-200 text-[#1A1A1A] hover:border-[#00C78A]'
          }
          ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
        `}
      >
        {wanted ? '💛' : '❤️'} 欲しい（{count}人）
      </button>

      {showLinks && affiliateUrl && (
        <div className="flex gap-2">
          <a
            href={`${affiliateUrl}&site=rakuten`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white border border-gray-200 rounded px-3 py-1.5 text-xs font-mono text-[#555555] hover:border-[#00C78A] transition-colors duration-150"
          >
            楽天で探す
          </a>
          <a
            href={`${affiliateUrl}&site=amazon`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white border border-gray-200 rounded px-3 py-1.5 text-xs font-mono text-[#555555] hover:border-[#00C78A] transition-colors duration-150"
          >
            Amazonで探す
          </a>
        </div>
      )}
    </div>
  );
}
