const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// 定数・マスターデータ
// ==========================================
const TOTAL_TURNS = 35;
const TURN_DURATION_SEC = 120;
const TOTAL_FROGS = 25;

const WEATHERS = ["快晴", "曇り", "雨", "日照り", "豪雨"];
const TRAITS = ["頑強", "大食漢", "身軽", "高代謝", "慎重"];
const PERSONALITIES = ["温厚", "利己", "獰猛", "慎重"];

const PREY_MASTER = {
  0: [
    { id: "algae", name: "アオミドロ(藻)", diff: 0, food: 18, exp: 8 },
    { id: "chironomid", name: "ユスリカの幼虫", diff: 10, food: 22, exp: 12 }
  ],
  1: [
    { id: "daphnia", name: "ミジンコ", diff: 5, food: 15, exp: 8 },
    { id: "wriggler", name: "ボウフラ", diff: 15, food: 25, exp: 14 },
    { id: "bloodworm", name: "アカムシ", diff: 20, food: 28, exp: 18 }
  ],
  2: [
    { id: "mosquito", name: "落ちた蚊", diff: 25, food: 30, exp: 20 },
    { id: "strider", name: "アメンボ", diff: 30, food: 32, exp: 22 }
  ],
  3: [
    { id: "woodlouse", name: "ワラジムシ", diff: 35, food: 38, exp: 25 },
    { id: "fly", name: "小型ハエ", diff: 40, food: 40, exp: 28 }
  ],
  4: [
    { id: "cricket", name: "コオロギ", diff: 50, food: 55, exp: 35 },
    { id: "grasshopper", name: "大型バッタ", diff: 65, food: 65, exp: 45 },
    { id: "earthworm", name: "巨大ミミズ (大物)", diff: 85, food: 85, exp: 60 }
  ]
};

