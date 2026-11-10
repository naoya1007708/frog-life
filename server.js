const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 定数・マスターデータ ====================
const MAX_TURNS = 35;
const TURN_DURATION = 45;

const ZONES = [
  { id: 0, name: "① 水底・泥地", minStage: 1, baseWaterLoss: 0, prey: [
    { id: "algae", name: "アオミドロ(藻)", diff: 0, food: 18, exp: 6 },
    { id: "chironomid", name: "ユスリカの幼虫", diff: 10, food: 22, exp: 8 }
  ]},
  { id: 1, name: "② 水中(水草)", minStage: 1, baseWaterLoss: 0, prey: [
    { id: "daphnia", name: "ミジンコ", diff: 5, food: 15, exp: 5 },
    { id: "wriggler", name: "ボウフラ", diff: 15, food: 25, exp: 9 },
    { id: "bloodworm", name: "アカムシ", diff: 20, food: 28, exp: 11 }
  ]},
  { id: 2, name: "③ 水面・浅瀬", minStage: 3, baseWaterLoss: 0, prey: [
    { id: "mosquito", name: "落ちた蚊", diff: 25, food: 30, exp: 12 },
    { id: "strider", name: "アメンボ", diff: 30, food: 32, exp: 14 }
  ]},
  { id: 3, name: "④ 水際・湿地", minStage: 4, baseWaterLoss: 5, prey: [
    { id: "woodlouse", name: "ワラジムシ", diff: 35, food: 38, exp: 16 },
    { id: "fly", name: "小型ハエ", diff: 40, food: 40, exp: 18 }
  ]},
  { id: 4, name: "⑤ 草むら・陸地", minStage: 5, baseWaterLoss: 20, prey: [
    { id: "cricket", name: "コオロギ", diff: 50, food: 55, exp: 22 },
    { id: "grasshopper", name: "大型バッタ", diff: 65, food: 65, exp: 28 },
    { id: "earthworm", name: "巨大ミミズ (大物)", diff: 85, food: 85, exp: 35 }
  ]}
];

const STAGE_NAMES = ["", "オタマジャクシ", "後足が生えた", "前足が生えた", "変態期(尾あり)", "子ガエル", "成体カエル"];
const EXP_THRESHOLDS = [0, 10, 25, 45, 75, 115, 9999];
const NPC_PERSONALITIES = ["温厚", "臆病", "利己", "獰猛", "気まぐれ"];
const TRAITS = ["頑強", "大食漢", "身軽", "高代謝", "慎重"];

// エリア連動イベントプール
const AREA_EVENTS = {
  global: [
    { id: "g_rain", title: "【全体】恵みのゲリラ豪雨", desc: "池全体に激しいスコール！陸地が潤い、虫たちが地面に落ちてきた！", choices: [{ id: "rush", text: "🦗 陸へ駆け上がって乱獲" }, { id: "stay", text: "💧 水中で安全に雨宿り" }] },
    { id: "g_heron", title: "【全体】上空にサギの旋回！", desc: "巨大なアオサギが池を見下ろしている。どう生き延びる？", choices: [{ id: "threat", text: "👥 みんなで膨らんで威嚇" }, { id: "hide", text: "🙈 泥の底へ潜って隠れる" }] }
  ],
  // ゾーン4（草むら）
  4: [
    { id: "p_dew", type: "pair", title: "【ペアイベント】朝露の分け合い", desc: "快晴の暑さ。草の先端に大粒の朝露が1滴だけ残っている……", choices: [{ id: "share", text: "💧 半分ずつ吸い合う (協調)" }, { id: "drink_all", text: "⚡ 突き飛ばして一気飲み (独占)" }] },
    { id: "p_mantis", type: "pair", title: "【ペアイベント】巨大オオカマキリ", desc: "草むらで凶暴なカマキリと鉢合わせ！2匹で威嚇すれば撃退できるが……？", choices: [{ id: "threat", text: "👥 2匹で同時に威嚇する" }, { id: "bait", text: "🏃 相手を盾にして逃走する" }] }
  ],
  // ゾーン3（水際・湿地）
  3: [
    { id: "g_worm", type: "global_area", title: "【水際】流れてきた大ミミズ", desc: "岸辺の泥に巨大な獲物が漂着！山分けするか、独り占めを狙うか？", choices: [{ id: "coop", text: "🤝 山分けを提案" }, { id: "betray", text: "⚔️ 独り占めを狙う" }] }
  ],
  // ゾーン2（水面・浅瀬）
  2: [
    { id: "p_leaf", type: "pair", title: "【ペアイベント】浮き草の定員", desc: "サギ接近中！1匹しか乗れない浮き葉の上で鉢合わせた。重みで沈む前にどうする？", choices: [{ id: "coop", text: "🤝 譲り合って片足で耐える" }, { id: "kick", text: "🦶 相手を水中に蹴り落とす" }] }
  ],
  // ゾーン1（水中・水草）
  1: [
    { id: "s_skin", type: "personal", title: "【水中】古い皮膚の脱皮", desc: "水草の間で古い皮が剥がれてきた。栄養にするか？", choices: [{ id: "eat_skin", text: "🍴 口で食べて栄養にする" }, { id: "discard", text: "💨 そのまま脱ぎ捨てる" }] }
  ],
  // ゾーン0（水底・泥地）
  0: [
    { id: "s_moss", type: "personal", title: "【水底】青白く光る苔", desc: "暗い泥底に怪しく光る苔が生い茂っている。極上の栄養か、毒か？", choices: [{ id: "eat", text: "😋 思い切って食べる" }, { id: "ignore", text: "🙅 怪しいので無視する" }] }
  ]
};

