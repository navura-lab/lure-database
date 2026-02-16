-- Migration 001: Add slug and manufacturer_slug columns
-- 実行方法: Supabaseダッシュボード → SQL Editor → この内容をペーストして実行
-- 日付: 2026-02-16

-- 1. 既存データ全削除
TRUNCATE TABLE public.lures;

-- 2. 新カラム追加
ALTER TABLE public.lures
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer_slug TEXT;

-- 3. NOT NULL制約
ALTER TABLE public.lures
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN manufacturer_slug SET NOT NULL;

-- 4. インデックス追加
CREATE INDEX IF NOT EXISTS idx_lures_slug ON public.lures(slug);
CREATE INDEX IF NOT EXISTS idx_lures_manufacturer_slug ON public.lures(manufacturer_slug);
