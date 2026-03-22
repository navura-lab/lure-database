#!/usr/bin/env python3
"""
type分類監査スクリプト — .cache/lures.json を読み込み、
疑わしいシリーズを5つのルールで検出して /tmp/type-audit-full.json に保存する。
DB修正は行わない。
"""

import json
import re
from collections import defaultdict
from pathlib import Path

CACHE = Path(__file__).resolve().parent.parent / ".cache" / "lures.json"
OUT = Path("/tmp/type-audit-full.json")

# ── ルール1: descriptionのtype言及 vs DB type ─────────────────────
# (descキーワード, 除外正規表現, 許容type群)
DESC_TYPE_RULES = [
    ("バイブレーション", r"バイブレーション(を抑え|的|ライク|要素|アクション|幅|の[よ良]う|で沈|で泳|しながら|を発生|を伴)", {"バイブレーション", "メタルバイブ"}),
    ("ワーム",          r"ワーム(ライク|的|の[よ良]う|キーパー|フック|ボディ|セッティング|をセット|をトレーラー|感覚)", {"ワーム"}),
    ("ソフトベイト",    r"ソフトベイト(ライク|的)", {"ワーム"}),
    ("ソフトプラスチック", None, {"ワーム"}),
    ("メタルジグ",      r"メタルジグ(に匹敵|以上|並み|ライク|的|の[よ良]う|では届かない|のような飛距離)", {"メタルジグ"}),
    ("スプーン",        r"(スプーン(ライク|的|の[よ良]う)|テーブルスプーン|ティースプーン)", {"スプーン"}),
    ("エギ",            r"エギ(ング|ライク|的|の[よ良]う)", {"エギ"}),
    ("クランクベイト",  r"クランクベイト(ライク|的)", {"クランクベイト"}),
    ("クランク",        r"(クランク(ライク|的|アクション|シャフト|ベイト)|クランキング)", {"クランクベイト"}),
    ("スピナーベイト",  r"スピナーベイト(ライク|的)", {"スピナーベイト"}),
    ("チャターベイト",  r"チャターベイト(ライク|的)", {"チャターベイト"}),
    ("ブレーデッドジグ", None, {"チャターベイト"}),
    ("ポッパー",        r"ポッパー(ライク|的|の[よ良]う)", {"ポッパー", "トップウォーター"}),
    ("ペンシルベイト",  None, {"ペンシルベイト", "シンキングペンシル", "ダイビングペンシル", "トップウォーター"}),
    ("ペンシル",        r"(ペンシル(ライク|的|の[よ良]う|アクション)|ペンシルベイト|シンキングペンシル|ダイビングペンシル)", {"ペンシルベイト", "シンキングペンシル", "ダイビングペンシル", "トップウォーター"}),
    ("フロッグ",        r"フロッグ(ライク|的|の[よ良]う|ゲーム)", {"フロッグ", "トップウォーター"}),
    ("スイムベイト",    r"スイムベイト(ライク|的)", {"スイムベイト"}),
    ("バズベイト",      r"バズベイト(ライク|的)", {"バズベイト", "トップウォーター"}),
]

# ── ルール2: 名前のtype言及 vs DB type ─────────────────────────
# (名前パターン正規表現, 許容type群)
NAME_TYPE_RULES = [
    (r"(?i)\bVib\b", {"バイブレーション", "メタルバイブ"}),
    (r"(?i)\bCrank\b", {"クランクベイト"}),
    (r"(?i)\bSpoon\b", {"スプーン"}),
    (r"(?i)\bJig\b(?!head)", {"メタルジグ", "ラバージグ", "ジグヘッド"}),
    (r"(?i)\bSwim\s*Bait\b", {"スイムベイト"}),
    (r"(?i)\bWorm\b", {"ワーム"}),
    (r"(?i)\bGrub\b", {"ワーム"}),
    (r"(?i)\bCraw\b", {"ワーム"}),
]

# ── ルール3: メーカー偏り除外対象（ワーム専門メーカー） ────────
WORM_SPECIALISTS = {
    "zoom", "z-man", "missile-baits", "xzone-lures", "lunker-city",
    "riot-baits", "googan-baits",
}

