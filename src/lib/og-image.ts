/**
 * OGP画像生成ユーティリティ
 * satori + @resvg/resvg-js で1200x630のPNG画像を生成
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LureSeries } from './types';

// フォントは一度だけ読み込んでキャッシュ
let fontData: ArrayBuffer | null = null;

/** フォント読み込み（ローカル/Vercelサーバーレス両対応） */
async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;

  // 候補パスを順番に試す（import.meta.urlベース → process.cwd()ベース）
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, '..', 'assets', 'fonts', 'NotoSansJP-Bold.ttf'),
    join(process.cwd(), 'src', 'assets', 'fonts', 'NotoSansJP-Bold.ttf'),
    join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Bold.ttf'),
  ];

  for (const fontPath of candidates) {
    try {
      if (existsSync(fontPath)) {
        const buffer = readFileSync(fontPath);
        fontData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        return fontData;
      }
    } catch {
      // パスアクセスに失敗した場合は次の候補へ
    }
  }

  // ファイルシステムにない場合はGoogle Fonts CDNからfetch（Vercelサーバーレス関数用）
  const cdnUrls = [
    'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-jp@latest/japanese-700-normal.ttf',
    'https://www.castlog.xyz/fonts/NotoSansJP-Bold.ttf',
  ];

  for (const cdnUrl of cdnUrls) {
    try {
      const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        fontData = await res.arrayBuffer();
        return fontData;
      }
    } catch {
      // CDNフェッチ失敗時は次の候補へ
    }
  }

  throw new Error('フォントの読み込みに失敗しました');
}

/** 外部画像をfetchしてPNG base64データURIに変換（satoriはWebP非対応のため） */
async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const pngBuf = await sharp(Buffer.from(arrayBuf))
      .resize(380, 380, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${pngBuf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** スペック表示用のヘルパー */
function formatWeight(series: LureSeries): string | null {
  if (!series.weight_range.min) return null;
  if (series.weight_range.min === series.weight_range.max) return `${series.weight_range.min}g`;
  return `${series.weight_range.min}g〜${series.weight_range.max}g`;
}

function formatPrice(series: LureSeries): string | null {
  if (series.price_range.max <= 0) return null;
  if (series.price_range.min === series.price_range.max) {
    return `¥${series.price_range.min.toLocaleString()}`;
  }
  return `¥${series.price_range.min.toLocaleString()}〜¥${series.price_range.max.toLocaleString()}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * ルアーシリーズのOGP画像をPNGバイナリとして生成
 */
export async function generateOgImage(series: LureSeries): Promise<Buffer> {
  const font = await loadFont();

  const weight = formatWeight(series);
  const price = formatPrice(series);
  const fishList = series.target_fish.length > 0
    ? truncate(series.target_fish.join(', '), 30)
    : null;

  // 外部画像をfetch → PNGデータURI化
  let imageDataUri: string | null = null;
  if (series.representative_image) {
    imageDataUri = await fetchImageAsDataUri(series.representative_image);
  }

  // スペック行を構築
  const specs: { label: string; value: string }[] = [];
  specs.push({ label: 'タイプ', value: series.type });
  if (weight) specs.push({ label: '重量', value: weight });
  if (series.color_count > 0) specs.push({ label: 'カラー', value: `${series.color_count}色展開` });
  if (fishList) specs.push({ label: '対象魚', value: fishList });
  if (price) specs.push({ label: '価格', value: price });

  // satori用のReact要素（JSX互換オブジェクト）
  const element = {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'row' as const,
        backgroundColor: '#0a0f1a',
        color: '#e8e6e3',
        fontFamily: 'NotoSansJP',
        position: 'relative' as const,
      },
      children: [
        // 左側: ルアー画像エリア
        {
          type: 'div',
          props: {
            style: {
              width: '460px',
              height: '630px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#111827',
              flexShrink: 0,
            },
            children: imageDataUri
              ? [{
                  type: 'img',
                  props: {
                    src: imageDataUri,
                    width: 380,
                    height: 380,
                    style: {
                      objectFit: 'contain' as const,
                    },
                  },
                }]
              : [{
                  // プレースホルダー: 画像なし
                  type: 'div',
                  props: {
                    style: {
                      width: '160px',
                      height: '160px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '16px',
                      backgroundColor: '#1f2937',
                      border: '2px solid #374151',
                    },
                    children: [{
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '14px',
                          color: '#6b7280',
                          textAlign: 'center' as const,
                        },
                        children: 'NO IMAGE',
                      },
                    }],
                  },
                }],
          },
        },
        // 右側: テキストエリア
        {
          type: 'div',
          props: {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column' as const,
              justifyContent: 'center',
              padding: '40px 48px 40px 40px',
              gap: '8px',
            },
            children: [
              // ルアー名
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: series.name.length > 20 ? '32px' : '40px',
                    fontWeight: 700,
                    lineHeight: 1.2,
                    color: '#ffffff',
                    marginBottom: '4px',
                  },
                  children: truncate(series.name, 35),
                },
              },
              // メーカー名
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '22px',
                    color: '#94a3b8',
                    marginBottom: '20px',
                  },
                  children: series.manufacturer,
                },
              },
              // 区切り線
              {
                type: 'div',
                props: {
                  style: {
                    width: '60px',
                    height: '3px',
                    backgroundColor: '#3b82f6',
                    marginBottom: '20px',
                  },
                },
              },
              // スペック一覧
              ...specs.map((spec) => ({
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'row' as const,
                    fontSize: '20px',
                    lineHeight: 1.6,
                    gap: '12px',
                  },
                  children: [
                    {
                      type: 'span',
                      props: {
                        style: {
                          color: '#64748b',
                          minWidth: '80px',
                        },
                        children: spec.label,
                      },
                    },
                    {
                      type: 'span',
                      props: {
                        style: { color: '#e2e8f0' },
                        children: spec.value,
                      },
                    },
                  ],
                },
              })),
            ],
          },
        },
        // 右下ロゴ
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute' as const,
              bottom: '24px',
              right: '36px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '18px',
                    color: '#475569',
                    letterSpacing: '2px',
                  },
                  children: 'CAST/LOG',
                },
              },
            ],
          },
        },
        // 上部アクセントライン
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute' as const,
              top: '0',
              left: '0',
              width: '1200px',
              height: '4px',
              background: 'linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%)',
            },
          },
        },
      ],
    },
  };

  const svg = await satori(element as any, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'NotoSansJP',
        data: font,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