// ==================== ルーム管理 ====================
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
    eventsByZone: {}, // ゾーンごとに発生するイベント
    pairTargets: {},   // ペアイベント相手マッピング
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
    stage: 1,
    eggs: 2,
    offspringCount: 0,
    hp: 100, food: 100, water: 100, stamina: 100,
    length: 1.0, weight: 0.5, exp: 0,
    zone: 1,
    ready: false,
    action: null,
    eventChoice: null,
    affinity: {}, // 親密度マップ: { [targetId]: number (0〜100) }
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

// エリア対応イベントの抽選
function pickAreaEvents(room) {
  room.eventsByZone = {};
  room.pairTargets = {};
  const aliveList = Object.values(room.actors).filter(a => a.alive);

  // ゾーンごとにグループ分け
  const byZone = {};
  aliveList.forEach(a => {
    byZone[a.zone] = byZone[a.zone] || [];
    byZone[a.zone].push(a.id);
  });

  // 全体共通イベントを1つ基礎として選定
  const globalBase = AREA_EVENTS.global[Math.floor(Math.random() * AREA_EVENTS.global.length)];

  // 各ゾーンごとのイベントを決定
  for (let z = 0; z < 5; z++) {
    const actorsHere = byZone[z] || [];
    const pool = AREA_EVENTS[z] || [];

    if (actorsHere.length >= 2 && pool.some(e => e.type === "pair")) {
      // 2匹以上いてペアイベントがあるゾーンはペア発生！
      const pairEv = pool.find(e => e.type === "pair");
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

// ==================== ターン解決ロジック ====================
function resolveTurn(room) {
  if (room.isFinished) return;

  const logs = [];
  logs.push(`=== [ TURN ${room.turn} 解決 ] ===`);
  room.activePredatorAnimation = null;

  const alive = Object.values(room.actors).filter(a => a.alive);

  // 1. NPC思考
  alive.filter(a => !a.isPlayer).forEach(npc => decideNpcTurn(npc, room));

  // 2. 移動の実行
  alive.forEach(a => {
    if (a.action && a.action.moveZone !== undefined) {
      const tz = a.action.moveZone;
      if (tz >= 0 && tz <= 4 && a.stage >= ZONES[tz].minStage) {
        a.zone = tz;
      }
    }
  });

  // 3. エリア連動イベントの解決
  resolveAreaEvents(room, logs);

  // 4. 天敵襲来
  if (room.nextPredator) {
    room.activePredatorAnimation = room.nextPredator;
    resolvePredator(room, logs);
  }

  // 5. アクション（捕食・水分・団子・攻撃・見張り・求愛）
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
  room.forecast = Math.random() < 0.4 ? "雨" : (Math.random() < 0.75 ? "快晴" : "曇り");

  if (Math.random() < 0.35) {
    room.nextPredator = Math.random() < 0.6 ? "yago" : "heron";
  } else {
    room.nextPredator = null;
  }

  pickAreaEvents(room);

  Object.values(room.actors).forEach(a => {
    a.ready = false;
    a.action = null;
    a.eventChoice = null;
  });

  broadcastState(room, logs);
}

function decideNpcTurn(npc, room) {
  let tz = npc.zone;
  if (npc.stage >= 5 && Math.random() < 0.4) {
    tz = room.weather === "雨" ? 4 : 3;
  } else if (npc.stage < 4) {
    tz = Math.random() < 0.6 ? 1 : 0;
  }
  tz = Math.max(0, Math.min(4, tz));
  if (tz > npc.stage) tz = npc.zone;

  let act = "feed";
  let targetId = null;
  let targetPreyId = null;

  // NPCの行動判断
  if (npc.water < 35 && tz >= 3) {
    act = "water";
  } else if (npc.stamina < 30) {
    act = "rest";
  } else if (npc.stage >= 6 && Math.random() < 0.4) {
    // 異性の成体を探す
    const partner = Object.values(room.actors).find(o => o.alive && o.id !== npc.id && o.zone === tz && o.stage >= 6 && o.gender !== npc.gender);
    if (partner) {
      act = "mate";
      targetId = partner.id;
    }
  } else if (room.weather === "快晴" && tz >= 4 && Math.random() < 0.5) {
    // 仲間を探してカエル団子
    const buddy = Object.values(room.actors).find(o => o.alive && o.id !== npc.id && o.zone === tz);
    if (buddy) {
      act = "huddle";
      targetId = buddy.id;
    }
  }

  // 捕食時は生息する獲物を選択
  if (act === "feed") {
    const zData = ZONES[tz];
    if (zData && zData.prey.length > 0) {
      targetPreyId = zData.prey[Math.floor(Math.random() * zData.prey.length)].id;
    }
  }

  npc.action = { moveZone: tz, act, targetId, targetPreyId };

  // イベント選択
  const ev = room.eventsByZone[tz];
  if (ev && ev.choices) {
    if (npc.personality === "利己" || npc.personality === "獰猛") {
      npc.eventChoice = ev.choices[1].id;
    } else if (npc.personality === "温厚") {
      npc.eventChoice = ev.choices[0].id;
    } else {
      npc.eventChoice = Math.random() < 0.5 ? ev.choices[0].id : ev.choices[1].id;
    }
  }
}

function resolveAreaEvents(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  for (let z = 0; z < 5; z++) {
    const ev = room.eventsByZone[z];
    if (!ev) continue;
    const actorsInZone = alive.filter(a => a.zone === z);

    if (ev.type === "pair") {
      const handled = new Set();
      actorsInZone.forEach(p1 => {
        const p2Id = room.pairTargets[p1.id];
        if (!p2Id || handled.has(p1.id) || handled.has(p2Id)) return;
        handled.add(p1.id); handled.add(p2Id);
        const p2 = room.actors[p2Id];
        if (!p2 || !p2.alive) return;

        const involvesPlayer = p1.isPlayer || p2.isPlayer;

        if (ev.id === "p_leaf") {
          if (p1.eventChoice === "coop" && p2.eventChoice === "coop") {
            addAffinity(p1, p2, 20);
            if (involvesPlayer) logs.push(`ペア結末[葉]: ${p1.name} と ${p2.name} は譲り合って葉に留まった (親密度UP)`);
          } else if (p1.eventChoice === "kick" && p2.eventChoice === "coop") {
            p2.hp -= 30; addAffinity(p2, p1, -30);
            p1.history.push(`TURN ${room.turn}: ${p2.name} を葉から蹴り落とす`);
            if (involvesPlayer) logs.push(`ペア結末[葉]: ${p1.name} が ${p2.name} を水中に蹴り落とした！`);
          } else if (p1.eventChoice === "coop" && p2.eventChoice === "kick") {
            p1.hp -= 30; addAffinity(p1, p2, -30);
            p2.history.push(`TURN ${room.turn}: ${p1.name} を葉から蹴り落とす`);
            if (involvesPlayer) logs.push(`ペア結末[葉]: ${p2.name} が ${p1.name} を水中に蹴り落とした！`);
          } else {
            p1.hp -= 20; p2.hp -= 20; addAffinity(p1, p2, -15);
            if (involvesPlayer) logs.push(`ペア結末[葉]: 2匹はもつれ合い共倒れ（HP-20）`);
          }
        } else if (ev.id === "p_dew") {
          if (p1.eventChoice === "share" && p2.eventChoice === "share") {
            p1.water = Math.min(100, p1.water + 35); p2.water = Math.min(100, p2.water + 35);
            addAffinity(p1, p2, 15);
            if (involvesPlayer) logs.push(`ペア結末[露]: ${p1.name} と ${p2.name} は朝露を分け合った (親密度UP)`);
          } else if (p1.eventChoice === "drink_all" && p2.eventChoice === "share") {
            p1.water = Math.min(100, p1.water + 75); addAffinity(p2, p1, -25);
            if (involvesPlayer) logs.push(`ペア結末[露]: ${p1.name} が朝露を独り占めして飲み干した！`);
          } else if (p1.eventChoice === "share" && p2.eventChoice === "drink_all") {
            p2.water = Math.min(100, p2.water + 75); addAffinity(p1, p2, -25);
            if (involvesPlayer) logs.push(`ペア結末[露]: ${p2.name} が朝露を独り占めして飲み干した！`);
          } else {
            if (involvesPlayer) logs.push(`ペア結末[露]: 朝露を奪い合い、露は泥に消えた……`);
          }
        }
      });
    } else {
      // 個人・ゾーン全体イベント
      actorsInZone.forEach(a => {
        if (ev.id === "g_worm") {
          if (a.eventChoice === "coop") {
            a.food = Math.min(100, a.food + 30);
            if (a.isPlayer) logs.push(`${a.name}: 大ミミズを分け合って食べた（満腹+30）`);
          } else {
            a.food = Math.min(100, a.food + 65); a.exp += 15;
            if (a.isPlayer) logs.push(`${a.name}: 大ミミズを強奪して独り占め！（満腹+65）`);
          }
        } else if (ev.id === "s_moss" && a.isPlayer && a.eventChoice === "eat") {
          if (Math.random() < 0.65) {
            a.exp += 18; a.length += 0.2; logs.push(`${a.name}: 光る苔は極上の栄養だった！（EXP+18）`);
          } else {
            a.hp -= 15; logs.push(`${a.name}: 光る苔に微毒が含まれていた！（HP-15）`);
          }
        }
      });
    }
  }
}

function resolvePredator(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  if (room.nextPredator === "yago") {
    logs.push("【天敵急襲！】水底からヤゴのアゴが飛び出した！");
    const victims = alive.filter(a => (a.zone === 0 || a.zone === 1) && (!a.action || a.action.act !== "rest"));
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      killActor(victims[0], "ヤゴの鋭いアゴに捕獲された！", room, logs);
    }
  } else if (room.nextPredator === "heron") {
    logs.push("【天敵急襲！】アオサギの嘴が水面をドスンと突き刺した！");
    const victims = alive.filter(a => a.zone === 2 && (!a.action || a.action.act !== "rest"));
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      killActor(victims[0], "アオサギに丸呑みされた！", room, logs);
    }
  }
}

// アクション解決（捕食・水分・団子・攻撃・見張り・求愛）
function resolveActions(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);
  const matingDone = new Set();

  alive.forEach(a => {
    if (!a.action) return;
    const act = a.action.act;
    const target = a.action.targetId ? room.actors[a.action.targetId] : null;

    if (act === "rest") {
      a.stamina = Math.min(100, a.stamina + 35);
      a.hp = Math.min(100, a.hp + 10);
    } else if (act === "water") {
      // 水分補給
      a.water = 100;
      a.stamina = Math.max(0, a.stamina - 5);
      if (a.isPlayer) logs.push(`${a.name}: 水分を十分に補給した（水分全快）`);
    } else if (act === "watch") {
      // 見張り
      a.stamina = Math.max(0, a.stamina - 15);
      if (a.isPlayer) logs.push(`${a.name}: 周囲を警戒し、天敵の接近を見張った`);
    } else if (act === "huddle" && target && target.alive && target.zone === a.zone) {
      // カエル団子（集団保湿）
      addAffinity(a, target, 15);
      a.water = Math.min(100, a.water + 20);
      target.water = Math.min(100, target.water + 20);
      if (a.isPlayer || target.isPlayer) {
        logs.push(`🤝 ${a.name} と ${target.name} は寄り添い、乾燥を防いだ (親密度UP)`);
      }
    } else if (act === "attack" && target && target.alive && target.zone === a.zone) {
      // 攻撃
      target.hp -= 20;
      addAffinity(target, a, -50);
      if (a.isPlayer || target.isPlayer) {
        logs.push(`⚔️ ${a.name} が ${target.name} を攻撃した！（${target.name} HP-20）`);
      }
    } else if (act === "feed") {
      // 狙う獲物の捕食判定
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
          a.food = Math.min(100, a.food + prey.food);
          a.exp += Math.round(prey.exp * eff);
          a.weight += 0.1 * eff;
          a.length += 0.05 * eff;
          if (a.isPlayer) logs.push(`${a.name}: ${prey.name}の捕食に成功！（満腹+${prey.food}）`);
        } else {
          if (a.isPlayer) logs.push(`${a.name}: ${prey.name}に逃げられた……`);
        }
      }
    } else if (act === "mate" && a.stage >= 6 && target && target.alive && target.zone === a.zone && target.stage >= 6 && target.gender !== a.gender && !matingDone.has(a.id) && !matingDone.has(target.id)) {
      // 求愛（親密度で卵数ボーナス！）
      let isSuccess = false;
      if (target.isPlayer) {
        if (target.action && target.action.act === "mate" && target.action.targetId === a.id) {
          isSuccess = true;
        } else {
          if (a.isPlayer) logs.push(`${a.name}: ${target.name} へ求愛したが、合意が得られなかった……`);
        }
      } else {
        const healthScore = a.hp + a.food;
        const aff = a.affinity[target.id] || 0;
        if (healthScore + aff >= 130) {
          isSuccess = true;
        } else {
          if (a.isPlayer) logs.push(`${a.name}: ${target.name} に求愛を断られた！`);
        }
      }

      if (isSuccess) {
        matingDone.add(a.id); matingDone.add(target.id);
        const affBonus = Math.floor(((a.affinity[target.id] || 0) + (target.affinity[a.id] || 0)) * 0.25);
        const eggs = 20 + Math.floor(Math.random() * 15) + affBonus;

        a.offspringCount += eggs;
        target.offspringCount += eggs;
        a.food = Math.max(10, a.food - 30); a.stamina = Math.max(10, a.stamina - 40);
        target.food = Math.max(10, target.food - 30); target.stamina = Math.max(10, target.stamina - 40);

        if (a.isPlayer || target.isPlayer) {
          logs.push(`💖 【交配成立！】${a.name} と ${target.name} が結ばれ、親愛の絆で卵を${eggs}個産み落とした！`);
        }
        a.history.push(`TURN ${room.turn}: ${target.name} と交配し卵を${eggs}個残す`);
        target.history.push(`TURN ${room.turn}: ${a.name} と交配し卵を${eggs}個残す`);
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
    const foodLoss = a.trait === "大食漢" ? 11 : (a.stage >= 5 ? 10 : 8);
    a.food -= foodLoss;
    if (a.food <= 0) {
      a.food = 0;
      a.hp -= (a.trait === "高代謝" ? 20 : 15);
      if (a.isPlayer) logs.push(`⚠ ${a.name}: 飢餓ダメージ！`);
    }

    let waterLoss = ZONES[a.zone].baseWaterLoss;
    if (room.weather === "雨") waterLoss = 0;
    if (a.trait === "頑強") waterLoss *= 0.6;
    if (room.weather === "快晴" && a.zone === 4) waterLoss *= 1.5;
    a.water -= waterLoss;
    if (a.water <= 0) {
      a.water = 0;
      a.hp -= 25;
      if (a.isPlayer) logs.push(`⚠ ${a.name}: 乾燥ダメージ！`);
    }

    const reqExp = a.trait === "高代謝" ? Math.round(EXP_THRESHOLDS[a.stage] * 0.8) : EXP_THRESHOLDS[a.stage];
    if (a.exp >= reqExp && a.stage < 6) {
      a.stage++;
      a.length += 0.5;
      a.weight += 1.0;
      if (a.isPlayer) logs.push(`🎉 ${a.name} が成長し、『${STAGE_NAMES[a.stage]}』へ進化した！`);
      a.history.push(`TURN ${room.turn}: 『${STAGE_NAMES[a.stage]}』へ変態`);
      if (a.stage === 4) {
        a.eggs = 0;
        if (a.isPlayer) logs.push(`⚠ ${a.name}: 尾が吸収され残機消滅！【永久死亡】へ！`);
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
    actor.stage = 1; actor.exp = 0; actor.zone = 1;
    if (actor.isPlayer) logs.push(`🥚 ${actor.name} は卵から再誕生！（出遅れ発生、残機: ${actor.eggs}）`);
    actor.history.push(`TURN ${room.turn}: 死亡したが卵ストックから復活`);
  } else {
    actor.alive = false;
    actor.history.push(`TURN ${room.turn}: 死亡（${reason}）`);
  }
}

function finishGame(room, logs) {
  room.isFinished = true;
  room.status = "finished";
  clearInterval(room.timer);
  logs.push("❄️ 池の水面が凍結し、冬が訪れた。サバイバル終了！");

  const ranking = Object.values(room.actors).map(a => {
    let score = (room.turn * 100) + (a.offspringCount * 50);
    if (a.alive) score += 1500;
    return {
      id: a.id,
      name: a.name,
      isPlayer: a.isPlayer,
      gender: a.gender,
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

// ==================== WebSocket ====================
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