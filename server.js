const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

const MAX_TURNS = 35;
const TURN_DURATION = 120; // 思考時間2分

const ZONES = [
  { id: 0, name: "① 水底・泥地", minStage: 1, baseWaterLoss: 0, prey: [
    { id: "algae", name: "アオミドロ(藻)", diff: 0, food: 18, exp: 8 },
    { id: "chironomid", name: "ユスリカの幼虫", diff: 10, food: 22, exp: 12 }
  ]},
  { id: 1, name: "② 水中(水草)", minStage: 1, baseWaterLoss: 0, prey: [
    { id: "daphnia", name: "ミジンコ", diff: 5, food: 15, exp: 8 },
    { id: "wriggler", name: "ボウフラ", diff: 15, food: 25, exp: 14 },
    { id: "bloodworm", name: "アカムシ", diff: 20, food: 28, exp: 18 }
  ]},
  { id: 2, name: "③ 水面・浅瀬", minStage: 3, baseWaterLoss: 0, prey: [
    { id: "mosquito", name: "落ちた蚊", diff: 25, food: 30, exp: 20 },
    { id: "strider", name: "アメンボ", diff: 30, food: 32, exp: 22 }
  ]},
  { id: 3, name: "④ 水際・湿地", minStage: 4, baseWaterLoss: 5, prey: [
    { id: "woodlouse", name: "ワラジムシ", diff: 35, food: 38, exp: 25 },
    { id: "fly", name: "小型ハエ", diff: 40, food: 40, exp: 28 }
  ]},
  { id: 4, name: "⑤ 草むら・陸地", minStage: 5, baseWaterLoss: 20, prey: [
    { id: "cricket", name: "コオロギ", diff: 50, food: 55, exp: 35 },
    { id: "grasshopper", name: "大型バッタ", diff: 65, food: 65, exp: 45 },
    { id: "earthworm", name: "巨大ミミズ (大物・協力推奨)", diff: 85, food: 85, exp: 60 }
  ]}
];

function getStageFromLevel(level) {
  if (level >= 12) return 6; // 成体
  if (level >= 9) return 5;  // 子ガエル
  if (level >= 7) return 4;  // 尾変態
  if (level >= 5) return 3;  // 前足
  if (level >= 3) return 2;  // 後足
  return 1;                  // オタマ
}

function getNextExpForLevel(level) {
  return 10 + (level * 6);
}

const STAGE_NAMES = ["", "オタマジャクシ", "後足が生えた", "前足が生えた", "変態期(尾あり)", "子ガエル", "成体カエル"];
const NPC_PERSONALITIES = ["温厚", "臆病", "利己", "獰猛", "気まぐれ"];
const TRAITS = ["頑強", "大食漢", "身軽", "高代謝", "慎重"];

// ★大幅拡充されたイベントマスター（全20種類以上）
const AREA_EVENTS = {
  global: [
    { id: "g_rain", title: "【全体】恵みのゲリラ豪雨", desc: "激しいスコール！陸地が潤い、虫たちが地面に落ちてきた！", choices: [{ id: "rush", text: "🦗 陸へ駆け上がって乱獲 (EXP期待)" }, { id: "stay", text: "💧 水中で安全に雨宿り (安全第一)" }] },
    { id: "g_heron", title: "【全体】上空にサギの旋回！", desc: "巨大なアオサギが池を見下ろしている。どう切り抜ける？", choices: [{ id: "threat", text: "👥 みんなで膨らんで威嚇" }, { id: "hide", text: "🙈 泥の底へ潜って隠れる" }] },
    { id: "g_bloom", title: "【全体】水面のアオコ大発生", desc: "水面の酸素が薄くなってきた。息継ぎが困難に！", choices: [{ id: "surface", text: "🫧 水面で必死に呼吸 (気力回復)" }, { id: "endure", text: "🧘 水底でジッと耐える (消耗回避)" }] }
  ],
  4: [
    { id: "p_snake_nest", type: "pair", title: "【草むら】ヘビの寝床の獲物", desc: "眠る大蛇のすぐ脇にバッタの卵塊を発見！音を立てればヘビが目覚める！", choices: [{ id: "creep", text: "🤫 忍び足で分け合う (協調)" }, { id: "push", text: "⚡ 相手を突き飛ばして独占 (非情)" }] },
    { id: "p_dew", type: "pair", title: "【草むら】朝露の分け合い", desc: "照りつける太陽。草の先端に大粒の朝露が1滴だけ残っている……", choices: [{ id: "share", text: "💧 半分ずつ吸い合う (協調)" }, { id: "drink_all", text: "⚡ 突き飛ばして一気飲み (独占)" }] },
    { id: "p_grasshopper_hunt", type: "pair", title: "【草むら】大型バッタの挟み撃ち", desc: "凶暴なトノサマバッタを発見！2匹で挟み撃ちにすれば狩れそうだ！", choices: [{ id: "pincer", text: "🤝 合図に合わせて挟み撃ち" }, { id: "bait", text: "😈 相手を突っ込ませて漁夫の利" }] },
    { id: "s_scorching_sun", type: "personal", title: "【草むら】直射日光の猛威", desc: "日差しが強烈で皮膚がパリパリに乾いていく……！", choices: [{ id: "shade", text: "🌿 葉陰を探して休む (水分保護)" }, { id: "hunt_on", text: "🦗 我慢して虫を探し回る (捕食優先)" }] }
  ],
  3: [
    { id: "p_log_entry", type: "pair", title: "【水際】倒木シェルターの定員", desc: "外敵の気配！狭い倒木の空洞は1匹分しかない！押し合うか、譲るか？", choices: [{ id: "squeeze", text: "🤝 半分ずつ押し込み合う (協調)" }, { id: "kick_out", text: "🦶 相手を外へ蹴り出す (非情)" }] },
    { id: "p_mud_bath", type: "pair", title: "【水際】泥パックの塗り合い", desc: "湿った泥を皮膚に塗ると乾燥を防げる。背中に泥を塗り合うか？", choices: [{ id: "help", text: "🤝 お互いに泥を塗り合う" }, { id: "take", text: "⚡ 泥を奪って自分だけに塗る" }] },
    { id: "g_worm", type: "personal", title: "【水際】流れてきた大ミミズ", desc: "岸辺の泥に高栄養なミミズが漂着した！", choices: [{ id: "share_w", text: "🤝 周囲の仲間と分け合う" }, { id: "solo_w", text: "😋 独り占めして丸呑み" }] }
  ],
  2: [
    { id: "p_leaf", type: "pair", title: "【水面】浮き草の定員", desc: "サギ警戒中！1匹しか乗れない浮き葉の上で鉢合わせた。沈む前にどうする？", choices: [{ id: "coop", text: "🤝 譲り合って片足で耐える (協調)" }, { id: "kick", text: "🦶 相手を水中に蹴り落とす (非情)" }] },
    { id: "p_strider_chase", type: "pair", title: "【水面】素早いアメンボ", desc: "水面を滑るアメンボ！素早くて1匹では捕まえにくい！", choices: [{ id: "coop_hunt", text: "🤝 追い込んで挟み撃ち" }, { id: "steal", text: "⚡ 相手が追ったところを横取り" }] },
    { id: "s_floating_flower", type: "personal", title: "【水面】水面に浮かぶ花びら", desc: "綺麗なスイレンの花びらが流れてきた。乗って休めそうだ。", choices: [{ id: "ride", text: "🌸 花びらに乗って休む (気力回復)" }, { id: "under", text: "👀 花の影に潜んで虫を待つ (捕食)" }] }
  ],
  1: [
    { id: "p_weed_trap", type: "pair", title: "【水中】水草に絡まった仲間", desc: "相手が水草に尾びれを絡め取られて動けない！助けるか、襲うか？", choices: [{ id: "rescue", text: "✂️ 水草を噛みちぎって助ける (協調)" }, { id: "cannibal", text: "😈 動けない相手の尾をかじる (非情)" }] },
    { id: "p_bubble_share", type: "pair", title: "【水中】水草の光合成気泡", desc: "水草から新鮮な空気の泡が出ている！息継ぎに行かずに酸素を得られる！", choices: [{ id: "share_b", text: "🫧 半分ずつ吸い合う" }, { id: "gulp_b", text: "⚡ 一気に全部吸い込む" }] },
    { id: "p_beetle_danger", type: "pair", title: "【水中】凶暴なゲンゴロウ急襲", desc: "鋭いアゴを持つ大型ゲンゴロウが泳ぎ寄ってきた！", choices: [{ id: "coop_flee", text: "🤝 目配せして同時に左右へ逃げる" }, { id: "push_bait", text: "⚡ 相手を前へ突き飛ばして逃げる" }] }
  ],
  0: [
    { id: "p_yago_ambush", type: "pair", title: "【水底】ヤゴの巣穴の発見", desc: "泥の底にヤゴが潜んでいるのを2匹が同時に気づいた！", choices: [{ id: "back_off", text: "🤫 目配せして静かに後退 (協調)" }, { id: "push_yago", text: "⚡ 相手をヤゴの前へ突き飛ばす (非情)" }] },
    { id: "p_mud_burrow", type: "pair", title: "【水底】安全な泥の寝床", desc: "冷たくて天敵から見つかりにくい極上の泥のくぼみを発見！", choices: [{ id: "cuddle", text: "🤝 2匹で身を寄せて埋まる" }, { id: "monopolize", text: "🦶 相手を押し出して独占する" }] },
    { id: "s_moss", type: "personal", title: "【水底】青白く光る苔", desc: "暗い泥底に怪しく光る苔が生い茂っている。極上の栄養か、毒か？", choices: [{ id: "eat", text: "😋 思い切って食べる" }, { id: "ignore", text: "🙅 怪しいので無視する" }] }
  ]
};

