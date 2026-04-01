import { useState, useEffect } from 'react';

// 仮ユーザー生成（Supabase Auth有効化後に差し替え）
function generateUserId(): string {
  return 'local_' + crypto.randomUUID().slice(0, 12);
}

function getStoredUser(): { id: string; name: string; level: number } | null {
  try {
    const raw = localStorage.getItem('castlog_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveUser(user: { id: string; name: string; level: number }) {
  localStorage.setItem('castlog_user', JSON.stringify(user));
  localStorage.setItem('castlog_user_id', user.id);
}

export default function UserStatus() {
  const [user, setUser] = useState<{ id: string; name: string; level: number } | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
    }

    // ログインモーダル開放イベント
    const handler = () => setShowLogin(true);
    window.addEventListener('castlog:open-login', handler);
    return () => window.removeEventListener('castlog:open-login', handler);
  }, []);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const name = nameInput.trim() || 'アングラー';
    const newUser = { id: generateUserId(), name, level: 1 };
    saveUser(newUser);
    setUser(newUser);
    setShowLogin(false);
    setNameInput('');

    // 他コンポーネントにログインを通知
    window.dispatchEvent(
      new CustomEvent('castlog:login', { detail: { userId: newUser.id } })
    );
  }

  function handleLogout() {
    localStorage.removeItem('castlog_user');
    localStorage.removeItem('castlog_user_id');
    setUser(null);
  }

  return (
    <>
      {user ? (
        <div className="flex items-center gap-2">
          {/* アバター */}
          <div className="w-8 h-8 rounded-full bg-[#F7F7F7] border border-gray-200 flex items-center justify-center text-sm">
            {user.name.slice(0, 1)}
          </div>
          <span className="text-sm font-sans text-[#1A1A1A]">
            {user.name}
          </span>
          <span className="text-xs font-mono text-[#00C78A]">
            Lv.{user.level}
          </span>
          <button
            onClick={handleLogout}
            className="text-xs font-mono text-[#999999] hover:text-[#555555] transition-colors duration-150 ml-1 cursor-pointer"
          >
            ログアウト
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowLogin(true)}
          className="bg-white border border-gray-200 rounded px-4 py-2 text-sm font-mono text-[#1A1A1A] hover:border-[#00C78A] transition-colors duration-150 cursor-pointer"
        >
          ログイン
        </button>
      )}

      {/* ログインモーダル */}
      {showLogin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogin(false);
          }}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-sans font-medium text-[#1A1A1A]">
                ログイン
              </h3>
              <button
                onClick={() => setShowLogin(false)}
                className="text-[#999999] hover:text-[#555555] text-xl leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <p className="text-sm font-sans text-[#555555] mb-4">
              表示名を入力してください。アカウント機能は今後追加予定です。
            </p>

            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="表示名（例: バス太郎）"
                maxLength={20}
                autoFocus
                className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-sans text-[#1A1A1A] placeholder-[#CCCCCC] focus:outline-none focus:border-[#00C78A] transition-colors duration-150"
              />
              <button
                type="submit"
                className="rounded px-4 py-2 text-sm font-mono text-white bg-[#00C78A] hover:bg-[#00B07A] transition-colors duration-150 cursor-pointer"
              >
                はじめる
              </button>
            </form>

            <p className="text-xs font-sans text-[#999999] mt-3">
              ※ 現在はブラウザ内のみで動作します
            </p>
          </div>
        </div>
      )}
    </>
  );
}
