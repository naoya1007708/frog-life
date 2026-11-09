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
const MAX_TURNS = 35; // 35ターンで冬の訪れ・ゲーム終了
const TURN_DURATION = 45; // 1ターンの秒数

const ZONES = [
  { id: 0, name: "① 水底・泥地", minStage: 1, baseWaterLoss: 0, prey: [{ name: "アオミドロ(藻)", diff: 0, food: 18, exp: 6 }] },
  { id: 1, name: "② 水中(水草)", minStage: 1, baseWaterLoss: 0, prey: [{ name: "ボウフラ", diff: 15, food: 25, exp: 9 }, { name: "ミジンコ", diff: 5, food: 15, exp: 5 }] },
  { id: 2, name: "③ 水面・浅瀬", minStage: 3, baseWaterLoss: 0, prey: [{ name: "落ちた蚊", diff: 25, food: 30, exp: 12 }, { name: "アメンボ", diff: 30, food: 32, exp: 14 }] },
  { id: 3, name: "④ 水際・湿地", minStage: 4, baseWaterLoss: 5, prey: [{ name: "ワラジムシ", diff: 35, food: 38, exp: 16 }, { name: "小型ハエ", diff: 40, food: 40, exp: 18 }] },
  { id: 4, name: "⑤ 草むら・陸地", minStage: 5, baseWaterLoss: 20, prey: [{ name: "コオロギ", diff: 50, food: 55, exp: 22 }, { name: "大型バッタ", diff: 65, food: 65, exp: 28 }] }
];

const STAGE_NAMES = ["", "オタマジャクシ", "後足が生えた", "前足が生えた", "尾の吸収(変態期)", "子ガエル", "成体カエル"];
const EXP_THRESHOLDS = [0, 10, 25, 45, 75, 115, 9999];
const NPC_PERSONALITIES = ["温厚", "臆病", "利己", "獰猛", "気まぐれ"];
const TRAITS = ["標準", "大食漢", "身軽", "頑強", "高代謝"];

// ==================== イベントプール ====================
const GLOBAL_EVENTS = [
  { id: "g_worm", type: "global", title: "【共通】流れてきた大ミミズ", desc: "岸辺に巨大な獲物が漂着！山分けするか、独り占めを狙うか？", choices: [{ id: "coop", text: "🤝 山分けを提案" }, { id: "betray", text: "⚔️ 独り占めを狙う" }] },
  { id: "g_heron", type: "global", title: "【共通】上空にサギが旋回！", desc: "巨大なアオサギが池を見下ろしている。どう生き延びる？", choices: [{ id: "threat", text: "👥 みんなで膨らんで威嚇" }, { id: "hide", text: "🙈 自分だけ泥の底に潜る" }] },
  { id: "g_rain", type: "global", title: "【共通】にわか雨の恵み", desc: "急なスコール！草むらが潤い、虫たちが地面に落ちてきた！", choices: [{ id: "rush", text: "🦗 陸へ駆け上がって乱獲" }, { id: "stay", text: "💧 水中で安全に雨宿り" }] }
];

const PAIR_EVENTS = [
  { id: "p_leaf", type: "pair", title: "【ペアイベント】ハスの葉の浮力", desc: "サギ接近中！1匹しか乗れないハスの葉で鉢合わせた。重みで沈む前にどうする？", choices: [{ id: "coop", text: "🤝 譲り合って片足で耐える" }, { id: "kick", text: "🦶 相手を水中に蹴り落とす" }] },
  { id: "p_dew", type: "pair", title: "【ペアイベント】朝露の分け合い", desc: "干上がりそうな草の葉に、命を繋ぐ大粒の朝露が1滴だけ残っている……", choices: [{ id: "share", text: "💧 半分ずつ吸い合う" }, { id: "drink_all", text: "⚡ 突き飛ばして一気に飲み干す" }] },
  { id: "p_mantis", type: "pair", title: "【ペアイベント】巨大オオカマキリ", desc: "目の前に凶暴なカマキリ！1匹では勝てない！", choices: [{ id: "threat", text: "👥 2匹で同時に威嚇する" }, { id: "bait", text: "🏃 相手を盾にして逃げる" }] }
];

