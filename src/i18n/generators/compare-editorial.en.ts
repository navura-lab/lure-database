/**
 * 英語版 比較ページ用エディトリアルテキスト生成
 *
 * 元: src/lib/compare-editorial.ts の英語版。
 * 魚種×タイプのコンテキスト + 選び方の3軸を英語で生成。
 */
import { LURE_TYPE_EN, FISH_NAME_EN } from '../dictionaries/fishing-terms';

// ── 魚種別コンテキスト（英語版）──

const FISH_CONTEXT_EN: Record<string, { field: string; season: string; tip: string }> = {
  シーバス: {
    field: 'Japanese seabass (suzuki) can be targeted across diverse environments including rivers, harbors, and surf',
    season: 'Year-round fishing is possible, from spring worm hatch patterns through fall gizzard shad patterns',
    tip: 'At night, use high-silhouette colors; during the day, rely on flashy finishes',
  },
  ブラックバス: {
    field: 'Largemouth bass inhabit ponds, reservoirs, rivers, and lakes across Japan',
    season: 'Peak seasons are the spring pre-spawn period and the fall feeding frenzy',
    tip: 'Natural colors for clear water, chartreuse or dark tones for murky conditions',
  },
  トラウト: {
    field: 'Trout are found in mountain streams, managed fishing areas, and clear lakes',
    season: 'Stream fishing runs March–September; managed areas peak in fall and winter',
    tip: 'Trout have sharp eyesight, making color rotation especially important',
  },
  青物: {
    field: 'Bluerunners (yellowtail, amberjack, etc.) are targeted from shore and offshore',
    season: 'Early summer through late fall is the main migration season; dawn bite windows are critical',
    tip: 'Casting distance and fall speed are the most important factors in lure selection',
  },
  ヒラメ: {
    field: 'Japanese flounder (hirame) are primarily targeted on sandy surf beaches near rip currents',
    season: 'Spring and fall are peak seasons; winter "zabuton" (trophy-size) flatfish are prized',
    tip: 'Select lures that can maintain a depth of 50cm–1m above the bottom',
  },
  マダイ: {
    field: 'Red sea bream (madai) are mainly targeted offshore via tai rubber and jigging at 30–100m depth',
    season: 'Best seasons are the spring spawning run and the aggressive fall feeding period',
    tip: 'Match head weight to water depth and rotate necktie colors to trigger strikes',
  },
  イカ: {
    field: 'Squid (mainly bigfin reef squid) are targeted from piers and rocky shores via eging',
    season: 'Two peak seasons: spring for large spawning adults, fall for numbers (new hatchlings)',
    tip: 'Match egi size to the squid size; choose sink rate based on water depth',
  },
  アジ: {
    field: 'Horse mackerel (aji) are targeted around harbor light poles via ajing (light game)',
    season: 'Fall is the best season, though winter trophy-size aji are popular targets',
    tip: 'Ultra-small worms paired with lightweight jigheads are the ajing standard',
  },
  メバル: {
    field: 'Japanese rockfish (mebaru) are found around harbors, tetrapods, and rocky shores',
    season: 'Winter through spring is the main season; night fishing is most productive',
    tip: 'Surface-level steady retrieves are fundamental; switching between plugs and worms changes results',
  },
  マゴチ: {
    field: 'Bartail flathead (magochi) inhabit sandy and muddy bottoms along surf and estuaries',
    season: 'Early summer through fall is peak season; often found in the same spots as flounder',
    tip: 'Since magochi stay right on the bottom, lures that can reach the bottom are essential',
  },
  カンパチ: {
    field: 'Greater amberjack (kampachi) are structure-oriented fish found around reefs and offshore',
    season: 'Summer through fall is best; large specimens also migrate in winter',
    tip: 'Bottom-oriented jigging is the standard approach; expect frequent snags',
  },
  ブリ: {
    field: 'Japanese yellowtail (buri) are popular targets for shore jigging and offshore jigging',
    season: 'Fall through winter "kan-buri" (cold yellowtail) season is the highlight; spring runs also occur',
    tip: 'Strong tackle setups are essential for big yellowtail battles',
  },
  ヒラマサ: {
    field: 'Yellowtail amberjack (hiramasa) are targeted from rocky shores and via offshore jigging',
    season: 'Spring through fall is the main season; spring is peak for trophy-size shore casting',
    tip: 'As the strongest fighter among bluerunners, tackle strength is the top priority',
  },
  マグロ: {
    field: 'Tuna are targeted via offshore casting and jigging in big-game scenarios',
    season: 'Summer through fall is the main season; Sagami Bay yellowfin tuna are especially popular',
    tip: 'Use large lures; hook and split ring strength should be the top selection criterion',
  },
  タコ: {
    field: 'Octopus can be targeted from piers and breakwaters to boats across various fields',
    season: 'Summer is the best season; shore-side spawning octopus are easiest to catch',
    tip: 'Bottom jigging is fundamental; egi color and size selection determine your catch rate',
  },
  ハタ: {
    field: 'Grouper (hata) are rockfish found around reefs, rubble shores, and pier structures',
    season: 'Summer through fall is peak season as grouper activity rises with water temperature',
    tip: 'Careful bottom-area approaches are essential; snag-prevention measures are a must',
  },
  チヌ: {
    field: 'Black sea bream (chinu/kurodai) inhabit estuaries, harbors, and tidal flats in brackish zones',
    season: 'Spring spawning runs and fall aggressive feeding are peak; fishable year-round',
    tip: 'Using different lures for top, mid, and bottom zones is the key to success',
  },
};

// ── タイプ別の選び方ポイント（英語版）──