// ==========================================
// イベントマスター（すべて2択制）
// ==========================================
const EVENTS_MASTER = {
  solo: [
    // 良いイベント（方針の2択）
    {
      id: "solo_sunbath",
      title: "【心地よい木漏れ日】",
      desc: "温かな光が差し込んでいる。どう過ごす？",
      choices: [
        { id: "rest", text: "光を浴びてじっと休む (HP+25, 気力+35)" },
        { id: "search", text: "温まった体で周囲を探索 (満腹+20, EXP+15)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "rest") {
          actor.hp = Math.min(100, actor.hp + 25);
          actor.stamina = Math.min(100, actor.stamina + 35);
          return "木漏れ日の中で体を休め、HPと気力が大きく回復した！";
        } else {
          actor.food = Math.min(100, actor.food + 20);
          actor.exp += 15;
          return "活発に動き回り、小さな虫を見つけて捕食した！（満腹+20, EXP+15）";
        }
      }
    },
    {
      id: "solo_drift_food",
      title: "【流れてきたごちそう】",
      desc: "栄養満点な大物の脱皮殻が漂着した！",
      choices: [
        { id: "meat", text: "栄養たっぷりの肉厚部を食べる (満腹+30, HP+10)" },
        { id: "soft", text: "消化しやすい薄皮を食べる (EXP+20, 気力+20)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "meat") {
          actor.food = Math.min(100, actor.food + 30);
          actor.hp = Math.min(100, actor.hp + 10);
          return "ごちそうを平らげて腹を満たした！（満腹+30, HP+10）";
        } else {
          actor.exp += 20;
          actor.stamina = Math.min(100, actor.stamina + 20);
          return "すばやくエネルギーを吸収し、体が引き締まった！（EXP+20, 気力+20）";
        }
      }
    },
    {
      id: "solo_spring_water",
      title: "【清らかな湧き水】",
      desc: "澄んだ冷たい湧き水を見つけた！",
      choices: [
        { id: "drink", text: "がぶ飲みして皮膚を潤す (水分全快, HP+15)" },
        { id: "bathe", text: "冷水に浸かってリフレッシュ (水分+40, 気力全快)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "drink") {
          actor.water = 100;
          actor.hp = Math.min(100, actor.hp + 15);
          return "清水で水分が全快し、皮膚の傷も癒えた！（水分100%, HP+15）";
        } else {
          actor.water = Math.min(100, actor.water + 40);
          actor.stamina = 100;
          return "冷水で疲れが一気に吹き飛び、気力が全快した！（気力100%）";
        }
      }
    },
    // 悪いイベント（デメリットの2択）
    {
      id: "solo_mud_trap",
      title: "【底なしのぬかるみ】",
      desc: "足が深い泥に飲み込まれた！脱出の代償を選べ。",
      choices: [
        { id: "muscle", text: "力づくで強引に引き抜く (気力-35, 満腹-20)" },
        { id: "scrape", text: "皮膚の擦り傷覚悟で脱出 (HP-20, 気力-15)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "muscle") {
          actor.stamina = Math.max(0, actor.stamina - 35);
          actor.food = Math.max(0, actor.food - 20);
          return "強引に脱出したが、激しい体力とカロリーを消耗した。（気力-35, 満腹-20）";
        } else {
          actor.hp = Math.max(1, actor.hp - 20);
          actor.stamina = Math.max(0, actor.stamina - 15);
          return "皮膚を強く擦りむきながら脱出した。（HP-20, 気力-15）";
        }
      }
    },
    {
      id: "solo_gust_wind",
      title: "【乾いた激しい突風】",
      desc: "突風が体温と水分を奪いに襲いかかる！どう耐える？",
      choices: [
        { id: "grip", text: "岩にしがみついて踏ん張る (気力-30, HP-10)" },
        { id: "endure", text: "丸くなって乾燥風を浴びる (水分-35, 満腹-15)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "grip") {
          actor.stamina = Math.max(0, actor.stamina - 30);
          actor.hp = Math.max(1, actor.hp - 10);
          return "突風に耐え抜いたが、体がきしみ傷を負った。（気力-30, HP-10）";
        } else {
          actor.water = Math.max(0, actor.water - 35);
          actor.food = Math.max(0, actor.food - 15);
          return "風に煽られて皮膚が一気に乾燥してしまった！（水分-35, 満腹-15）";
        }
      }
    },
    {
      id: "solo_leech",
      title: "【吸血ヒルとの遭遇】",
      desc: "厄介なヒルが皮膚に食らいついた！どう対処する？",
      choices: [
        { id: "rip", text: "皮膚ごと無理やり引き剥がす (HP-25の出血)" },
        { id: "rub", text: "泥を擦り付けて時間をかけ落とす (気力-25, 満腹-20)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "rip") {
          actor.hp = Math.max(1, actor.hp - 25);
          return "ヒルを引きちぎったが、皮膚が裂けて血が滲んだ！（HP-25）";
        } else {
          actor.stamina = Math.max(0, actor.stamina - 25);
          actor.food = Math.max(0, actor.food - 20);
          return "泥でヒルを擦り落としたが、ひどく疲弊した。（気力-25, 満腹-20）";
        }
      }
    }
  ],
  pair: [
    {
      id: "pair_food_share",
      title: "【一匹の獲物を巡って】",
      desc: "2匹の目の前に手頃な虫が現れた。どうする？",
      choices: [
        { id: "share", text: "半分ずつ分け合う (親密度+15, 満腹+15)" },
        { id: "steal", text: "素早く独り占めする (満腹+30, 親密度-20)" }
      ],
      resolvePair: (a1, c1, a2, c2) => {
        if (c1 === "share" && c2 === "share") {
          a1.food = Math.min(100, a1.food + 15);
          a2.food = Math.min(100, a2.food + 15);
          addAffinity(a1, a2, 15);
          return {
            log1: `${a2.name} と仲良く分け合った！（満腹+15, 親密度+15）`,
            log2: `${a1.name} と仲良く分け合った！（満腹+15, 親密度+15）`
          };
        } else if (c1 === "steal" && c2 === "share") {
          a1.food = Math.min(100, a1.food + 30);
          addAffinity(a1, a2, -20);
          return {
            log1: `${a2.name} を出し抜いて獲物を独占した！（満腹+30, 親密度-20）`,
            log2: `${a1.name} に獲物を横取りされてしまった……（親密度-20）`
          };
        } else if (c1 === "share" && c2 === "steal") {
          a2.food = Math.min(100, a2.food + 30);
          addAffinity(a1, a2, -20);
          return {
            log1: `${a2.name} に獲物を横取りされてしまった……（親密度-20）`,
            log2: `${a1.name} を出し抜いて獲物を独占した！（満腹+30, 親密度-20）`
          };
        } else {
          a1.stamina = Math.max(0, a1.stamina - 15);
          a2.stamina = Math.max(0, a2.stamina - 15);
          addAffinity(a1, a2, -15);
          return {
            log1: `${a2.name} と奪い合いになり、獲物に逃げられた！（気力-15, 親密度-15）`,
            log2: `${a1.name} と奪い合いになり、獲物に逃げられた！（気力-15, 親密度-15）`
          };
        }
      }
    },
    {
      id: "pair_skin_care",
      title: "【皮膚の乾燥】",
      desc: "風が強く、互いの皮膚が乾き始めている。",
      choices: [
        { id: "help", text: "背中を密着させて保湿し合う (水分+25, 親密度+12)" },
        { id: "refuse", text: "距離を取って警戒する" }
      ],
      resolvePair: (a1, c1, a2, c2) => {
        if (c1 === "help" && c2 === "help") {
          a1.water = Math.min(100, a1.water + 25);
          a2.water = Math.min(100, a2.water + 25);
          addAffinity(a1, a2, 12);
          return {
            log1: `${a2.name} と体を寄せ合って乾燥を防いだ！（水分+25, 親密度+12）`,
            log2: `${a1.name} と体を寄せ合って乾燥を防いだ！（水分+25, 親密度+12）`
          };
        } else {
          return {
            log1: "息が合わず、お互い単独で乾燥に耐えた。",
            log2: "息が合わず、お互い単独で乾燥に耐えた。"
          };
        }
      }
    }
  ]
};

function addAffinity(a1, a2, delta) {
  if (!a1 || !a2 || a1.id === a2.id) return;
  if (!a1.affinity) a1.affinity = {};
  if (!a2.affinity) a2.affinity = {};
  a1.affinity[a2.id] = Math.max(-50, Math.min(100, (a1.affinity[a2.id] || 0) + delta));
  a2.affinity[a1.id] = Math.max(-50, Math.min(100, (a2.affinity[a1.id] || 0) + delta));
}

// ==========================================
// ルーム管理
// ==========================================
const rooms = {};