const PERSONAL_EVENTS = [
  { id: "s_moss", type: "personal", title: "【個別】光る苔の群生地", desc: "水底に怪しく光る苔がある。高栄養だが毒かもしれない。", choices: [{ id: "eat", text: "😋 思い切って食べる" }, { id: "ignore", text: "🙅 無視して通り過ぎる" }] },
  { id: "s_trap", type: "personal", title: "【個別】水草の罠", desc: "尾びれが枯れた水草に絡まってしまった！", choices: [{ id: "break", text: "💪 力任せに引きちぎる" }, { id: "wait", text: "🧘 じっと外れるのを待つ" }] },
  { id: "s_skin", type: "personal", title: "【個別】古い皮膚の脱皮", desc: "成長に伴い古い皮が剥がれてきた。栄養にするか？", choices: [{ id: "eat_skin", text: "🍴 器用に口で食べて栄養にする" }, { id: "discard", text: "💨 そのまま脱ぎ捨てる" }] }
];

// ==================== ルーム管理 ====================
const rooms = {};

function createNewRoom(roomId) {
  const room = {
    id: roomId,
    turn: 1,
    timeLeft: TURN_DURATION,
    weather: "快晴",
    forecast: "曇り",
    nextPredator: null,
    actors: {}, // プレイヤー ＋ NPC
    currentEvent: null,
    pairTargets: {}, // ペアイベントの組み合わせ { p1Id: p2Id }
    isFinished: false,
    timer: null
  };

  // NPCを初期生成（プレイヤーと合わせて25匹になるよう準備、初期はNPC21匹）
  for (let i = 1; i <= 21; i++) {
    const npcId = `npc_${i}`;
    room.actors[npcId] = createActor(npcId, `兄弟_${i}`, false);
  }

  // 最初のイベント抽選
  pickNextEvent(room);
  startRoomTimer(room);
  rooms[roomId] = room;
  return room;
}

function createActor(id, name, isPlayer) {
  const trait = TRAITS[Math.floor(Math.random() * TRAITS.length)];
  const personality = isPlayer ? "プレイヤー" : NPC_PERSONALITIES[Math.floor(Math.random() * NPC_PERSONALITIES.length)];
  return {
    id, name, isPlayer, personality, trait,
    alive: true,
    stage: 1,
    eggs: 2, // オタマ期残機
    offspringCount: 0, // 繁殖で残した卵の数
    hp: 100, food: 100, water: 100, stamina: 100,
    length: 1.0, weight: 0.5, exp: 0,
    zone: Math.random() < 0.5 ? 0 : 1,
    ready: false,
    action: null,
    eventChoice: null,
    history: [`第1世代の卵塊からオタマジャクシとして誕生（体質: ${trait}）`]
  };
}

function startRoomTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      resolveTurn(room);
    } else {
      broadcastState(room);
    }
  }, 1000);
}

function pickNextEvent(room) {
  const roll = Math.random();
  if (roll < 0.4) {
    room.currentEvent = GLOBAL_EVENTS[Math.floor(Math.random() * GLOBAL_EVENTS.length)];
    room.pairTargets = {};
  } else if (roll < 0.75) {
    // ペアイベント：生存個体から同じゾーンの2匹を抽出
    room.currentEvent = PAIR_EVENTS[Math.floor(Math.random() * PAIR_EVENTS.length)];
    room.pairTargets = {};
    const aliveList = Object.values(room.actors).filter(a => a.alive);
    // ゾーンごとにグループ化
    const byZone = {};
    aliveList.forEach(a => {
      byZone[a.zone] = byZone[a.zone] || [];
      byZone[a.zone].push(a.id);
    });
    for (const z in byZone) {
      if (byZone[z].length >= 2) {
        // シャッフルしてペア作成
        const list = byZone[z].sort(() => 0.5 - Math.random());
        for (let i = 0; i < list.length - 1; i += 2) {
          room.pairTargets[list[i]] = list[i + 1];
          room.pairTargets[list[i + 1]] = list[i];
        }
      }
    }
  } else {
    room.currentEvent = PERSONAL_EVENTS[Math.floor(Math.random() * PERSONAL_EVENTS.length)];
    room.pairTargets = {};
  }
}