const TYPE_CRITERIA_EN: Record<string, { key1: string; key2: string; key3: string }> = {
  ミノー: {
    key1: 'Lip shape and diving depth',
    key2: 'Body size and weight (casting distance)',
    key3: 'Buoyancy type: floating, sinking, or suspending',
  },
  メタルジグ: {
    key1: 'Weight and fall posture (center-balanced vs rear-balanced)',
    key2: 'Body profile (slim vs fat)',
    key3: 'Flash intensity and color selection',
  },
  ワーム: {
    key1: 'Size (inches) matched to target fish mouth size',
    key2: 'Tail shape (shad tail / pin tail / curly tail, etc.)',
    key3: 'Material softness vs durability balance',
  },
  バイブレーション: {
    key1: 'Weight, and presence/absence of rattle',
    key2: 'Casting distance and fall speed',
    key3: 'Sink rate and depth-keeping ability',
  },
  スプーン: {
    key1: 'Weight and shape (wide vs narrow)',
    key2: 'Action type (wobbling vs rolling)',
    key3: 'Surface finish (mirror / hammered / matte) flash',
  },
  クランクベイト: {
    key1: 'Lip length and diving depth (SR / MR / DR)',
    key2: 'Body buoyancy (high-float vs low-float)',
    key3: 'Action quality (wide wobble vs tight wiggle)',
  },
  シンキングペンシル: {
    key1: 'Weight and casting distance',
    key2: 'Fall posture and sink rate',
    key3: 'Swimming action on retrieve',
  },
  トップウォーター: {
    key1: 'Action type (pop / walk-the-dog / prop)',
    key2: 'Sound quality and volume',
    key3: 'Castability (weight transfer system)',
  },
  ラバージグ: {
    key1: 'Head shape (arky / football / swim)',
    key2: 'Weight and brush guard strength',
    key3: 'Skirt volume and color',
  },
  ジグヘッド: {
    key1: 'Head shape (round / dart / shaky)',
    key2: 'Hook size and gape width',
    key3: 'Weight variation range',
  },
  エギ: {
    key1: 'Size (gou) matched to target squid size',
    key2: 'Sink type (normal / shallow / deep)',
    key3: 'Base tape rotation (gold / silver / red / marble)',
  },
  タイラバ: {
    key1: 'Head weight and shape (round / slide)',
    key2: 'Necktie shape, length, and color',
    key3: 'Head material (lead vs tungsten) fall speed difference',
  },
  スイムベイト: {
    key1: 'Size and matching baitfish',
    key2: 'Soft type vs hard type selection',
    key3: 'Swimming action quality and optimal retrieve speed',
  },
  ペンシルベイト: {
    key1: 'Walk-the-dog action ease',
    key2: 'Size and weight (casting distance)',
    key3: 'Weight transfer system presence',
  },
  ポッパー: {
    key1: 'Cup shape and pop sound quality',
    key2: 'Splash size',
    key3: 'Size and castability',
  },
  バズベイト: {
    key1: 'Blade shape and buzz sound quality',
    key2: 'Head weight and lift speed',
    key3: 'Trailer hook compatibility',
  },
  フロッグ: {
    key1: 'Body material softness (directly affects hookup rate)',
    key2: 'Weight and casting accuracy',
    key3: 'Hook size and snag guard performance',
  },
  シャッド: {
    key1: 'Lip angle and diving depth',
    key2: 'Suspend precision',
    key3: 'Body size and matching baitfish',
  },
  チャターベイト: {
    key1: 'Blade vibration quality',
    key2: 'Head weight and depth range',
    key3: 'Skirt color and trailer compatibility',
  },
  ジョイントベイト: {
    key1: 'Number of joints and S-action smoothness',
    key2: 'Size and field matching',
    key3: 'Buoyancy: floating / sinking / slow floating',
  },
  スピナーベイト: {
    key1: 'Blade combo (double willow / tandem, etc.)',
    key2: 'Head weight and depth range',
    key3: 'Skirt volume and color',
  },
};

// ── エディトリアルテキスト生成 ──

export interface CompareEditorialEn {
  contextParagraph: string;
  selectionCriteria: string[] | null;
}

export function getCompareEditorialEn(
  fishName: string,
  typeName: string,
  totalCount: number,
): CompareEditorialEn {
  const fishCtx = FISH_CONTEXT_EN[fishName];
  const typeCrit = TYPE_CRITERIA_EN[typeName];
  const fishEn = FISH_NAME_EN[fishName] ?? fishName;
  const typeEn = LURE_TYPE_EN[typeName] ?? typeName;

  let contextParagraph: string;

  if (fishCtx) {
    contextParagraph =
      `${fishCtx.field}. ` +
      `${fishCtx.season}. ` +
      `When choosing a ${typeEn.toLowerCase()}, ${fishCtx.tip.charAt(0).toLowerCase() + fishCtx.tip.slice(1)}. ` +
      `CAST/LOG's database contains ${totalCount} ${typeEn.toLowerCase()} series for ${fishEn}, ` +
      `allowing side-by-side comparison of color options, specs, and pricing to find the perfect match.`;
  } else {
    contextParagraph =
      `${totalCount} ${typeEn.toLowerCase()} series are cataloged for ${fishEn}. ` +
      `Selecting the right lure for target size and field conditions is crucial to success. ` +
      `A wide color lineup indicates versatility, and comparing specs side by side helps you make the best choice.`;
  }

  const selectionCriteria = typeCrit
    ? [typeCrit.key1, typeCrit.key2, typeCrit.key3]
    : null;

  return { contextParagraph, selectionCriteria };
}