function createActor(id, name, isPlayer) {
  const gender = Math.random() < 0.5 ? "♂" : "♀";
  const trait = TRAITS[Math.floor(Math.random() * TRAITS.length)];
  const personality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
  return {
    id,
    name,
    isPlayer,
    gender,
    trait,
    personality,
    level: 1,
    stage: 1,
    exp: 0,
    eggs: 2,
    hp: 100,
    food: 80,
    water: 100,
    stamina: 100,
    length: 1.0,
    weight: 0.5,
    zone: 0,
    alive: true,
    ready: false,
    offspringCount: 0,
    affinity: {},
    history: [`Lv.1 オタマジャクシとして誕生（特徴: ${trait}）`]
  };
}

function getExpReq(level) {
  return 10 + (level * 6);
}

function getStageByLevel(level) {
  if (level >= 12) return 6;
  if (level >= 9) return 5;
  if (level >= 7) return 4;
  if (level >= 5) return 3;
  if (level >= 3) return 2;
  return 1;
}

// ==========================================
// WebSocket 通信処理
// ==========================================
wss.on("connection", (ws) => {
  let myRoomId = null;
  let myActorId = null;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "JOIN_ROOM") {
        myRoomId = data.roomId;
        myActorId = `p_${Math.random().toString(36).substring(2, 8)}`;

        if (!rooms[myRoomId]) {
          rooms[myRoomId] = {
            id: myRoomId,
            hostId: myActorId,
            status: "waiting",
            turn: 1,
            timeLeft: TURN_DURATION_SEC,
            weather: "快晴",
            forecast: "曇り",
            actors: {},
            clients: {},
            actions: {},
            eventChoices: {},
            coopRequests: {},
            coopAccepted: {},
            huddlingActors: new Set(),
            eventsByZone: {},
            pairTargets: {},
            turnSummaries: {},
            logs: ["池の卵塊から新たな命が生まれようとしている……"],
            timer: null
          };
        }

        const room = rooms[myRoomId];
        room.clients[myActorId] = ws;
        room.actors[myActorId] = createActor(myActorId, data.name || "アマガエル", true);

        ws.send(JSON.stringify({ type: "INIT", myId: myActorId }));
        broadcastState(room);
      }

      else if (data.type === "START_GAME" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.hostId === myActorId && room.status === "waiting") {
          const currentCount = Object.keys(room.actors).length;
          const npcNames = ["アオ", "ミドリ", "クロ", "シロ", "チビ", "ゴン", "モモ", "タマ", "ハル", "ナツ", "アキ", "フユ", "カゲ", "ツユ", "レン", "サクラ", "スミレ", "カエデ", "ヤマト", "ムサシ", "ソラ", "カイ", "リク", "シン"];
          for (let i = currentCount; i < TOTAL_FROGS; i++) {
            const npcId = `npc_${i + 1}`;
            const name = npcNames[i % npcNames.length] + (Math.floor(i / npcNames.length) > 0 ? (Math.floor(i / npcNames.length) + 1) : "");
            room.actors[npcId] = createActor(npcId, name, false);
          }

          room.status = "playing";
          room.turn = 1;
          setupTurnEvents(room);
          startTurnTimer(room);
          broadcastState(room);
        }
      }

      else if (data.type === "SEND_COOP_REQUEST" && myRoomId) {
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
              const aff = (targetActor.affinity && targetActor.affinity[fromActor.id]) || 0;
              let baseChance = targetActor.personality === "温厚" ? 50 : (targetActor.personality === "利己" ? 20 : 35);
              // 同性同士なら受諾確率が少し上昇（バディ意識）
              if (fromActor.gender === targetActor.gender) baseChance += 10;

              let chance = baseChance + (aff * 0.5);
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

      else if (data.type === "RESPOND_COOP" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.coopRequests[myActorId]) {
          const req = room.coopRequests[myActorId];
          const fromActor = room.actors[req.fromId];
          const targetActor = room.actors[myActorId];

          if (data.accept && fromActor && fromActor.alive) {
            room.coopAccepted[fromActor.id] = { partnerId: targetActor.id, type: req.type, preyId: req.preyId };
            room.coopAccepted[targetActor.id] = { partnerId: fromActor.id, type: req.type, preyId: req.preyId };
            const fromWs = room.clients[fromActor.id];
            if (fromWs && fromWs.readyState === WebSocket.OPEN) {
              fromWs.send(JSON.stringify({ type: "COOP_RESPONSE_NOTIFY", accepted: true, targetName: targetActor.name }));
            }
          } else if (fromActor) {
            addAffinity(targetActor, fromActor, -6);
            const fromWs = room.clients[fromActor.id];
            if (fromWs && fromWs.readyState === WebSocket.OPEN) {
              fromWs.send(JSON.stringify({ type: "COOP_RESPONSE_NOTIFY", accepted: false, targetName: targetActor.name }));
            }
          }
          delete room.coopRequests[myActorId];
          broadcastState(room);
        }
      }

      else if (data.type === "SUBMIT_ACTION" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "playing") {
          room.actions[myActorId] = data.action;
          room.eventChoices[myActorId] = data.eventChoice || "none";
          if (room.actors[myActorId]) room.actors[myActorId].ready = true;

          const alivePlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
          const allReady = alivePlayers.every(p => p.ready);
          if (allReady) {
            resolveTurn(room);
          } else {
            broadcastState(room);
          }
        }
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
    }
  });

  ws.on("close", () => {
    if (myRoomId && rooms[myRoomId]) {
      const room = rooms[myRoomId];
      delete room.clients[myActorId];
      if (room.actors[myActorId]) {
        room.actors[myActorId].alive = false;
      }
      broadcastState(room);
    }
  });
});