// ==================== ターン解決ロジック ====================
function resolveTurn(room) {
  if (room.isFinished) return;

  const logs = [];
  logs.push(`=== [ TURN ${room.turn} 解決結果 ] ===`);

  // 1. NPCの行動とイベント選択の自動決定
  const aliveActors = Object.values(room.actors).filter(a => a.alive);
  aliveActors.forEach(a => {
    if (!a.isPlayer) {
      decideNpcTurn(a, room);
    }
  });

  // 2. 移動の実行
  aliveActors.forEach(a => {
    if (a.action && a.action.moveZone !== undefined) {
      const targetZone = a.action.moveZone;
      if (targetZone >= 0 && targetZone <= 4 && a.stage >= ZONES[targetZone].minStage) {
        a.zone = targetZone;
      }
    }
  });

  // 3. イベントの解決
  resolveEventResults(room, logs);

  // 4. 天敵イベントの解決
  resolvePredator(room, logs);

  // 5. 通常アクション（捕食、休息、求愛、攻撃など）の解決
  resolveActions(room, logs);

  // 6. 代謝・成長・死亡・残機リスポーン判定
  resolveMetabolism(room, logs);

  // 7. 勝敗判定（35ターン経過 or 生存者1匹以下）
  const remainingPlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
  if (room.turn >= MAX_TURNS || (Object.values(room.actors).filter(a => a.isPlayer).length > 1 && remainingPlayers.length <= 1)) {
    finishGame(room, logs);
    return;
  }

  // 次のターンの準備
  room.turn++;
  room.timeLeft = TURN_DURATION;
  room.weather = room.forecast;
  room.forecast = Math.random() < 0.4 ? "雨" : (Math.random() < 0.7 ? "快晴" : "曇り");

  // 天敵予兆の抽選
  if (Math.random() < 0.35) {
    room.nextPredator = Math.random() < 0.5 ? "yago" : (Math.random() < 0.8 ? "heron" : "snake");
  } else {
    room.nextPredator = null;
  }

  pickNextEvent(room);

  // Ready状態リセット
  Object.values(room.actors).forEach(a => {
    a.ready = false;
    a.action = null;
    a.eventChoice = null;
  });

  broadcastState(room, logs);
}

// NPC思考ルーチン（性格別）
function decideNpcTurn(npc, room) {
  // 移動判断
  let desiredZone = npc.zone;
  if (npc.stage >= 5 && Math.random() < 0.4) {
    desiredZone = room.weather === "雨" ? 4 : 3;
  } else if (npc.stage < 4) {
    desiredZone = Math.random() < 0.6 ? 1 : 0;
  }
  desiredZone = Math.max(0, Math.min(4, desiredZone));
  if (desiredZone > npc.stage) desiredZone = npc.zone;

  // 通常行動
  let act = "feed";
  if (npc.stamina < 30 || (room.nextPredator && npc.personality === "臆病")) {
    act = "rest";
  } else if (npc.stage >= 6 && Math.random() < 0.3) {
    act = "mate";
  }

  npc.action = { moveZone: desiredZone, act: act };

  // イベント選択（性格に応じて分岐）
  const ev = room.currentEvent;
  if (ev) {
    if (ev.type === "global") {
      if (npc.personality === "利己" || npc.personality === "獰猛") {
        npc.eventChoice = ev.choices[1].id;
      } else if (npc.personality === "温厚") {
        npc.eventChoice = ev.choices[0].id;
      } else {
        npc.eventChoice = Math.random() < 0.5 ? ev.choices[0].id : ev.choices[1].id;
      }
    } else if (ev.type === "pair") {
      if (npc.personality === "利己" || npc.personality === "獰猛") {
        npc.eventChoice = ev.choices[1].id; // 蹴落とす・独占
      } else if (npc.personality === "温厚" || npc.personality === "臆病") {
        npc.eventChoice = ev.choices[0].id; // 譲る・山分け
      } else {
        npc.eventChoice = Math.random() < 0.5 ? ev.choices[0].id : ev.choices[1].id;
      }
    } else {
      npc.eventChoice = ev.choices[0].id;
    }
  }
}

