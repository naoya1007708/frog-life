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
const MAX_TURNS = 35; // 35ターンで冬眠・決着
const TURN_DURATION = 45; // 1ターンの制限秒数

const ZONES = [
  { id: 0, name: "① 水底・泥地", minStage: 1, baseWaterLoss: 0, prey: [{ name: "アオミドロ(藻)", diff: 0, food: 18, exp: 6 }] },
  { id: 1, name: "② 水中(水草)", minStage: 1, baseWaterLoss: 0, prey: [{ name: "ボウフラ", diff: 15, food: 25, exp: 9 }] },
  { id: 2, name: "③ 水面・浅瀬", minStage: 3, baseWaterLoss: 0, prey: [{ name: "落ちた蚊", diff: 25, food: 30, exp: 12 }, { name: "アメンボ", diff: 30, food: 32, exp: 14 }] },
  { id: 3, name: "④ 水際・湿地", minStage: 4, baseWaterLoss: 5, prey: [{ name: "ワラジムシ", diff: 35, food: 38, exp: 16 }] },
  { id: 4, name: "⑤ 草むら・陸地", minStage: 5, baseWaterLoss: 20, prey: [{ name: "コオロギ", diff: 50, food: 55, exp: 22 }, { name: "大型バッタ", diff: 65, food: 65, exp: 28 }] }
];

const STAGE_NAMES = ["", "オタマジャクシ", "後足が生えた", "前足が生えた", "変態期(尾あり)", "子ガエル", "成体カエル"];
const EXP_THRESHOLDS = [0, 10, 25, 45, 75, 115, 9999];
const NPC_PERSONALITIES = ["温厚", "臆病", "利己", "獰猛", "気まぐれ"];
const TRAITS = ["頑強", "大食漢", "身軽", "高代謝", "慎重"];

// 3層イベントプール
const GLOBAL_EVENTS = [
  { id: "g_worm", type: "global", title: "【共通】流れてきた大ミミズ", desc: "岸辺の泥に巨大な獲物が漂着！山分けするか、独り占めを狙うか？", choices: [{ id: "coop", text: "🤝 山分けを提案" }, { id: "betray", text: "⚔️ 独り占めを狙う" }] },
  { id: "g_heron", type: "global", title: "【共通】上空にサギの旋回！", desc: "巨大なアオサギが池を見下ろしている。どう生き延びる？", choices: [{ id: "threat", text: "👥 みんなで膨らんで威嚇" }, { id: "hide", text: "🙈 自分だけ泥の底に潜る" }] },
  { id: "g_rain", type: "global", title: "【共通】恵みのゲリラ豪雨", desc: "激しいスコール！草むらが潤い、虫たちが地面に落ちてきた！", choices: [{ id: "rush", text: "🦗 陸へ駆け上がって乱獲" }, { id: "stay", text: "💧 水中で安全に雨宿り" }] }
];

const PAIR_EVENTS = [
  { id: "p_leaf", type: "pair", title: "【ペアイベント】浮き草の定員", desc: "サギ接近中！1匹しか乗れない浮葉の上で鉢合わせた。重みで沈む前にどうする？", choices: [{ id: "coop", text: "🤝 譲り合って片足で耐える" }, { id: "kick", text: "🦶 相手を水中に蹴り落とす" }] },
  { id: "p_dew", type: "pair", title: "【ペアイベント】朝露の分け合い", desc: "干上がりそうな草むら。葉の先端に大粒の朝露が1滴だけ残っている……", choices: [{ id: "share", text: "💧 半分ずつ吸い合う" }, { id: "drink_all", text: "⚡ 突き飛ばして一気に飲み干す" }] },
  { id: "p_mantis", type: "pair", title: "【ペアイベント】巨大オオカマキリ", desc: "草むらで凶暴なカマキリと鉢合わせ！1匹では勝てないが、2匹で威嚇すれば……？", choices: [{ id: "threat", text: "👥 2匹で同時に威嚇" }, { id: "bait", text: "🏃 相手を盾にして逃走" }] }
];

