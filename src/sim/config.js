// 部落时代的数值都在这里：时间、需求、产出、建筑、神格、技艺、威胁、外族、时代工程。调平衡只改这一个文件。
// 时间单位是「游戏分钟」：一天 1440 分钟，1 倍速下约 1 分钟（每秒 24 游戏分钟）。距离单位是纸面单位。

export const DAY = 1440;
export const SEASON_DAYS = 7, YEAR_DAYS = 28;
export const SEASONS = ['春', '夏', '秋', '冬'];
export const MAP = { w: 2400, h: 1600, cell: 50 };
export const STEP = 2;                 // 模拟步长（游戏分钟）
export const GAME_MIN_PER_SEC = 24;    // 1 倍速

export const K = {
  // 走路（单位 / 游戏分钟）
  walk: 5, run: 7.5, laden: 4, riverSlow: 0.45, roadFast: 1.4,
  reveal: 100,          // 人走过时看清的半径
  campReveal: 400,      // 开局营地周围已画出的半径
  campR: 120,           // 营地（族人身上）的半径

  // 需求：每天涨多少（0 = 满足，1 = 撑不住）
  hunger: { adult: 0.8, child: 0.45 }, meal: 0.4, cooked: 0.5,
  thirst: 1.0,
  fatigueAwake: 1.4, fatigueSleep: 3.2,
  // 冷：体感温度低于 12° 开始积冷；高于 15° 散冷
  coldBelow: 12, warmAbove: 15, coldShed: 2.5,
  // 伤血（每天）：饿、渴、冻、病；需求都还好时回血
  dmg: { hunger: 0.3, thirst: 0.5, cold: 0.5, sick: 0.07 }, heal: 0.14,

  // 产出（每小时；技能 0.5、士气 0.6 时大约这么多）
  rate: { gather: 3, grass: 3, chop: 2.5, quarry: 2, fish: [0.7, 1.0, 0.8, 0.12], water: 10, build: 1 },
  carry: 6, meatCarry: 10,
  spoil: { berry: 6, meat: 3, fish: 2, dried: 40 },   // 几天后坏
  bush: { max: 8, regrow: [0.6, 1.0, 0.8, 0] },          // 每丛浆果每天长多少（春夏秋冬）
  tree: { wood: 8 }, rock: { stone: 25 },
  deer: { meat: 10, hide: 1, flee: 110, speed: 7.5, kill: 0.25, killSkill: 0.35 },

  // 火：燃料以「小时」计；一根柴添 3 小时
  fire: { maxFuel: 30, burnDay: 0.6, burnNight: 1.0, winterMul: 1.3, perWood: 3, heat: 18, radius: 90 },
  shelterHeat: { base: 10, warmth: 8 },

  // 野兽
  tiger: { speed: 5.5, dash: 8, hungerDay: 0.16, attack: 0.42, fearFire: 120, territory: 520 },
  wolf: { speed: 6, attack: 0.32, pack: 4, hungerDay: 0.35 },

  // 墨与信仰
  ink: { max: 30, start: 20, perDevotionDay: 1.4, crowd: 0.5 },
  baseLove: 0.3, baseFear: 0.22, loveFade: 0.05,

  // 生老病死
  birthChance: 0.035, pregnantDays: 10, oldAge: 52, sickChance: 0.008,

  // 技艺：琢磨一个钟头顶几个钟头的功（rate × 手艺、士气、天才）；傍晚火边一个师傅一晚带一个徒弟，学会的机会 teach
  tech: { rate: 0.24, geniusMul: 2.5, geniusOther: 1.3, teach: 0.14, teachGenius: 2, muralTeach: 0.08, autoPickDays: 3, relearn: 0.5, geniusBirth: 0.05 },
  // 威胁（第 2 年起）
  locust: { chance: 0.4, speed: 2.4, r: 90, eat: 3, days: 4 },
  harsh: { chance: 0.35, temp: -6 },
  flood: { chance: 0.35, width: [70, 150], hours: 10, warn: 6 },
  plague: { chance: 0.22, days: [4, 7], dmg: 0.13, spread: 0.22 },
  lost: { chance: 0.035, days: 5 },
  // 外族：邻近的游群
  band: { meetDay: 12, pop: 9, fireOut: 0.07, raid: 0.5, mergeMood: 0.7 },
  // 时代工程与考验：祭坛三段要的墨；大水最早第 5 年开春，最晚第 6 年开春（祭坛没修好也来）
  era: { pace: 0.3, ink: [10, 15, 24], bless: [10, 30, 56], blessFloor: 0.4, floodMinDay: 112, floodForceDay: 140, floodAfter: 14, floodW: 430, arrive: 0.5, valleyR: 170 },
  // 营地范围与农耕时代（第二代 · 彩陶）
  campActiveR: 460,
  farm: { minArea: 1800, maxArea: 90000, minPerim: 120, baseYield: 26, growDays: 9, irrigateRange: 125, drainRange: 145, canalSeg: 55, canalWork: 1.4, canalWaterSnap: 55 },
  era2: { floodMinYears: 4, floodForceYears: 8, floodAfter: 14, floodPeakDays: 5, canalInk: [12, 16, 22], canalBless: [18, 28, 44], leveeHp: 24, droughtChance: 0.42, waterlogChance: 0.36, ratChance: 0.35, pestChance: 0.4, raidChance: 0.28, villagePop: 14 },
};