# ── ルール4: 非ルアー検出キーワード ────────────────────────────
# descriptionの冒頭で「〜は」「〜の」と主語的に登場するパターン
NON_LURE_PATTERNS = [
    r"^(ロッド|竿|リール|シューズ|グローブ|手袋|バッグ|ケース|プライヤー|ハサミ|フィッシュグリップ|ランディングネット|タモ|偏光|サングラス|ウェーダー|ネット|ギャフ)",
    r"^【推奨タックル】",  # タックル情報がdescriptionに入っているパターン
]

# ── ルール5: AI捏造テンプレ検出 ────────────────────────────────
AI_TEMPLATE_PHRASES = [
    r"に特化した",
    r"を高い次元で両立",
    r"を攻略する",
    r"高い次元で実現",
    r"あらゆるシーンに対応",
    r"カバーする万能",
    r"最適化された",
    r"研ぎ澄まされた",
    r"妥協なき",
    r"極限まで追求",
    r"唯一無二の",
    r"至高の",
    r"コンセプトに基づ",
    r"を武器に",
    r"が魅力の",
    r"を可能にする",
    r"を両立した",
]

def is_official_source(url: str) -> bool:
    """メーカー公式URLかどうかの簡易判定"""
    if not url:
        return False
    official_patterns = [
        r"\.co\.jp", r"\.com/", r"\.net/",
        r"daiwa\.com", r"shimano", r"megabass", r"jackall",
        r"deps\.co", r"evergreen", r"gancraft", r"duo",
    ]
    # ECサイトは非公式
    ec_patterns = [r"amazon", r"rakuten", r"yahoo", r"tackle-berry"]
    for p in ec_patterns:
        if re.search(p, url, re.I):
            return False
    return True  # ほとんどのsource_urlは公式なので、あれば公式扱い