const rooms = {};

function createNewRoom(roomId) {
  const room = {
    id: roomId,
    status: "waiting",
    hostId: null,
    turn: 1,
    timeLeft: TURN_DURATION,
    weather: "快晴",
    forecast: "曇り",
    nextPredator: null,
    activePredatorAnimation: null,
    actors: {},
    eventsByZone: {},
    pairTargets: {},
    coopRequests: {},
    coopAccepted: {},
    turnSummaries: {},
    isFinished: false,
    timer: null
  };

  for (let i = 1; i <= 24; i++) {
    const npcId = `npc_${i}`;
    room.actors[npcId] = createActor(npcId, `兄弟_${i}`, false);
  }

  rooms[roomId] = room;
  return room;
}

function createActor(id, name, isPlayer) {
  const trait = TRAITS[Math.floor(Math.random() * TRAITS.length)];
  const personality = isPlayer ? "プレイヤー" : NPC_PERSONALITIES[Math.floor(Math.random() * NPC_PERSONALITIES.length)];
  const gender = Math.random() < 0.5 ? "♂" : "♀";

  return {
    id, name, isPlayer, personality, trait, gender,
    alive: true,
    level: 1,
    exp: 0,
    stage: 1,
    eggs: 2,
    offspringCount: 0,
    hp: 100, food: 100, water: 100, stamina: 100,
    length: 1.0,
    weight: 0.5,
    zone: 1, // 初期水中
    ready: false,
    action: null,
    eventChoice: null,
    affinity: {},
    history: [`第1世代の卵塊から誕生（性別: ${gender === '♂' ? 'オス' : 'メス'} / 特徴: ${trait}）`]
  };
}

function startRoomGame(room) {
  room.status = "playing";
  room.turn = 1;
  room.timeLeft = TURN_DURATION;
  pickAreaEvents(room);

  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      resolveTurn(room);
    } else {
      broadcastState(room);
    }
  }, 1000);

  broadcastState(room, ["🎉 ゲーム開始！全員が卵から孵化し、池へ広がった！"]);
}

function pickAreaEvents(room) {
  room.eventsByZone = {};
  room.pairTargets = {};
  const aliveList = Object.values(room.actors).filter(a => a.alive);

  const byZone = {};
  aliveList.forEach(a => {
    const az = parseInt(a.zone, 10) || 1;
    byZone[az] = byZone[az] || [];
    byZone[az].push(a.id);
  });

  const globalBase = AREA_EVENTS.global[Math.floor(Math.random() * AREA_EVENTS.global.length)];

  for (let z = 0; z < 5; z++) {
    const actorsHere = byZone[z] || [];
    const pool = AREA_EVENTS[z] || [];

    if (actorsHere.length >= 2 && pool.some(e => e.type === "pair")) {
      const pairPool = pool.filter(e => e.type === "pair");
      const pairEv = pairPool[Math.floor(Math.random() * pairPool.length)];
      room.eventsByZone[z] = pairEv;

      const shuffled = [...actorsHere].sort(() => 0.5 - Math.random());
      for (let i = 0; i < shuffled.length - 1; i += 2) {
        room.pairTargets[shuffled[i]] = shuffled[i + 1];
        room.pairTargets[shuffled[i + 1]] = shuffled[i];
      }
    } else if (pool.length > 0) {
      room.eventsByZone[z] = pool[Math.floor(Math.random() * pool.length)];
    } else {
      room.eventsByZone[z] = globalBase;
    }
  }
}

// ターン解決処理（★重要：実行順序を正常化）
function resolveTurn(room) {
  if (room.isFinished) return;

  const logs = [];
  logs.push(`=== [ TURN ${room.turn} 解決 ] ===`);
  room.activePredatorAnimation = null;
  room.turnSummaries = {};

  const alive = Object.values(room.actors).filter(a => a.alive);

  alive.filter(a => a.isPlayer).forEach(p => {
    room.turnSummaries[p.id] = {
      turn: room.turn,
      action: "行動なし",
      event: "特になし",
      metabolism: "",
      growth: "",
      danger: ""
    };
  });

  // 1. NPCの行動・イベント選択を決定（現在地ベース）
  alive.filter(a => !a.isPlayer).forEach(npc => decideNpcTurn(npc, room));

  // 2. ★エリア連動イベント解決を「移動前（現在地）」で確実に実行！
  resolveAreaEvents(room, logs);

  // 3. 移動の実行
  alive.forEach(a => {
    if (a.action && a.action.moveZone !== undefined) {
      const tz = parseInt(a.action.moveZone, 10);
      if (!isNaN(tz) && tz >= 0 && tz <= 4 && a.stage >= ZONES[tz].minStage) {
        a.zone = tz;
      }
    }
  });

  // 4. 天敵襲来（豪雨時は安全）
  if (room.nextPredator && room.weather !== "豪雨") {
    room.activePredatorAnimation = room.nextPredator;
    resolvePredator(room, logs);
  } else if (room.weather === "豪雨") {
    logs.push("⛈️ 激しい豪雨のため、天敵たちは身を潜めている。");
  }

  // 5. アクション解決（移動先での捕食・交配・団子など）
  resolveActions(room, logs);

  // 6. 代謝・成長・死亡
  resolveMetabolism(room, logs);

  // 7. 勝敗判定
  const livePlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
  if (room.turn >= MAX_TURNS || (Object.values(room.actors).filter(a => a.isPlayer).length > 1 && livePlayers.length <= 1)) {
    finishGame(room, logs);
    return;
  }

  // 次ターン準備
  room.turn++;
  room.timeLeft = TURN_DURATION;
  room.weather = room.forecast;

  const wRoll = Math.random();
  if (wRoll < 0.25) room.forecast = "雨";
  else if (wRoll < 0.50) room.forecast = "快晴";
  else if (wRoll < 0.75) room.forecast = "曇り";
  else if (wRoll < 0.90) room.forecast = "日照り";
  else room.forecast = "豪雨";

  if (Math.random() < 0.35) {
    room.nextPredator = Math.random() < 0.6 ? "yago" : "heron";
  } else {
    room.nextPredator = null;
  }

  // 新しい現在地に合わせて次ターンのイベントを抽選
  pickAreaEvents(room);

  room.coopRequests = {};
  room.coopAccepted = {};
  Object.values(room.actors).forEach(a => {
    a.ready = false;
    a.action = null;
    a.eventChoice = null;
  });

  broadcastState(room, logs);
}