// 建筑：要多少料、多少工时（小时）。图纸画出来的数值会改这些（见 build.js）
export const BUILD = {
  shack: { name: '窝棚', work: 6 },
  hearth: { name: '火塘', work: 3 },
  rack: { name: '晾肉架', work: 4 },
  fence: { name: '篱笆', work: 10 },
  fenceSeg: { name: '篱笆', work: 1 },
  well: { name: '井', need: { stone: 6, wood: 2 }, work: 5 },
  cairn: { name: '石垛', need: { stone: 6 }, work: 1.5 },
  sapling: { name: '树苗', need: {}, work: 0.5 },
  outpost: { name: '营旗', need: { wood: 4 }, work: 1 },
  fire: { name: '篝火', need: { wood: 3 }, work: 0.5 },
  bench: { name: '石器台', work: 4 },
  trap: { name: '陷阱', work: 3 },
  altar1: { name: '祭坛·台基', work: 28 },
  altar2: { name: '祭坛·立石', work: 26 },
  altar3: { name: '祭坛·墨池', work: 36 },
  levee: { name: '河堤', need: { stone: 8, wood: 4 }, work: 6 },
  granary: { name: '公共粮仓', work: 14, era: 2 },
  kiln: { name: '陶窑', work: 12, era: 2 },
  timberhouse: { name: '木构房', work: 14, era: 2 },
  pen: { name: '畜栏', work: 10, era: 2 },
  bridge: { name: '木桥', work: 16, era: 2 },
  citywall: { name: '城墙', work: 25, era: 3 },
  palace: { name: '宫室', work: 18, era: 3 },
  workshop: { name: '工坊', work: 14, era: 3 },
  furnace: { name: '铸铜炉', work: 16, era: 3 },
  market: { name: '市集', work: 14, era: 3 },
  temple: { name: '宗庙', work: 16, era: 3 },
  cartway: { name: '车道', work: 16, era: 3 },
  bell: { name: '大钟', work: 38, era: 3 },
};
export const DESIGNS = ['shack', 'hearth', 'rack', 'fence', 'bench', 'trap', 'altar1', 'altar2', 'altar3']; // 第一代的图纸
export const ERA1_DESIGNS = DESIGNS;
export const ERA2_DESIGNS = ['granary', 'kiln', 'timberhouse', 'pen', 'bridge'];
export const ERA3_DESIGNS = ['citywall', 'palace', 'workshop', 'furnace', 'market', 'temple', 'cartway', 'bell'];
export const ALL_DESIGNS = [...DESIGNS, ...ERA2_DESIGNS, ...ERA3_DESIGNS];
// 图纸要先学会什么（祭坛三段还要按顺序修）
export const DESIGN_NEEDS = {
  bench: 'knap', trap: 'trap', altar1: 'knap', altar2: 'mural', altar3: 'stars',
  granary: 'granary', kiln: 'pottery', timberhouse: 'timberhouse', pen: 'husbandry', bridge: 'bridge',
  citywall: 'bronzeWalls', palace: 'law', workshop: 'smelt', furnace: 'smelt',
  market: 'measure', temple: 'rites', cartway: 'wheel', bell: 'alloy',
};