// ==========================================
// ゾーンイベントの選定
// ==========================================
function setupTurnEvents(room) {
  room.eventsByZone = {};
  room.pairTargets = {};

  for (let z = 0; z < 5; z++) {
    const aliveInZone = Object.values(room.actors).filter(a => a.alive && a.zone === z);

    // 同エリアに1匹しかいない場合は必ず単独イベント
    if (aliveInZone.length <= 1) {
      const soloList = EVENTS_MASTER.solo;
      const ev = soloList[Math.floor(Math.random() * soloList.length)];
      room.eventsByZone[z] = { ...ev };
    } else {
      if (Math.random() < 0.65) {
        const pairList = EVENTS_MASTER.pair;
        const ev = pairList[Math.floor(Math.random() * pairList.length)];
        room.eventsByZone[z] = { ...ev };

        const p1 = aliveInZone[0];
        const p2 = aliveInZone[1];
        room.pairTargets[p1.id] = p2.id;
        room.pairTargets[p2.id] = p1.id;
      } else {
        const soloList = EVENTS_MASTER.solo;
        const ev = soloList[Math.floor(Math.random() * soloList.length)];
        room.eventsByZone[z] = { ...ev };
      }
    }
  }
}

function startTurnTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timeLeft = TURN_DURATION_SEC;

  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      resolveTurn(room);
    } else if (room.timeLeft % 5 === 0 || room.timeLeft <= 5) {
      broadcastState(room);
    }
  }, 1000);
}

// ==========================================
// ターン解決処理
// ==========================================
function resolveTurn(room) {
  if (room.timer) clearInterval(room.timer);

  const turnLogs = [];
  const finishedTurn = room.turn;
  room.turnSummaries = {};
  room.huddlingActors = new Set(); // カエル団子成功者の完全防御リスト

  Object.values(room.actors).forEach(a => {
    room.turnSummaries[a.id] = {
      turn: finishedTurn,
      action: "特になし",
      event: "特になし",
      metabolism: "正常",
      danger: null,
      growth: null
    };
  });

  decideNpcActions(room);

  // 移動処理
  Object.values(room.actors).filter(a => a.alive).forEach(a => {
    const actData = room.actions[a.id];
    if (actData && actData.moveZone !== undefined) {
      const targetZ = parseInt(actData.moveZone, 10);
      const minStage = [1, 1, 3, 4, 5][targetZ];
      if (a.stage >= minStage && Math.abs(targetZ - a.zone) <= 1) {
        a.zone = targetZ;
      }
    }
  });

  // 行動解決（鳴く・協力捕食・カエル団子・攻撃・交配等）
  resolveActions(room, turnLogs);

  // イベント解決（単独2択＆ペア）
  resolveEvents(room, turnLogs);

  // 代謝・環境変化
  resolveMetabolism(room, turnLogs);

  // 天敵判定（カエル団子中の個体は除外・最大30%・1匹集中急襲）
  resolvePredators(room, turnLogs);

  // 成長・変態
  resolveGrowth(room, turnLogs);

  room.logs = [...turnLogs, ...room.logs].slice(0, 50);

  const aliveFrogs = Object.values(room.actors).filter(a => a.alive);
  if (room.turn >= TOTAL_TURNS || aliveFrogs.length <= 1) {
    room.status = "finished";
    finishGame(room);
    broadcastState(room);
    return;
  }

  room.turn++;
  room.weather = room.forecast;
  room.forecast = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  room.actions = {};
  room.eventChoices = {};
  room.coopRequests = {};
  room.coopAccepted = {};
  Object.values(room.actors).forEach(a => { a.ready = false; });

  setupTurnEvents(room);
  startTurnTimer(room);
  broadcastState(room);
}

// NPCの行動決定（同性の場合の裏切り減少ロジック）
function decideNpcActions(room) {
  Object.values(room.actors).filter(a => !a.isPlayer && a.alive).forEach(npc => {
    let targetZone = npc.zone;
    if (npc.water < 40 && npc.zone > 1) targetZone = Math.max(0, npc.zone - 1);
    else if (npc.food < 40 && npc.zone < 4) {
      const nextZ = npc.zone + 1;
      const minStage = [1, 1, 3, 4, 5][nextZ];
      if (npc.stage >= minStage) targetZone = nextZ;
    }

    let act = "feed";
    if (npc.water <= 30 && targetZone <= 1) act = "water";
    else if (npc.hp <= 40 || npc.stamina <= 30) act = "rest";
    else if (npc.stage >= 6 && Math.random() < 0.3) act = "mate";

    const preyList = PREY_MASTER[targetZone] || PREY_MASTER[0];
    const prey = preyList[Math.floor(Math.random() * preyList.length)];

    room.actions[npc.id] = {
      moveZone: targetZone,
      act: act,
      targetPreyId: prey.id,
      targetId: null
    };

    // イベント選択肢決定
    const ev = room.eventsByZone[targetZone];
    if (ev && ev.choices && ev.choices.length > 0) {
      if (ev.type === "pair") {
        const partnerId = room.pairTargets[npc.id];
        const partner = room.actors[partnerId];
        let stealChance = (npc.personality === "利己" || npc.personality === "獰猛") ? 0.7 : 0.2;

        // ★同性の場合、ペアイベントでの裏切り確率が減少（バディ補正）
        if (partner && partner.gender === npc.gender) {
          stealChance -= 0.25;
        }
        const aff = partner && partner.affinity && partner.affinity[npc.id] ? partner.affinity[npc.id] : 0;
        stealChance -= (aff * 0.005); // 親密度が高いほど裏切らない

        if (Math.random() < Math.max(0.05, stealChance)) {
          room.eventChoices[npc.id] = "steal";
        } else {
          room.eventChoices[npc.id] = "share";
        }
      } else {
        // 単独イベントの2択
        room.eventChoices[npc.id] = Math.random() < 0.5 ? ev.choices[0].id : ev.choices[1].id;
      }
    } else {
      room.eventChoices[npc.id] = "none";
    }
  });
}

