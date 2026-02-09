-- ルアーDBテーブル設計
-- 作成日: 2026-02-09

CREATE TABLE IF NOT EXISTS public.lures (
  -- Primary Key
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- 基本情報
  name TEXT NOT NULL,                      -- ルアー名
  manufacturer TEXT NOT NULL,              -- メーカー
  type TEXT NOT NULL,                      -- 種類（ミノー、クランク等）
  price NUMERIC(10, 2),                    -- 価格
  description TEXT,                        -- 説明文
  images TEXT[],                           -- 画像URL配列
  official_video_url TEXT,                 -- 公式動画URL
  
  -- 詳細情報
  target_fish TEXT[],                      -- 対象魚
  length NUMERIC(10, 2),                   -- 長さ（mm）
  weight NUMERIC(10, 2),                   -- 重さ（g）
  color_name TEXT,                         -- カラー名
  color_description TEXT,                  -- カラー説明
  release_year INTEGER,                    -- 発売年
  is_limited BOOLEAN DEFAULT FALSE,        -- 限定品フラグ
  diving_depth TEXT,                       -- 潜行深度
  action_type TEXT,                        -- アクション種類
  is_discontinued BOOLEAN DEFAULT FALSE,   -- 廃盤フラグ
  
  -- メタデータ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_lures_manufacturer ON public.lures(manufacturer);
CREATE INDEX IF NOT EXISTS idx_lures_type ON public.lures(type);
CREATE INDEX IF NOT EXISTS idx_lures_price ON public.lures(price);
CREATE INDEX IF NOT EXISTS idx_lures_release_year ON public.lures(release_year);
CREATE INDEX IF NOT EXISTS idx_lures_is_limited ON public.lures(is_limited);
CREATE INDEX IF NOT EXISTS idx_lures_is_discontinued ON public.lures(is_discontinued);

-- updated_at自動更新トリガー
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.lures
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security (RLS) 有効化
ALTER TABLE public.lures ENABLE ROW LEVEL SECURITY;

-- 公開読み取りポリシー（誰でも読める）
CREATE POLICY "Public lures are viewable by everyone"
  ON public.lures
  FOR SELECT
  USING (true);

-- コメント追加
COMMENT ON TABLE public.lures IS '世界最大のルアーデータベース - ルアー情報テーブル';
COMMENT ON COLUMN public.lures.name IS 'ルアー名';
COMMENT ON COLUMN public.lures.manufacturer IS 'メーカー名';
COMMENT ON COLUMN public.lures.type IS 'ルアー種類（ミノー、クランク、バイブレーション等）';
COMMENT ON COLUMN public.lures.official_video_url IS 'メーカー公式YouTube動画URL';