// NPCの思考ロジック
function decideNpcTurn(npc, room) {
  const currentZone = parseInt(npc.zone, 10) || 1;
  let tz = currentZone;

  if (npc.stage >= 5 && Math.random() < 0.4) {
    tz = (room.weather === "雨" || room.weather === "豪雨") ? 4 : 3;
  } else if (npc.stage < 4) {
    tz = Math.random() < 0.6 ? 1 : 0;
  }
  tz = Math.max(0, Math.min(4, tz));
  if (tz > npc.stage) tz = currentZone;

  let act = "feed";
  let targetId = null;
  let targetPreyId = null;

  if (npc.water < 35 && tz >= 3) {
    act = "water";
  } else if (npc.stamina < 30) {
    act = "rest";
  } else if (npc.stage >= 6 && Math.random() < 0.4) {
    const partner = Object.values(room.actors).find(o => o.alive && o.id !== npc.id && parseInt(o.zone, 10) === tz && o.stage >= 6 && o.gender !== npc.gender);
    if (partner) { act = "mate"; targetId = partner.id; }
  } else if ((room.weather === "快晴" || room.weather === "日照り") && tz >= 4 && Math.random() < 0.5) {
    const buddy = Object.values(room.actors).find(o => o.alive && o.id !== npc.id && parseInt(o.zone, 10) === tz);
    if (buddy) { act = "huddle"; targetId = buddy.id; }
  }

  if (act === "feed") {
    const zData = ZONES[tz];
    if (zData && zData.prey.length > 0) {
      targetPreyId = zData.prey[Math.floor(Math.random() * zData.prey.length)].id;
    }
  }

  npc.action = { moveZone: tz, act, targetId, targetPreyId };

  // ★現在地のイベントに対する選択肢を性格から決定
  const ev = room.eventsByZone[currentZone];
  if (ev && ev.choices && ev.choices.length > 0) {
    if (npc.personality === "温厚") {
      npc.eventChoice = ev.choices[0].id; // 協調
    } else if (npc.personality === "利己" || npc.personality === "獰猛") {
      npc.eventChoice = ev.choices.length > 1 ? ev.choices[1].id : ev.choices[0].id; // 独占・攻撃
    } else if (npc.personality === "臆病") {
      npc.eventChoice = ev.choices[0].id;
    } else {
      npc.eventChoice = ev.choices[Math.floor(Math.random() * ev.choices.length)].id;
    }
  }
}