// イベント解決処理
function resolveEventResults(room, logs) {
  const ev = room.currentEvent;
  if (!ev) return;

  const alive = Object.values(room.actors).filter(a => a.alive);

  if (ev.type === "global") {
    const choices = alive.map(a => a.eventChoice);
    const betrayCount = choices.filter(c => c === "betray" || c === "hide" || c === "rush").length;

    alive.forEach(a => {
      if (ev.id === "g_worm") {
        if (a.eventChoice === "coop") {
          if (betrayCount > 0) {
            a.food = Math.min(100, a.food + 12);
            logs.push(`${a.name}: 山分けを待ったが、強奪されて僅かしか食べられず（満腹+12）`);
          } else {
            a.food = Math.min(100, a.food + 35); a.exp += 8;
            logs.push(`${a.name}: 【平和的解決】みんなで分け合って仲良く満腹！（満腹+35, EXP+8）`);
          }
        } else {
          a.food = Math.min(100, a.food + 65); a.exp += 15;
          logs.push(`${a.name}: 【強奪！】大ミミズを独り占めして貪り食った！（満腹+65, EXP+15）`);
          a.history.push(`TURN ${room.turn}: 大ミミズを独り占めして兄弟を出し抜く`);
        }
      } else if (ev.id === "g_heron") {
        if (a.eventChoice === "threat") {
          const threatCount = choices.filter(c => c === "threat").length;
          if (threatCount >= 2) {
            a.stamina = Math.max(0, a.stamina - 15);
            logs.push(`${a.name}: 集団威嚇に加わり、サギを撃退した！`);
          } else {
            killActor(a, "サギへの単独威嚇に失敗し、嘴で突かれた！", room, logs);
          }
        } else {
          logs.push(`${a.name}: 泥の底に潜んでサギをやり過ごした。`);
        }
      } else if (ev.id === "g_rain") {
        if (a.eventChoice === "rush") {
          a.food = Math.min(100, a.food + 30); a.exp += 15;
          logs.push(`${a.name}: 豪雨の中で落ちた虫を乱獲！（満腹+30, EXP+15）`);
        } else {
          a.stamina = 100;
          logs.push(`${a.name}: 水中で安全に雨宿りし、気力を全快した。`);
        }
      }
    });
  } else if (ev.type === "pair") {
    const handled = new Set();
    for (const p1Id in room.pairTargets) {
      const p2Id = room.pairTargets[p1Id];
      if (handled.has(p1Id) || handled.has(p2Id)) continue;
      handled.add(p1Id); handled.add(p2Id);

      const p1 = room.actors[p1Id];
      const p2 = room.actors[p2Id];
      if (!p1 || !p2 || !p1.alive || !p2.alive) continue;

      if (ev.id === "p_leaf") {
        if (p1.eventChoice === "coop" && p2.eventChoice === "coop") {
          logs.push(`ペア結末: ${p1.name} と ${p2.name} は譲り合い、2匹でハスの葉に乗って耐えきった！`);
        } else if (p1.eventChoice === "kick" && p2.eventChoice === "coop") {
          logs.push(`ペア結末: ${p1.name} が ${p2.name} をハスの葉から水中に蹴り落とした！`);
          p2.hp -= 30; p1.history.push(`TURN ${room.turn}: ハスの葉から ${p2.name} を蹴り落とす`);
        } else if (p1.eventChoice === "coop" && p2.eventChoice === "kick") {
          logs.push(`ペア結末: ${p2.name} が ${p1.name} をハスの葉から水中に蹴り落とした！`);
          p1.hp -= 30; p2.history.push(`TURN ${room.turn}: ハスの葉から ${p1.name} を蹴り落とす`);
        } else {
          logs.push(`ペア結末: ${p1.name} と ${p2.name} はもつれ合い、2匹とも葉から転がり落ちて怪我をした！（共倒れ）`);
          p1.hp -= 20; p2.hp -= 20;
        }
      } else if (ev.id === "p_dew") {
        if (p1.eventChoice === "share" && p2.eventChoice === "share") {
          p1.water = Math.min(100, p1.water + 35); p2.water = Math.min(100, p2.water + 35);
          logs.push(`ペア結末: ${p1.name} と ${p2.name} は朝露を半分ずつ分け合った（水分+35）`);
        } else if (p1.eventChoice === "drink_all" && p2.eventChoice === "share") {
          p1.water = Math.min(100, p1.water + 75);
          logs.push(`ペア結末: ${p1.name} が朝露を独り占めして飲み干した！`);
        } else if (p1.eventChoice === "share" && p2.eventChoice === "drink_all") {
          p2.water = Math.min(100, p2.water + 75);
          logs.push(`ペア結末: ${p2.name} が朝露を独り占めして飲み干した！`);
        } else {
          logs.push(`ペア結末: 2匹が朝露を奪い合い、露は地面に落ちて泥に消えた……`);
        }
      }
    }
  } else if (ev.type === "personal") {
    alive.forEach(a => {
      if (ev.id === "s_moss") {
        if (a.eventChoice === "eat") {
          if (Math.random() < 0.65) {
            a.exp += 18; a.length += 0.2;
            logs.push(`${a.name}: 光る苔は極上の栄養だった！（EXP+18）`);
          } else {
            a.hp -= 15;
            logs.push(`${a.name}: 光る苔に微毒が含まれていた！（HP-15）`);
          }
        }
      } else if (ev.id === "s_trap") {
        if (a.eventChoice === "break") {
          a.stamina -= 20; a.weight += 0.1;
          logs.push(`${a.name}: 力任せに水草をちぎって脱出！（気力-20）`);
        } else {
          a.stamina = Math.min(100, a.stamina + 10);
        }
      } else if (ev.id === "s_skin") {
        if (a.eventChoice === "eat_skin") {
          a.food = Math.min(100, a.food + 15); a.exp += 10;
          logs.push(`${a.name}: 脱皮した古い皮を食べて栄養を補給！（満腹+15, EXP+10）`);
        }
      }
    });
  }
}

