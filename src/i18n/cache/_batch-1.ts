import type { TranslatedArticle } from './article-translations-en';

export const batch1: Record<string, TranslatedArticle> = {
  'aji-jighead': {
    slug: 'aji-jighead',
    title: 'Best Aji Jigheads: Shape & Weight Guide',
    h1: 'Best Jigheads for Aji Fishing & How to Choose',
    description: 'Top jigheads for aji (horse mackerel) fishing selected from our database. Compare round, dart, and arrow-point head shapes, 0.3-1.5g weights, hook sizes #8-#4, and worm pairings with real data.',
    lead: 'Jighead selection can make or break your aji fishing results. The CAST/LOG database contains numerous aji-compatible jigheads. Aji are suction feeders, meaning jighead weight and shape directly affect hookup rates. Head shapes fall into three main categories — round, arrow-point, and dart — each excelling in different situations. Weights range from 0.3-1.5g in the ultra-light category, demanding a finesse approach that reads current and wind conditions.',
    sections: [
      {
        heading: 'Choosing the Right Head Shape',
        body: 'Round heads offer stable sinking posture and work with any retrieve style — the go-to all-rounder. Beginners should always start with round heads. Arrow-point heads cut through the water efficiently and sink faster, making them ideal for fishing in current or targeting deep-holding aji. Dart heads produce an erratic side-to-side darting action that triggers reaction strikes from active fish. They feature a flattened front face and require rod-tip action to perform. Rather than committing to one shape, switching between them based on conditions is the key to consistent catches.',
      },
      {
        heading: 'Weight Selection & Depth Control',
        body: 'Aji jigheads range from 0.3-1.5g in the ultra-light zone. The golden rule is to use the lightest weight that still lets you feel the current. In calm, sheltered harbors with minimal current, use 0.3-0.5g for a slow surface-layer fall. When wind exceeds 3m/s or current is strong, step up to 0.8-1.0g for better control. For water deeper than 5m or when distance casting is needed, go with 1.5g. Lighter jigheads fall slower, giving aji more time to inspect and eat the lure — but too light means casting becomes difficult, so consider your rod\'s weight rating as well.',
        comparisonTable: {
          headers: ['Weight', 'Primary Situation', 'Fall Speed', 'Casting Range'],
          rows: [
            ['0.3-0.5g', 'Calm / sheltered harbors', 'Ultra-slow', '5-10m'],
            ['0.6-0.8g', 'Light breeze / piers', 'Slow', '10-20m'],
            ['1.0g', 'Windy / all-purpose', 'Medium', '15-25m'],
            ['1.5g', 'Strong wind / deep water', 'Moderately fast', '20-30m'],
          ],
          criteria: 'Based on analysis of aji-compatible jigheads in the CAST/LOG database.',
        },
      },
      {
        heading: 'Hook Size & Worm Matching',
        body: 'Hook sizes #8 through #4 are standard for aji fishing. For mamé-aji (10-15cm juveniles), use #8-#6 small hooks; for medium aji (15-25cm), go with #6-#4. Aji have soft, paper-thin mouths, so fine-wire hooks with superior penetration have a clear advantage. Open-gape hooks (with the point angled outward) improve hookup rates but are more prone to snagging. The standard worm pairing is a 1.5-2 inch pintail or straight-tail, matched to the hook shank length. A worm that\'s too long leads to short bites, while one that\'s too short compromises the action.',
      },
      {
        heading: 'Practical Techniques',
        body: 'The foundation of aji fishing is the countdown fall after casting. Work through depth in 1m increments to locate the school\'s cruising layer. Create the "feeding window" by not reeling — pausing for 1-2 seconds during the retrieve triggers bites at the moment the lure transitions to a fall. With dart-type jigheads, use a two-twitch-and-fall pattern to provoke strikes. Bites range from a distinct "tick" sensation to the more subtle feeling of the line going slack (the "drop bite"). Watch your rod tip and feel through your fingers — set the hook immediately at anything unusual.',
      },
    ],
    faq: [
      { question: 'What jighead is best for beginners?', answer: 'A 1.0g round head with a #6 hook is the easiest to handle. Pair it with a 1.5-inch pintail worm, count down under harbor lights, and simply slow-retrieve — that\'s enough to catch aji.' },
      { question: 'What should I do when the hook point gets dull?', answer: 'A razor-sharp point is essential for penetrating aji\'s thin upper jaw. If the hook no longer catches your fingernail, it\'s time to replace it. Swapping for a new one is more reliable than using a hook sharpener — treat jigheads as consumables and stock up.' },
      { question: 'When should I use a jighead vs. a Carolina rig?', answer: 'Jigheads excel at close-range, shallow-water finesse fishing. For distance casting or deeper targets, a Carolina rig (split shot or float) has the advantage. Master jighead fishing first, then graduate to Carolina setups for a smoother learning curve.' },
    ],
  },

  'aji-night-game': {
    slug: 'aji-night-game',
    title: 'Aji Night Fishing: Complete Guide to Lights',
    h1: 'Complete Guide to Aji Night Fishing',
    description: 'Master aji (horse mackerel) night game tactics. Learn how to target fish around harbor lights, optimize jighead + worm setups, adjust techniques by depth, and read tidal patterns for more bites.',
    lead: 'Night fishing is overwhelmingly advantageous for aji. After dark, plankton gathers under harbor lights, drawing aji schools in to feed. Fish that hold in deep offshore water during the day move within casting range of the shore at night. The appeal lies in the technical, game-like pursuit — detecting delicate bites through ultralight line and micro jigheads.',
    sections: [
      {
        heading: 'Working Harbor Lights',
        body: '<p>Harbor lights are the number-one hotspot for night aji fishing. Light attracts plankton, plankton draws baitfish, and baitfish bring aji — a food chain that creates a reliable fishing spot.</p><p>Focus on the <strong>shadow line</strong> — the boundary between light and dark. Aji don\'t sit in the illuminated zone; they stage in the shadows, ambushing bait that drifts from light into dark. Cast into the lit area and retrieve toward the dark side.</p><p>The <strong>type of light</strong> matters too. LEDs cast a wide, white glow, but sodium-vapor lights (orange) are generally better at concentrating plankton. When a harbor has multiple lights, target the one that most directly illuminates the water surface.</p>',
      },
      {
        heading: 'Jighead + Worm Fundamentals',
        body: '<p>The jighead + soft plastic rig is the primary weapon for aji. Here\'s how to dial it in:</p><ul><li><strong>Jighead weight</strong>: 0.6-1.5g is the night-game standard. Use 0.6-0.8g inside sheltered harbors with weak current; step up to 1.0-1.5g on current-exposed breakwalls. Lighter = slower fall = more time in the strike zone.</li><li><strong>Worm size</strong>: 1.5-2 inches is the mainstay. For mamé-aji (under 10cm), downsize to 1-1.5 inches; for trophy-class aji, 2.5-3 inches can be effective.</li><li><strong>Worm shape</strong>: Pintails are the baseline — their subtle vibration provides a natural presentation. When fish are aggressive, switch to shad tails or ribbed bodies for extra attraction.</li><li><strong>Color</strong>: Clear variants (clear lamé, clear pink) are the night-game standard — they transmit light naturally under harbor lamps. If the bite drops off, rotate to glow (phosphorescent) or solid colors.</li></ul>',
      },
      {
        heading: 'Techniques by Depth',
        body: '<p>Aji are pelagic and shift depth zones with tide and time. Matching the right depth is the single most important technique.</p><p><strong>Surface (0-1m)</strong>: Most common around slack tide when plankton concentrates near the surface. Start retrieving immediately after the cast at a slow pace. Keep the rod tip up to hold the lure shallow.</p><p><strong>Mid-depth (1-3m)</strong>: The most frequently productive zone. Count down after casting (roughly 30-50cm per second) to reach the target depth, then slow-retrieve or lift-and-fall.</p><p><strong>Near-bottom (3m+)</strong>: Effective during low-activity periods or under heavy pressure. After the lure touches bottom, give gentle rod-tip taps, then lift and let it fall on a tight line (tension fall) to trigger bites.</p><p>When bites stop, change depth. Adjust your countdown by one second at a time to re-locate the school\'s holding layer.</p>',
      },
      {
        heading: 'Tackle & On-the-Water Tips',
        body: '<p>Sensitivity is everything in aji tackle. To feel jighead weight and detect feather-light bites, purpose-built rods and finesse setups are essential.</p><p><strong>Rod</strong>: 5.8-6.8ft aji rod, UL-L class. Solid tips absorb soft bites without bouncing the hook. Tubular tips deliver greater sensitivity for those who prefer an active hook-set approach.</p><p><strong>Reel</strong>: 1000-2000 size spinning. The lighter the reel, the better the sensitivity.</p><p><strong>Line</strong>: Ester line 0.2-0.3 (JDM rating) is mainstream. PE 0.1-0.2 with a fluorocarbon leader is another option. Straight fluorocarbon 1.5-2lb is beginner-friendly.</p><p><strong>Reading the bite</strong>: Aji bites feel like a faint "tick." They\'re predominantly suction bites, so set the hook at the slightest irregularity. Aji have soft mouths — use a quick wrist snap rather than a full-body hook-set to avoid tearing the hook free.</p>',
      },
    ],
    faq: [
      { question: 'What is the best time window for aji night fishing?', answer: 'The first 1-2 hours after sunset are peak activity. Bites taper off around midnight but pick up again when the tide starts moving. The last hour before dawn is another prime window. Fish around harbor lights can bite all night long.' },
      { question: 'How do I target trophy aji (30cm+)?', answer: 'Big aji tend to sit on the outer edges of the school or in deeper zones. Step up your jighead to 1.5-2g and probe near the bottom. Upsize your worm to 2.5-3 inches to filter out small fish and selectively target the big ones.' },
      { question: 'How do I deal with strong wind while aji fishing?', answer: 'Increase jighead weight (1.5-3g) or switch to a Carolina rig or split-shot rig. Moving to a wind-sheltered spot is also effective. A tailwind is actually an advantage — it extends your casting distance.' },
    ],
  },

  'aji-worm': {
    slug: 'aji-worm',
    title: 'Best Soft Plastics for Aji Fishing',
    h1: 'Best Worms for Aji Fishing & How to Choose',
    description: 'Top soft plastics for aji (horse mackerel) selected from 87 series in our database. Compare worm shapes, sizes, and colors, plus jighead pairings and seasonal patterns backed by real data.',
    lead: 'Soft plastics are the most fundamental lure in aji fishing. The CAST/LOG database contains 87 aji-compatible worm series. JACKALL\'s Pekering comes in 44 colors and Viva\'s Aji PinPin in 40 — extensive color lineups are a hallmark of dedicated aji worms. Here\'s how to work 1-2 inch micro worms to crack aji\'s finicky feeding behavior.',
    sections: [
      {
        heading: 'How to Choose Aji Worms',
        body: 'Select aji worms based on three criteria: size, shape, and material. The core size range is 1.5-2.5 inches — downsize to 1-1.5 inches for mamé-aji (under 10cm) and go up to 2-3 inches for trophy aji (30cm+). For shape, pintails (thin tails) are the most versatile, producing a subtle vibration that attracts aji. Shad tails generate stronger vibration through tail movement for added appeal. Ribbed bodies feature multiple ridges that grip in the fish\'s teeth, making it harder for aji to spit the lure on a bite. Softer materials resist bouncing short bites but wear out faster — a classic trade-off between bite absorption and durability.',
        comparisonTable: {
          headers: ['Shape', 'Attraction', 'Hookup Rate', 'Durability'],
          rows: [
            ['Pintail', '△ Low', '◎ High', '○'],
            ['Shad Tail', '○ Medium', '○', '○'],
            ['Ribbed Body', '○ Medium', '◎ High', '△'],
            ['Curly Tail', '◎ High', '○', '△'],
          ],
          criteria: 'Based on analysis of 87 aji-compatible worm series in the CAST/LOG database.',
        },
      },
      {
        heading: 'Jighead Pairing',
        body: 'Jighead rigs are the standard for aji worms. Jighead weight ranges from 0.3-1.5g, with lighter heads offering a more natural fall for finicky fish and heavier heads providing casting distance and deep-water access. 0.6g is the most versatile weight, covering daytime through nighttime pier fishing. Round heads are the all-around choice. Arrow-point heads create water resistance for better fall-speed control. Hook sizes #8-#4 are standard, matched to worm size. Aji have small mouths — delayed hook-sets let the hook pull free, so set immediately when you feel a bite.',
      },
      {
        heading: 'Color Rotation Strategy',
        body: 'Rotate aji worm colors across three families: clear, glow, and solid. Clear (translucent) is the standard for clear water and daytime fishing, letting natural light pass through for a lifelike appearance. Glow (phosphorescent) is essential for night sessions — highly visible both under harbor lights and in dark water. Solid colors (chartreuse, pink, and other opaque shades) work in murky water or as a change-of-pace. JACKALL\'s Pekering line spans 44 colors well-balanced across clear, glow, and solid families, making rotation easy. When bites dry up at a spot, changing color should be your first move.',
      },
      {
        heading: 'Seasonal Aji Patterns',
        body: 'Spring (March-May) targets pre-spawn trophy aji. Use 2-2.5 inch worms with a slow retrieve under harbor lights. Summer (June-August) is mamé-aji season — downsize to 1-1.5 inch micro worms for quantity fishing in lit harbors. Autumn (September-November) offers the best size-to-catch ratio and is the easiest season overall. Work 1.5-2 inch pintails across piers and harbors. Winter (December-February) is trophy time. Target deep-holding aji with 2-3 inch worms on heavier jigheads (1-1.5g) near the bottom. Night fishing dominates year-round, though daytime aji is gaining popularity.',
      },
    ],
    faq: [
      { question: 'What should my first aji worm pack be?', answer: 'A 1.5-inch pintail in clear lamé color is the most versatile option — effective for pier night fishing year-round. Start with one pack, then add a glow color when the bite slows. That two-color setup covers most situations.' },
      { question: 'Any tips for rigging the worm?', answer: 'Threading the worm perfectly straight onto the jighead shank is critical. A crooked worm swims unnaturally and kills your bite rate. Leave the hook point slightly exposed — burying it completely reduces hookup rates.' },
      { question: 'How should I set the hook on aji bites?', answer: 'Aji bites come in three types: a distinct "tick," a soft "float," and a mushy "thud." For all three, snap the hook with a quick wrist flick the instant your rod tip registers the change. Hesitate and the aji strips your worm. But don\'t overpower the set — aji mouths tear easily.' },
    ],
  },

  'aomono-diving-pencil': {
    slug: 'aomono-diving-pencil',
    title: 'Diving Pencils for Pelagics: Selection Guide',
    h1: 'Diving Pencil Guide for Bluerunner & Pelagics',
    description: 'Complete guide to diving pencils for yellowtail, amberjack, and kingfish. Covers size and weight selection, jerk-and-dive technique, and species-specific tactics backed by database analysis.',
    lead: 'The diving pencil is the star of topwater pelagic fishing. Its dive-and-splash cycle draws explosive strikes from bluerunners feeding on the surface. Alongside poppers, diving pencils are a core topwater plug — but their longer travel distance per cycle gives them superior search capability. Here\'s everything you need to know about this essential lure for rocky shore, surf, and offshore pelagic fishing.',
    sections: [
      {
        heading: 'Choosing the Right Diving Pencil',
        body: '<p>Diving pencils are matched to the job by <strong>size</strong> and <strong>weight</strong>.</p><ul><li><strong>130-160mm (40-60g)</strong>: Light class for shore casting. Ideal for yellowtail (hamachi/warasa) and Spanish mackerel. Good balance of distance and workability — beginner-friendly.</li><li><strong>160-190mm (60-90g)</strong>: Standard shore class. The main size for yellowtail and amberjack from rocky shores. Requires an M-class or heavier shore jigging rod.</li><li><strong>190-230mm (90-150g)</strong>: Heavy class for trophy pelagics and offshore casting. Built for 10kg-plus amberjack and kingfish.</li></ul><p><strong>Action characteristics</strong> also matter. Models with a large head and cupped face dive deeper and throw bigger splashes. Slimmer profiles produce an S-shaped darting action for a more natural appeal. In rough seas, higher-buoyancy models are easier to work.</p>',
      },
      {
        heading: 'Jerk & Dive: Core Technique',
        body: '<p>The fundamental diving pencil action is a <strong>jerk → dive → float</strong> cycle.</p><p><strong>One-jerk, one-dive</strong>: Sweep the rod downward to force the lure underwater, then lift the rod to let it float back up. Repeat this simple one-jerk, one-surface cycle. The splash and bubble trail created during the dive is what triggers pelagic strikes.</p><p><strong>Combination pattern</strong>: Two quick jerks → long pause (3-5 seconds). The double jerk grabs attention; the pause invites the strike. Bites most often come the instant the lure surfaces and stalls.</p><p><strong>Long jerk</strong>: A full rod sweep that sends the lure on a long, deep dive. Covers more water per cycle — effective for searching large areas. When working a surface bust-up, cast beyond the activity and sweep the lure through it.</p>',
      },
      {
        heading: 'Species-Specific Tactics',
        body: '<p><strong>Yellowtail (Warasa/Inada)</strong>: The most topwater-responsive pelagic. Flashy, splashy diving pencils work well — keep the tempo brisk to make them chase. They travel in schools, so when a surface bust-up appears, get your cast in immediately.</p><p><strong>Amberjack (Hiramasa)</strong>: More cautious and quicker to become line-shy than yellowtail. Natural S-shaped darts and slow jerks are more effective. Realistic colors (sardine, mackerel patterns) have the best track record. Running the lure through the white-water wash zone along rocky shores often flips their feeding switch.</p><p><strong>Greater Amberjack (Kanpachi)</strong>: Delivers the most violent surface strikes of any pelagic. Lures that dive deep and track 30-50cm below the surface get the best response. Bites concentrate on the re-dive moment after a pause. Kanpachi bolt for structure after the hookup — lock down and power-reel immediately to maintain control.</p>',
      },
      {
        heading: 'Tackle & Field Selection',
        body: '<p><strong>Shore tackle</strong>: MH-H class shore jigging rod, 9.6-10.6ft. Diving pencils require rod backbone to generate proper dive action — soft rods can\'t load them effectively. Reel: SW 4000-6000, PE 2-4.</p><p><strong>Offshore tackle</strong>: Casting rod 7.6-8.2ft. Must have the power to work large diving pencils (150g+). Reel: SW 8000-14000, PE 4-8.</p><p><strong>Rocky shores</strong>: Target well-flushed points and white-water zones. Pelagics chase bait into current seams and wash zones to corner them.</p><p><strong>Surf</strong>: Primarily bust-up hunting. Use 130-160mm models for maximum casting distance, landing beyond the surface activity and retrieving through it.</p>',
      },
    ],
    faq: [
      { question: 'When should I use a diving pencil vs. a popper?', answer: 'Poppers create noise and splash in one spot, drawing fish in close. Diving pencils cover more water per cast with greater search efficiency. Start with a diving pencil to locate fish across a wide area, then switch to a popper to work a specific zone once you find activity.' },
      { question: 'What size is best for beginners?', answer: '130-150mm in the 40-50g class is the easiest to learn on. Light enough to work with an M-class shore jigging rod. Master the basic one-jerk, one-dive rhythm first, then size up as your technique develops.' },
      { question: 'What if my diving pencil won\'t dive properly?', answer: 'Create line slack before jerking. Jerking against a tight line makes the lure skate across the surface without diving. Point the rod tip downward and jerk in a downward sweep. On windy days, switch to a heavier model — wind catches the line and lifts the lure.' },
    ],
  },

  'aomono-metaljig': {
    slug: 'aomono-metaljig',
    title: 'Best Metal Jigs for Pelagics: Shore & Offshore',
    h1: 'Best Metal Jigs for Bluerunners & How to Choose',
    description: 'Top metal jigs for pelagics selected from 114 series in our database. Compare shore vs. offshore jigging weights, fall characteristics, and action patterns backed by real data.',
    lead: 'The metal jig is the core lure for targeting pelagics — yellowtail, amberjack, and kingfish. The CAST/LOG database contains 114 pelagic-compatible metal jig series. Top manufacturers like Palms, DAIWA, SHIMANO, and Owner compete fiercely in this category, offering wide variety in material (lead vs. tungsten), shape (long, short, semi-long), and weight (20-300g). Here\'s how to choose for both shore and offshore jigging.',
    sections: [
      {
        heading: 'How to Choose Metal Jigs for Pelagics',
        body: 'Metal jigs are selected by three factors: weight, shape, and material. For shore jigging, 30-60g is the primary range, adjusted for depth and current. Offshore jigging centers on 80-200g, with a rule-of-thumb of 10g per 10m of water depth. Long jigs (slim profile) cut through water cleanly and fall fast. Short jigs (compact shape) flutter and fall slowly, creating a feeding pause that triggers bites. Semi-long jigs split the difference and offer the most versatility. Lead is the standard material and more cost-effective. Tungsten (TG) has higher density, producing a smaller silhouette at the same weight — devastating when bait is small or current is strong. DAIWA\'s TG Bait is the benchmark tungsten jig.',
      },
      {
        heading: 'Shore Jigging Strategy',
        body: 'Shore jigging (casting from breakwalls, rocky shores, and surf) demands maximum casting distance. Full-cast a 40-60g metal jig to reach surface bust-ups and feeding zones. The fundamental action is the one-pitch jerk — one rod pump paired with one reel crank. The standard approach is to let the jig hit bottom and work it back up to the surface, but if pelagics are feeding near the top, start jerking immediately after splashdown. Use fast jerks for dawn bust-up sessions and slow jerks for daytime bottom-zone fishing. Palms JIGARO, with its 198-color lineup, is a proven shore-jigging staple.',
        comparisonTable: {
          headers: ['Style', 'Weight', 'Action', 'Target Zone'],
          rows: [
            ['Light Shore Jigging', '20-40g', 'One-pitch / steady retrieve', 'Surface to mid-depth'],
            ['Shore Jigging', '40-60g', 'One-pitch / rapid jerk', 'All zones'],
            ['Rock Shore Jigging', '60-100g', 'One-pitch / combination', 'Mid-depth to bottom'],
          ],
          criteria: 'Based on weight-range analysis of 114 pelagic-compatible metal jig series in the CAST/LOG database.',
        },
      },
      {
        heading: 'Offshore Jigging Strategy',
        body: 'Offshore jigging (boat-based) requires matching the jig to bait size and water depth. In nearshore waters of 30-60m, 100-150g is standard; in faster current, 200g+ may be needed. Two action styles dominate: high-pitch jerking (fast one-pitch) and slow jerking (deliberate pumps with fall-triggered bites). High-pitch works on aggressive fish; slow pitch excels when they\'re reluctant. Bites on the fall are common, making fall stability critical — the DAIWA Saltiga series is renowned for its controlled fall posture. Color-wise, silver and glow are the two proven staples — silver for mornings, glow for deep water and overcast conditions.',
      },
      {
        heading: 'When to Use Tungsten Jigs',
        body: 'Tungsten (TG) jigs have roughly 1.7x the density of lead, delivering a smaller profile at the same weight — their defining advantage. They\'re devastating during micro-bait patterns when fish are keyed on tiny sardines or whitebait. In fast current, TG jigs reach bottom more easily and transmit bottom-contact feel better. The downside is cost — 3-5x the price of lead. Use lead jigs in snag-heavy areas and save TG for high-confidence situations. DAIWA\'s TG Bait offers 180 colors and is the category benchmark. Composite jigs (tungsten-blend materials) have emerged recently as a middle ground between cost and compact profile.',
      },
    ],
    faq: [
      { question: 'What weight should I start with for shore jigging?', answer: '40g offers the most versatility — works from breakwalls to surf and is castable on light shore jigging tackle. Add 30g and 60g to cover the vast majority of situations.' },
      { question: 'What colors are recommended for metal jigs?', answer: 'Silver (sardine pattern) and blue-pink are the two proven standards. Gold works well at dawn, glow in overcast or deep-water conditions. Carrying at least three colors — silver, blue-pink, and glow — covers most scenarios.' },
      { question: 'Should I choose lead or tungsten?', answer: 'Lead is more than enough for beginners and budget-conscious anglers. Tungsten\'s compact profile shines during micro-bait patterns and fast-current situations. Start with lead to learn the fundamentals, then add TG as specific situations demand it.' },
    ],
  },

  'aomono-minnow': {
    slug: 'aomono-minnow',
    title: 'Best Minnows for Pelagic Shore Plugging',
    h1: 'Best Minnows for Bluerunners & How to Choose',
    description: 'Top minnows for pelagics selected from 141 series in our database. Covers shore plugging technique, size and diving-depth selection, and when to choose minnows over metal jigs with real data.',
    lead: 'Minnows are the second most important lure after metal jigs for shore plugging. The CAST/LOG database contains 141 pelagic-compatible minnow series. DAIWA\'s Shoreline Shiner Z Set Upper, with 216 colors, has cemented its status as the go-to shore plugging minnow. Here\'s how to choose minnows that deliver both casting distance and fish-catching action.',
    sections: [
      {
        heading: 'Choosing Minnows for Pelagics',
        body: 'Select pelagic minnows on three criteria: size, casting distance, and diving depth. The core size range is 90-130mm, matched to the prevailing baitfish (sardine, small mackerel). Casting distance is critical on rocky shores and surf — minnows with rear-weighted shifting systems have the edge. Diving depth breaks into shallow runners (0.5-1m) and medium runners (1-2m). When fish are boiling on the surface, use a shallow runner to work just below the skin. When the action goes quiet, switch to a medium runner to probe slightly deeper. DAIWA\'s Set Upper S-DR achieves an outstanding balance of casting distance and depth-holding, making it beginner-friendly as well.',
      },
      {
        heading: 'Shore Plugging Techniques',
        body: 'The baseline action for pelagic minnows is a fast retrieve. Pelagics respond to speed, so use a high-gear reel and crank hard. Mixing in jerks creates erratic darts that trigger reactive strikes. During bust-ups, begin a high-speed retrieve the instant the lure splashes down and run it through the school. When there\'s no visible surface activity, cast long and search the top to mid-depth zone. Minnows can\'t match metal jigs for distance, but they win on depth-holding ability and action consistency — especially in that thin 0-1m subsurface band.',
        comparisonTable: {
          headers: ['Situation', 'Minnow Type', 'Action', 'Retrieve Speed'],
          rows: [
            ['Surface bust-up', 'Shallow runner 90-110mm', 'Fast steady retrieve', 'Fast'],
            ['Bait ball spotted', 'Medium runner 100-130mm', 'Jerk & retrieve', 'Medium'],
            ['Searching (no fish showing)', 'Heavy sinking 90-120mm', 'Retrieve & stop', 'Medium'],
          ],
          criteria: 'Based on analysis of 141 pelagic-compatible minnow series in the CAST/LOG database.',
        },
      },
      {
        heading: 'When to Use Minnows vs. Metal Jigs',
        body: 'Minnows and metal jigs complement each other. Metal jigs excel at distance and vertical action (the fall), effective for deep-holding or bottom-hugging pelagics. Minnows track horizontally at a consistent depth, dominating when fish are sitting near the surface. At dawn when fish are boiling, start with minnows in the surface zone. Once the boils subside, switch to metal jigs and work from bottom to mid-depth — that\'s the most efficient rotation. Metal jigs handle wind better; minnows are easier to work in calm conditions. Carrying both in your tackle box dramatically expands your versatility.',
      },
      {
        heading: 'Color & Season Guide',
        body: 'Sardine-pattern silver is the year-round baseline color for pelagic minnows. Gold-flash colors excel at dawn. In turbid water, chartreuse and matte finishes stand out by silhouette. Holographic finishes shine in clear water under sunny skies. The season runs from spring sardine arrivals through autumn pelagic migrations. In early summer, smaller 80-90mm minnows match young amberjack (shogo). During the autumn yellowtail migration, 120-130mm large minnows let you selectively target trophy-class fish.',
      },
    ],
    faq: [
      { question: 'What size minnow is most versatile for pelagics?', answer: '100-120mm covers the widest range. For wakashi/inada class (small yellowtail), go with 90mm; for warasa/buri class, 120mm is the target. When in doubt, a 100mm-class sinking minnow is a safe all-around choice.' },
      { question: 'Should I upgrade the stock hooks?', answer: 'Pelagics hit hard, so hook strength matters. If the factory hooks are fine-wire, swap them for heavy-gauge trebles (ST-46 or ST-56). Note that hook swaps can alter the lure\'s swimming action, so test it after changing.' },
      { question: 'What PE line weight should I use?', answer: 'PE 1.5-2 is standard for shore plugging. Use a 30-40lb fluorocarbon leader. For trophy fish from rocky shores, PE 2-3 is an option. The PE + fluoro leader setup is the baseline for preserving minnow action.' },
    ],
  },

  'aomono-popper': {
    slug: 'aomono-popper',
    title: 'Best Poppers for Pelagics: Shore & Offshore',
    h1: 'Best Poppers for Bluerunners & How to Choose',
    description: 'Top poppers for pelagics selected from 31 series in our database. Compare sizes and actions for shore and offshore use, with techniques for yellowtail, amberjack, and kingfish.',
    lead: 'Poppers deliver the most exciting strikes in pelagic fishing — explosive surface blowups that never get old. The CAST/LOG database lists 31 pelagic-compatible popper series from popular makers like BlueBlue and SHIMANO. Beyond bust-up hunting, poppers actively pull pelagics to the surface for aggressive, high-adrenaline fishing. Here\'s how to match size and action to your target water.',
    sections: [
      {
        heading: 'How to Choose Pelagic Poppers',
        body: 'Three factors drive pelagic popper selection: cup shape, size, and casting performance. A larger cup generates bigger splashes and louder pops, increasing the lure\'s fish-calling radius. Size depends on target species and location. For shore use, 90-130mm is the sweet spot — castable and versatile. Offshore, 130-200mm models flip the feeding switch on big pelagics. Casting distance varies greatly depending on rear-weighted design and internal weight-transfer systems.',
      },
      {
        heading: 'Recommended Poppers by Size',
        body: 'The 90-130mm shore class is perfect for light shore jigging from breakwalls and surf. At 40-60g, they maintain good casting range and work well on medium yellowtail and Spanish mackerel. The 130-160mm class is the main size for amberjack and kingfish from rocky shores and boats. Big cups throw massive splashes that pull pelagics up from depth. 160mm and above are dedicated offshore models for GT and tuna.',
        comparisonTable: {
          headers: ['Size', 'Weight Range', 'Field', 'Primary Target'],
          rows: [
            ['60-90mm', '7-20g', 'Piers / harbors', 'Young amberjack / mackerel / small yellowtail'],
            ['90-130mm', '20-50g', 'Piers / surf / rocky shores', 'Yellowtail / Spanish mackerel'],
            ['130-160mm', '50-80g', 'Rocky shores / offshore', 'Amberjack / kingfish'],
            ['160mm+', '80g+', 'Offshore', 'GT / tuna'],
          ],
          criteria: 'Based on spec analysis of 31 pelagic-compatible popper series in the CAST/LOG database.',
        },
      },
      {
        heading: 'Popper Action Techniques',
        body: 'Two fundamental actions form the popper playbook: popping and splashing. Popping uses short, sharp rod jerks to catch water in the cup, producing a rhythmic "pop-pop" sound with bubbles that attract pelagics. Splashing uses broader rod sweeps to throw a column of water — a high-impact move that reaches distant fish. Combining the two is the most effective approach. A baseline pattern is 2-3 pops → long pause → splash, repeated.',
      },
      {
        heading: 'Color Selection & Optimal Conditions',
        body: 'Pelagic popper colors prioritize surface visibility. Natural patterns — sardine, mackerel — are the all-conditions standard for clear water and sunny skies. At dawn and dusk, pink-back or chartreuse-back high-visibility colors are more effective. Overall, pelagics are less color-selective than many species — action and timing matter more than paint. Poppers work best in three windows: during surface bust-ups, when bait is near the surface, and during the dawn feeding blitz. A light chop often produces better bite rates than dead calm.',
      },
    ],
    faq: [
      { question: 'What is the most important factor for popper success?', answer: 'Timing. Deploying a popper when pelagics are already surface-oriented (bust-ups, bird activity) is the most efficient approach. Outside those windows, you\'re working to pull fish up from depth — a valid strategy, but one that requires patience and persistence.' },
      { question: 'When should I use a popper vs. a pencil bait?', answer: 'Poppers have superior fish-calling ability, making them ideal for searching when you don\'t know where the fish are. Pencil baits (including diving pencils) swim subsurface and are more efficient at converting active, feeding schools. The classic combo: call fish in with a popper, then seal the deal with a pencil.' },
      { question: 'What tackle do I need for shore popper fishing?', answer: 'Rod: M-MH class shore jigging rod, around 10ft. Reel: spinning 5000-6000. PE 2-3, leader 40-60lb, 1-1.5m long. Working poppers is physically demanding, so a lighter rod balanced with a smooth reel makes extended sessions more comfortable.' },
    ],
  },

  'aomono-sinkingpencil': {
    slug: 'aomono-sinkingpencil',
    title: 'Sinking Pencils for Pelagics: The Secret Weapon',
    h1: 'Best Sinking Pencils for Bluerunners & How to Choose',
    description: 'Top sinking pencils for pelagics selected from our database. Learn when to use them over metal jigs, master bust-up targeting techniques, and choose the right size for your field.',
    lead: 'The sinking pencil is an indispensable lure in shore pelagic fishing. It combines the casting distance of a metal jig with the natural swimming action of a plug, excelling during surface bust-ups and when metal jigs draw no response. The CAST/LOG database features numerous pelagic-compatible sinking pencils, with DUEL\'s Hardcore Monster Shot and BLUEBLUE\'s Burito among the most popular.',
    sections: [
      {
        heading: 'Sinking Pencil Characteristics',
        body: 'A sinking pencil is a slim, lipless sinking lure. Without a lip, it creates minimal water resistance and produces a natural swimming action on the retrieve. Compared to metal jigs, it falls slower and maintains a near-horizontal posture during the sink. This "slow presentation" trait is what catches pelagics that ignore the fast, aggressive movement of metal jigs. The primary weight range is 20-60g, with 30-40g being the most versatile class. Casting distance falls short of metal jigs but still reaches 80-100m in the 40g class.',
      },
      {
        heading: 'When to Choose a Sinking Pencil Over a Metal Jig',
        body: 'Rotating between metal jigs and sinking pencils dramatically improves shore jigging results. Metal jigs dominate for distance, deep water, strong current, and high-activity fish. Sinking pencils take over for bust-up targeting, surface-to-mid-depth work, light current, and situations where metal jigs get ignored. The classic rotation: start with a metal jig at dawn to search aggressively, then switch to a sinking pencil as the bite tapers off. When a bust-up erupts, skip a sinking pencil across the surface to mimic panicked baitfish and trigger reaction strikes.',
        comparisonTable: {
          headers: ['Situation', 'Metal Jig', 'Sinking Pencil', 'Decision Factor'],
          rows: [
            ['Dawn blitz', '○ Search tool', '◎ Bust-up response', 'Activity level & depth'],
            ['Midday', '◎ Deep-zone access', '○ Surface cruisers', 'Fish holding depth'],
            ['Bust-up active', '△ Sinks too fast', '◎ Surface skipping', 'Keeping lure in the zone'],
            ['Strong current', '◎ Weight handles it', '△ Gets swept', 'Current intensity'],
          ],
          criteria: 'Based on analysis of pelagic-compatible sinking pencils in the CAST/LOG database.',
        },
      },
      {
        heading: 'Bust-Up Targeting Techniques',
        body: 'Bust-up hunting is where sinking pencils truly shine. Cast slightly ahead of the bust-up\'s direction of travel and rip the lure across the surface in a skipping motion. The key is casting beyond the bust-up, not into it — landing a lure in the middle scatters the school. The skipping phase only needs to last 3-5 seconds before transitioning to a medium-speed retrieve. After the bust-up disappears, continue working the area — fish that pushed down below the surface often strike at a lure passing through their zone. DUEL\'s Hardcore Monster Shot is prized for its skipping performance and is a go-to for bust-up situations.',
      },
      {
        heading: 'Size & Field Selection',
        body: 'Match your sinking pencil weight to the field and target size. Surf and open rocky shores demand long casts, so choose 40-60g. Breakwalls and smaller rocky points produce adequate distance at 30-40g. For wakashi/inada class (40-60cm yellowtail), use compact 20-30g models; for warasa/buri class (70cm+), step up to 40-60g. Sardine pattern is the all-purpose color, with pink back for dawn, blue back for midday, and chartreuse for murky water. BLUEBLUE\'s Burito has low air resistance and exceptional casting distance, earning strong support for surf shore jigging.',
      },
    ],
    faq: [
      { question: 'What should be my first sinking pencil?', answer: 'A 30-40g sardine-pattern model is the most versatile choice — works from breakwalls to surf. DUEL Monster Shot and BLUEBLUE Burito are proven standards and easy to find at tackle shops.' },
      { question: 'What hook setup should I use?', answer: 'Front and rear treble hooks are standard. Pelagics tend to strike the front hook. Stick with factory hook sizes as a baseline; upsize one step for trophy targets. A single-hook conversion is effective for big-fish situations.' },
      { question: 'Any tips for working the action?', answer: 'A straight retrieve is the foundation. Control depth with rod angle and reel speed — rod tip up runs shallow, rod tip down runs deep. Adding twitches creates erratic darting for reaction strikes.' },
    ],
  },

  'aomono-tairaba': {
    slug: 'aomono-tairaba',
    title: 'Tai Rubber for Pelagics: The Offshore Secret',
    h1: 'Best Tai Rubber for Bluerunners & How to Choose',
    description: 'Top tai rubber rigs for pelagics selected from our database. Learn why tai rubber catches yellowtail and amberjack, how to set up vs. standard red sea bream rigs, and retrieval techniques.',
    lead: 'Tai rubber is often pigeonholed as a red sea bream lure, but it\'s highly effective on pelagics too. The CAST/LOG database lists numerous pelagic-compatible tai rubber rigs, with JACKALL\'s Bakuryu and DUEL\'s TG BinBin Slide Head among the top picks. Here\'s why a simple steady retrieve catches pelagics — and how to make it work.',
    sections: [
      {
        heading: 'Why Tai Rubber Works on Pelagics',
        body: 'Tai rubber offers two key advantages for pelagic fishing: "dead-simple steady retrieve" and "high bite conversion." Jigging is physically exhausting, but tai rubber catches fish just by reeling. On days when jigging draws blanks, switching to tai rubber can suddenly fire up the bite. The reason: a slow, natural presentation flips the feeding switch in low-activity pelagics. The fluttering necktie and pulsing skirt provide a completely different stimulus than a jig\'s aggressive action, mesmerizing yellowtail, warasa, and amberjack alike.',
      },
      {
        heading: 'Differences from Red Sea Bream Setups',
        body: 'Pelagic tai rubber differs from red sea bream setups in three ways: heavier heads, stronger hooks, and faster retrieves. Head weight jumps from the standard 60-100g for bream to 100-200g for pelagics — the extra weight is needed to reach bottom in deep water and strong current. Hooks must handle pelagic power, so use heavy-gauge large hooks (#1 to #1/0). Retrieve speed goes from dead-slow for bream to medium or slightly faster for pelagics. Neckties should be longer (120-150mm) straight-type for maximum appeal.',
        comparisonTable: {
          headers: ['Spec', 'Red Sea Bream', 'Pelagic', 'Common'],
          rows: [
            ['Head Weight', '60-100g', '100-200g', 'Tungsten gives better feel'],
            ['Hook Size', '#3-#1', '#1-#1/0', 'Fluorine-coated recommended'],
            ['Retrieve Speed', 'Dead-slow', 'Medium', 'Steady speed is key'],
            ['Necktie Length', '80-100mm', '120-150mm', 'Curly or straight'],
          ],
          criteria: 'Based on analysis of pelagic-compatible tai rubber rigs in the CAST/LOG database.',
        },
      },
      {
        heading: 'Retrieve Technique & Depth Management',
        body: 'The baseline pelagic tai rubber approach is a steady retrieve searching 10-20m up from the bottom. Start reeling immediately after touchdown at medium speed. Pelagics roam more widely than bream and often suspend in the water column, so reel up to the depth where your fish finder shows marks. Target speed is roughly one handle turn per second — noticeably faster than bream-fishing pace. When you feel a bite, resist the urge to set the hook — keep reeling until the rod loads fully (reel-set). A snap hook-set causes pulled hooks. JACKALL\'s Bakuryu uses a tungsten head for superior sensitivity, helping you detect bottom contact and current shifts.',
      },
      {
        heading: 'Head & Necktie Combinations',
        body: 'Tai rubber action changes with head and necktie combinations. Spherical heads are best for a stable straight retrieve; slide-type heads add fall-phase appeal. Since pelagics also strike on the drop, slide heads create more opportunities. Orange and red neckties are the proven standards with the strongest track record. Chartreuse excels in turbid or low-light conditions. Black works as a silhouette-focused option in clear midday water. For head color, unpainted tungsten or gold/red finishes are popular. DUEL\'s TG BinBin Slide Head features a compact tungsten head with clean water-cutting ability, well-regarded for deep pelagic work.',
      },
    ],
    faq: [
      { question: 'What head weight should I use for pelagics?', answer: 'Use 1.5-2x the water depth in grams as a starting point. At 60m depth, use 100-120g; at 80m, 120-160g. Go heavier in fast current. Tungsten heads are smaller and sink faster than lead — a natural fit for pelagic work.' },
      { question: 'Can I catch pelagics on bream-class tackle?', answer: 'Bream tackle handles warasa-class fish comfortably. For buri (80cm+), upgrade to M-MH power rod with at least 7kg of drag. Step up PE to 1-1.5 and leader to 20-30lb.' },
      { question: 'When should I use tai rubber vs. a metal jig?', answer: 'Switch to tai rubber when jigs draw no response — the classic pattern. When slow-pitch jigging fails on finicky fish, tai rubber\'s steady retrieve often breaks through. Conversely, during aggressive surface feeding, jigs offer more appeal and faster cycling.' },
    ],
  },

  'aomono-worm': {
    slug: 'aomono-worm',
    title: 'Best Soft Plastics for Pelagic Shore Fishing',
    h1: 'Best Worms for Bluerunners & How to Choose',
    description: 'Top soft plastics for pelagics selected from 28 series in our database. Compare jighead, VJ rig, and winding setups, with metal jig rotation strategies backed by real data.',
    lead: 'Soft plastics are gaining serious traction for shore pelagic fishing — yellowtail, amberjack, and Spanish mackerel. When metal jigs draw blanks, pelagics often respond to the natural action of a worm. The CAST/LOG database contains 28 pelagic-compatible worm series. Since the introduction of the VJ (vibration jighead) rig, worm-based pelagic fishing has exploded in popularity. Here\'s how to pick the right worm from those 28 series.',
    sections: [
      {
        heading: 'Why Soft Plastics Work on Pelagics',
        body: 'Soft plastics catch pelagics for three reasons. First, natural swimming action — pelagics that shy away from the aggressive movement of metal jigs respond to the soft, subtle vibration of a worm. Second, the ability to go slow — when activity is low or the bite is tough, a worm handles the slow, methodical approach that metal jigs can\'t deliver. Third, realistic profile — a slim worm body closely matches the silhouette of actual baitfish for a true match-the-hatch presentation.',
      },
      {
        heading: 'Choosing the Right Rig',
        body: 'Three main rigs dominate pelagic worm fishing. The VJ (vibration jighead) rig is the most popular — it fuses the jighead\'s vibration with the worm\'s undulation for a high-attraction package with good casting range. Standard jighead rigs are simple and versatile, letting the worm\'s natural action take center stage. Texas rigs handle snag-heavy structure but see limited use for pelagics.',
        comparisonTable: {
          headers: ['Rig Type', 'Weight Range', 'Advantage', 'Best Situation'],
          rows: [
            ['VJ Rig', '20-40g', 'Distance + vibration effect', 'Surf / piers / when distance is needed'],
            ['Jighead Rig', '14-28g', 'Natural action', 'Harbors / ports / slow presentations'],
            ['Winding Rig', '14-21g', 'Darting action', 'Reaction bites / Spanish mackerel'],
          ],
          criteria: 'Based on usage data from 28 pelagic-compatible worm series in the CAST/LOG database.',
        },
      },
      {
        heading: 'Size & Color Selection',
        body: 'The standard size range is 3-5 inches, matched to the prevailing bait. For anchovy patterns, use 3-3.5 inches; for threadfin shad (konoshiro) patterns, step up to 4-5 inches. Natural colors — sardine, mackerel — form the baseline. Switch to chartreuse or pink in turbid water. Glow (phosphorescent) colors perform well at dawn and in deep water. Harder-compound worms hold up better against pelagic teeth.',
      },
      {
        heading: 'Rotation Strategy with Metal Jigs',
        body: 'The most efficient pelagic game plan rotates between metal jigs and soft plastics. Start with a metal jig to search a wide area quickly and identify productive depth zones and holding spots. When the bite fades, swap to a worm and work a slow, finesse approach to convert followers. When a bust-up erupts, fire a metal jig for instant reach with a long cast; after the bust-up dies, switch to a worm to pick off lingering fish below the surface.',
      },
    ],
    faq: [
      { question: 'How do I choose the right worm size for pelagics?', answer: 'Match it to the prevailing baitfish. For anchovy (5-10cm), use 3-3.5 inches; for small mackerel or horse mackerel (10-15cm), go 4-5 inches. When in doubt, 4 inches is the versatile choice.' },
      { question: 'What season is best for worm-based pelagic fishing?', answer: 'May through December is the main window. Autumn (September-November) is prime — worms shine when metal jigs fail during shore jigging season. Winter brings slower presentations overall, increasing opportunities for worm fishing.' },
      { question: 'What is a VJ rig?', answer: 'Short for "vibration jighead" — a jighead designed to produce vibration during the retrieve. Coreman\'s VJ series pioneered the concept. A straight retrieve generates combined vibration and worm undulation that pelagics find irresistible. The 20-40g weight range also delivers solid casting distance.' },
    ],
  },
};