// ★エリアイベントの完全解決（親密度・パラメータ増減の確実な反映）
function resolveAreaEvents(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  for (let z = 0; z < 5; z++) {
    const ev = room.eventsByZone[z];
    if (!ev) continue;
    const actorsInZone = alive.filter(a => parseInt(a.zone, 10) === z);

    if (ev.type === "pair") {
      const handled = new Set();
      actorsInZone.forEach(p1 => {
        const p2Id = room.pairTargets[p1.id];
        if (!p2Id || handled.has(p1.id) || handled.has(p2Id)) return;
        handled.add(p1.id); handled.add(p2Id);
        const p2 = room.actors[p2Id];
        if (!p2 || !p2.alive) return;

        const involvesPlayer = p1.isPlayer || p2.isPlayer;
        const c1 = p1.eventChoice;
        const c2 = p2.eventChoice;

        // --- ゾーン4: 草むら ---
        if (ev.id === "p_snake_nest") {
          if (c1 === "creep" && c2 === "creep") {
            p1.exp += 25; p1.food = Math.min(100, p1.food + 30);
            p2.exp += 25; p2.food = Math.min(100, p2.food + 30);
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `ヘビを起こさず獲物を分け合った (満腹+30, EXP+25, ${p2.name}親密度+8)`);
            setEventSummary(room, p2, `ヘビを起こさず獲物を分け合った (満腹+30, EXP+25, ${p1.name}親密度+8)`);
            if (involvesPlayer) logs.push(`ペア結末[ヘビ]: ${p1.name} と ${p2.name} は静かに獲物を分け合った (親密度+8)`);
          } else if (c1 === "push" && c2 === "creep") {
            p1.exp += 45; p1.food = Math.min(100, p1.food + 60);
            p2.hp -= 35; addAffinity(p2, p1, -15);
            setEventSummary(room, p1, `${p2.name} を突き飛ばし獲物を独占！ (満腹+60, EXP+45)`);
            setEventSummary(room, p2, `${p1.name} に突き飛ばされヘビに噛まれた！ (HP-35, 親密度-15)`);
            if (involvesPlayer) logs.push(`ペア結末[ヘビ]: ${p1.name} が ${p2.name} を生贄にして獲物を独占！`);
          } else if (c1 === "creep" && c2 === "push") {
            p2.exp += 45; p2.food = Math.min(100, p2.food + 60);
            p1.hp -= 35; addAffinity(p1, p2, -15);
            setEventSummary(room, p2, `${p1.name} を突き飛ばし獲物を独占！ (満腹+60, EXP+45)`);
            setEventSummary(room, p1, `${p2.name} に突き飛ばされヘビに噛まれた！ (HP-35, 親密度-15)`);
            if (involvesPlayer) logs.push(`ペア結末[ヘビ]: ${p2.name} が ${p1.name} を生贄にして獲物を独占！`);
          } else {
            p1.hp -= 30; p2.hp -= 30; addAffinity(p1, p2, -8);
            setEventSummary(room, p1, `暴れて目覚めたヘビに共倒れで噛まれた！ (HP-30, 親密度-8)`);
            setEventSummary(room, p2, `暴れて目覚めたヘビに共倒れで噛まれた！ (HP-30, 親密度-8)`);
            if (involvesPlayer) logs.push(`ペア結末[ヘビ]: 2匹が暴れ、ヘビに共倒れで噛まれた！`);
          }
        } else if (ev.id === "p_dew") {
          if (c1 === "share" && c2 === "share") {
            p1.water = Math.min(100, p1.water + 35); p2.water = Math.min(100, p2.water + 35);
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `${p2.name} と朝露を半分ずつ分け合った (水分+35, 親密度+8)`);
            setEventSummary(room, p2, `${p1.name} と朝露を半分ずつ分け合った (水分+35, 親密度+8)`);
            if (involvesPlayer) logs.push(`ペア結末[朝露]: ${p1.name} と ${p2.name} は朝露を分け合った (親密度+8)`);
          } else if (c1 === "drink_all" && c2 === "share") {
            p1.water = Math.min(100, p1.water + 70); addAffinity(p2, p1, -12);
            setEventSummary(room, p1, `朝露を独り占めして飲み干した！ (水分+70)`);
            setEventSummary(room, p2, `${p1.name} に朝露を独り占めされた！ (水分0, 親密度-12)`);
            if (involvesPlayer) logs.push(`ペア結末[朝露]: ${p1.name} が朝露を独り占めした！`);
          } else if (c1 === "share" && c2 === "drink_all") {
            p2.water = Math.min(100, p2.water + 70); addAffinity(p1, p2, -12);
            setEventSummary(room, p2, `朝露を独り占めして飲み干した！ (水分+70)`);
            setEventSummary(room, p1, `${p2.name} に朝露を独り占めされた！ (水分0, 親密度-12)`);
            if (involvesPlayer) logs.push(`ペア結末[朝露]: ${p2.name} が朝露を独り占めした！`);
          } else {
            addAffinity(p1, p2, -6);
            setEventSummary(room, p1, `朝露を奪い合って地面にこぼした (水分0, 親密度-6)`);
            setEventSummary(room, p2, `朝露を奪い合って地面にこぼした (水分0, 親密度-6)`);
            if (involvesPlayer) logs.push(`ペア結末[朝露]: 奪い合いにより朝露は泥に消えた……`);
          }
        } else if (ev.id === "p_grasshopper_hunt") {
          if (c1 === "pincer" && c2 === "pincer") {
            p1.food = Math.min(100, p1.food + 35); p1.exp += 25;
            p2.food = Math.min(100, p2.food + 35); p2.exp += 25;
            addAffinity(p1, p2, 10);
            setEventSummary(room, p1, `${p2.name} と挟み撃ち成功！ (満腹+35, EXP+25, 親密度+10)`);
            setEventSummary(room, p2, `${p1.name} と挟み撃ち成功！ (満腹+35, EXP+25, 親密度+10)`);
            if (involvesPlayer) logs.push(`ペア結末[狩り]: ${p1.name} と ${p2.name} がバッタを挟み撃ち捕獲！(親密度+10)`);
          } else if (c1 === "bait" && c2 === "pincer") {
            p1.food = Math.min(100, p1.food + 60); p1.exp += 40;
            p2.hp -= 20; addAffinity(p2, p1, -12);
            setEventSummary(room, p1, `${p2.name} を囮にしてバッタを丸呑み！ (満腹+60, EXP+40)`);
            setEventSummary(room, p2, `${p1.name} に囮にされバッタに蹴られた！ (HP-20, 親密度-12)`);
            if (involvesPlayer) logs.push(`ペア結末[狩り]: ${p1.name} が ${p2.name} を囮にして獲物を強奪！`);
          } else if (c1 === "pincer" && c2 === "bait") {
            p2.food = Math.min(100, p2.food + 60); p2.exp += 40;
            p1.hp -= 20; addAffinity(p1, p2, -12);
            setEventSummary(room, p2, `${p1.name} を囮にしてバッタを丸呑み！ (満腹+60, EXP+40)`);
            setEventSummary(room, p1, `${p2.name} に囮にされバッタに蹴られた！ (HP-20, 親密度-12)`);
            if (involvesPlayer) logs.push(`ペア結末[狩り]: ${p2.name} が ${p1.name} を囮にして獲物を強奪！`);
          } else {
            p1.stamina = Math.max(0, p1.stamina - 15); p2.stamina = Math.max(0, p2.stamina - 15);
            setEventSummary(room, p1, `お互いに様子を見すぎてバッタに逃げられた (気力-15)`);
            setEventSummary(room, p2, `お互いに様子を見すぎてバッタに逃げられた (気力-15)`);
          }
        }

        // --- ゾーン3: 水際 ---
        else if (ev.id === "p_log_entry") {
          if (c1 === "squeeze" && c2 === "squeeze") {
            p1.hp = Math.min(100, p1.hp + 15); p2.hp = Math.min(100, p2.hp + 15);
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `倒木に寄り添って安全に休んだ (HP+15, ${p2.name}親密度+8)`);
            setEventSummary(room, p2, `倒木に寄り添って安全に休んだ (HP+15, ${p1.name}親密度+8)`);
            if (involvesPlayer) logs.push(`ペア結末[倒木]: ${p1.name} と ${p2.name} は倒木で身を寄せ合った (親密度+8)`);
          } else if (c1 === "kick_out" && c2 === "squeeze") {
            p1.hp = Math.min(100, p1.hp + 20); p2.hp -= 25; addAffinity(p2, p1, -15);
            setEventSummary(room, p1, `${p2.name} を蹴り出して倒木を独占！ (HP+20)`);
            setEventSummary(room, p2, `${p1.name} に倒木から蹴り出された！ (HP-25, 親密度-15)`);
            if (involvesPlayer) logs.push(`ペア結末[倒木]: ${p1.name} が ${p2.name} を倒木から蹴り出した！`);
          } else if (c1 === "squeeze" && c2 === "kick_out") {
            p2.hp = Math.min(100, p2.hp + 20); p1.hp -= 25; addAffinity(p1, p2, -15);
            setEventSummary(room, p2, `${p1.name} を蹴り出して倒木を独占！ (HP+20)`);
            setEventSummary(room, p1, `${p2.name} に倒木から蹴り出された！ (HP-25, 親密度-15)`);
            if (involvesPlayer) logs.push(`ペア結末[倒木]: ${p2.name} が ${p1.name} を倒木から蹴り出した！`);
          } else {
            p1.hp -= 20; p2.hp -= 20; addAffinity(p1, p2, -10);
            setEventSummary(room, p1, `押し合いの末2匹とも転落！ (HP-20, 親密度-10)`);
            setEventSummary(room, p2, `押し合いの末2匹とも転落！ (HP-20, 親密度-10)`);
            if (involvesPlayer) logs.push(`ペア結末[倒木]: 2匹は倒木の奪い合いでもつれ合って転落！`);
          }
        } else if (ev.id === "p_mud_bath") {
          if (c1 === "help" && c2 === "help") {
            p1.water = Math.min(100, p1.water + 30); p2.water = Math.min(100, p2.water + 30);
            addAffinity(p1, p2, 10);
            setEventSummary(room, p1, `${p2.name} と泥を塗り合って保湿！ (水分+30, 親密度+10)`);
            setEventSummary(room, p2, `${p1.name} と泥を塗り合って保湿！ (水分+30, 親密度+10)`);
            if (involvesPlayer) logs.push(`ペア結末[泥浴]: ${p1.name} と ${p2.name} は泥を塗り合って保湿した (親密度+10)`);
          } else if (c1 === "take" && c2 === "help") {
            p1.water = Math.min(100, p1.water + 45); addAffinity(p2, p1, -10);
            setEventSummary(room, p1, `泥を独占して体に塗りたくった！ (水分+45)`);
            setEventSummary(room, p2, `${p1.name} に泥を独占された！ (親密度-10)`);
          } else if (c1 === "help" && c2 === "take") {
            p2.water = Math.min(100, p2.water + 45); addAffinity(p1, p2, -10);
            setEventSummary(room, p2, `泥を独占して体に塗りたくった！ (水分+45)`);
            setEventSummary(room, p1, `${p2.name} に泥を独占された！ (親密度-10)`);
          } else {
            addAffinity(p1, p2, -6);
            setEventSummary(room, p1, `泥を投げ合って喧嘩になった (親密度-6)`);
            setEventSummary(room, p2, `泥を投げ合って喧嘩になった (親密度-6)`);
          }
        }

        // --- ゾーン2: 水面 ---
        else if (ev.id === "p_leaf") {
          if (c1 === "coop" && c2 === "coop") {
            addAffinity(p1, p2, 8);
            p1.stamina = Math.min(100, p1.stamina + 20); p2.stamina = Math.min(100, p2.stamina + 20);
            setEventSummary(room, p1, `浮葉を譲り合い耐えきった (気力+20, ${p2.name}親密度+8)`);
            setEventSummary(room, p2, `浮葉を譲り合い耐えきった (気力+20, ${p1.name}親密度+8)`);
            if (involvesPlayer) logs.push(`ペア結末[浮葉]: ${p1.name} と ${p2.name} は譲り合って耐えきった (親密度+8)`);
          } else if (c1 === "kick" && c2 === "coop") {
            p2.hp -= 25; addAffinity(p2, p1, -12);
            setEventSummary(room, p1, `${p2.name} を葉から水中に蹴り落とした！`);
            setEventSummary(room, p2, `${p1.name} に葉から蹴り落とされた！ (HP-25, 親密度-12)`);
            if (involvesPlayer) logs.push(`ペア結末[浮葉]: ${p1.name} が ${p2.name} を水中に蹴り落とした！`);
          } else if (c1 === "coop" && c2 === "kick") {
            p1.hp -= 25; addAffinity(p1, p2, -12);
            setEventSummary(room, p2, `${p1.name} を葉から水中に蹴り落とした！`);
            setEventSummary(room, p1, `${p2.name} に葉から蹴り落とされた！ (HP-25, 親密度-12)`);
            if (involvesPlayer) logs.push(`ペア結末[浮葉]: ${p2.name} が ${p1.name} を水中に蹴り落とした！`);
          } else {
            p1.hp -= 20; p2.hp -= 20; addAffinity(p1, p2, -8);
            setEventSummary(room, p1, `もつれ合って共に水没！ (HP-20, 親密度-8)`);
            setEventSummary(room, p2, `もつれ合って共に水没！ (HP-20, 親密度-8)`);
            if (involvesPlayer) logs.push(`ペア結末[浮葉]: 2匹はもつれ合い共倒れで水没した`);
          }
        } else if (ev.id === "p_strider_chase") {
          if (c1 === "coop_hunt" && c2 === "coop_hunt") {
            p1.food = Math.min(100, p1.food + 25); p1.exp += 15;
            p2.food = Math.min(100, p2.food + 25); p2.exp += 15;
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `${p2.name} とアメンボを挟み撃ち捕獲！ (満腹+25, EXP+15, 親密度+8)`);
            setEventSummary(room, p2, `${p1.name} とアメンボを挟み撃ち捕獲！ (満腹+25, EXP+15, 親密度+8)`);
            if (involvesPlayer) logs.push(`ペア結末[アメンボ]: 2匹でアメンボを仕留めて山分け！(親密度+8)`);
          } else if (c1 === "steal" && c2 === "coop_hunt") {
            p1.food = Math.min(100, p1.food + 45); p1.exp += 25; addAffinity(p2, p1, -10);
            setEventSummary(room, p1, `${p2.name} が追ったアメンボを横取り！ (満腹+45, EXP+25)`);
            setEventSummary(room, p2, `${p1.name} にアメンボを横取りされた！ (親密度-10)`);
          } else if (c1 === "coop_hunt" && c2 === "steal") {
            p2.food = Math.min(100, p2.food + 45); p2.exp += 25; addAffinity(p1, p2, -10);
            setEventSummary(room, p2, `${p1.name} が追ったアメンボを横取り！ (満腹+45, EXP+25)`);
            setEventSummary(room, p1, `${p2.name} にアメンボを横取りされた！ (親密度-10)`);
          } else {
            setEventSummary(room, p1, `互いに邪魔し合ってアメンボに逃げられた`);
            setEventSummary(room, p2, `互いに邪魔し合ってアメンボに逃げられた`);
          }
        }

        // --- ゾーン1: 水中 ---
        else if (ev.id === "p_weed_trap") {
          if (c1 === "rescue" && c2 === "rescue") {
            addAffinity(p1, p2, 12);
            p1.exp += 10; p2.exp += 10;
            setEventSummary(room, p1, `${p2.name} と助け合い水草を脱出！ (EXP+10, 親密度+12)`);
            setEventSummary(room, p2, `${p1.name} と助け合い水草を脱出！ (EXP+10, 親密度+12)`);
            if (involvesPlayer) logs.push(`ペア結末[水草]: ${p1.name} と ${p2.name} は助け合って脱出した (親密度+12)`);
          } else if (c1 === "cannibal" && c2 === "rescue") {
            p1.food = Math.min(100, p1.food + 35); p1.exp += 20;
            p2.hp -= 25; addAffinity(p2, p1, -20);
            setEventSummary(room, p1, `助けようとした ${p2.name} の尾をかじった！ (満腹+35, EXP+20)`);
            setEventSummary(room, p2, `助けようとした ${p1.name} に尾をかじられた！ (HP-25, 親密度-20)`);
            if (involvesPlayer) logs.push(`ペア結末[水草]: 恐ろしい！${p1.name} が動けない仲間の尾をかじった！`);
          } else if (c1 === "rescue" && c2 === "cannibal") {
            p2.food = Math.min(100, p2.food + 35); p2.exp += 20;
            p1.hp -= 25; addAffinity(p1, p2, -20);
            setEventSummary(room, p2, `助けようとした ${p1.name} の尾をかじった！ (満腹+35, EXP+20)`);
            setEventSummary(room, p1, `助けようとした ${p2.name} に尾をかじられた！ (HP-25, 親密度-20)`);
            if (involvesPlayer) logs.push(`ペア結末[水草]: 恐ろしい！${p2.name} が動けない仲間の尾をかじった！`);
          } else {
            p1.hp -= 15; p2.hp -= 15; addAffinity(p1, p2, -10);
            setEventSummary(room, p1, `互いに噛みつき合って傷を負った (HP-15, 親密度-10)`);
            setEventSummary(room, p2, `互いに噛みつき合って傷を負った (HP-15, 親密度-10)`);
          }
        } else if (ev.id === "p_bubble_share") {
          if (c1 === "share_b" && c2 === "share_b") {
            p1.stamina = Math.min(100, p1.stamina + 25); p2.stamina = Math.min(100, p2.stamina + 25);
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `${p2.name} と気泡を分け合って呼吸！ (気力+25, 親密度+8)`);
            setEventSummary(room, p2, `${p1.name} と気泡を分け合って呼吸！ (気力+25, 親密度+8)`);
          } else if (c1 === "gulp_b" && c2 === "share_b") {
            p1.stamina = Math.min(100, p1.stamina + 45); addAffinity(p2, p1, -10);
            setEventSummary(room, p1, `気泡を全部吸い込んだ！ (気力+45)`);
            setEventSummary(room, p2, `${p1.name} に気泡を独占された！ (親密度-10)`);
          } else if (c1 === "share_b" && c2 === "gulp_b") {
            p2.stamina = Math.min(100, p2.stamina + 45); addAffinity(p1, p2, -10);
            setEventSummary(room, p2, `気泡を全部吸い込んだ！ (気力+45)`);
            setEventSummary(room, p1, `${p2.name} に気泡を独占された！ (親密度-10)`);
          } else {
            addAffinity(p1, p2, -6);
            setEventSummary(room, p1, `気泡を取り合って泡が弾け散った`);
            setEventSummary(room, p2, `気泡を取り合って泡が弾け散った`);
          }
        } else if (ev.id === "p_beetle_danger") {
          if (c1 === "coop_flee" && c2 === "coop_flee") {
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `${p2.name} と息を合わせて逃げ延びた！ (親密度+8)`);
            setEventSummary(room, p2, `${p1.name} と息を合わせて逃げ延びた！ (親密度+8)`);
          } else if (c1 === "push_bait" && c2 === "coop_flee") {
            p2.hp -= 30; addAffinity(p2, p1, -15);
            setEventSummary(room, p1, `${p2.name} をゲンゴロウの前へ突き飛ばして逃走！`);
            setEventSummary(room, p2, `${p1.name} に突き飛ばされゲンゴロウに噛まれた！ (HP-30, 親密度-15)`);
          } else if (c1 === "coop_flee" && c2 === "push_bait") {
            p1.hp -= 30; addAffinity(p1, p2, -15);
            setEventSummary(room, p2, `${p1.name} をゲンゴロウの前へ突き飛ばして逃走！`);
            setEventSummary(room, p1, `${p2.name} に突き飛ばされゲンゴロウに噛まれた！ (HP-30, 親密度-15)`);
          } else {
            p1.hp -= 20; p2.hp -= 20; addAffinity(p1, p2, -10);
            setEventSummary(room, p1, `突き飛ばし合い共倒れでゲンゴロウに噛まれた！ (HP-20)`);
            setEventSummary(room, p2, `突き飛ばし合い共倒れでゲンゴロウに噛まれた！ (HP-20)`);
          }
        }

        // --- ゾーン0: 水底 ---
        else if (ev.id === "p_yago_ambush") {
          if (c1 === "back_off" && c2 === "back_off") {
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `${p2.name} と静かに後退しヤゴを回避 (親密度+8)`);
            setEventSummary(room, p2, `${p1.name} と静かに後退しヤゴを回避 (親密度+8)`);
            if (involvesPlayer) logs.push(`ペア結末[ヤゴ]: 2匹は静かに後退しヤゴを回避した (親密度+8)`);
          } else if (c1 === "push_yago" && c2 === "back_off") {
            p2.hp -= 35; addAffinity(p2, p1, -15);
            setEventSummary(room, p1, `${p2.name} をヤゴの巣穴へ突き飛ばした！`);
            setEventSummary(room, p2, `${p1.name} にヤゴの前へ突き飛ばされた！ (HP-35, 親密度-15)`);
            if (involvesPlayer) logs.push(`ペア結末[ヤゴ]: ${p1.name} が ${p2.name} をヤゴの前へ突き飛ばした！`);
          } else if (c1 === "back_off" && c2 === "push_yago") {
            p1.hp -= 35; addAffinity(p1, p2, -15);
            setEventSummary(room, p2, `${p1.name} をヤゴの巣穴へ突き飛ばした！`);
            setEventSummary(room, p1, `${p2.name} にヤゴの前へ突き飛ばされた！ (HP-35, 親密度-15)`);
            if (involvesPlayer) logs.push(`ペア結末[ヤゴ]: ${p2.name} が ${p1.name} をヤゴの前へ突き飛ばした！`);
          } else {
            p1.hp -= 25; p2.hp -= 25; addAffinity(p1, p2, -8);
            setEventSummary(room, p1, `もつれ合って暴れ、ヤゴに2匹とも挟まれた！ (HP-25)`);
            setEventSummary(room, p2, `もつれ合って暴れ、ヤゴに2匹とも挟まれた！ (HP-25)`);
          }
        } else if (ev.id === "p_mud_burrow") {
          if (c1 === "cuddle" && c2 === "cuddle") {
            p1.hp = Math.min(100, p1.hp + 15); p2.hp = Math.min(100, p2.hp + 15);
            addAffinity(p1, p2, 8);
            setEventSummary(room, p1, `${p2.name} と泥に身を寄せて休んだ (HP+15, 親密度+8)`);
            setEventSummary(room, p2, `${p1.name} と泥に身を寄せて休んだ (HP+15, 親密度+8)`);
          } else if (c1 === "monopolize" && c2 === "cuddle") {
            p1.hp = Math.min(100, p1.hp + 25); addAffinity(p2, p1, -12);
            setEventSummary(room, p1, `${p2.name} を追い出して泥床を独占！ (HP+25)`);
            setEventSummary(room, p2, `${p1.name} に泥床から追い出された！ (親密度-12)`);
          } else if (c1 === "cuddle" && c2 === "monopolize") {
            p2.hp = Math.min(100, p2.hp + 25); addAffinity(p1, p2, -12);
            setEventSummary(room, p2, `${p1.name} を追い出して泥床を独占！ (HP+25)`);
            setEventSummary(room, p1, `${p2.name} に泥床から追い出された！ (親密度-12)`);
          } else {
            addAffinity(p1, p2, -6);
            setEventSummary(room, p1, `泥の寝床を争って泥まみれになった`);
            setEventSummary(room, p2, `泥の寝床を争って泥まみれになった`);
          }
        }
      });
    } else {
      // --- 単独・全体イベント解決 ---
      actorsInZone.forEach(a => {
        if (ev.id === "g_worm") {
          if (a.eventChoice === "share_w") {
            a.food = Math.min(100, a.food + 35); a.exp += 15;
            setEventSummary(room, a, `大ミミズを仲良く食べた (満腹+35, EXP+15)`);
          } else {
            a.food = Math.min(100, a.food + 65); a.exp += 25;
            setEventSummary(room, a, `大ミミズを独り占めして丸呑み！ (満腹+65, EXP+25)`);
          }
        } else if (ev.id === "s_moss") {
          if (a.eventChoice === "eat") {
            if (Math.random() < 0.7) {
              a.exp += 20; a.length += 0.2;
              setEventSummary(room, a, `光る苔は滋養強壮だった！ (EXP+20, 体長+0.2cm)`);
            } else {
              a.hp -= 15;
              setEventSummary(room, a, `光る苔に微毒が含まれていた！ (HP-15)`);
            }
          } else {
            setEventSummary(room, a, `怪しい光る苔を見送った`);
          }
        } else if (ev.id === "s_scorching_sun") {
          if (a.eventChoice === "shade") {
            a.stamina = Math.min(100, a.stamina + 20);
            setEventSummary(room, a, `日陰で休んで乾燥を防いだ (気力+20)`);
          } else {
            a.food = Math.min(100, a.food + 25); a.water = Math.max(0, a.water - 15);
            setEventSummary(room, a, `炎天下で虫を捕食したが乾燥が進んだ (満腹+25, 水分-15)`);
          }
        } else if (ev.id === "s_floating_flower") {
          if (a.eventChoice === "ride") {
            a.stamina = Math.min(100, a.stamina + 30); a.hp = Math.min(100, a.hp + 10);
            setEventSummary(room, a, `スイレンの花びらに揺られて休息 (HP+10, 気力+30)`);
          } else {
            a.food = Math.min(100, a.food + 30); a.exp += 15;
            setEventSummary(room, a, `花の下で虫を奇襲捕獲！ (満腹+30, EXP+15)`);
          }
        } else if (ev.id === "g_rain") {
          if (a.eventChoice === "rush") {
            a.food = Math.min(100, a.food + 35); a.exp += 20;
            setEventSummary(room, a, `豪雨の恵みで落ちた虫を乱獲！ (満腹+35, EXP+20)`);
          } else {
            a.stamina = Math.min(100, a.stamina + 25);
            setEventSummary(room, a, `水中で安全に雨宿りした (気力+25)`);
          }
        } else if (ev.id === "g_heron") {
          if (a.eventChoice === "threat") {
            a.stamina = Math.max(0, a.stamina - 20);
            setEventSummary(room, a, `体を膨らませてサギを威嚇・牽制した (気力-20)`);
          } else {
            a.food = Math.max(0, a.food - 10);
            setEventSummary(room, a, `泥の底にじっと潜んでサギをやり過ごした`);
          }
        } else if (ev.id === "g_bloom") {
          if (a.eventChoice === "surface") {
            a.stamina = Math.min(100, a.stamina + 20);
            setEventSummary(room, a, `水面で新鮮な空気を吸い込んだ (気力+20)`);
          } else {
            a.hp = Math.max(1, a.hp - 10);
            setEventSummary(room, a, `水底で息苦しさに耐えた (HP-10)`);
          }
        }
      });
    }
  }
}