// 天敵処理
function resolvePredator(room, logs) {
  if (!room.nextPredator) return;

  const targetActors = Object.values(room.actors).filter(a => a.alive);

  if (room.nextPredator === "yago") {
    logs.push("【天敵急襲！】水底からヤゴの鋭い下顎が飛び出した！");
    const victims = targetActors.filter(a => (a.zone === 0 || a.zone === 1) && (!a.action || a.action.act !== "rest"));
    // NPC優先で間引く
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      const v = victims[0];
      killActor(v, "ヤゴの鋭いアゴに捕獲された！", room, logs);
    }
  } else if (room.nextPredator === "heron") {
    logs.push("【天敵急襲！】アオサギの嘴が水面をドスンと突き刺した！");
    const victims = targetActors.filter(a => a.zone === 2 && (!a.action || a.action.act !== "rest"));
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      const v = victims[0];
      killActor(v, "アオサギに丸呑みされた！", room, logs);
    }
  } else if (room.nextPredator === "snake") {
    logs.push("【天敵急襲！】草むらの奥からヘビがうねり出た！");
    const victims = targetActors.filter(a => a.zone === 4);
    victims.sort((a, b) => (a.isPlayer ? 1 : -1));
    if (victims.length > 0) {
      const v = victims[0];
      killActor(v, "ヘビに締め上げられ丸呑みされた！", room, logs);
    }
  }
}

// 通常行動処理（捕食・休息・繁殖）
function resolveActions(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  alive.forEach(a => {
    if (!a.action) return;
    const act = a.action.act;

    if (act === "rest") {
      a.stamina = Math.min(100, a.stamina + 35);
      a.hp = Math.min(100, a.hp + 10);
    } else if (act === "feed") {
      const zoneData = ZONES[a.zone];
      if (zoneData.prey.length > 0) {
        const prey = zoneData.prey[0];
        a.stamina = Math.max(0, a.stamina - 12);
        const myPower = (a.length * 5) + (a.weight * 3) + (a.stamina * 0.2);
        let chance = 60 + (myPower - prey.diff) * 2;
        chance = Math.max(20, Math.min(95, chance));

        if (Math.random() * 100 < chance) {
          const eff = 0.8 + Math.random() * 0.4;
          a.food = Math.min(100, a.food + prey.food);
          a.exp += Math.round(prey.exp * eff);
          a.weight += 0.1 * eff;
          a.length += 0.05 * eff;
          logs.push(`${a.name}: ${prey.name}の捕獲に成功！（満腹+${prey.food}）`);
        } else {
          logs.push(`${a.name}: ${prey.name}に逃げられた……`);
        }
      }
    } else if (act === "mate" && a.stage >= 6) {
      // 同じゾーンにいる他の成体と交配
      const partners = alive.filter(o => o.id !== a.id && o.zone === a.zone && o.stage >= 6);
      if (partners.length > 0) {
        const p = partners[0];
        const eggsCount = 20 + Math.floor(Math.random() * 15);
        a.offspringCount += eggsCount;
        p.offspringCount += eggsCount;
        a.food = Math.max(10, a.food - 30);
        a.stamina = Math.max(10, a.stamina - 40);
        p.food = Math.max(10, p.food - 30);
        p.stamina = Math.max(10, p.stamina - 40);
        logs.push(`💖 【交配成功！】${a.name} と ${p.name} が繁殖し、${eggsCount}個の卵を残した！`);
        a.history.push(`TURN ${room.turn}: ${p.name} と交配し、卵を${eggsCount}個残す`);
        p.history.push(`TURN ${room.turn}: ${a.name} と交配し、卵を${eggsCount}個残す`);
      }
    }
  });
}