// 第一代技艺：pre 前置；work 要琢磨多少个钟头（一天大约能琢磨 6–8 个钟头）；skill 谁最合适；domain 哪一行的天才琢磨得快
export const TECHS = {
  forage: { name: '辨识野食', pre: [], work: 20, skill: 'gather', domain: 'herb', cat: '生产', what: '采集多四分之一；冬天会挖块根' },
  knap: { name: '打制石器', pre: [], work: 24, skill: 'quarry', domain: 'craft', cat: '生产', what: '砍柴、采石、盖房快 15%，打猎准；能画石器台、祭坛' },
  keepfire: { name: '保火', pre: [], work: 20, skill: 'fire', domain: 'fire', cat: '生产', what: '火省柴 20%，大雨难浇灭；有了火守' },
  burial: { name: '葬礼', pre: [], work: 16, skill: null, domain: 'art', cat: '仪式', what: '有人死了，族人哀伤减半，更念神的好' },
  basket: { name: '编筐', pre: ['forage'], work: 24, skill: 'gather', domain: 'craft', cat: '生产', what: '一趟多背一半；能在河上写「山」筑堤' },
  hide: { name: '兽皮衣', pre: ['knap'], work: 24, skill: 'hunt', domain: 'craft', cat: '生产', what: '会用兽皮缝衣裳：冬天不冻' },
  drive: { name: '围猎', pre: ['knap'], work: 28, skill: 'hunt', domain: 'hunt', cat: '军事', what: '能在兽身上写「旗」围猎，打猎更准' },
  harpoon: { name: '渔叉', pre: ['knap'], work: 24, skill: 'fish', domain: 'hunt', cat: '生产', what: '叉鱼多六成，冬天也叉得到' },
  smoke: { name: '熏肉', pre: ['keepfire'], work: 28, skill: 'fire', domain: 'fire', cat: '生产', what: '晾肉架快四成，下雨也能熏' },
  herb: { name: '草药', pre: ['forage'], work: 36, skill: 'gather', domain: 'herb', cat: '社会', what: '有了草药师：治病、治伤，热病少死人' },
  trap: { name: '陷阱', pre: ['drive'], work: 32, skill: 'hunt', domain: 'hunt', cat: '军事', what: '能画陷阱：自己逮野物，也伤狼' },
  needle: { name: '骨针', pre: ['hide'], work: 28, skill: 'build', domain: 'craft', cat: '生产', what: '皮衣更暖、缝得快' },
  longhouse: { name: '长屋', pre: ['knap', 'basket'], work: 40, skill: 'build', domain: 'craft', cat: '建造', what: '新盖的窝棚多住一半人、更暖' },
  raft: { name: '木筏', pre: ['basket'], work: 36, skill: 'build', domain: 'craft', cat: '交通', what: '过河不慢；发大水时少淹死人' },
  mural: { name: '壁画', pre: ['keepfire'], work: 32, skill: null, domain: 'art', cat: '社会', what: '把会的手艺画上石壁：会的人死了也能照着学回来' },
  dance: { name: '舞祭', pre: ['burial'], work: 28, skill: null, domain: 'art', cat: '仪式', what: '月圆夜围着火跳舞，信仰更旺' },
  dog: { name: '驯犬', pre: ['drive'], work: 48, skill: 'hunt', domain: 'hunt', cat: '军事', what: '狗帮着打猎、夜里报警、找回走失的人' },
  stars: { name: '观星', pre: ['mural'], work: 56, skill: null, domain: 'art', cat: '社会', what: '能写日·放晴、月·入夜、月·歇息；提前看出寒冬和大水；祭坛第三段（墨池）要它' },
  // 第二代 · 农耕时代（彩陶）18 门技艺
  plow: { name: '开垦', era: 2, pre: [], work: 22, skill: 'build', domain: 'craft', cat: '农耕', what: '铅笔闭合圈地划田更快，整地省三成工夫' },
  pottery: { name: '制陶', era: 2, pre: [], work: 26, skill: 'fire', domain: 'potter', cat: '工艺', what: '能画陶窑烧陶罐；陶罐装谷物和干肉，放得久、防鼠咬' },
  sow: { name: '播种', era: 2, pre: ['plow'], work: 24, skill: 'gather', domain: 'herb', cat: '农耕', what: '下种匀、出苗齐，每块田多打两成粮' },
  irrigate: { name: '引水', era: 2, pre: ['plow'], work: 28, skill: 'build', domain: 'hydro', cat: '水利', what: '挖水渠快四成；能修大渠第一段（引水干渠）' },
  bridge: { name: '筑桥', era: 2, pre: ['plow'], work: 28, skill: 'build', domain: 'hydro', cat: '交通', what: '能画木桥跨过河：过河不再慢，两岸来往方便' },
  granary: { name: '公共粮仓', era: 2, pre: ['pottery'], work: 32, skill: 'build', domain: 'craft', cat: '建造', what: '能画公共粮仓：谷物能放好几季，少喂老鼠；能修大渠第二段' },
  husbandry: { name: '驯养', era: 2, pre: ['sow'], work: 30, skill: 'hunt', domain: 'hunt', cat: '农耕', what: '能画畜栏养牲畜：常产出鲜肉，栏边农田肥得快' },
  weave: { name: '织布', era: 2, pre: ['sow'], work: 26, skill: 'gather', domain: 'craft', cat: '工艺', what: '用草和麻织粗布衣裳，不必等猎兽就有衣穿' },
  calendar: { name: '历法', era: 2, pre: ['sow'], work: 38, skill: null, domain: 'astro', cat: '社会', what: '能写「光」降不季之穗；提前知晓旱涝与洪期；能修大渠第三段（分洪尾渠）' },
  rotation: { name: '轮作', era: 2, pre: ['sow', 'calendar'], work: 30, skill: 'gather', domain: 'herb', cat: '农耕', what: '收割少耗地力，休耕的田肥力回得快一倍' },
  brew: { name: '酿酒', era: 2, pre: ['pottery', 'sow'], work: 28, skill: 'fire', domain: 'potter', cat: '仪式', what: '春秋季节祭用谷酿酒祭神，士气与爱戴多涨一倍' },
  mill: { name: '石磨', era: 2, pre: ['sow'], work: 26, skill: 'quarry', domain: 'craft', cat: '工艺', what: '把谷物磨成面，一份谷顶得上一份半' },
  timberhouse: { name: '木构房', era: 2, pre: ['bridge'], work: 34, skill: 'build', domain: 'craft', cat: '建造', what: '能画木构房：按户同住、暖和防雨，不容易塌' },
  knot: { name: '结绳记事', era: 2, pre: ['calendar'], work: 32, skill: null, domain: 'astro', cat: '社会', what: '手艺记进绳结：失传只要三成工夫学回，传习也更快' },
  villageRule: { name: '村规', era: 2, pre: ['knot', 'granary'], work: 34, skill: null, domain: 'art', cat: '仪式', what: '推举司祭稳住信仰（回墨 +20%）；众人更听神谕、防鼠也周全' },
  net: { name: '渔网', era: 2, pre: ['weave'], work: 26, skill: 'fish', domain: 'hunt', cat: '生产', what: '织网下河，叉鱼捕鱼再多八成' },
  canoe: { name: '独木舟', era: 2, pre: ['bridge'], work: 28, skill: 'build', domain: 'hydro', cat: '交通', what: '涉水行船更快，过河往来青陶村省一半工夫' },
  herbgarden: { name: '草药园', era: 2, pre: ['sow'], work: 30, skill: 'gather', domain: 'herb', cat: '社会', what: '房前屋后种草药：村里少病倒，病好得快一半' },
  smelt: { name: '冶铜', era: 3, pre: [], work: 27, skill: 'fire', domain: 'smith', cat: '工艺', what: '建工坊和铸铜炉，将矿料和柴炼成铜' },
  alloy: { name: '合金', era: 3, pre: ['smelt'], work: 35, skill: 'fire', domain: 'smith', cat: '工艺', what: '铜炉产出青铜，可铸大钟' },
  wheel: { name: '车与轮', era: 3, pre: [], work: 28, skill: 'build', domain: 'smith', cat: '交通', what: '画车道，缩短商队往返，村里送粮更多' },
  script: { name: '文字', era: 3, pre: [], work: 30, skill: null, domain: 'scribe', cat: '社会', what: '史官把技艺记进书简，神谕也可抄成经文' },
  law: { name: '立法', era: 3, pre: ['script'], work: 32, skill: null, domain: 'scribe', cat: '治理', what: '建宫室，把一道已生效的神谕写成常行律令' },
  tribute: { name: '税赋', era: 3, pre: ['law'], work: 30, skill: null, domain: 'scribe', cat: '治理', what: '可调整村落税粮，筹措军粮或减赋安民' },
  measure: { name: '度量衡', era: 3, pre: ['script'], work: 30, skill: 'quarry', domain: 'scribe', cat: '商贸', what: '建市集，统一斗斛后邻邦交易更划算' },
  rites: { name: '礼乐', era: 3, pre: ['script'], work: 32, skill: null, domain: 'art', cat: '仪式', what: '建宗庙，祭祀安民并增加信仰' },
  bronzeWalls: { name: '戈与剑', era: 3, pre: ['smelt'], work: 34, skill: 'hunt', domain: 'general', cat: '防卫', what: '可筑城墙，青铜守卒护城更稳' },
  chariot: { name: '战车', era: 3, pre: ['alloy', 'wheel'], work: 42, skill: 'build', domain: 'general', cat: '防卫', what: '有车道时可从两村调车应援，增加守城力量' },
  post: { name: '驿传', era: 3, pre: ['wheel', 'script'], work: 35, skill: 'build', domain: 'general', cat: '交通', what: '巡行和贸易更快，消息早一季传回' },
  astronomy: { name: '天文', era: 3, pre: ['script'], work: 38, skill: null, domain: 'astro', cat: '历法', what: '预报城邦旱年，及时储粮或引水' },
  divination: { name: '占卜', era: 3, pre: ['astronomy', 'rites'], work: 35, skill: null, domain: 'scribe', cat: '仪式', what: '提前看出联盟来势，祭祀可安定军心' },
};
export const TECH_IDS = Object.keys(TECHS);
export const ERA1_TECH_IDS = TECH_IDS.filter(id => !TECHS[id].era || TECHS[id].era === 1);
export const ERA2_TECH_IDS = TECH_IDS.filter(id => TECHS[id].era === 2);
export const ERA3_TECH_IDS = TECH_IDS.filter(id => TECHS[id].era === 3);
export const eraNum = sim => sim?.era3?.active ? 3 : sim?.era2?.active ? 2 : 1;
// 天才：哪一行
export const GENIUS_ERA1 = { fire: '会保火的人', art: '会画壁画的人', hunt: '会驯兽的人', herb: '会认草药的人', craft: '手巧的人' };
export const GENIUS_ERA2 = { ...GENIUS_ERA1, potter: '巧手陶匠', hydro: '善治水的人', astro: '通历法的人' };
export const GENIUS = { ...GENIUS_ERA2, smith: '天生铸匠', scribe: '史官的眼力', general: '善领军的人' };