function setEventSummary(room, actor, text) {
  if (actor.isPlayer && room.turnSummaries[actor.id]) {
    room.turnSummaries[actor.id].event = text;
  }
}

function resolvePredator(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  if (room.nextPredator === "yago") {
    logs.push("【天敵急襲！】水底からヤゴのアゴが飛び出した！");
    const victims = alive.filter(a => (parseInt(a.zone, 10) === 0 || parseInt(a.zone, 10) === 1) && (!a.action || a.action.act !== "rest"));
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      const v = victims[0];
      if (v.isPlayer && room.turnSummaries[v.id]) room.turnSummaries[v.id].danger = "ヤゴの鋭いアゴに捕縛された！";
      killActor(v, "ヤゴの鋭いアゴに捕獲された！", room, logs);
    }
  } else if (room.nextPredator === "heron") {
    logs.push("【天敵急襲！】アオサギの嘴が水面をドスンと突き刺した！");
    const victims = alive.filter(a => parseInt(a.zone, 10) === 2 && (!a.action || a.action.act !== "rest"));
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      const v = victims[0];
      if (v.isPlayer && room.turnSummaries[v.id]) room.turnSummaries[v.id].danger = "アオサギの嘴に突かれた！";
      killActor(v, "アオサギに丸呑みされた！", room, logs);
    }
  }
}
function resolveActions(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);
  const matingDone = new Set();
  const coopDone = new Set();

  alive.forEach(a => {
    if (!a.action) return;
    const act = a.action.act;
    const target = a.action.targetId ? room.actors[a.action.targetId] : null;

    if (act === "rest") {
      a.stamina = Math.min(100, a.stamina + 35);
      a.hp = Math.min(100, a.hp + 10);
      if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = "じっと休んで体力を回復（HP+10, 気力+35）";
    } else if (act === "water") {
      a.water = 100;
      a.stamina = Math.max(0, a.stamina - 5);
      if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = "水を十分に飲んで体を潤した（水分全快）";
      if (a.isPlayer) logs.push(`${a.name}: 水分を十分に補給した（水分全快）`);
    } else if (act === "watch") {
      a.stamina = Math.max(0, a.stamina - 15);
      if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = "周囲を警戒し仲間を見張った（天敵察知100%）";
      if (a.isPlayer) logs.push(`${a.name}: 周囲を警戒し、天敵の接近を見張った`);
    } else if (act === "huddle") {
      if (room.coopAccepted[a.id] && room.coopAccepted[a.id].type === "huddle" && !coopDone.has(a.id)) {
        const partner = room.actors[room.coopAccepted[a.id].partnerId];
        coopDone.add(a.id); coopDone.add(partner.id);

        a.water = Math.min(100, a.water + 25);
        partner.water = Math.min(100, partner.water + 25);
        addAffinity(a, partner, 8);

        if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `${partner.name} とカエル団子で保湿！（水分+25, 親密度+8）`;
        if (partner.isPlayer && room.turnSummaries[partner.id]) room.turnSummaries[partner.id].action = `${a.name} とカエル団子で保湿！（水分+25, 親密度+8）`;
        logs.push(`🤝 ${a.name} と ${partner.name} は寄り添い、乾燥を防いだ (親密度UP)`);
      } else if (!room.coopAccepted[a.id]) {
        if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `カエル団子の相手が見つからず、身をすくめて耐えた`;
      }
    } else if (act === "attack" && target && target.alive && target.zone === a.zone) {
      target.hp -= 20;
      addAffinity(target, a, -30);
      if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `${target.name} を攻撃して排除した！（相手HP-20, 親密度-30）`;
      if (target.isPlayer && room.turnSummaries[target.id]) room.turnSummaries[target.id].danger = `${a.name} から攻撃を受けた！ (HP-20)`;
      if (a.isPlayer || target.isPlayer) logs.push(`⚔️ ${a.name} が ${target.name} を攻撃した！（${target.name} HP-20）`);
    } else if (act === "feed") {
      if (room.coopAccepted[a.id] && room.coopAccepted[a.id].type === "feed" && !coopDone.has(a.id)) {
        const partner = room.actors[room.coopAccepted[a.id].partnerId];
        const preyId = room.coopAccepted[a.id].preyId;
        const zData = ZONES[a.zone];
        const prey = zData.prey.find(p => p.id === preyId) || zData.prey[zData.prey.length - 1];

        coopDone.add(a.id); coopDone.add(partner.id);

        a.stamina = Math.max(0, a.stamina - 12);
        partner.stamina = Math.max(0, partner.stamina - 12);

        const p1Power = (a.length * 5) + (a.weight * 3) + (a.stamina * 0.2);
        const p2Power = (partner.length * 5) + (partner.weight * 3) + (partner.stamina * 0.2);
        let chance = 60 + ((p1Power + p2Power) - prey.diff) * 2;
        chance = Math.max(30, Math.min(95, chance));

        if (Math.random() * 100 < chance) {
          const halfFood = Math.round(prey.food * 0.55);
          const halfExp = Math.round(prey.exp * 0.55);

          a.food = Math.min(100, a.food + halfFood); a.exp += halfExp;
          partner.food = Math.min(100, partner.food + halfFood); partner.exp += halfExp;
          addAffinity(a, partner, 8);

          if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `【協力捕食成功！】${partner.name} と ${prey.name} を山分け！（満腹+${halfFood}, EXP+${halfExp}, 親密度+8）`;
          if (partner.isPlayer && room.turnSummaries[partner.id]) room.turnSummaries[partner.id].action = `【協力捕食成功！】${a.name} と ${prey.name} を山分け！（満腹+${halfFood}, EXP+${halfExp}, 親密度+8）`;
          logs.push(`🤝 【協力狩り成功！】${a.name} と ${partner.name} が ${prey.name} を捕獲して山分け！`);
        } else {
          if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `【協力捕食失敗】${partner.name} と挑んだが、${prey.name} に逃げられた`;
          if (partner.isPlayer && room.turnSummaries[partner.id]) room.turnSummaries[partner.id].action = `【協力捕食失敗】${a.name} と挑んだが、${prey.name} に逃げられた`;
        }
      } else if (!coopDone.has(a.id)) {
        const zData = ZONES[a.zone];
        const prey = zData.prey.find(p => p.id === a.action.targetPreyId) || zData.prey[0];

        if (prey) {
          a.stamina = Math.max(0, a.stamina - 12);
          const myPower = (a.length * 5) + (a.weight * 3) + (a.stamina * 0.2);
          let chance = 60 + (myPower - prey.diff) * 2;
          if (a.trait === "大食漢") chance += 5;
          chance = Math.max(15, Math.min(95, chance));

          if (Math.random() * 100 < chance) {
            const eff = a.trait === "大食漢" ? 1.2 : (0.8 + Math.random() * 0.4);
            const foodGain = Math.round(prey.food);
            const expGain = Math.round(prey.exp * eff);
            a.food = Math.min(100, a.food + foodGain);
            a.exp += expGain;

            if (a.isPlayer && room.turnSummaries[a.id]) {
              room.turnSummaries[a.id].action = `【単独捕食成功！】${prey.name} を捕獲（満腹+${foodGain}, EXP+${expGain}）`;
            }
            if (a.isPlayer) logs.push(`${a.name}: ${prey.name}の捕食に成功！（満腹+${foodGain}）`);
          } else {
            if (a.isPlayer && room.turnSummaries[a.id]) {
              room.turnSummaries[a.id].action = `【単独捕食失敗…】${prey.name} に逃げられた（満腹度回復なし）`;
            }
            if (a.isPlayer) logs.push(`${a.name}: ${prey.name}に逃げられた……`);
          }
        }
      }
    } else if (act === "mate" && a.stage >= 6 && target && target.alive && target.zone === a.zone && target.stage >= 6 && target.gender !== a.gender && !matingDone.has(a.id) && !matingDone.has(target.id)) {
      let isSuccess = false;
      if (target.isPlayer) {
        if (target.action && target.action.act === "mate" && target.action.targetId === a.id) {
          isSuccess = true;
        } else {
          if (a.isPlayer) logs.push(`${a.name}: ${target.name} へ求愛したが合意が得られず…`);
          if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `${target.name} へ求愛したが合意が得られなかった`;
        }
      } else {
        const healthScore = a.hp + a.food;
        const aff = a.affinity[target.id] || 0;
        if (healthScore + aff >= 130) {
          isSuccess = true;
        } else {
          if (a.isPlayer) logs.push(`${a.name}: ${target.name} に求愛を断られた！`);
          if (a.isPlayer && room.turnSummaries[a.id]) room.turnSummaries[a.id].action = `${target.name} に求愛を断られた！`;
        }
      }

      if (isSuccess) {
        matingDone.add(a.id); matingDone.add(target.id);

        const aff = Math.max(a.affinity[target.id] || 0, target.affinity[a.id] || 0);
        let baseMin = 15, baseMax = 20;
        let rankTxt = "初対面・行きずり";

        if (aff >= 70) {
          baseMin = 46; baseMax = 60; rankTxt = "無二の親友 (真の絆)";
        } else if (aff >= 40) {
          baseMin = 31; baseMax = 45; rankTxt = "親密 (ピンク枠💕)";
        } else if (aff >= 20) {
          baseMin = 21; baseMax = 30; rankTxt = "顔見知り";
        }

        const eggs = baseMin + Math.floor(Math.random() * (baseMax - baseMin + 1));

        a.offspringCount += eggs;
        target.offspringCount += eggs;
        a.food = Math.max(10, a.food - 30); a.stamina = Math.max(10, a.stamina - 40);
        target.food = Math.max(10, target.food - 30); target.stamina = Math.max(10, target.stamina - 40);

        if (a.isPlayer && room.turnSummaries[a.id]) {
          room.turnSummaries[a.id].action = `💖 【交配成功！】${target.name} と結ばれた！[${rankTxt}] 絆の力で卵を ${eggs} 個産卵！（大量得点）`;
        }
        if (target.isPlayer && room.turnSummaries[target.id]) {
          room.turnSummaries[target.id].action = `💖 【交配成功！】${a.name} と結ばれた！[${rankTxt}] 絆の力で卵を ${eggs} 個産卵！（大量得点）`;
        }

        if (a.isPlayer || target.isPlayer) {
          logs.push(`💖 【交配成立！】${a.name} と ${target.name} が結ばれ、[${rankTxt}] 卵を${eggs}個産み落とした！`);
        }
        a.history.push(`TURN ${room.turn}: ${target.name} と交配し卵を${eggs}個残す [${rankTxt}]`);
        target.history.push(`TURN ${room.turn}: ${a.name} と交配し卵を${eggs}個残す [${rankTxt}]`);
      }
    }
  });
}