// 代謝と成長
function resolveMetabolism(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  alive.forEach(a => {
    // 満腹度減少
    a.food -= (a.stage >= 5 ? 10 : 8);
    if (a.food <= 0) {
      a.food = 0;
      a.hp -= 15;
      logs.push(`⚠ ${a.name}: 飢餓によりHP-15！`);
    }

    // 水分減少
    let waterLoss = ZONES[a.zone].baseWaterLoss;
    if (room.weather === "雨") waterLoss = 0;
    if (room.weather === "快晴" && a.zone === 4) waterLoss *= 1.5;
    a.water -= waterLoss;
    if (a.water <= 0) {
      a.water = 0;
      a.hp -= 25;
      logs.push(`⚠ ${a.name}: 乾燥によりHP-25！`);
    }

    // 成長判定
    if (a.exp >= EXP_THRESHOLDS[a.stage] && a.stage < 6) {
      a.stage++;
      a.length += 0.5;
      a.weight += 1.0;
      logs.push(`🎉 ${a.name} が成長し、『${STAGE_NAMES[a.stage]}』に変態した！`);
      a.history.push(`TURN ${room.turn}: 『${STAGE_NAMES[a.stage]}』へ変態`);
      if (a.stage === 4) {
        a.eggs = 0;
        logs.push(`⚠ ${a.name}: 尾が吸収され、残機が消滅！ここからは【永久死亡】です。`);
      }
    }

    if (a.hp <= 0) {
      killActor(a, "飢餓または乾燥により衰弱死した。", room, logs);
    }
  });
}

function killActor(actor, reason, room, logs) {
  if (!actor.alive) return;
  logs.push(`💀 ${actor.name} が命を落とした（${reason}）`);

  if (actor.stage < 4 && actor.eggs > 0) {
    actor.eggs--;
    actor.hp = 100; actor.food = 80; actor.water = 100; actor.stamina = 100;
    actor.stage = 1; actor.exp = 0; actor.zone = 0;
    logs.push(`🥚 ${actor.name} は卵ストックから再誕生した！（出遅れ発生、残機: ${actor.eggs}）`);
    actor.history.push(`TURN ${room.turn}: 死亡したが卵ストックから復活`);
  } else {
    actor.alive = false;
    actor.history.push(`TURN ${room.turn}: 死亡（${reason}）`);
  }
}

// ゲーム終了処理・スコア計算
function finishGame(room, logs) {
  room.isFinished = true;
  clearInterval(room.timer);
  logs.push("❄️ 池が凍結し、冬が訪れた。サバイバルゲーム終了！");

  // スコア計算
  // 最終スコア = (生存T * 100) + (卵 * 50) + 最終生存ボーナス(1500)
  const ranking = Object.values(room.actors).map(a => {
    let score = (room.turn * 100) + (a.offspringCount * 50);
    if (a.alive) score += 1500;
    return {
      id: a.id,
      name: a.name,
      isPlayer: a.isPlayer,
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
      turn: room.turn,
      timeLeft: room.timeLeft,
      weather: room.weather,
      forecast: room.forecast,
      nextPredator: room.nextPredator,
      event: room.currentEvent,
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

// ==================== WebSocket通信 ====================
wss.on('connection', (ws) => {
  let myRoomId = null;
  let myActorId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "JOIN_ROOM") {
        myRoomId = data.roomId;
        const room = rooms[myRoomId] || createNewRoom(myRoomId);

        // 空いているプレイヤー枠を探す、または追加
        myActorId = `pl_${Math.random().toString(36).substring(2, 6)}`;
        const playerActor = createActor(myActorId, data.name || "カエル", true);
        playerActor.ws = ws;

        // NPCを1匹プレイヤーと入れ替えて総数25匹を維持
        const npcKeys = Object.keys(room.actors).filter(k => !room.actors[k].isPlayer);
        if (npcKeys.length > 0) {
          delete room.actors[npcKeys[0]];
        }
        room.actors[myActorId] = playerActor;

        ws.send(JSON.stringify({ type: "INIT", myId: myActorId }));
        broadcastState(room);
      }

      if (data.type === "SUBMIT_ACTION" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.actors[myActorId]) {
          const a = room.actors[myActorId];
          a.ready = true;
          a.action = data.action;
          a.eventChoice = data.eventChoice;

          broadcastState(room);

          // 全プレイヤーがReadyなら即ターン解決
          const players = Object.values(room.actors).filter(act => act.isPlayer && act.alive);
          if (players.length > 0 && players.every(p => p.ready)) {
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
        // 回線落ちは自動で臆病なNPCに切り替え
        const a = room.actors[myActorId];
        a.isPlayer = false;
        a.personality = "臆病";
        a.ws = null;
      }
      broadcastState(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`FROG LIFE server running on port ${PORT}`);
});