function calculateFeedChance(actor, prey) {
  const staRatio = Math.max(0.1, (actor.stamina || 100) / 100);
  const myPower = ((actor.length || 1) * 5) + ((actor.weight || 0.5) * 3) + ((actor.stamina || 100) * 0.25);
  let baseChance = 60 + (myPower - prey.diff) * 2;

  if (staRatio < 0.5) {
    baseChance -= Math.round((0.5 - staRatio) * 40);
  }
  if (actor.trait === "大食漢") baseChance += 5;
  if (actor.trait === "慎重") baseChance -= 3;

  return Math.max(10, Math.min(95, Math.round(baseChance)));
}

// 行動解決
function resolveActions(room, logs) {
  const coopDone = new Set();

  // ① カエル団子の事前成立判定（完全防御の付与）
  Object.values(room.actors).filter(a => a.alive).forEach(a => {
    const actData = room.actions[a.id];
    if (actData && actData.act === "huddle" && actData.targetId) {
      const partner = room.actors[actData.targetId];
      if (partner && partner.alive && partner.zone === a.zone) {
        room.huddlingActors.add(a.id);
        room.huddlingActors.add(partner.id);
      }
    }
  });

  Object.values(room.actors).filter(a => a.alive).forEach(a => {
    const actData = room.actions[a.id] || { act: "rest" };
    const act = actData.act;

    // ① 協力捕食
    if (act === "feed" && room.coopAccepted[a.id] && room.coopAccepted[a.id].type === "feed" && !coopDone.has(a.id)) {
      const partner = room.actors[room.coopAccepted[a.id].partnerId];
      const preyId = room.coopAccepted[a.id].preyId;
      const preyList = PREY_MASTER[a.zone] || [];
      const prey = preyList.find(p => p.id === preyId) || preyList[preyList.length - 1];

      coopDone.add(a.id);
      coopDone.add(partner.id);

      a.stamina = Math.max(0, a.stamina - 12);
      partner.stamina = Math.max(0, partner.stamina - 12);

      const p1Power = (a.length * 5) + (a.weight * 3) + (a.stamina * 0.25);
      const p2Power = (partner.length * 5) + (partner.weight * 3) + (partner.stamina * 0.25);
      let chance = 60 + ((p1Power + p2Power) - prey.diff) * 2;

      // ★同性同士の協力捕食成功率アップボーナス（+10%）
      const isSameGender = (a.gender === partner.gender);
      if (isSameGender) {
        chance += 10;
      }
      chance = Math.max(30, Math.min(95, Math.round(chance)));

      if (Math.random() * 100 < chance) {
        const halfFood = Math.round(prey.food * 0.55);
        const halfExp = Math.round(prey.exp * 0.55);
        a.food = Math.min(100, a.food + halfFood); a.exp += halfExp;
        partner.food = Math.min(100, partner.food + halfFood); partner.exp += halfExp;
        addAffinity(a, partner, 8);

        const bonusTxt = isSameGender ? "【同性バディ連携+10%発動！】" : "";
        room.turnSummaries[a.id].action = `🤝 【協力捕食成功！】${partner.name} と ${prey.name} を山分け！${bonusTxt}（満腹+${halfFood}, EXP+${halfExp}, 親密度+8）`;
        room.turnSummaries[partner.id].action = `🤝 【協力捕食成功！】${a.name} と ${prey.name} を山分け！${bonusTxt}（満腹+${halfFood}, EXP+${halfExp}, 親密度+8）`;
        logs.push(`🤝 【協力狩り成功！】${a.name} と ${partner.name} が ${prey.name} を捕獲して山分け！${bonusTxt}`);
      } else {
        room.turnSummaries[a.id].action = `【協力捕食失敗】${partner.name} と挑んだが、${prey.name} に逃げられた。`;
        room.turnSummaries[partner.id].action = `【協力捕食失敗】${a.name} と挑んだが、${prey.name} に逃げられた。`;
      }
      return;
    }

    if (coopDone.has(a.id)) return;

    // ② 単独捕食
    if (act === "feed") {
      a.stamina = Math.max(0, a.stamina - 10);
      const preyList = PREY_MASTER[a.zone] || [];
      const prey = preyList.find(p => p.id === actData.targetPreyId) || preyList[0];
      const chance = calculateFeedChance(a, prey);

      if (Math.random() * 100 < chance) {
        let gainExp = prey.exp;
        let gainFood = prey.food;
        if (a.trait === "大食漢") { gainExp = Math.round(gainExp * 1.2); gainFood = Math.round(gainFood * 1.2); }
        a.food = Math.min(100, a.food + gainFood);
        a.exp += gainExp;
        room.turnSummaries[a.id].action = `【捕食成功】${prey.name} を捕らえた！（満腹+${gainFood}, EXP+${gainExp}）`;
      } else {
        room.turnSummaries[a.id].action = `【捕食失敗】${prey.name} を狙ったが、すんでのところで逃げられた。`;
      }
    }

    // ③ 新行動：鳴く（協力を求める・親密度+3）
    else if (act === "croak") {
      a.stamina = Math.max(0, a.stamina - 8);
      const target = room.actors[actData.targetId];
      if (target && target.alive && target.zone === a.zone) {
        addAffinity(a, target, 3);
        room.turnSummaries[a.id].action = `📢 【鳴く】${target.name} に向けて共鳴するように鳴き声を響かせた！（親密度+3, 気力-8）`;
        room.turnSummaries[target.id].event = `📢 ${a.name} から親愛の鳴き声が届いた。（親密度+3）`;
        logs.push(`📢 ${a.name} が ${target.name} に向けて協調の鳴き声を響かせた。`);
      } else {
        room.turnSummaries[a.id].action = "📢 【鳴く】周囲に響き渡る声で鳴いたが、届く仲間がいなかった。（気力-8）";
      }
    }

    // ④ 水を飲む
    else if (act === "water") {
      a.water = 100;
      a.stamina = Math.min(100, a.stamina + 10);
      room.turnSummaries[a.id].action = "【水分補給】喉を潤し、水分を全快にした。";
    }

    // ⑤ 休む・隠れる
    else if (act === "rest") {
      a.hp = Math.min(100, a.hp + 20);
      a.stamina = Math.min(100, a.stamina + 35);
      room.turnSummaries[a.id].action = "【休息】物陰でじっと休み、HPと気力を回復した。（HP+20, 気力+35）";
    }

    // ⑥ 見張り
    else if (act === "watch") {
      a.stamina = Math.max(0, a.stamina - 15);
      room.turnSummaries[a.id].action = "【見張り】周囲の警戒に集中し、天敵の接近に目を光らせた。";
    }

    // ⑦ カエル団子（完全防御付与）
    else if (act === "huddle") {
      const partner = room.actors[actData.targetId];
      if (partner && partner.alive && partner.zone === a.zone) {
        a.water = Math.min(100, a.water + 25);
        partner.water = Math.min(100, partner.water + 25);
        addAffinity(a, partner, 8);
        room.turnSummaries[a.id].action = `🛡️ 【カエル団子成立！】${partner.name} と密着して保湿＆完全防御！（水分+25, 親密度+8 / 天敵・他者攻撃を無効化）`;
      } else {
        a.water = Math.min(100, a.water + 15);
        room.turnSummaries[a.id].action = "【カエル団子】相手が見つからず、一人で体を丸めて保湿した。";
      }
    }

    // ⑧ 攻撃（カエル団子による無効化チェック）
    else if (act === "attack") {
      const target = room.actors[actData.targetId];
      if (target && target.alive && target.zone === a.zone) {
        // ★相手がカエル団子中なら完全防御される
        if (room.huddlingActors.has(target.id)) {
          room.turnSummaries[a.id].action = `【攻撃失敗】${target.name} はカエル団子で密集して防御していたため攻撃が弾かれた！`;
          room.turnSummaries[target.id].danger = `${a.name} から攻撃を受けたが、カエル団子の結束でノーダメージに抑え込んだ！`;
          logs.push(`🛡️ ${a.name} が ${target.name} を攻撃したが、カエル団子の防御に弾かれた！`);
        } else {
          target.hp -= 20;
          addAffinity(a, target, -30);
          room.turnSummaries[a.id].action = `【攻撃】${target.name} に体当たりしてダメージを与えた！（親密度-30）`;
          room.turnSummaries[target.id].danger = `${a.name} から不意打ち攻撃を受け、HP-20のダメージ！`;
          logs.push(`⚔️ ${a.name} が ${target.name} を攻撃！険悪な空気が流れた。`);
        }
      }
    }

    // ⑨ 求愛・繁殖
    else if (act === "mate") {
      const target = room.actors[actData.targetId];
      if (a.stage >= 6 && target && target.alive && target.zone === a.zone && target.stage >= 6 && target.gender !== a.gender) {
        const aff = (a.affinity && a.affinity[target.id]) || 0;
        let baseEggs = 18;
        if (aff >= 70) baseEggs = Math.floor(46 + Math.random() * 15);
        else if (aff >= 40) baseEggs = Math.floor(31 + Math.random() * 15);
        else if (aff >= 20) baseEggs = Math.floor(21 + Math.random() * 10);

        a.offspringCount += baseEggs;
        target.offspringCount += baseEggs;
        a.stamina = Math.max(0, a.stamina - 30);
        target.stamina = Math.max(0, target.stamina - 30);
        addAffinity(a, target, 20);

        room.turnSummaries[a.id].action = `💖 【交配成功！】${target.name} と愛を交わし、卵を ${baseEggs} 個産卵した！（親密度+20）`;
        room.turnSummaries[target.id].action = `💖 【交配成功！】${a.name} と愛を交わし、卵を ${baseEggs} 個産卵した！（親密度+20）`;
        logs.push(`💕 【愛の結晶】${a.name} と ${target.name} が結ばれ、${baseEggs} 個の卵が産み落とされた！`);
      } else {
        room.turnSummaries[a.id].action = "【求愛失敗】相手に受け入れられず、虚しく鳴き声が響いた。";
      }
    }
  });
}