function addAffinity(p1, p2, val) {
  p1.affinity = p1.affinity || {};
  p2.affinity = p2.affinity || {};
  p1.affinity[p2.id] = Math.max(0, Math.min(100, (p1.affinity[p2.id] || 0) + val));
  p2.affinity[p1.id] = Math.max(0, Math.min(100, (p2.affinity[p1.id] || 0) + val));
}

function resolveMetabolism(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  alive.forEach(a => {
    let foodLoss = a.trait === "大食漢" ? 11 : (a.stage >= 5 ? 10 : 8);
    if (room.weather === "日照り") foodLoss += 2;

    a.food -= foodLoss;
    let metaTxt = `満腹度-${foodLoss}`;

    if (a.food <= 0) {
      a.food = 0;
      const dmg = a.trait === "高代謝" ? 20 : 15;
      a.hp -= dmg;
      metaTxt += ` / 飢餓によりHP-${dmg}`;
      if (a.isPlayer) logs.push(`⚠ ${a.name}: 飢餓ダメージ！`);
    }

    let waterLoss = ZONES[a.zone].baseWaterLoss;
    if (room.weather === "雨" || room.weather === "豪雨") {
      waterLoss = 0;
    } else if (room.weather === "快晴" && a.zone === 4) {
      waterLoss *= 1.5;
    } else if (room.weather === "日照り") {
      if (a.zone === 4) waterLoss *= 2.0;
      if (a.zone === 3) waterLoss = 15;
    }

    if (a.trait === "頑強") waterLoss *= 0.6;
    a.water -= Math.round(waterLoss);
    if (waterLoss > 0) metaTxt += ` / 水分-${Math.round(waterLoss)}`;

    if (a.water <= 0) {
      a.water = 0;
      a.hp -= 25;
      metaTxt += ` / 乾燥によりHP-25`;
      if (a.isPlayer) logs.push(`⚠ ${a.name}: 乾燥ダメージ！`);
    }

    if (a.isPlayer && room.turnSummaries[a.id]) {
      room.turnSummaries[a.id].metabolism = metaTxt;
    }

    let nextReq = getNextExpForLevel(a.level);
    let leveledUp = false;

    while (a.exp >= nextReq) {
      a.exp -= nextReq;
      a.level++;
      leveledUp = true;

      a.length += 0.35;
      a.weight += 0.75;

      const oldStage = a.stage;
      a.stage = getStageFromLevel(a.level);

      if (a.stage > oldStage) {
        if (a.isPlayer && room.turnSummaries[a.id]) {
          room.turnSummaries[a.id].growth = `🎉 『${STAGE_NAMES[a.stage]}』へ変態達成！ (Lv.${a.level} / 体長:${a.length.toFixed(1)}cm / 体重:${a.weight.toFixed(1)}g)`;
        }
        if (a.isPlayer) logs.push(`🎉 ${a.name} が『${STAGE_NAMES[a.stage]}』へ変態！ (Lv.${a.level})`);
        a.history.push(`TURN ${room.turn}: 『${STAGE_NAMES[a.stage]}』へ変態 (Lv.${a.level})`);
        if (a.stage === 4) {
          a.eggs = 0;
          if (a.isPlayer) logs.push(`⚠ ${a.name}: 尾が吸収され残機消滅！【永久死亡】へ！`);
        }
      }

      nextReq = getNextExpForLevel(a.level);
    }

    if (leveledUp && !room.turnSummaries[a.id]?.growth) {
      if (a.isPlayer && room.turnSummaries[a.id]) {
        room.turnSummaries[a.id].growth = `⭐ レベルアップ！ Lv.${a.level} 到達 (体長:${a.length.toFixed(1)}cm / 体重:${a.weight.toFixed(1)}g)`;
      }
    }

    if (a.hp <= 0) {
      killActor(a, "衰弱死した。", room, logs);
    }
  });
}

