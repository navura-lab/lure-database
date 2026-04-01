#!/usr/bin/env python3
"""
GA4日次データ取得スクリプト

Usage:
    python3 scripts/ga4-daily-report.py              # 直近7日
    python3 scripts/ga4-daily-report.py --days 30    # 直近30日
    python3 scripts/ga4-daily-report.py --json       # JSON出力
"""

import sys
import json
from datetime import datetime, timedelta

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import RunReportRequest, DateRange, Metric, Dimension, OrderBy

PROPERTY_ID = "524881644"

def get_daily_data(days=7):
    client = BetaAnalyticsDataClient()
    request = RunReportRequest(
        property=f"properties/{PROPERTY_ID}",
        date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")],
        metrics=[
            Metric(name="activeUsers"),
            Metric(name="sessions"),
            Metric(name="screenPageViews"),
            Metric(name="averageSessionDuration"),
            Metric(name="bounceRate"),
            Metric(name="newUsers"),
        ],
        dimensions=[Dimension(name="date")],
        order_bys=[OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date"))],
    )
    return client.run_report(request)

def get_top_pages(days=7, limit=20):
    client = BetaAnalyticsDataClient()
    request = RunReportRequest(
        property=f"properties/{PROPERTY_ID}",
        date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="activeUsers"),
            Metric(name="averageSessionDuration"),
        ],
        dimensions=[Dimension(name="pagePath")],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="screenPageViews"), desc=True)],
        limit=limit,
    )
    return client.run_report(request)

def main():
    days = 7
    as_json = False
    for i, arg in enumerate(sys.argv):
        if arg == "--days" and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])
        if arg == "--json":
            as_json = True

    daily = get_daily_data(days)
    top_pages = get_top_pages(days)

    if as_json:
        result = {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "period": f"{days}days",
            "daily": [],
            "topPages": [],
        }
        for row in daily.rows:
            result["daily"].append({
                "date": row.dimension_values[0].value,
                "users": int(row.metric_values[0].value),
                "sessions": int(row.metric_values[1].value),
                "pageviews": int(row.metric_values[2].value),
                "avgDuration": round(float(row.metric_values[3].value), 1),
                "bounceRate": round(float(row.metric_values[4].value) * 100, 1),
                "newUsers": int(row.metric_values[5].value),
            })
        for row in top_pages.rows:
            result["topPages"].append({
                "path": row.dimension_values[0].value,
                "pageviews": int(row.metric_values[0].value),
                "users": int(row.metric_values[1].value),
                "avgDuration": round(float(row.metric_values[2].value), 1),
            })

        # ファイル保存
        outfile = f"logs/ga4-data/ga4-{datetime.now().strftime('%Y-%m-%d')}.json"
        import os
        os.makedirs("logs/ga4-data", exist_ok=True)
        with open(outfile, "w") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"\n保存: {outfile}", file=sys.stderr)
    else:
        print(f"=== GA4 直近{days}日データ（CAST/LOG） ===\n")
        print(f"{'日付':>12} {'ユーザー':>8} {'新規':>6} {'セッション':>10} {'PV':>6} {'滞在秒':>8} {'直帰率':>8}")
        total_users = total_sessions = total_pv = 0
        for row in daily.rows:
            d = row.dimension_values[0].value
            u = int(row.metric_values[0].value)
            s = int(row.metric_values[1].value)
            pv = int(row.metric_values[2].value)
            dur = float(row.metric_values[3].value)
            br = float(row.metric_values[4].value) * 100
            nu = int(row.metric_values[5].value)
            total_users += u; total_sessions += s; total_pv += pv
            print(f"{d:>12} {u:>8} {nu:>6} {s:>10} {pv:>6} {dur:>8.1f} {br:>7.1f}%")

        print(f"\n合計: ユーザー={total_users} セッション={total_sessions} PV={total_pv}")
        print(f"日平均: ユーザー={total_users/days:.1f} PV={total_pv/days:.1f}")

        print(f"\n=== TOP {min(20, len(top_pages.rows))}ページ ===\n")
        print(f"{'PV':>6} {'ユーザー':>8} {'滞在秒':>8} パス")
        for row in top_pages.rows:
            path = row.dimension_values[0].value
            pv = int(row.metric_values[0].value)
            u = int(row.metric_values[1].value)
            dur = float(row.metric_values[2].value)
            print(f"{pv:>6} {u:>8} {dur:>8.1f} {path}")

if __name__ == "__main__":
    main()