// イベント解決
function resolveEvents(room, logs) {
  const resolvedPair = new Set();

  for (let z = 0; z < 5; z++) {
    const ev = room.eventsByZone[z];
    if (!ev) continue;

    const aliveInZone = Object.values(room.actors).filter(a => a.alive && a.zone === z);

    if (ev.type === "pair" && ev.resolvePair) {
      aliveInZone.forEach(a => {
        const pId = room.pairTargets[a.id];
        if (pId && !resolvedPair.has(a.id) && !resolvedPair.has(pId)) {
          const partner = room.actors[pId];
          if (partner && partner.alive && partner.zone === z) {
            resolvedPair.add(a.id);
            resolvedPair.add(partner.id);
            const c1 = room.eventChoices[a.id] || "share";
            const c2 = room.eventChoices[partner.id] || "share";
            const res = ev.resolvePair(a, c1, partner, c2);
            room.turnSummaries[a.id].event = res.log1;
            room.turnSummaries[partner.id].event = res.log2;
          }
        }
      });
    }

    aliveInZone.forEach(a => {
      if (!resolvedPair.has(a.id) && ev.resolve) {
        const c = room.eventChoices[a.id] || (ev.choices ? ev.choices[0].id : "none");
        const msg = ev.resolve(a, c);
        room.turnSummaries[a.id].event = msg;
      }
    });
  }
}