function killActor(actor, reason, room, logs) {
  if (!actor.alive) return;
  if (actor.isPlayer) logs.push(`💀 ${actor.name} が命を落とした（${reason}）`);

  if (actor.stage < 4 && actor.eggs > 0) {
    actor.eggs--;
    actor.hp = 100; actor.food = 80; actor.water = 100; actor.stamina = 100;
    actor.zone = 1;
    if (actor.level > 1) actor.level--;
    actor.exp = 0;
    actor.stage = getStageFromLevel(actor.level);

    if (actor.isPlayer && room.turnSummaries[actor.id]) {
      room.turnSummaries[actor.id].growth = `🥚 命を落としたが、卵ストックから再誕生！（出遅れペナルティ、残機: ${actor.eggs}）`;
    }
    if (actor.isPlayer) logs.push(`🥚 ${actor.name} は卵から再誕生！（出遅れ発生、残機: ${actor.eggs}）`);
    actor.history.push(`TURN ${room.turn}: 死亡したが卵ストックから復活`);
  } else {
    actor.alive = false;
    if (actor.isPlayer && room.turnSummaries[actor.id]) {
      room.turnSummaries[actor.id].growth = `💀 命が尽き、永久死亡となった……（観戦モードへ移行）`;
    }
    actor.history.push(`TURN ${room.turn}: 死亡（${reason}）`);
  }
}

