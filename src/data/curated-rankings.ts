/**
 * 実績ベースのキュレーテッドランキング
 *
 * 複数の外部ソース（TSURI HACK、マイベスト、sakidori、シアターカミカゼ、
 * タックルノート、360.life、Amazon売上、Yahoo!ショッピング等）を横断的に調査し、
 * 複数ソースで繰り返し名前が挙がる実績ルアーを上位に配置。
 *
 * キーは ranking/[slug] のslug（例: "seabass-minnow"）
 * 値は manufacturer_slug/series_slug の配列（上位から順）
 *
 * このリストに含まれるシリーズは掲載順の上位に固定され、
 * リストにないシリーズはアルゴリズムスコア順で後続する。
 *
 * ※ DB上のtarget_fishとtypeが一致するシリーズのみ有効。
 *   不一致の場合は自動的にスキップされる。
 */

export const curatedRankings: Record<string, string[]> = {
  // ─── シーバス×ミノー ───
  // 出典: TSURI HACK, Amazon, Yahoo!ショッピング, シアターカミカゼ
  'seabass-minnow': [
    'shimano/sairentoasashin-99f-99s-99sp-furasshubusuto', // サイレントアサシン 99F/99S/99SP FB
    'ima/sasuke-120',                                      // sasuke 120 裂波
    'daiwa/eopcilx',                                       // セットアッパー S-DR
    'megabass/kagelou124',                                 // KAGELOU 124F
    'blueblue/buroin-140s',                                // ブローウィン！140S
    'daiwa/0ia3b6l',                                       // バーティス R
    'shimano/a155f00000c5cxfqaf',                          // シャローアサシン 99F FB
    'osp/asura-o-s-p-rudra-130-sp-sw',                     // RUDRA 130 SP SW
    'megabass/x-80sw',                                     // X-80SW
    'ima/komomoii',                                        // komomoII
    'shimano/a155f00000c5czxqav',                          // サイレントアサシン 120F FB
    'shimano/a155f00000c5cwmqav',                          // サイレントアサシン 120F JB
    'daiwa/un3mqns',                                       // セットアッパー フルバック 125S-DR
    'ima/sasuke-140',                                      // sasuke 140 裂波
    'shimano/a155f00000cpd8xqah',                          // サイレントアサシン 80F/80S FB
    'shimano/a155f00000c5cxeqaf',                          // サイレントアサシン 160F JB
    'megabass/x-80sw-lbo',                                 // X-80SW LBO
  ],

  // ─── シーバス×バイブレーション ───
  // 出典: TSURI HACK, Lure Zukan, シアターカミカゼ
  'seabass-vibration': [
    'bassday/renjibaibu-45es55es70es80es90es100es',        // レンジバイブ ES（累計200万個超の定番）
    'shimano/sarubeji-soriddo-60es-70s-70es-85es',         // サルベージソリッド
    'daiwa/kv60wxt',                                       // ミニエント レーザーインパクト
    'shimano/sarubeji-60es-70s-70es-85s-85es',             // サルベージ
    'evergreen/marvie50',                                  // マービー50
    'ja-do/rein-14g',                                      // 冷音 14g
    'ja-do/rein-24g',                                      // 冷音 24g
    'bassday/renjibaibu-55tg70tg',                         // レンジバイブ TG
  ],

  // ─── シーバス×メタルバイブ ───
  // 出典: TSURI HACK, Lure Zukan, シアターカミカゼ
  'seabass-metal-vib': [
    'coreman/ip-26-ironplate-sc',                          // IP-26（専用シングルフック、瞬間起動）
    'daiwa/74d36vu',                                       // リアルスティール
    'jackson/teppan-vib-9g-14g-20g-26g',                   // 鉄PANバイブ
    'coreman/ip-13-ironplate-sc',                          // IP-13
    'daiwa/kth66pg',                                       // リアルスティールTG
    'jackson/teppan-vib-3g-5g-7g',                         // 鉄PANバイブ ライト
  ],

  // ─── シーバス×シンキングペンシル ───
  // 出典: TSURI HACK, シアターカミカゼ, Lure Zukan
  'seabass-sinking-pencil': [
    'daiwa/p84ie5s',                                       // スイッチヒッター
    'luckycraft/wander-salt',                              // ワンダー（シンペンの元祖）
    'jumprize/buttobi-kun95s',                             // ぶっ飛び君95S
    'daiwa/g37fonx',                                       // ガルバ
    'apia/punch-line-80',                                  // パンチライン80
    'shimano/toraidento-60s-90s-115s-130s-jettobusuto',    // トライデント JB
    'blueblue/snecon-90s',                                 // スネコン90S
    'megabass/genma110s',                                  // ゲンマ110S
    'longin/levin',                                        // レビン
    'duo/bay-ruf-manic-75',                                // マニック75
    'daiwa/46q7d5g',                                       // スイッチヒッター LI
    'blueblue/snecon-130s',                                // スネコン130S
    'apia/punch-line-95',                                  // パンチライン95
    'jumprize/buttobi-kun-light95ss',                      // ぶっ飛び君ライト95SS
  ],

  // ─── ブラックバス×クランクベイト ───
  // 出典: TSURI HACK, sakidori, マイベスト
  'black-bass-crankbait': [
    'osp/blitz',                                           // BLITZ（全レンジ揃い、多くのプロ愛用）
    'evergreen/wildhunch',                                 // ワイルドハンチ（日米で実績多数）
    'megabass/sr-x-griffon',                               // SR-X GRIFFON
    'daiwa/op4em6r',                                       // ピーナッツ（超定番）
    'megabass/deep-x300',                                  // DEEP-X300
    'nories/shot-over-3',                                  // SHOT OVER 3
    'megabass/deep-x100-lbo',                              // DEEP-X100 LBO
    'evergreen/wildhunch8footer',                          // ワイルドハンチ8フッター
    'osp/blitz-mr',                                        // BLITZ MR
    'osp/blitz-ex-dr',                                     // BLITZ EX-DR
    'osp/tiny-blitz',                                      // Tiny BLITZ
    'evergreen/rattleinwildhunch',                         // ラトルインワイルドハンチ
    'daiwa/iijne50',                                       // デカピーナッツ II
  ],

  // ─── ブラックバス×ワーム ───
  // 出典: TSURI HACK, タックルノート, Amazon
  'black-bass-worm': [
    'gary-yamamoto/senko4',                                // 4″ヤマセンコー（エサと呼ばれる反則ワーム）
    'gary-yamamoto/kuttail4',                              // 4″カットテール（ネコリグ定番）
    'osp/dolivestick',                                     // DoliveStick
    'gary-yamamoto/grub4',                                 // 4″グラブ（40年以上の実績）
    'osp/dolivessgill',                                    // DoLiveSS-Gill
    'osp/dolivecraw',                                      // DoLiveCraw
    'osp/doliveshad',                                      // DoliveShad
    'gary-yamamoto/legworm25',                             // 2.5″レッグワーム
    'nories/escape-twin',                                  // F-ESCAPE TWIN
    'dstyle/virola2-8',                                    // ヴィローラ 2.8
    'gary-yamamoto/senko5',                                // 5″ヤマセンコー
    'osp/dolivehog',                                       // DoliveHog
    'osp/doliveshrimp',                                    // DoliveShrimp
    'gary-yamamoto/kuttail3-5',                            // 3.5″カットテール
    'osp/dolivecrawler',                                   // DoliveCrawler
    'osp/dolivestickfat',                                  // DoliveStickFAT
    'gary-yamamoto/senko3',                                // 3″ヤマセンコー
    'smith/bass-fatika',                                   // ファットイカ
  ],

  // ─── 青物×メタルジグ ───
  // 出典: TSURI HACK, マイベスト, Amazon, 25人投票
  'bluerunner-metal-jig': [
    'majorcraft/jps',                                      // ジグパラ ショート（4,148人投票1位）
    'daiwa/huz2stf',                                       // TGベイト
    'hayabusa/fs417',                                      // ジャックアイマキマキ
    'jackall/bigbackerjig',                                // ビッグバッカージグ
    'daiwa/7c5pl9f',                                       // サムライジグR
    'majorcraft/jptg',                                     // ジグパラ タングステン
    'zeake/r-sardine',                                     // R-SARDINE
    'daiwa/2tg85hj',                                       // TGベイト SLJ
    'daiwa/62ez8tl',                                       // サムライジグR スローフォール
    'jackall/bigbacker-fitjig',                            // ビッグバッカーフィットジグ
  ],

  // ─── ヒラメ・マゴチ×ミノー ───
  // DB上 target_fish='ヒラメ・マゴチ' のシリーズ
  'hirame-magochi-minnow': [
    'shimano/hiramemino-135f-135s-furasshubusuto',         // ヒラメミノー 135F/135S FB（不動の王者）
    'shimano/hiramemino-3-125f-125s-jettobusuto',          // ヒラメミノーⅢ JB
    'shimano/hiramemino-sr-130f-130s-furasshubusuto',      // ヒラメミノーSR FB
  ],

  // ─── ヒラメ×ミノー ───
  // DB上 target_fish='ヒラメ' のシリーズ
  'hirame-minnow': [
    'jumprize/surface-wing147f',                           // サーフェスウイング147F
    'duo/beach-walker-guado-130s',                         // ビーチウォーカー Guado 130S
    'jackson/athlete-12-fs-vg-14-fs-vg',                   // アスリート+ 12/14 FS VG
    'jumprize/surface-wing120f',                           // サーフェスウイング120F
    'duo/beach-walker-120md',                              // ビーチウォーカー 120MD
  ],

  // ─── トラウト×スプーン ───
  // 出典: TSURI HACK, トラウトフィッシング専門サイト
  'trout-spoon': [
    'forest/miusutandadokara',                             // MIU スタンダード
    'forest/miu-1-5g-3-5g',                                // MIU 1.5g 3.5g
    'jackall/tearo',                                       // ティアロ
    'valkein/hi-burst',                                    // ハイバースト
    'forest/pal-2016',                                     // PAL
    'shimano/uoburusuima',                                 // ウォブルスイマー（カーディフ）
    'forest/marshal-tournament',                           // マーシャル トーナメント
    'forest/miu-2-8g',                                     // MIU 2.8g
    'forest/miu-1-4g',                                     // MIU 1.4g
    'jackall/chibitearo',                                  // ちびティアロ
    'forest/mebius',                                       // メビウス
    'forest/realize',                                      // リアライズ
    'valkein/scheila',                                     // シャイラ
    'shimano/rorusuima-0-9g-3-5g',                         // ロールスイマー
    'forest/marshal',                                      // マーシャル
  ],

  // ─── メバル×ワーム ───
  // 出典: TSURI HACK, Amazon, マイベスト
  // ※ target_fish=メバルのシリーズのみ有効
  'mebaru-worm': [
    'daiwa/epecxf5',                                       // 月下美人 ビームスティック
    'daiwa/acnbnh1',                                       // 月下美人シラスビーム
    'ecogear/mebaru-pawashirasu',                          // メバル職人 パワーシラス
    'daiwa/rr8e0og',                                       // 月下美人 デュアルビーム
    'ecogear/ekogia-akua-mebarumino',                      // 熟成アクア 活メバルミノー
    'daiwa/v62ag37',                                       // 月下美人ソードビーム
    'ecogear/mebaru-sutoroterugurabu',                     // メバル職人 ストローテールグラブ
  ],

  // ─── アジ×ワーム ───
  // 出典: TSURI HACK, Amazon
  'aji-worm': [
    'daiwa/epecxf5',                                       // 月下美人 ビームスティック
    'daiwa/a2mroil',                                       // 月下美人 アジングビーム
    'jackall/kibikibinago',                                // キビキビナ〜ゴ
    'daiwa/g6pqtb4',                                       // 月下美人 アジングビームFAT
    'jackall/pekering',                                    // ペケリング
    'daiwa/96a3pji',                                       // 月下美人 アジングビーム 極み
    'daiwa/du5dyjs',                                       // 月下美人 ビームスティック極み
  ],

  // ─── シーバス×その他（ローリングベイト系） ───
  'seabass-other': [
    'tacklehouse/rollingbait',                             // ローリングベイト（唯一無二の存在）
    'tacklehouse/roringubeito-botomuchun',                 // ローリングベイト ボトムチューン
    'tacklehouse/roringubeitorippuresu',                   // ローリングベイトリップレス
  ],
};

/**
 * カテゴリslugに対するキュレーテッドランキングを取得
 * @returns 存在しなければ空配列
 */
export function getCuratedRanking(categorySlug: string): string[] {
  return curatedRankings[categorySlug] ?? [];
}