// 代謝処理
function resolveMetabolism(room, logs) {
  Object.values(room.actors).filter(a => a.alive).forEach(a => {
    let foodDrain = a.trait === "大食漢" ? 14 : 10;
    if (room.weather === "日照り") foodDrain += 4;
    a.food = Math.max(0, a.food - foodDrain);

    let waterDrain = 0;
    if (a.zone === 4) waterDrain = 18;
    else if (a.zone === 3) waterDrain = 8;
    if (room.weather === "雨" || room.weather === "豪雨") waterDrain = 0;
    if (room.weather === "快晴" && a.zone === 4) waterDrain = Math.round(waterDrain * 1.5);
    if (room.weather === "日照り") waterDrain = Math.round(waterDrain * 2);
    if (a.trait === "頑強") waterDrain = Math.round(waterDrain * 0.6);
    a.water = Math.max(0, a.water - waterDrain);

    let metaDamage = 0;
    if (a.food <= 0) metaDamage += (a.trait === "高代謝" ? 22 : 15);
    if (a.water <= 0) metaDamage += (a.trait === "高代謝" ? 25 : 18);

    if (metaDamage > 0) {
      a.hp -= metaDamage;
      room.turnSummaries[a.id].metabolism = `飢餓・乾燥により HP-${metaDamage} のダメージ！`;
      if (a.hp <= 0) {
        handleDeath(room, a, "飢餓と乾燥による衰弱死", logs);
      }
    } else {
      room.turnSummaries[a.id].metabolism = `満腹-${foodDrain}, 水分-${waterDrain} 消費`;
    }
  });
}

// 天敵判定（カエル団子中の個体は除外・最大30%・1匹集中急襲）
function resolvePredators(room, logs) {
  if (room.weather === "豪雨") return;

  const ZONE_PREDATOR_CHANCE = {
    0: 0.05, 1: 0.10, 2: 0.18, 3: 0.24, 4: 0.30
  };
  const PREDATOR_NAMES = ["泥底の巨大ヤゴ", "水中の肉食魚", "空からのアオサギ", "水際のイタチ", "草むらのヘビ"];

  for (let z = 0; z < 5; z++) {
    const chance = ZONE_PREDATOR_CHANCE[z];
    if (Math.random() < chance) {
      // ★カエル団子で身を守っているカエルは天敵のターゲットから除外！
      const candidates = Object.values(room.actors).filter(a => a.alive && a.zone === z && !room.huddlingActors.has(a.id));
      if (candidates.length === 0) {
        // エリア内にいたが全員団子中だった場合
        const huddlers = Object.values(room.actors).filter(a => a.alive && a.zone === z);
        if (huddlers.length > 0) {
          logs.push(`🛡️ 【天敵回避！】${PREDATOR_NAMES[z]} が飛来したが、カエル団子の擬態・結束に欺かれ立ち去った！`);
        }
        continue;
      }

      const watcher = candidates.find(a => room.actions[a.id] && room.actions[a.id].act === "watch");
      if (watcher) {
        logs.push(`🛡️ 【天敵撃退！】${watcher.name} の見張りにより、${PREDATOR_NAMES[z]} の接近を察知し全員が退避した！`);
        continue;
      }

      const victim = candidates[Math.floor(Math.random() * candidates.length)];

      if (victim.trait === "身軽" && Math.random() < 0.25) {
        logs.push(`💨 【危機一髪！】${victim.name} は持ち前の身軽さで ${PREDATOR_NAMES[z]} の牙を紙一重でかわした！`);
        continue;
      }

      const damage = Math.floor(75 + Math.random() * 16);
      victim.hp -= damage;
      logs.push(`🚨 【天敵急襲！】${victim.name} が ${PREDATOR_NAMES[z]} に襲われ、${damage} の致命傷を負った！`);

      if (room.turnSummaries[victim.id]) {
        room.turnSummaries[victim.id].danger = `${PREDATOR_NAMES[z]} に急襲され、HP-${damage} の大ダメージ！`;
      }

      if (victim.hp <= 0) {
        handleDeath(room, victim, `${PREDATOR_NAMES[z]} に捕食された`, logs);
      }
    }
  }
}