// 墨笔号令：「语境:符」→ 做什么。动词名和墨价取自 symbols.js 的 CONTEXTS，这里只管 M1 解锁了哪些、落到模拟里是什么
export const ACTIONS = {
  'sky:yu': { kind: 'rain' },
  'sky:huo': { kind: 'bolt' },
  'folk:qi': { kind: 'rally' },
  'folk:guang': { kind: 'light' },
  'folk:huo': { kind: 'kindle' },
  'folk:jian': { kind: 'train' },
  'folk:shu': { kind: 'order', job: 'gather', near: true },
  'wood:jian': { kind: 'order', job: 'chop' },
  'wood:shu': { kind: 'order', job: 'gather' },
  'wood:huo': { kind: 'burn' },
  'wood:qi': { kind: 'rally' },
  'rock:jian': { kind: 'order', job: 'quarry' },
  'rock:shan': { kind: 'site', build: 'cairn' },
  'rock:qi': { kind: 'rally' },
  'beast:jian': { kind: 'hunt' },
  'beast:huo': { kind: 'scare' },
  'beast:qi': { kind: 'huntAll' },
  'river:shui': { kind: 'order', job: 'water' },
  'river:jian': { kind: 'order', job: 'fish' },
  'river:qi': { kind: 'rally' },
  'land:shu': { kind: 'site', build: 'sapling' },
  'land:qi': { kind: 'site', build: 'outpost' },
  'land:shui': { kind: 'site', build: 'well' },
  'land:shan': { kind: 'site', build: 'cairn' },
  'land:huo': { kind: 'site', build: 'fire' },
  'river:shan': { kind: 'levee' },
  'sky:ri': { kind: 'clear' },
  'sky:yue': { kind: 'night' },
  'folk:yue': { kind: 'rest' },
  'band:huo': { kind: 'giveFire' },
  'band:qi': { kind: 'marry' },
  'band:jian': { kind: 'drive' },
  'band:guang': { kind: 'awe' },
  // 第二代：农田与邻村
  'field:shu': { kind: 'fieldSow' },
  'field:jian': { kind: 'fieldHarvest' },
  'field:shui': { kind: 'fieldWater' },
  'field:huo': { kind: 'fieldPest' },
  'field:guang': { kind: 'fieldBless' },
  'village:qi': { kind: 'villageTrade' },
  'village:shui': { kind: 'villageWater' },
  'village:jian': { kind: 'villageBreakDam' },
  'village:guang': { kind: 'villageAwe' },
};
// 这一代还没有的（写对了也只提示「下一代」）
export const LOCKED = {};
// 要先学会某项技艺才能写的
export const TECH_LOCKS = { 'sky:ri': 'stars', 'sky:yue': 'stars', 'folk:yue': 'stars', 'river:shan': 'basket', 'beast:qi': 'drive', 'field:guang': 'calendar' };

// 名字：开局十人，之后生的孩子从池子里取
export const NAMES = {
  m: ['石头', '阿木', '阿岩', '老柯', '阿松', '山子', '阿栗', '青石', '阿杉', '阿桐', '小橡', '阿蒿', '小鹿', '阿樟', '小枫', '阿竹'],
  f: ['阿禾', '小杏', '青禾', '小满', '阿苗', '小溪', '小葵', '小荷', '阿梅', '小苇', '小芽', '阿柳', '小雀', '阿桑', '小蒲', '阿莲'],
};