const PERSONAL_EVENTS = [
  { id: "s_moss", type: "personal", title: "【個別】水底の光る苔", desc: "水底に青白く光る苔が生い茂っている。極上の栄養か、毒か？", choices: [{ id: "eat", text: "😋 思い切って食べる" }, { id: "ignore", text: "🙅 怪しいので無視する" }] },
  { id: "s_skin", type: "personal", title: "【個別】古い皮膚の脱皮", desc: "成長に伴い古い皮が剥がれてきた。栄養にするか？", choices: [{ id: "eat_skin", text: "🍴 口で食べて栄養にする" }, { id: "discard", text: "💨 そのまま脱ぎ捨てる" }] }
];

// ==================== ルーム管理 ====================
const rooms = {};

function createNewRoom(roomId) {
  const room = {
    id: roomId,
    status: "waiting", // "waiting" (ロビー待機) または "playing" (進行中) または "finished"
    hostId: null,
    turn: 1,
    timeLeft: TURN_DURATION,
    weather: "快晴",
    forecast: "曇り",
    nextPredator: null,
    activePredatorAnimation: null,
    actors: {},
    currentEvent: null,
    pairTargets: {},
    isFinished: false,
    timer: null
  };

  // 卵塊の兄弟NPCを初期生成（合計25匹になるよう準備）
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
  return {
    id, name, isPlayer, personality, trait,
    alive: true,
    stage: 1,
    eggs: 2, // 残機
    offspringCount: 0,
    hp: 100, food: 100, water: 100, stamina: 100,
    length: 1.0, weight: 0.5, exp: 0,
    zone: 1, // 初期は水中
    ready: false,
    action: null,
    eventChoice: null,
    history: [`第1世代の卵塊から誕生（生まれ持った特徴: ${trait}）`]
  };
}

function startRoomGame(room) {
  room.status = "playing";
  room.turn = 1;
  room.timeLeft = TURN_DURATION;
  pickNextEvent(room);

  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      resolveTurn(room);
    } else {
      broadcastState(room);
    }
  }, 1000);

  broadcastState(room, ["🎉 ホストがゲームを開始しました！全員が卵から孵化し、池へ広がる！"]);
}