def main():
    with open(CACHE, "r") as f:
        rows = json.load(f)

    # slugごとにグループ化（シリーズ単位）
    series = defaultdict(list)
    for r in rows:
        key = f"{r['manufacturer_slug']}/{r['slug']}"
        series[key].append(r)

    # 各シリーズの代表行（最初の行）を取得
    reps = {}
    for key, items in series.items():
        rep = items[0].copy()
        rep["_count"] = len(items)
        reps[key] = rep

    suspects = {
        "rule1_desc_type_mismatch": [],
        "rule2_name_type_mismatch": [],
        "rule3_maker_bias": [],
        "rule4_non_lure": [],
        "rule5_ai_fabrication": [],
    }
    seen_keys = set()

    # ── ルール1 ────────────────────────────────
    for key, rep in reps.items():
        desc = rep.get("description") or ""
        db_type = rep.get("type") or ""
        if not desc:
            continue

        for keyword, exclude_re, allowed_types in DESC_TYPE_RULES:
            if keyword not in desc:
                continue
            # 修飾的用法チェック
            if exclude_re and re.search(exclude_re, desc):
                # 修飾的用法がある場合、キーワード単独での出現もチェック
                # 修飾的用法を取り除いた残りにまだキーワードがあるか
                cleaned = re.sub(exclude_re, "", desc)
                if keyword not in cleaned:
                    continue
            if db_type not in allowed_types:
                suspects["rule1_desc_type_mismatch"].append({
                    "key": key,
                    "name": rep["name"],
                    "type": db_type,
                    "rule": "rule1",
                    "detail": f"descに「{keyword}」あり → type={db_type}（期待: {', '.join(allowed_types)}）",
                    "desc_preview": desc[:120],
                })
                seen_keys.add(key)
                break  # 1シリーズ1ヒットで十分

    # ── ルール2 ────────────────────────────────
    for key, rep in reps.items():
        name = rep.get("name") or ""
        db_type = rep.get("type") or ""

        for pattern, allowed_types in NAME_TYPE_RULES:
            if re.search(pattern, name):
                if db_type not in allowed_types:
                    suspects["rule2_name_type_mismatch"].append({
                        "key": key,
                        "name": name,
                        "type": db_type,
                        "rule": "rule2",
                        "detail": f"名前に {pattern} マッチ → type={db_type}（期待: {', '.join(allowed_types)}）",
                        "desc_preview": (rep.get("description") or "")[:120],
                    })
                    seen_keys.add(key)
                    break

    # ── ルール3 ────────────────────────────────
    maker_types = defaultdict(lambda: defaultdict(list))
    for key, rep in reps.items():
        maker = rep["manufacturer_slug"]
        t = rep.get("type") or "不明"
        maker_types[maker][t].append(key)

    for maker, types_dict in maker_types.items():
        if maker in WORM_SPECIALISTS:
            continue
        total = sum(len(v) for v in types_dict.values())
        if total < 5:
            continue
        for t, keys in types_dict.items():
            ratio = len(keys) / total
            if ratio >= 0.7:
                for k in keys:
                    rep = reps[k]
                    suspects["rule3_maker_bias"].append({
                        "key": k,
                        "name": rep["name"],
                        "type": rep.get("type") or "",
                        "rule": "rule3",
                        "detail": f"{maker}: {len(keys)}/{total}件({ratio:.0%})が{t}（フォールバック疑い）",
                        "desc_preview": (rep.get("description") or "")[:120],
                    })
                    seen_keys.add(k)

    # ── ルール4 ────────────────────────────────
    for key, rep in reps.items():
        desc = rep.get("description") or ""
        if not desc:
            continue
        for pattern in NON_LURE_PATTERNS:
            if re.search(pattern, desc):
                suspects["rule4_non_lure"].append({
                    "key": key,
                    "name": rep["name"],
                    "type": rep.get("type") or "",
                    "rule": "rule4",
                    "detail": f"descriptionが非ルアー用語で始まる",
                    "desc_preview": desc[:120],
                })
                seen_keys.add(key)
                break

    # ── ルール5 ────────────────────────────────
    # リライト済み（250文字以下）でAIテンプレ語句2個以上、
    # またはsource_url空でテンプレ語句2個以上
    for key, rep in reps.items():
        desc = rep.get("description") or ""
        source = rep.get("source_url") or ""
        if not desc or len(desc) < 50:
            continue
        matches = sum(1 for p in AI_TEMPLATE_PHRASES if re.search(p, desc))
        is_rewritten = len(desc) <= 250
        if (matches >= 2 and is_rewritten) or (matches >= 2 and not source):
            suspects["rule5_ai_fabrication"].append({
                "key": key,
                "name": rep["name"],
                "type": rep.get("type") or "",
                "rule": "rule5",
                "detail": f"AIテンプレ語句{matches}個マッチ、desc長={len(desc)}字、source_url={'あり' if source else '(空)'}",
                "desc_preview": desc[:120],
            })
            seen_keys.add(key)

    # ── サマリー ───────────────────────────────
    summary = {
        "rule1": len(suspects["rule1_desc_type_mismatch"]),
        "rule2": len(suspects["rule2_name_type_mismatch"]),
        "rule3": len(suspects["rule3_maker_bias"]),
        "rule4": len(suspects["rule4_non_lure"]),
        "rule5": len(suspects["rule5_ai_fabrication"]),
        "total_unique": len(seen_keys),
    }

    result = {
        "scan_date": "2026-03-23",
        "total_series": len(reps),
        "suspects_by_rule": suspects,
        "summary": summary,
    }

    with open(OUT, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"=== type監査完了 ===")
    print(f"総シリーズ数: {len(reps)}")
    print(f"ルール1 (desc/type矛盾):   {summary['rule1']}件")
    print(f"ルール2 (名前/type矛盾):   {summary['rule2']}件")
    print(f"ルール3 (メーカー偏り):     {summary['rule3']}件")
    print(f"ルール4 (非ルアー):         {summary['rule4']}件")
    print(f"ルール5 (AI捏造):           {summary['rule5']}件")
    print(f"ユニーク合計:               {summary['total_unique']}件")
    print(f"\n→ /tmp/type-audit-full.json に保存済み")

if __name__ == "__main__":
    main()