function finishGame(room, logs) {
  room.isFinished = true;
  room.status = "finished";
  clearInterval(room.timer);
  logs.push("❄️ 池の水面が凍結し、冬が訪れた。サバイバル終了！");

  const ranking = Object.values(room.actors).map(a => {
    let score = (room.turn * 100) + (a.offspringCount * 50) + (a.level * 150);
    if (a.alive) score += 1500;
    return {
      id: a.id,
      name: a.name,
      isPlayer: a.isPlayer,
      gender: a.gender,
      level: a.level,
      length: a.length,
      weight: a.weight,
      alive: a.alive,
      score: score,
      offspring: a.offspringCount,
      history: a.history
    };
  }).sort((a, b) => b.score - a.score);

  broadcastState(room, logs, ranking);
}

function broadcastState(room, logs = [], ranking = null) {
  const msg = JSON.stringify({
    type: "STATE_UPDATE",
    state: {
      status: room.status,
      hostId: room.hostId,
      turn: room.turn,
      timeLeft: room.timeLeft,
      weather: room.weather,
      forecast: room.forecast,
      nextPredator: room.nextPredator,
      activePredatorAnimation: room.activePredatorAnimation,
      eventsByZone: room.eventsByZone,
      pairTargets: room.pairTargets,
      coopRequests: room.coopRequests,
      turnSummaries: room.turnSummaries,
      actors: room.actors,
      isFinished: room.isFinished,
      ranking: ranking,
      logs: logs
    }
  });

  for (const pid in room.actors) {
    const ws = room.actors[pid].ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  let myRoomId = null;
  let myActorId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "JOIN_ROOM") {
        myRoomId = data.roomId;
        const room = rooms[myRoomId] || createNewRoom(myRoomId);

        myActorId = `pl_${Math.random().toString(36).substring(2, 6)}`;
        const playerActor = createActor(myActorId, data.name || "カエル", true);
        playerActor.ws = ws;

        if (!room.hostId) room.hostId = myActorId;

        const npcKeys = Object.keys(room.actors).filter(k => !room.actors[k].isPlayer);
        if (npcKeys.length > 0) delete room.actors[npcKeys[0]];
        room.actors[myActorId] = playerActor;

        ws.send(JSON.stringify({ type: "INIT", myId: myActorId }));
        broadcastState(room);
      }

      if (data.type === "START_GAME" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.hostId === myActorId && room.status === "waiting") {
          startRoomGame(room);
        }
      }

      if (data.type === "SEND_COOP_REQUEST" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "playing") {
          const fromActor = room.actors[myActorId];
          const targetActor = room.actors[data.targetId];

          if (fromActor && targetActor && fromActor.alive && targetActor.alive && fromActor.zone === targetActor.zone) {
            if (targetActor.isPlayer) {
              room.coopRequests[targetActor.id] = {
                fromId: fromActor.id,
                fromName: fromActor.name,
                type: data.coopType,
                preyId: data.preyId
              };
              broadcastState(room);
            } else {
              const aff = targetActor.affinity[fromActor.id] || 0;
              let baseChance = 35;
              if (targetActor.personality === "温厚") baseChance = 50;
              if (targetActor.personality === "利己") baseChance = 20;
              if (targetActor.personality === "獰猛") baseChance = 15;

              let chance = baseChance + (aff * 0.5);
              if (fromActor.hp >= 70 && fromActor.stamina >= 50) chance += 10;
              if (fromActor.hp <= 30) chance -= 20;

              if (data.coopType === "huddle" && targetActor.water <= 50) chance += 20;
              if (data.coopType === "feed" && targetActor.food <= 50) chance += 20;

              chance = Math.max(5, Math.min(95, Math.round(chance)));

              if (Math.random() * 100 < chance) {
                room.coopAccepted[fromActor.id] = { partnerId: targetActor.id, type: data.coopType, preyId: data.preyId };
                room.coopAccepted[targetActor.id] = { partnerId: fromActor.id, type: data.coopType, preyId: data.preyId };
                ws.send(JSON.stringify({ type: "COOP_RESPONSE_NOTIFY", accepted: true, targetName: targetActor.name }));
              } else {
                addAffinity(targetActor, fromActor, -6);
                ws.send(JSON.stringify({ type: "COOP_RESPONSE_NOTIFY", accepted: false, targetName: targetActor.name }));
              }
            }
          }
        }
      }

      if (data.type === "RESPOND_COOP" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "playing") {
          const req = room.coopRequests[myActorId];
          if (req) {
            const fromActor = room.actors[req.fromId];
            const toActor = room.actors[myActorId];

            if (data.accept && fromActor && toActor) {
              room.coopAccepted[fromActor.id] = { partnerId: toActor.id, type: req.type, preyId: req.preyId };
              room.coopAccepted[toActor.id] = { partnerId: fromActor.id, type: req.type, preyId: req.preyId };
              toActor.action = { moveZone: toActor.zone, act: req.type, targetId: fromActor.id, targetPreyId: req.preyId };
              addAffinity(fromActor, toActor, 8);
            } else if (fromActor && toActor) {
              addAffinity(fromActor, toActor, -6);
            }
            delete room.coopRequests[myActorId];
            broadcastState(room);
          }
        }
      }

      if (data.type === "SUBMIT_ACTION" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "playing" && room.actors[myActorId]) {
          const a = room.actors[myActorId];
          a.ready = true;
          a.action = data.action;
          a.eventChoice = data.eventChoice;

          broadcastState(room);

          const livePlayers = Object.values(room.actors).filter(act => act.isPlayer && act.alive);
          if (livePlayers.length > 0 && livePlayers.every(p => p.ready)) {
            resolveTurn(room);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    if (myRoomId && rooms[myRoomId]) {
      const room = rooms[myRoomId];
      if (room.actors[myActorId]) {
        const a = room.actors[myActorId];
        a.isPlayer = false;
        a.personality = "臆病";
        a.ws = null;
      }
      if (room.hostId === myActorId) {
        const otherPlayers = Object.values(room.actors).filter(act => act.isPlayer);
        room.hostId = otherPlayers.length > 0 ? otherPlayers[0].id : null;
      }
      broadcastState(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`FROG LIFE master server running on port ${PORT}`);
});