function pickNextEvent(room) {
  const roll = Math.random();
  if (roll < 0.4) {
    room.currentEvent = GLOBAL_EVENTS[Math.floor(Math.random() * GLOBAL_EVENTS.length)];
    room.pairTargets = {};
  } else if (roll < 0.75) {
    room.currentEvent = PAIR_EVENTS[Math.floor(Math.random() * PAIR_EVENTS.length)];
    room.pairTargets = {};
    const aliveList = Object.values(room.actors).filter(a => a.alive);
    const byZone = {};
    aliveList.forEach(a => {
      byZone[a.zone] = byZone[a.zone] || [];
      byZone[a.zone].push(a.id);
    });
    for (const z in byZone) {
      if (byZone[z].length >= 2) {
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
  logs.push(`=== [ TURN ${room.turn} 解決 ] ===`);
  room.activePredatorAnimation = null;

  const alive = Object.values(room.actors).filter(a => a.alive);

  // 1. NPCの思考決定
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

  // 3. イベント解決
  resolveEvent(room, logs);

  // 4. 天敵の襲来
  if (room.nextPredator) {
    room.activePredatorAnimation = room.nextPredator;
    resolvePredator(room, logs);
  }

  // 5. アクション解決（捕食、休息、求愛）
  resolveActions(room, logs);

  // 6. 代謝・成長・死亡
  resolveMetabolism(room, logs);

  // 7. 勝敗判定（35Tまたは生存者1匹以下）
  const livePlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
  if (room.turn >= MAX_TURNS || (Object.values(room.actors).filter(a => a.isPlayer).length > 1 && livePlayers.length <= 1)) {
    finishGame(room, logs);
    return;
  }

  // 次のターンの準備
  room.turn++;
  room.timeLeft = TURN_DURATION;
  room.weather = room.forecast;
  room.forecast = Math.random() < 0.4 ? "雨" : (Math.random() < 0.75 ? "快晴" : "曇り");

  if (Math.random() < 0.35) {
    room.nextPredator = Math.random() < 0.6 ? "yago" : "heron";
  } else {
    room.nextPredator = null;
  }

  pickNextEvent(room);

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
  if (npc.stamina < 30 || (room.nextPredator && npc.personality === "臆病")) {
    act = "rest";
  } else if (npc.stage >= 6 && Math.random() < 0.3) {
    act = "mate";
  }

  npc.action = { moveZone: tz, act: act };

  const ev = room.currentEvent;
  if (ev) {
    if (npc.personality === "利己" || npc.personality === "獰猛") {
      npc.eventChoice = ev.choices[1].id;
    } else if (npc.personality === "温厚") {
      npc.eventChoice = ev.choices[0].id;
    } else {
      npc.eventChoice = Math.random() < 0.5 ? ev.choices[0].id : ev.choices[1].id;
    }
  }
}

function resolveEvent(room, logs) {
  const ev = room.currentEvent;
  if (!ev) return;
  const alive = Object.values(room.actors).filter(a => a.alive);

  if (ev.type === "global") {
    const betrayCount = alive.filter(a => a.eventChoice === "betray" || a.eventChoice === "rush").length;
    alive.forEach(a => {
      if (ev.id === "g_worm") {
        if (a.eventChoice === "coop") {
          if (betrayCount > 0) {
            a.food = Math.min(100, a.food + 12);
            logs.push(`${a.name}: 山分けを待ったが、抜け駆けされて僅かしか食べられず（満腹+12）`);
          } else {
            a.food = Math.min(100, a.food + 35); a.exp += 8;
            logs.push(`${a.name}: 【平和的解決】みんなで分け合って仲良く満腹！（満腹+35, EXP+8）`);
          }
        } else {
          a.food = Math.min(100, a.food + 65); a.exp += 15;
          logs.push(`${a.name}: 【強奪！】大ミミズを独り占めして食い散らかした！（満腹+65, EXP+15）`);
          a.history.push(`TURN ${room.turn}: 大ミミズを独占して兄弟を出し抜く`);
        }
      } else if (ev.id === "g_heron") {
        if (a.eventChoice === "threat") {
          const threats = alive.filter(act => act.eventChoice === "threat").length;
          if (threats >= 2) {
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
          logs.push(`ペア結末: 2匹はもつれ合い、共に葉から転がり落ちて怪我をした！（共倒れ）`);
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
          logs.push(`ペア結末: 2匹が朝露を奪い合い、露は泥に落ちて消えた……`);
        }
      }
    }
  } else if (ev.type === "personal") {
    alive.forEach(a => {
      if (ev.id === "s_moss" && a.eventChoice === "eat") {
        if (Math.random() < 0.65) {
          a.exp += 18; a.length += 0.2;
          logs.push(`${a.name}: 光る苔は極上の栄養だった！（EXP+18）`);
        } else {
          a.hp -= 15;
          logs.push(`${a.name}: 光る苔に微毒が含まれていた！（HP-15）`);
        }
      } else if (ev.id === "s_skin" && a.eventChoice === "eat_skin") {
        a.food = Math.min(100, a.food + 15); a.exp += 10;
        logs.push(`${a.name}: 脱皮した古い皮を食べて栄養を補給！（満腹+15, EXP+10）`);
      }
    });
  }
}

function resolvePredator(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  if (room.nextPredator === "yago") {
    logs.push("【天敵急襲！】水底からヤゴの鋭いアゴが飛び出した！");
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

function resolveActions(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  alive.forEach(a => {
    if (!a.action) return;
    const act = a.action.act;

    if (act === "rest") {
      a.stamina = Math.min(100, a.stamina + 35);
      a.hp = Math.min(100, a.hp + 10);
    } else if (act === "feed") {
      const zData = ZONES[a.zone];
      if (zData && zData.prey.length > 0) {
        const prey = zData.prey[0];
        a.stamina = Math.max(0, a.stamina - 12);
        const myPower = (a.length * 5) + (a.weight * 3) + (a.stamina * 0.2);
        let chance = 60 + (myPower - prey.diff) * 2;
        if (a.trait === "大食漢") chance += 5;
        chance = Math.max(20, Math.min(95, chance));

        if (Math.random() * 100 < chance) {
          const eff = a.trait === "大食漢" ? 1.2 : (0.8 + Math.random() * 0.4);
          a.food = Math.min(100, a.food + prey.food);
          a.exp += Math.round(prey.exp * eff);
          a.weight += 0.1 * eff;
          a.length += 0.05 * eff;
          logs.push(`${a.name}: ${prey.name}の捕食に成功！（満腹+${prey.food}）`);
        } else {
          logs.push(`${a.name}: ${prey.name}に逃げられた……`);
        }
      }
    } else if (act === "mate" && a.stage >= 6) {
      const partners = alive.filter(o => o.id !== a.id && o.zone === a.zone && o.stage >= 6);
      if (partners.length > 0) {
        const p = partners[0];
        const eggs = 20 + Math.floor(Math.random() * 15);
        a.offspringCount += eggs;
        p.offspringCount += eggs;
        a.food = Math.max(10, a.food - 30);
        a.stamina = Math.max(10, a.stamina - 40);
        p.food = Math.max(10, p.food - 30);
        p.stamina = Math.max(10, p.stamina - 40);
        logs.push(`💖 【交配成功！】${a.name} と ${p.name} が繁殖し、${eggs}個の卵を残した！`);
        a.history.push(`TURN ${room.turn}: ${p.name} と交配し、卵を${eggs}個残す`);
        p.history.push(`TURN ${room.turn}: ${a.name} と交配し、卵を${eggs}個残す`);
      }
    }
  });
}

function resolveMetabolism(room, logs) {
  const alive = Object.values(room.actors).filter(a => a.alive);

  alive.forEach(a => {
    // 満腹度減少
    const foodLoss = a.trait === "大食漢" ? 11 : (a.stage >= 5 ? 10 : 8);
    a.food -= foodLoss;
    if (a.food <= 0) {
      a.food = 0;
      a.hp -= (a.trait === "高代謝" ? 20 : 15);
      logs.push(`⚠ ${a.name}: 飢餓によりHP減少！`);
    }

    // 水分減少
    let waterLoss = ZONES[a.zone].baseWaterLoss;
    if (room.weather === "雨") waterLoss = 0;
    if (a.trait === "頑強") waterLoss *= 0.6;
    if (room.weather === "快晴" && a.zone === 4) waterLoss *= 1.5;
    a.water -= waterLoss;
    if (a.water <= 0) {
      a.water = 0;
      a.hp -= 25;
      logs.push(`⚠ ${a.name}: 体が干からび、乾燥ダメージ！`);
    }

    // 成長
    const reqExp = a.trait === "高代謝" ? Math.round(EXP_THRESHOLDS[a.stage] * 0.8) : EXP_THRESHOLDS[a.stage];
    if (a.exp >= reqExp && a.stage < 6) {
      a.stage++;
      a.length += 0.5;
      a.weight += 1.0;
      logs.push(`🎉 ${a.name} が成長し、『${STAGE_NAMES[a.stage]}』へ進化した！`);
      a.history.push(`TURN ${room.turn}: 『${STAGE_NAMES[a.stage]}』へ変態`);
      if (a.stage === 4) {
        a.eggs = 0;
        logs.push(`⚠ ${a.name}: 尾が吸収され、残機が消滅！ここからは【永久死亡】です！`);
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
    actor.stage = 1; actor.exp = 0; actor.zone = 1;
    logs.push(`🥚 ${actor.name} は卵ストックから再誕生した！（出遅れ発生、残機: ${actor.eggs}）`);
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

        // 最初の参加者をホストにする
        if (!room.hostId) {
          room.hostId = myActorId;
        }

        // NPC枠を1つプレイヤーと置き換え（総数25匹維持）
        const npcKeys = Object.keys(room.actors).filter(k => !room.actors[k].isPlayer);
        if (npcKeys.length > 0) {
          delete room.actors[npcKeys[0]];
        }
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
      // ホストが抜けたら次のプレイヤーに委譲
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