// 死亡・リスポーン処理
function handleDeath(room, actor, reason, logs) {
  Object.values(room.actors).filter(other => other.alive && other.id !== actor.id).forEach(other => {
    const aff = (other.affinity && other.affinity[actor.id]) || 0;
    if (aff >= 1) {
      const sadLog = `🥀【訃報】親交のあった仲間「${actor.name}」が「${reason}」により命を落としました……`;
      if (room.turnSummaries[other.id]) {
        room.turnSummaries[other.id].event = (room.turnSummaries[other.id].event || "") + " " + sadLog;
      }
      logs.push(sadLog);
    }
  });

  if (actor.eggs > 0 && actor.stage < 4) {
    actor.eggs -= 1;
    actor.level = Math.max(1, actor.level - 1);
    actor.exp = 0; // EXPリセット

    actor.stage = getStageByLevel(actor.level);
    actor.length = +(1.0 + (actor.level - 1) * 0.35).toFixed(1);
    actor.weight = +(0.5 + (actor.level - 1) * 0.5).toFixed(1);

    actor.hp = 100;
    actor.food = 70;
    actor.water = 100;
    actor.stamina = 100;
    actor.zone = 0;
    actor.alive = true;

    logs.push(`🥚 【転生】${actor.name} は卵ストックを消費して水底から復活した（Lv.${actor.level}に出遅れ / 残機:${actor.eggs}）`);
    if (room.turnSummaries[actor.id]) {
      room.turnSummaries[actor.id].danger = `${reason}により死亡したが、卵の残機で水底からリスポーンした（Lv.${actor.level}）。`;
    }
  } else {
    actor.alive = false;
    actor.hp = 0;
    logs.push(`💀 【永久死亡】${actor.name} は力尽き、池の底へと沈んでいった……（${reason}）`);
    if (room.turnSummaries[actor.id]) {
      room.turnSummaries[actor.id].danger = `${reason}により死亡退場しました。`;
    }
  }
}

// 成長判定
function resolveGrowth(room, logs) {
  Object.values(room.actors).filter(a => a.alive).forEach(a => {
    let req = getExpReq(a.level);
    if (a.trait === "高代謝") req = Math.round(req * 0.8);

    let leveledUp = false;
    while (a.exp >= req) {
      a.exp -= req;
      a.level++;
      leveledUp = true;
      req = getExpReq(a.level);

      const oldStage = a.stage;
      a.stage = getStageByLevel(a.level);

      let lenPlus = 0.35;
      let wtPlus = 0.5;
      if (a.trait === "大食漢") { lenPlus *= 1.2; wtPlus *= 1.2; }
      if (a.trait === "身軽") { wtPlus *= 0.8; }
      a.length = +(a.length + lenPlus).toFixed(1);
      a.weight = +(a.weight + wtPlus).toFixed(1);

      if (a.stage > oldStage) {
        const stageNames = ["", "オタマジャクシ", "後足が生えた", "前足が生えた", "変態期(尾あり)", "子ガエル", "成体カエル"];
        logs.push(`✨ 【変態進化！】${a.name} は ${stageNames[a.stage]} へと劇的な変態を遂げた！`);
        a.history.push(`TURN ${room.turn}: ${stageNames[a.stage]} へ変態（体長 ${a.length}cm / 体重 ${a.weight}g）`);
      }
    }

    if (leveledUp) {
      room.turnSummaries[a.id].growth = `レベルアップ！ Lv.${a.level} に到達！（体長 ${a.length}cm / 体重 ${a.weight}g）`;
    }
  });
}

function finishGame(room) {
  const ranking = Object.values(room.actors).map(a => {
    const survivalTurn = a.alive ? TOTAL_TURNS : Math.max(1, room.turn - 1);
    const survivalBonus = a.alive ? 1500 : 0;
    const score = (survivalTurn * 100) + (a.offspringCount * 50) + (a.level * 150) + survivalBonus;
    return {
      id: a.id,
      name: a.name,
      gender: a.gender,
      level: a.level,
      alive: a.alive,
      offspring: a.offspringCount,
      score: score,
      history: a.history
    };
  });

  ranking.sort((a, b) => b.score - a.score);
  room.ranking = ranking;
  logsPush(room, "🏁 池の表面が厚い氷に覆われ、サバイバルセッションが終了した。");
}

function logsPush(room, txt) {
  room.logs.unshift(txt);
  if (room.logs.length > 50) room.logs.pop();
}

function getSanitizedRoomState(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    turn: room.turn,
    timeLeft: room.timeLeft,
    weather: room.weather,
    forecast: room.forecast,
    actors: room.actors,
    coopRequests: room.coopRequests,
    eventsByZone: room.eventsByZone,
    pairTargets: room.pairTargets,
    turnSummaries: room.turnSummaries,
    logs: room.logs,
    ranking: room.ranking || null
  };
}

function broadcastState(room) {
  const state = getSanitizedRoomState(room);
  const jsonStr = JSON.stringify({ type: "STATE_UPDATE", state: state });
  Object.values(room.clients).forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonStr);
    }
  });
}

server.listen(PORT, () => {
  console.log(`FROG LIFE Server running on port ${PORT}`);
});