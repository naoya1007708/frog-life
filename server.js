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
const MAX_PLAYERS = 8;

const WEATHERS = ["快晴", "曇り", "雨", "日照り", "豪雨"];
const TRAITS = ["頑強", "大食漢", "身軽", "高代謝", "慎重"];
const PERSONALITIES = ["温厚", "利己", "獰猛", "慎重"];
const EXP_GAIN_MULTIPLIER = 1.35;

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
    { id: "fly", name: "小型ハエ", diff: 40, food: 40, exp: 28 },
    { id: "large_mayfly", name: "\u5927\u578b\u30c8\u30d3\u30b1\u30e9\u5e7c\u866b", diff: 58, food: 60, exp: 40 },
  ],
  4: [
    { id: "cricket", name: "コオロギ", diff: 50, food: 55, exp: 35 },
    { id: "grasshopper", name: "大型バッタ", diff: 65, food: 65, exp: 45 },
    { id: "earthworm", name: "巨大ミミズ (大物)", diff: 85, food: 85, exp: 60 }
  ]
};

// ==========================================
// イベントマスター（単独イベント＆ペアイベント）
// ==========================================
const EVENTS_MASTER = {
  solo: [
    {
      id: "solo_sunbath",
      title: "【心地よい木漏れ日】",
      desc: "温かな光が差し込み、冷えた体を心地よく温めてくれる。",
      choices: [
        { id: "rest", text: "光を浴びてじっと休む (HP+20, 気力+30)" },
        { id: "ignore", text: "油断せず警戒を続ける" }
      ],
      resolve: (actor, choice) => {
        if (choice === "rest") {
          actor.hp = Math.min(100, actor.hp + 20);
          actor.stamina = Math.min(100, actor.stamina + 30);
          return "木漏れ日を浴びて気力と体力が回復した！（HP+20, 気力+30）";
        }
        return "警戒を怠らず、周囲に目を配った。";
      }
    },
    {
      id: "solo_drift_food",
      title: "【流れてきたごちそう】",
      desc: "目の前に栄養満点な昆虫の脱皮殻が引っかかっている！",
      choices: [
        { id: "eat", text: "すばやく平らげる (満腹+25, EXP+16)" },
        { id: "pass", text: "罠を警戒して見送る" }
      ],
      resolve: (actor, choice) => {
        if (choice === "eat") {
          actor.food = Math.min(100, actor.food + 25);
          addExperience(actor, 12);
          return "栄養満点のごちそうを独り占めした！（満腹+25, EXP+16）";
        }
        return "怪しい餌には手を出さず、安全を優先した。";
      }
    },
    {
      id: "solo_spring_water",
      title: "【清らかな湧き水】",
      desc: "岩肌から冷たく澄んだ清水が湧き出しているのを発見した。",
      choices: [
        { id: "drink", text: "思い切り水を飲む (水分全快, HP+10)" }
      ],
      resolve: (actor) => {
        actor.water = 100;
        actor.hp = Math.min(100, actor.hp + 10);
        return "冷たい清水で喉を潤し、水分が全快した！（HP+10）";
      }
    },
    {
      id: "solo_mud_trap",
      title: "【泥のぬかるみ】",
      desc: "足元の泥が予想以上に深く、体がズブズブと沈み込んでいく！",
      choices: [
        { id: "struggle", text: "力づくで脱出を試みる (気力-25, 満腹-15)" },
        { id: "calm", text: "息を整えて慎重に抜ける (気力-15, ダメージ10)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "struggle") {
          actor.stamina = Math.max(0, actor.stamina - 25);
          actor.food = Math.max(0, actor.food - 15);
          return "泥からもがいて抜け出したが、大量のエネルギーを消費した。";
        } else {
          actor.stamina = Math.max(0, actor.stamina - 15);
          actor.hp = Math.max(0, actor.hp - 10);
          return "皮膚を擦りむきながらも、なんとかぬかるみから脱出した。（HP-10）";
        }
      }
    },
    {
      id: "solo_gust_wind",
      title: "【激しい突風】",
      desc: "池を吹き抜ける強風が体を激しく打ちつける！",
      choices: [
        { id: "hold", text: "岩にしがみついて耐える (気力-20)" },
        { id: "curl", text: "体を丸めてやり過ごす (水分-20)" }
      ],
      resolve: (actor, choice) => {
        if (choice === "hold") {
          actor.stamina = Math.max(0, actor.stamina - 20);
          return "強風に踏ん張って耐え抜いたが、足腰が疲弊した。（気力-20）";
        } else {
          actor.water = Math.max(0, actor.water - 20);
          return "風で皮膚の水分が一気に蒸発してしまった！（水分-20）";
        }
      }
    },
    {
      id: "solo_leech",
      title: "【潜む寄生ヒル】",
      desc: "ぬかるみに潜んでいたヒルが足に吸い付いて血を吸おうとしている！",
      choices: [
        { id: "shake", text: "力いっぱい振り払う (HP-15, 気力-10)" }
      ],
      resolve: (actor) => {
        actor.hp = Math.max(0, actor.hp - 15);
        actor.stamina = Math.max(0, actor.stamina - 10);
        return "ヒルをなんとか引き剥がしたが、皮膚に傷を負った（HP-15）。";
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
            log1: `${a2.name} と仲良く餌を分け合った！（満腹+15, 親密度+15）`,
            log2: `${a1.name} と仲良く餌を分け合った！（満腹+15, 親密度+15）`
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
  a1.affinity[a2.id] = Math.max(0, Math.min(100, (a1.affinity[a2.id] || 0) + delta));
  a2.affinity[a1.id] = Math.max(0, Math.min(100, (a2.affinity[a1.id] || 0) + delta));
}

function addExperience(actor, amount) {
  actor.exp += Math.max(0, Math.round(amount * EXP_GAIN_MULTIPLIER));
}

function appendSocialLog(summary, text) {
  if (summary) summary.socialLog = summary.socialLog ? `${summary.socialLog} ${text}` : text;
}

function isCoopActionCommitted(room, actorId) {
  if (!room || !actorId) return false;
  if (room.coopAccepted && room.coopAccepted[actorId]) return true;
  if (Object.values(room.coopRequests || {}).some(request => request.fromId === actorId)) return true;
  const actor = room.actors && room.actors[actorId];
  const action = room.actions && room.actions[actorId];
  return Boolean(actor && actor.ready && action && (
    action.act === "huddle" || action.act === "mate" || action.coopRequested
  ));
}

function calculateCoopAcceptanceChance(room, requester, target, type) {
  if (!room || !requester || !target || !requester.alive || !target.alive || requester.id === target.id || requester.zone !== target.zone) return 0;
  if (type === "mate" && (requester.stage < 6 || target.stage < 6 || requester.gender === target.gender || requester.stamina < 50)) return 0;
  if (isCoopActionCommitted(room, requester.id) || isCoopActionCommitted(room, target.id) || room.coopRequests[target.id]) return 0;
  if (target.isPlayer) return null;

  const affinity = (target.affinity && target.affinity[requester.id]) || 0;
  const baseChance = target.personality === PERSONALITIES[0] ? 50 : target.personality === PERSONALITIES[1] ? 20 : 35;
  let chance = baseChance + affinity * 0.5;
  if (type === "huddle" && target.water <= 50) chance += 20;
  if (type === "feed" && target.food <= 50) chance += 20;
  return Math.max(5, Math.min(95, Math.round(chance)));
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
    stage: 1, // 1:オタマ, 2:後足, 3:前足, 4:変態期, 5:子ガエル, 6:成体
    exp: 0,
    eggs: 2, // 残機
    hp: 100,
    food: 80,
    water: 100,
    stamina: 100,
    length: 1.0,
    weight: 0.5,
    zone: 0, // ①水底からスタート
    alive: true,
    ready: false,
    offspringCount: 0,
    killBonusScore: 0,
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
        myActorId = `${data.spectator ? "s" : "p"}_${Math.random().toString(36).substring(2, 8)}`;
        if (data.spectator && !rooms[myRoomId]) {
          ws.send(JSON.stringify({ type: "JOIN_ERROR", message: "観戦できるゲームが見つかりません。" }));
          myRoomId = null;
          return;
        }

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
            eventsByZone: {},
            eventsByActor: {},
            pairTargets: {},
            turnSummaries: {},
            playerActionLogs: [],
            logs: ["池の卵塊から新たな命が生まれようとしている……"],
            timer: null
          };
        }

        const room = rooms[myRoomId];
        if (!data.spectator && room.status !== "waiting") {
          ws.send(JSON.stringify({ type: "JOIN_ERROR", message: "ゲーム開始後はプレイヤーとして参加できません。観戦モードを選んでください。" }));
          myRoomId = null;
          return;
        }
        const roomPlayerCount = Object.values(room.actors).filter(actor => actor.isPlayer).length;
        if (!data.spectator && roomPlayerCount >= MAX_PLAYERS) {
          ws.send(JSON.stringify({ type: "JOIN_ERROR", message: `このルームは満員です（プレイヤー最大${MAX_PLAYERS}人）。` }));
          myRoomId = null;
          return;
        }
        room.clients[myActorId] = ws;
        room.actors[myActorId] = createActor(myActorId, data.name || "アマガエル", true);

        if (data.spectator) delete room.actors[myActorId];
        ws.send(JSON.stringify({ type: "INIT", myId: myActorId, spectator: !!data.spectator }));
        broadcastState(room);
      }

      else if (data.type === "LEAVE_ROOM" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "waiting") {
          delete room.clients[myActorId];
          delete room.actors[myActorId];
          delete room.actions[myActorId];
          delete room.eventChoices[myActorId];

          const remainingPlayers = Object.values(room.actors).filter(actor => actor.isPlayer);
          if (room.hostId === myActorId) room.hostId = remainingPlayers[0]?.id || null;

          ws.send(JSON.stringify({ type: "LEFT_ROOM" }));
          if (remainingPlayers.length === 0) {
            Object.values(room.clients).forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "ROOM_CLOSED", message: "参加者がいなくなったため、ルームを閉じました。" }));
                client.close();
              }
            });
            if (room.timer) clearInterval(room.timer);
            delete rooms[room.id];
          } else {
            broadcastState(room);
          }
          myRoomId = null;
          myActorId = null;
          ws.close();
        }
      }

      else if (data.type === "START_GAME" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.hostId === myActorId && room.status === "waiting" && Object.values(room.actors).some(actor => actor.isPlayer)) {
          // NPC補填（計25匹）
          const currentCount = Object.keys(room.actors).length;
          room.playerCountAtStart = Object.values(room.actors).filter(a => a.isPlayer).length;
          const npcNames = ["アオ", "ミドリ", "クロ", "シロ", "チビ", "ゴン", "モモ", "タマ", "ハル", "ナツ", "アキ", "フユ", "カゲ", "ツユ", "レン", "サクラ", "スミレ", "カエデ", "ヤマト", "ムサシ", "ソラ", "カイ", "リク", "シン"];
          for (let i = currentCount; i < TOTAL_FROGS; i++) {
            const npcId = `npc_${i + 1}`;
            const name = npcNames[i % npcNames.length] + (Math.floor(i / npcNames.length) > 0 ? (Math.floor(i / npcNames.length) + 1) : "");
            room.actors[npcId] = createActor(npcId, name, false);
          }

          const maleGender = String.fromCodePoint(0x2642);
          const femaleGender = String.fromCodePoint(0x2640);
          const genderPool = [
            ...Array(Math.floor(TOTAL_FROGS / 2)).fill(maleGender),
            ...Array(Math.ceil(TOTAL_FROGS / 2)).fill(femaleGender)
          ];
          for (let i = genderPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [genderPool[i], genderPool[j]] = [genderPool[j], genderPool[i]];
          }
          Object.values(room.actors).forEach((actor, index) => { actor.gender = genderPool[index]; });

          room.status = "playing";
          room.turn = 1;
          setupTurnEvents(room);
          startTurnTimer(room);
          broadcastState(room);
        }
      }

      else if (data.type === "SEND_COOP_REQUEST" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "playing" && (data.turn === undefined || Number(data.turn) === room.turn)) {
          const fromActor = room.actors[myActorId];
          const targetActor = room.actors[data.targetId];

          const validCoopType = ["feed", "huddle", "mate"].includes(data.coopType);
          const validMate = data.coopType !== "mate" || (fromActor && targetActor && fromActor.stage >= 6 && targetActor.stage >= 6 && fromActor.gender !== targetActor.gender && fromActor.stamina >= 50);
          if (validCoopType && validMate && fromActor && targetActor && fromActor.id !== targetActor.id && fromActor.alive && targetActor.alive && fromActor.zone === targetActor.zone) {
            const targetBusy = isCoopActionCommitted(room, targetActor.id) || Boolean(room.coopRequests[targetActor.id]);
            const requesterBusy = isCoopActionCommitted(room, fromActor.id);
            if (targetBusy || requesterBusy) {
              addAffinity(targetActor, fromActor, -6);
              ws.send(JSON.stringify({ type: "COOP_RESPONSE_NOTIFY", accepted: false, targetName: targetActor.name }));
            } else if (targetActor.isPlayer) {
              room.coopRequests[targetActor.id] = {
                fromId: fromActor.id,
                fromName: fromActor.name,
                type: data.coopType,
                preyId: data.preyId,
                turn: room.turn
              };
              broadcastState(room);
            } else {
              // NPCの受託判定
              const chance = calculateCoopAcceptanceChance(room, fromActor, targetActor, data.coopType) || 0;
              if (Math.random() * 100 < chance) {
                room.coopAccepted[fromActor.id] = { partnerId: targetActor.id, initiatorId: fromActor.id, type: data.coopType, preyId: data.preyId };
                room.coopAccepted[targetActor.id] = { partnerId: fromActor.id, initiatorId: fromActor.id, type: data.coopType, preyId: data.preyId };
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
        if (room && room.coopRequests[myActorId] && room.coopRequests[myActorId].turn === room.turn) {
          const req = room.coopRequests[myActorId];
          const fromActor = room.actors[req.fromId];
          const targetActor = room.actors[myActorId];

          const validMate = req.type !== "mate" || (fromActor && targetActor && fromActor.stage >= 6 && targetActor.stage >= 6 && fromActor.gender !== targetActor.gender && fromActor.stamina >= 50);
          if (data.accept && fromActor && fromActor.alive && targetActor && targetActor.alive && fromActor.zone === targetActor.zone && validMate) {
            room.coopAccepted[fromActor.id] = { partnerId: targetActor.id, initiatorId: fromActor.id, type: req.type, preyId: req.preyId };
            room.coopAccepted[targetActor.id] = { partnerId: fromActor.id, initiatorId: fromActor.id, type: req.type, preyId: req.preyId };
            room.actions[targetActor.id] = room.actions[targetActor.id] || {};
            room.actors[targetActor.id].ready = true;
            applyAcceptedCoopActions(room);
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
          const alivePlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
          if (alivePlayers.length > 0 && alivePlayers.every(p => p.ready) && Object.keys(room.coopRequests).length === 0) {
            resolveTurn(room);
          } else {
            broadcastState(room);
          }
        }
      }

      else if (data.type === "SUBMIT_ACTION" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.status === "playing" && (data.turn === undefined || Number(data.turn) === room.turn)) {
          const submittingActor = room.actors[myActorId];
          if (!submittingActor || !submittingActor.isPlayer || !submittingActor.alive || submittingActor.ready) return;
          room.actions[myActorId] = { ...(data.action || { act: "rest" }), coopRequested: Boolean(data.coopRequested) };
          if (room.actions[myActorId].act === "call" && submittingActor.stage < 5) {
            room.actions[myActorId] = { ...room.actions[myActorId], act: "rest" };
          }
          room.eventChoices[myActorId] = data.eventChoice || "none";
          if (room.actors[myActorId]) room.actors[myActorId].ready = true;

          // 全プレイヤーが確定したかチェック
          const alivePlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
          const allReady = alivePlayers.every(p => p.ready);
          const hasPendingCoop = Object.keys(room.coopRequests).length > 0;
          if (allReady && !hasPendingCoop) {
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
      if (room.status === "waiting" && room.actors[myActorId]?.isPlayer) {
        delete room.actors[myActorId];
        const remainingPlayers = Object.values(room.actors).filter(actor => actor.isPlayer);
        if (room.hostId === myActorId) room.hostId = remainingPlayers[0]?.id || null;
        if (remainingPlayers.length === 0) {
          Object.values(room.clients).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "ROOM_CLOSED", message: "参加者がいなくなったため、ルームを閉じました。" }));
              client.close();
            }
          });
          if (room.timer) clearInterval(room.timer);
          delete rooms[room.id];
          return;
        }
      } else if (room.actors[myActorId]) {
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

    // ★修正：同エリアに自分1匹しかいない場合は必ず単独イベント！
    if (aliveInZone.length <= 1) {
      const soloList = EVENTS_MASTER.solo;
      const ev = soloList[Math.floor(Math.random() * soloList.length)];
      room.eventsByZone[z] = { ...ev };
    } else {
      // 2匹以上いるなら65%でペアイベント
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

// ==========================================
// ターンタイマー管理
// ==========================================
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
// ターン解決処理（コアルール）
// ==========================================
function applyAcceptedCoopActions(room) {
  const handled = new Set();
  Object.entries(room.coopAccepted || {}).forEach(([actorId, accepted]) => {
    const initiator = room.actors[accepted.initiatorId || actorId];
    const partner = room.actors[accepted.partnerId];
    if (!initiator || !partner || handled.has(initiator.id) || handled.has(partner.id) || !initiator.alive || !partner.alive) return;
    handled.add(initiator.id);
    handled.add(partner.id);
    const initiatorAction = room.actions[initiator.id] || {};
    const partnerAction = room.actions[partner.id] || {};
    const sharedMoveZone = initiatorAction.moveZone !== undefined ? initiatorAction.moveZone : initiator.zone;
    if (accepted.type === "feed") {
      room.actions[initiator.id] = { ...initiatorAction, act: "feed", targetPreyId: accepted.preyId, targetId: partner.id };
      room.actions[partner.id] = { ...partnerAction, moveZone: sharedMoveZone, act: "feed", targetPreyId: accepted.preyId, targetId: initiator.id };
    } else if (accepted.type === "huddle") {
      room.actions[initiator.id] = { ...initiatorAction, act: "huddle", targetId: partner.id };
      room.actions[partner.id] = { ...partnerAction, moveZone: sharedMoveZone, act: "huddle", targetId: initiator.id };
    } else if (accepted.type === "mate") {
      room.actions[initiator.id] = { ...initiatorAction, act: "mate", targetId: partner.id };
      room.actions[partner.id] = { ...partnerAction, moveZone: sharedMoveZone, act: "mate", targetId: initiator.id, coopResponder: true };
    }
  });
}

function resolveTurn(room) {
  if (!room || room.status !== "playing" || room.isResolving) return;
  room.isResolving = true;
  if (room.timer) clearInterval(room.timer);

  const turnLogs = [];
  const finishedTurn = room.turn;
  room.turnSummaries = {};

  // ① 全カエルのサマリー初期化
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

  // ② NPCの行動・イベント選択決定
  decideNpcActions(room);
  applyAcceptedCoopActions(room);

  // ③ 移動処理
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

  // ④ 行動解決（捕食・団子・求愛・攻撃など）
  resolveActions(room, turnLogs);
  resolveZeroHpActors(room, turnLogs);

  // ⑤ イベント解決（単独イベント＆ペアイベント）
  resolveEvents(room, turnLogs);
  resolveZeroHpActors(room, turnLogs);

  // ⑥ 代謝・環境変化（乾燥・天候・飢餓）
  resolveMetabolism(room, turnLogs);
  resolveZeroHpActors(room, turnLogs);

  // ⑦ 天敵判定（上に行くほど危険・最大30%・1匹のみ大ダメージ）
  resolvePredators(room, turnLogs);

  // ⑧ 成長・変態・レベルアップ
  resolveGrowth(room, turnLogs);

  // ログの追加
  room.lastResolvedTurn = finishedTurn;
  const playerTurnLogs = Object.values(room.actors).filter(actor => actor.isPlayer).map(actor => {
    const summary = room.turnSummaries[actor.id];
    const action = summary && summary.action ? summary.action : "";
    return `\u3010\u7b2c${finishedTurn}\u30bf\u30fc\u30f3\u3011${actor.name}: ${action}`;
  });
  // One concise player-only entry per turn; preserve turn labels and discard duplicate rows.
  room.playerActionLogs = [...new Set([...playerTurnLogs, ...(room.playerActionLogs || [])])].slice(0, 24);
  room.logs = [...turnLogs, ...room.logs].slice(0, 50);

  // ⑨ ゲーム終了チェック
  const aliveFrogs = Object.values(room.actors).filter(a => a.alive);
  const alivePlayers = Object.values(room.actors).filter(a => a.isPlayer && a.alive);
  const playerEliminated = alivePlayers.length === 0 || ((room.playerCountAtStart || 0) > 1 && alivePlayers.length <= 1);
  if (room.turn >= TOTAL_TURNS || playerEliminated || aliveFrogs.length <= 1) {
    room.status = "finished";
    finishGame(room);
    broadcastState(room);
    return;
  }

  // ⑩ 次ターンの準備
  room.turn++;
  room.weather = room.forecast;
  room.forecast = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  room.actions = {};
  room.eventChoices = {};
  room.coopRequests = {};
  room.coopAccepted = {};
  room.isResolving = false;
  Object.values(room.actors).forEach(a => { a.ready = false; });

  setupTurnEvents(room);
  startTurnTimer(room);
  broadcastState(room);
}

// NPCの行動決定
function decideNpcActions(room) {
  Object.values(room.actors).filter(a => !a.isPlayer && a.alive).forEach(npc => {
    let targetZone = npc.zone;
    // 水分が低ければ水辺へ、満腹が低ければ餌の多い場所へ
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
      if (npc.personality === "利己" || npc.personality === "獰猛") {
        room.eventChoices[npc.id] = ev.choices[ev.choices.length - 1].id;
      } else {
        room.eventChoices[npc.id] = ev.choices[0].id;
      }
    } else {
      room.eventChoices[npc.id] = "none";
    }
  });
}

// 捕食成功率計算（気力ペナルティ反映）
function calculateFeedChance(actor, prey) {
  const start = actor.turnStartStats || actor;
  const startStamina = start.stamina === undefined ? 100 : start.stamina;
  const length = start.length || 1;
  const weight = start.weight || 0.5;
  // 餌の難易度に加え、満腹度と成長経験値のリターンも成功率に反映する。
  // 大きな獲物でも成功率が一律上限に張り付かないよう係数を調整。
  const rewardValue = prey.food + prey.exp * 0.5;
  let baseChance = 68
    + (startStamina - 50) * 0.32
    + (length - 1) * 3
    + (weight - 0.5) * 2
    - prey.diff * 0.45
    - rewardValue * 0.08;
  if (actor.trait === "大食漢") baseChance += 5;
  if (actor.trait === "慎重") baseChance -= 3;

  return Math.max(1, Math.min(99, Math.round(baseChance)));
}

function calculateCoopFeedChance(actor, partner, prey) {
  const actorStart = actor.turnStartStats || actor;
  const partnerStart = partner.turnStartStats || partner;
  const actorPower = (actorStart.length * 5) + (actorStart.weight * 3) + (actorStart.stamina * 0.5);
  const partnerPower = (partnerStart.length * 5) + (partnerStart.weight * 3) + (partnerStart.stamina * 0.5);
  let chance = 60 + ((actorPower + partnerPower) - prey.diff) * 2;
  if (actor.gender === partner.gender) chance += 10;
  return Math.max(30, Math.min(95, Math.round(chance)));
}

// 行動解決
function resolveActions(room, logs) {
  const coopDone = new Set();
  const attackersByTarget = new Map();

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

      const chance = calculateCoopFeedChance(a, partner, prey);

      if (Math.random() * 100 < chance) {
        const halfFood = Math.round(prey.food * 0.55);
        const halfExp = Math.round(prey.exp * 0.55);
        a.food = Math.min(100, a.food + halfFood); addExperience(a, halfExp);
        partner.food = Math.min(100, partner.food + halfFood); addExperience(partner, halfExp);
        addAffinity(a, partner, 8);

        const awardedHalfExp = Math.round(halfExp * EXP_GAIN_MULTIPLIER);
        room.turnSummaries[a.id].action = `【協力捕食成功！】${partner.name} と ${prey.name} を山分け！（満腹+${halfFood}, EXP+${awardedHalfExp}, 親密度+8）`;
        room.turnSummaries[partner.id].action = `【協力捕食成功！】${a.name} と ${prey.name} を山分け！（満腹+${halfFood}, EXP+${awardedHalfExp}, 親密度+8）`;
        logs.push(`🤝 【協力狩り成功！】${a.name} と ${partner.name} が ${prey.name} を捕獲して山分け！`);
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
        let gainExp = Math.round(prey.exp * EXP_GAIN_MULTIPLIER);
        let gainFood = prey.food;
        if (a.trait === "大食漢") { gainExp = Math.round(gainExp * 1.2); gainFood = Math.round(gainFood * 1.2); }
        a.food = Math.min(100, a.food + gainFood);
        a.exp += gainExp;
        room.turnSummaries[a.id].action = `【捕食成功】${prey.name} を捕らえた！（満腹+${gainFood}, EXP+${gainExp}）`;
      } else {
        room.turnSummaries[a.id].action = `【捕食失敗】${prey.name} を狙ったが、すんでのところで逃げられた。`;
      }
    }

    // ③ 水を飲む
    else if (act === "water") {
      a.water = 100;
      a.stamina = Math.min(100, a.stamina + 10);
      room.turnSummaries[a.id].action = "【水分補給】喉を潤し、水分を全快にした。";
    }

    // ④ 休む・隠れる
    else if (act === "rest") {
      a.hp = Math.min(100, a.hp + 20);
      a.stamina = Math.min(100, a.stamina + 35);
      room.turnSummaries[a.id].action = "【休息】物陰でじっと休み、HPと気力を回復した。（HP+20, 気力+35）";
    }

    // ⑥ カエル団子
    else if (act === "huddle") {
      const partner = room.actors[actData.targetId];
      const acceptedHuddle = room.coopAccepted[a.id];
      if (partner && acceptedHuddle && acceptedHuddle.type === "huddle" && acceptedHuddle.partnerId === partner.id && partner.alive && partner.zone === a.zone) {
        coopDone.add(a.id);
        coopDone.add(partner.id);
        a.water = Math.min(100, a.water + 25);
        partner.water = Math.min(100, partner.water + 25);
        addAffinity(a, partner, 8);
        room.turnSummaries[a.id].action = `【カエル団子】${partner.name} と身を寄せ合って保湿した。（水分+25, 親密度+8）`;
        room.turnSummaries[partner.id].action = `\u3010\u30ab\u30a8\u30eb\u56e3\u5b50\u6210\u529f\u3011${a.name}\u3068\u5bc6\u96c6\u3057\u3066\u4fdd\u6e7f\u3002\u6c34\u5206+25\u3001\u89aa\u5bc6\u5ea6+8`;
        appendSocialLog(room.turnSummaries[partner.id], `🐸 ${a.name} とのカエル団子が成功し、保湿と親密度上昇の効果を得た。（水分+25、親密度+8）`);
        logs.push(`🐸 【カエル団子成功】${a.name} と ${partner.name} が身を寄せ合い、保湿した！（水分+25、親密度+8）`);
      } else {
        a.water = Math.min(100, a.water + 15);
        room.turnSummaries[a.id].action = "【カエル団子】相手が見つからず、一人で体を丸めて保湿した。";
      }
    }

    // ⑦ 攻撃
    else if (act === "attack") {
      const target = room.actors[actData.targetId];
      const targetAction = room.actions[target && target.id];
      const protectedByHuddle = target && room.huddleProtected && room.huddleProtected.has(target.id);
      const protectedByRest = target && targetAction && targetAction.act === "rest";
      const targetIsProtected = Boolean(protectedByHuddle || protectedByRest);
      if (target && target.alive && target.zone !== a.zone) {
        room.turnSummaries[a.id].action = `【攻撃失敗】${target.name} は別エリアへ移動していたため、攻撃は当たらなかった。`;
        room.turnSummaries[target.id].danger = `${a.name} の攻撃をエリア移動で回避した。HPダメージなし。`;
        logs.push(`⚔️ ${target.name} は ${a.name} の攻撃をエリア移動で回避した。`);
      } else if (target && target.alive && target.zone === a.zone && targetIsProtected) {
        const defense = protectedByHuddle ? "カエル団子" : "休む・隠れる";
        room.turnSummaries[a.id].action = `【攻撃回避】${target.name} は「${defense}」で攻撃を回避し、ダメージを受けなかった。`;
        room.turnSummaries[target.id].danger = `${a.name} の攻撃を「${defense}」で回避した。HPダメージなし。`;
        logs.push(`⚔️ ${target.name} は ${a.name} の攻撃を${defense}で回避した。`);
      } else if (target && target.alive && target.zone === a.zone && !targetIsProtected) {
        const damage = Math.max(5, Math.min(40, 20 + ((a.level || 1) - (target.level || 1)) * 3));
        target.hp = Math.max(0, target.hp - damage);
        if (!attackersByTarget.has(target.id)) attackersByTarget.set(target.id, new Set());
        attackersByTarget.get(target.id).add(a.id);
        addAffinity(a, target, -30);
        room.turnSummaries[a.id].action = `【攻撃】${target.name} に攻撃し、レベル差を反映した HP-${damage} のダメージ！（親密度-30）`;
        room.turnSummaries[target.id].danger = `${a.name} から攻撃を受け、HP-${damage} のダメージ！（攻撃側Lv.${a.level || 1} / 自分Lv.${target.level || 1}）`;
        logs.push(`⚔️ ${a.name} が ${target.name} を攻撃し、HP-${damage}！`);
      }
    }

    // ⑧ 求愛・繁殖
    else if (act === "mate") {
      const target = room.actors[actData.targetId];
      const mateRequest = room.coopAccepted[a.id];
      const acceptedMate = mateRequest && mateRequest.type === "mate" && mateRequest.partnerId === target?.id && mateRequest.initiatorId === a.id;
      if (mateRequest && mateRequest.type === "mate" && mateRequest.initiatorId !== a.id) {
        room.turnSummaries[a.id].action = `【求愛を受諾】${target?.name || "相手"} の求愛を受け入れ、相手の行動に合流した。`;
        return;
      }
      if (a.stamina < 50) {
        room.turnSummaries[a.id].action = "【求愛不可】求愛には気力が50以上必要です。";
      } else if (a.stage >= 6 && target && target.alive && target.zone === a.zone && target.stage >= 6 && target.gender !== a.gender && acceptedMate) {
        const aff = (a.affinity && a.affinity[target.id]) || 0;
        let baseEggs = 18;
        if (aff >= 70) baseEggs = Math.floor(46 + Math.random() * 15);
        else if (aff >= 40) baseEggs = Math.floor(31 + Math.random() * 15);
        else if (aff >= 20) baseEggs = Math.floor(21 + Math.random() * 10);

        a.offspringCount += baseEggs;
        target.offspringCount += baseEggs;
        a.stamina = Math.max(0, a.stamina - 50);
        addAffinity(a, target, 20);
        coopDone.add(target.id);

        room.turnSummaries[a.id].action = `💖 【交配成功！】${target.name} と愛を交わし、卵を ${baseEggs} 個産卵した！（気力-50、親密度+20）`;
        appendSocialLog(room.turnSummaries[target.id], `💖 ${a.name} からの求愛を受け入れて交配が成功。卵を ${baseEggs} 個産卵した。（親密度+20）`);
        logs.push(`💕 【愛の結晶】${a.name} と ${target.name} が結ばれ、${baseEggs} 個の卵が産み落とされた！`);
      } else {
        room.turnSummaries[a.id].action = "【求愛失敗】相手に受け入れられず、虚しく鳴き声が響いた。";
      }
    }
  });

  attackersByTarget.forEach((attackerIds, targetId) => {
    const target = room.actors[targetId];
    if (!target || !target.alive || target.hp > 0) return;
    attackerIds.forEach(attackerId => {
      const attacker = room.actors[attackerId];
      if (!attacker) return;
      attacker.killBonusScore = (attacker.killBonusScore || 0) + 2000;
      const summary = room.turnSummaries[attackerId];
      if (summary) summary.action += ` / \u6483\u7834\u30dc\u30fc\u30ca\u30b9 +2000pt (${target.name}\u3092\u6483\u7834)`;
      logs.push(`\u6483\u7834\u30dc\u30fc\u30ca\u30b9: ${attacker.name} +2000pt (${target.name}\u3092\u653b\u6483\u3057HP0\u306b\u3057\u305f)`);
    });
  });
}

// イベント解決
function resolveEvents(room, logs) {
  const resolvedPair = new Set();

  for (let z = 0; z < 5; z++) {
    const ev = room.eventsByZone[z];
    if (!ev) continue;

    const aliveInZone = Object.values(room.actors).filter(a => a.alive && a.zone === z);

    // ペアイベント解決
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

    // 単独イベント解決
    aliveInZone.forEach(a => {
      if (!resolvedPair.has(a.id) && ev.resolve) {
        const c = room.eventChoices[a.id] || "rest";
        const msg = ev.resolve(a, c);
        room.turnSummaries[a.id].event = msg;
      }
    });
  }
}

// 代謝・環境変化
function resolveMetabolism(room, logs) {
  Object.values(room.actors).filter(a => a.alive).forEach(a => {
    // 満腹度消費
    let foodDrain = a.trait === "大食漢" ? 14 : 10;
    if (room.weather === "日照り") foodDrain += 4;
    a.food = Math.max(0, a.food - foodDrain);

    // 水分消費
    let waterDrain = 0;
    if (a.zone === 4) waterDrain = 18; // 草むら
    else if (a.zone === 3) waterDrain = 8; // 水際
    if (room.weather === "雨" || room.weather === "豪雨") waterDrain = 0;
    if (room.weather === "快晴" && a.zone === 4) waterDrain = Math.round(waterDrain * 1.5);
    if (room.weather === "日照り") waterDrain = Math.round(waterDrain * 2);
    if (a.trait === "頑強") waterDrain = Math.round(waterDrain * 0.6);
    a.water = Math.max(0, a.water - waterDrain);

    // 飢餓・乾燥ダメージ
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

// 天敵判定（ゾーン別確率・最大30%・1匹のみ大ダメージ）
function resolvePredators(room, logs) {
  if (room.weather === "豪雨") return;

  const BASE_ATTACK_CHANCE = [0.005, 0.008, 0.012, 0.016, 0.02];
  const ALERT_ATTACK_CHANCE = [0.08, 0.12, 0.20, 0.28, 0.36];
  const PREDATOR_NAMES = ["泥底の巨大ヤゴ", "水中の肉食魚", "空からのアオサギ", "水際のイタチ", "草むらのヘビ"];

  for (let z = 0; z < 5; z++) {
    const hasThreat = room.predatorThreats && room.predatorThreats[z] === true;
    const candidates = Object.values(room.actors).filter(a => a.alive && a.zone === z);
    if (candidates.length === 0) continue;

    const attackChance = hasThreat ? ALERT_ATTACK_CHANCE[z] : BASE_ATTACK_CHANCE[z];
    if (Math.random() >= attackChance) continue;

    const vulnerableCandidates = candidates.filter(a => !room.actions[a.id] || room.actions[a.id].act !== "rest");
    if (vulnerableCandidates.length === 0) continue;
    // 同じエリアに複数いても「1匹だけ」が襲われる。休んで隠れた個体は除外。
    const victim = vulnerableCandidates[Math.floor(Math.random() * vulnerableCandidates.length)];

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

    if (victim.hp <= 0) handleDeath(room, victim, `${PREDATOR_NAMES[z]} に捕食された`, logs);
  }
}

// 死亡・リスポーン処理（親密仲間の訃報＆2回目死亡バグ完全修正）
function handleDeath(room, actor, reason, logs) {
  // ① 親密度1以上の仲間に訃報通知
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

  // ② 残機制チェック（Lv.1〜6 かつ 残機あり）
  if (actor.eggs > 0 && actor.stage < 4) {
    actor.eggs -= 1;
    actor.level = Math.max(1, actor.level - 1);
    actor.exp = 0; // ★重要：EXPを0にリセットして即座のレベルアップを完全阻止！

    actor.stage = getStageByLevel(actor.level);
    actor.length = +(1.0 + (actor.level - 1) * 0.35).toFixed(1);
    actor.weight = +(0.5 + (actor.level - 1) * 0.5).toFixed(1);

    actor.hp = 100;
    actor.food = 70;
    actor.water = 100;
    actor.stamina = 100;
    actor.zone = 0; // ①水底へリスポーン
    actor.alive = true;

    logs.push(`🥚 【転生】${actor.name} は卵ストックを消費して水底から復活した（Lv.${actor.level}に出遅れ / 残機:${actor.eggs}）`);
    if (room.turnSummaries[actor.id]) {
      room.turnSummaries[actor.id].danger = `${reason}により死亡したが、卵の残機で水底からリスポーンした（Lv.${actor.level}）。`;
    }
  } else {
    // 永久死亡
    actor.alive = false;
    actor.hp = 0;
    logs.push(`💀 【永久死亡】${actor.name} は力尽き、池の底へと沈んでいった……（${reason}）`);
    if (room.turnSummaries[actor.id]) {
      room.turnSummaries[actor.id].danger = `${reason}により死亡退場しました。`;
    }
  }
}

function resolveZeroHpActors(room, logs) {
  Object.values(room.actors).forEach(actor => {
    if (actor.alive && actor.hp <= 0) handleDeath(room, actor, "HPが尽きた", logs);
  });
}

// 成長・変態・レベルアップ
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

// ゲーム終了処理（スコア計算）
function finishGame(room) {
  const scoreTurn = room.lastResolvedTurn ?? room.turn;
  const ranking = Object.values(room.actors).map(a => {
    const survivalTurn = a.alive ? scoreTurn : Math.max(1, scoreTurn - 1);
    const survivalBonus = a.alive ? 1500 : 0;
    const score = (survivalTurn * 100) + (a.offspringCount * 50) + (a.level * 200) + survivalBonus + (a.killBonusScore || 0);
    return {
      id: a.id,
      name: a.name,
      isPlayer: a.isPlayer,
      gender: a.gender,
      level: a.level,
      alive: a.alive,
      offspring: a.offspringCount,
      killBonusScore: a.killBonusScore || 0,
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

// クライアント配信用ステート作成
function getSanitizedRoomState(room) {
  const feedChances = {};
  const coopAcceptanceChances = {};
  const coopFeedChances = {};
  Object.values(room.actors).forEach(actor => {
    feedChances[actor.id] = {};
    Object.entries(PREY_MASTER).forEach(([zone, preyList]) => {
      feedChances[actor.id][zone] = Object.fromEntries(preyList.map(prey => [prey.id, calculateFeedChance(actor, prey)]));
    });
    coopAcceptanceChances[actor.id] = {};
    coopFeedChances[actor.id] = {};
    Object.values(room.actors).forEach(target => {
      coopAcceptanceChances[actor.id][target.id] = {
        feed: calculateCoopAcceptanceChance(room, actor, target, "feed"),
        huddle: calculateCoopAcceptanceChance(room, actor, target, "huddle"),
        mate: calculateCoopAcceptanceChance(room, actor, target, "mate")
      };
      coopFeedChances[actor.id][target.id] = {};
      Object.entries(PREY_MASTER).forEach(([zone, preyList]) => {
        coopFeedChances[actor.id][target.id][zone] = Object.fromEntries(preyList.map(prey => [prey.id, calculateCoopFeedChance(actor, target, prey)]));
      });
    });
  });
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
    eventsByActor: room.eventsByActor || {},
    pairTargets: room.pairTargets,
    predatorThreats: room.predatorThreats || {},
    feedChances,
    coopAcceptanceChances,
    coopFeedChances,
    turnSummaries: room.turnSummaries,
    logs: room.playerActionLogs || [],
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

// サーバー起動
// FROG LIFE rule extensions.
const springWaterEvent = EVENTS_MASTER.solo.find(ev => ev.id === "solo_spring_water");
if (springWaterEvent) {
  springWaterEvent.choices.push({ id: "save", text: "湧き水を後回しにして休む（気力+10）" });
  springWaterEvent.resolve = (actor, choice) => {
    if (choice === "save") {
      actor.stamina = Math.min(100, actor.stamina + 10);
      return "湧き水を後回しにして休んだ。（気力+10）";
    }
    actor.water = 100;
    actor.hp = Math.min(100, actor.hp + 10);
    return "冷たい湧き水を飲み、水分が全快した。（HP+10）";
  };
}
const leechEvent = EVENTS_MASTER.solo.find(ev => ev.id === "solo_leech");
if (leechEvent) {
  leechEvent.choices.push({ id: "endure", text: "動かず耐える（HP-10、気力-20）" });
  const originalLeechResolve = leechEvent.resolve;
  leechEvent.resolve = (actor, choice) => {
    if (choice === "endure") {
      actor.hp = Math.max(0, actor.hp - 10);
      actor.stamina = Math.max(0, actor.stamina - 20);
      return "動かず耐えたが、HP-10、気力-20。";
    }
    return originalLeechResolve(actor, choice);
  };
}

EVENTS_MASTER.solo.push(
  { id: "solo_shade", title: "木陰の休息", desc: "木漏れ日の差す涼しい場所を見つけた。", choices: [{ id: "rest", text: "休む（気力+15）" }, { id: "forage", text: "草むらを探す（満腹+10、水分-5）" }], resolve: (a, c) => { if (c === "rest") { a.stamina = Math.min(100, a.stamina + 15); return "木陰で休み、気力が15回復した。"; } a.food = Math.min(100, a.food + 10); a.water = Math.max(0, a.water - 5); return "草むらで食べ物を見つけた。満腹+10、水分-5。"; } },
  { id: "solo_insects", title: "虫たちの群れ", desc: "小さな虫の群れが近くを飛んでいる。", choices: [{ id: "eat", text: "捕まえる（満腹+15、EXP+7）" }, { id: "watch", text: "観察する（気力+10）" }], resolve: (a, c) => { if (c === "eat") { a.food = Math.min(100, a.food + 15); addExperience(a, 5); return "虫を捕まえた。満腹+15、EXP+7。"; } a.stamina = Math.min(100, a.stamina + 10); return "虫の群れを観察してひと息ついた。気力+10。"; } },
  { id: "solo_shallow_pool", title: "浅瀬の水たまり", desc: "浅瀬に澄んだ水たまりができている。", choices: [{ id: "drink", text: "水を飲む（水分+25）" }, { id: "nap", text: "少し休む（HP+8）" }], resolve: (a, c) => { if (c === "drink") { a.water = Math.min(100, a.water + 25); return "水たまりで喉を潤した。水分+25。"; } a.hp = Math.min(100, a.hp + 8); return "浅瀬で体を休めた。HP+8。"; } },
  { id: "solo_thorns", title: "いばらの道", desc: "進路に鋭いいばらが広がっている。", choices: [{ id: "retreat", text: "引き返す（HP-8）" }, { id: "push", text: "進み続ける（気力-20）" }], resolve: (a, c) => { if (c === "retreat") { a.hp = Math.max(0, a.hp - 8); return "いばらで小さな傷を負った。HP-8。"; } a.stamina = Math.max(0, a.stamina - 20); return "いばらを抜けたが、気力を消耗した。気力-20。"; } }
);
EVENTS_MASTER.pair.push(
  { id: "pair_shelter", title: "倒木の下", desc: "二匹で入れそうな倒木の下を見つけた。", choices: [{ id: "share", text: "場所を譲り合う（親密度+10、水分+10）" }, { id: "claim", text: "場所を独占する" }], resolvePair: (a, c1, b, c2) => { if (c1 === "share" && c2 === "share") { a.water = Math.min(100, a.water + 10); b.water = Math.min(100, b.water + 10); addAffinity(a, b, 10); return { log1: `${b.name}と倒木の下で休んだ（親密度+10、水分+10）。`, log2: `${a.name}と倒木の下で休んだ（親密度+10、水分+10）。` }; } const thief = c1 === "claim" ? a : b; const other = thief === a ? b : a; thief.stamina = Math.min(100, thief.stamina + 8); other.water = Math.max(0, other.water - 8); addAffinity(a, b, -10); return { log1: thief === a ? `場所を独占した（親密度-10）。` : `${b.name}に場所を取られた（親密度-10）。`, log2: thief === b ? `場所を独占した（親密度-10）。` : `${a.name}に場所を取られた（親密度-10）。` }; } },
  { id: "pair_alarm", title: "水面の波紋", desc: "水面に大きな影がよぎった。相手に知らせる？", choices: [{ id: "warn", text: "相手に知らせる" }, { id: "hide", text: "自分だけ隠れる" }], resolvePair: (a, c1, b, c2) => { if (c1 === "warn" && c2 === "warn") { addAffinity(a, b, 8); a.stamina = Math.min(100, a.stamina + 8); b.stamina = Math.min(100, b.stamina + 8); return { log1: `${b.name}に知らせて一緒に隠れた（親密度+8、気力+8）。`, log2: `${a.name}に知らせて一緒に隠れた（親密度+8、気力+8）。` }; } if (c1 !== c2) { const warned = c1 === "warn" ? a : b; const hidden = warned === a ? b : a; hidden.hp = Math.max(0, hidden.hp - 8); addAffinity(a, b, -5); return { log1: warned === a ? `${b.name}に知らせた（親密度-5）。` : `${b.name}は知らせず隠れた（HP-8、親密度-5）。`, log2: warned === b ? `${a.name}に知らせた（親密度-5）。` : `${a.name}は知らせず隠れた（HP-8、親密度-5）。` }; } a.hp = Math.max(0, a.hp - 5); b.hp = Math.max(0, b.hp - 5); return { log1: "二匹とも知らせず、波しぶきを浴びた（HP-5）。", log2: "二匹とも知らせず、波しぶきを浴びた（HP-5）。" }; } },
  { id: "pair_food_call", title: "餌の見つけ合い", desc: "二匹で食べ物のありかを探せそうだ。", choices: [{ id: "cooperate", text: "協力して探す（満腹+12、親密度+8）" }, { id: "rush", text: "先に食べる" }], resolvePair: (a, c1, b, c2) => { if (c1 === "cooperate" && c2 === "cooperate") { a.food = Math.min(100, a.food + 12); b.food = Math.min(100, b.food + 12); addAffinity(a, b, 8); return { log1: `${b.name}と餌を分け合った（満腹+12、親密度+8）。`, log2: `${a.name}と餌を分け合った（満腹+12、親密度+8）。` }; } const first = c1 === "rush" ? a : b; const second = first === a ? b : a; first.food = Math.min(100, first.food + 20); second.food = Math.max(0, second.food - 5); addAffinity(a, b, -8); return { log1: first === a ? `先に餌を食べた（満腹+20、親密度-8）。` : `${b.name}に先を越された（親密度-8）。`, log2: first === b ? `先に餌を食べた（満腹+20、親密度-8）。` : `${a.name}に先を越された（親密度-8）。` }; } }
);

const PREDATOR_ZONE_CHANCE = [0.05, 0.10, 0.18, 0.24, 0.30];
const PREDATOR_ZONE_NAMES = ["ヤゴ", "水中の天敵", "サギ", "イタチ", "ヘビ"];
setupTurnEvents = function(room) {
  room.eventsByZone = {};
  room.eventsByActor = {};
  room.pairTargets = {};
  room.predatorThreats = {};
  Object.values(room.actors).forEach(a => {
    a.turnStartStats = { stamina: a.stamina, length: a.length, weight: a.weight };
  });
  for (let z = 0; z < 5; z++) {
    const pairingPool = Object.values(room.actors).filter(a => a.alive && a.zone === z);
    for (let i = pairingPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairingPool[i], pairingPool[j]] = [pairingPool[j], pairingPool[i]];
    }

    // Randomly decide how many pairs this zone forms; remaining frogs each get a solo event.
    const pairCount = Math.floor(Math.random() * (Math.floor(pairingPool.length / 2) + 1));
    const zoneEvents = [];
    for (let i = 0; i < pairCount; i++) {
      const first = pairingPool[i * 2];
      const second = pairingPool[i * 2 + 1];
      const source = EVENTS_MASTER.pair[Math.floor(Math.random() * EVENTS_MASTER.pair.length)];
      const event = { ...source, type: "pair" };
      room.eventsByActor[first.id] = event;
      room.eventsByActor[second.id] = event;
      room.pairTargets[first.id] = second.id;
      room.pairTargets[second.id] = first.id;
      zoneEvents.push(event);
    }
    for (let i = pairCount * 2; i < pairingPool.length; i++) {
      const actor = pairingPool[i];
      const source = EVENTS_MASTER.solo[Math.floor(Math.random() * EVENTS_MASTER.solo.length)];
      const event = { ...source, type: "solo" };
      room.eventsByActor[actor.id] = event;
      zoneEvents.push(event);
    }
    room.eventsByZone[z] = zoneEvents[0] || null;
    room.predatorThreats[z] = room.weather !== WEATHERS[4] && Math.random() < PREDATOR_ZONE_CHANCE[z];
  }
};

resolveEvents = function(room, logs) {
  const savedChoices = { ...room.eventChoices };
  for (const [actorId, partnerId] of Object.entries(room.pairTargets || {})) {
    const actor = room.actors[actorId];
    const partner = room.actors[partnerId];
    if (!actor || !partner || actorId > partnerId) continue;
    const ev = room.eventsByActor[actorId];
    if (!ev || ev.type !== "pair" || !ev.choices || ev.choices.length < 2) continue;
    for (const [who, other] of [[actor, partner], [partner, actor]]) {
      if (room.eventChoices[who.id] !== ev.choices[ev.choices.length - 1].id) continue;
      let betrayalChance = 35;
      if (who.personality === PERSONALITIES[0]) betrayalChance -= 10;
      if (who.personality === PERSONALITIES[1]) betrayalChance += 20;
      const affinity = (who.affinity && who.affinity[other.id]) || 0;
      betrayalChance -= affinity * 0.3;
      if (who.gender === other.gender) betrayalChance -= 10;
      betrayalChance = Math.max(5, Math.min(80, betrayalChance));
      if (Math.random() * 100 >= betrayalChance) room.eventChoices[who.id] = ev.choices[0].id;
    }
  }

  const resolvedChoices = { ...room.eventChoices };
  const resolvedPairs = new Set();
  for (const [actorId, partnerId] of Object.entries(room.pairTargets || {})) {
    const actor = room.actors[actorId];
    const partner = room.actors[partnerId];
    if (!actor || !partner || actorId > partnerId) continue;
    const ev = room.eventsByActor[actorId];
    if (!ev || ev.type !== "pair" || room.eventsByActor[partnerId]?.id !== ev.id) continue;
    resolvedPairs.add(actorId);
    resolvedPairs.add(partnerId);
    if (!actor.alive || !partner.alive || actor.zone !== partner.zone || !ev.resolvePair) continue;
    const c1 = room.eventChoices[actorId] || ev.choices[0].id;
    const c2 = room.eventChoices[partnerId] || ev.choices[0].id;
    const result = ev.resolvePair(actor, c1, partner, c2);
    const choice1 = ev.choices.find(choice => choice.id === c1);
    const choice2 = ev.choices.find(choice => choice.id === c2);
    const affinity = (actor.affinity && actor.affinity[partnerId]) || 0;
    const betrayalChoice = ev.choices[ev.choices.length - 1];
    room.turnSummaries[actorId].event = `\u9078\u629e: ${choice1?.text || c1} / \u76f8\u624b\u306e\u9078\u629e: ${choice2?.text || c2} / \u7d50\u679c: ${result.log1} / \u89aa\u5bc6\u5ea6: ${affinity}`;
    room.turnSummaries[partnerId].event = `\u9078\u629e: ${choice2?.text || c2} / \u76f8\u624b\u306e\u9078\u629e: ${choice1?.text || c1} / \u7d50\u679c: ${result.log2} / \u89aa\u5bc6\u5ea6: ${affinity}`;
    if (betrayalChoice && resolvedChoices[partnerId] === betrayalChoice.id) {
      room.turnSummaries[actorId].event += ` / ${partner.name}\u306e\u88cf\u5207\u308a\u9078\u629e\u304c\u5b9f\u884c\u3055\u308c\u305f\u7d50\u679c: ${result.log2}`;
    }
    if (betrayalChoice && resolvedChoices[actorId] === betrayalChoice.id) {
      room.turnSummaries[partnerId].event += ` / ${actor.name}\u306e\u88cf\u5207\u308a\u9078\u629e\u304c\u5b9f\u884c\u3055\u308c\u305f\u7d50\u679c: ${result.log1}`;
    }
  }

  Object.values(room.actors).forEach(actor => {
    if (!actor.alive || resolvedPairs.has(actor.id)) return;
    const ev = room.eventsByActor[actor.id];
    if (!ev || ev.type !== "solo" || !ev.resolve) return;
    const choice = room.eventChoices[actor.id] || ev.choices?.[0]?.id || "none";
    room.turnSummaries[actor.id].event = ev.resolve(actor, choice);
  });

  Object.values(room.turnSummaries).forEach(summary => {
    if (!summary.socialLog) return;
    const eventText = summary.event || "特になし";
    summary.event = eventText === "特になし" ? summary.socialLog : `${eventText} ${summary.socialLog}`;
  });
  room.eventChoices = savedChoices;
};

const originalResolveActions = resolveActions;
resolveActions = function(room, logs) {
  room.huddleProtected = new Set();
  Object.values(room.actors).forEach(actor => {
    const action = room.actions[actor.id];
    const partner = action && room.actors[action.targetId];
    const acceptedHuddle = room.coopAccepted[actor.id];
    if (actor.alive && action && action.act === "huddle" && acceptedHuddle && acceptedHuddle.type === "huddle" && acceptedHuddle.partnerId === partner?.id && partner && partner.alive && partner.zone === actor.zone) {
      room.huddleProtected.add(actor.id);
      room.huddleProtected.add(partner.id);
    }
  });
  originalResolveActions(room, logs);
  Object.values(room.actors).forEach(actor => {
    const action = room.actions[actor.id];
    const partner = action && room.actors[action.targetId];
    const accepted = room.coopAccepted[actor.id];
    if (actor.alive && action && action.act === "huddle" && partner && partner.alive && partner.zone === actor.zone && (!accepted || accepted.type !== "huddle" || accepted.partnerId !== partner.id)) {
      room.turnSummaries[actor.id].action = `${partner.name}に断られ、カエル団子は不成立。ひとりで保湿した（水分+15）。`;
    }
  });
  Object.values(room.actors).forEach(actor => {
    const action = room.actions[actor.id];
    const partner = action && room.actors[action.targetId];
    const acceptedHuddle = room.coopAccepted[actor.id];
    if (actor.alive && action && action.act === "huddle" && acceptedHuddle && acceptedHuddle.type === "huddle" && acceptedHuddle.partnerId === partner?.id && partner && partner.alive && partner.zone === actor.zone) {
      for (const protectedActor of [actor, partner]) {
        const summary = room.turnSummaries[protectedActor.id];
        if (summary && !summary.action.includes("保護効果")) summary.action += "（保護効果：このターンは天敵とカエルの攻撃を防ぐ）";
      }
    }
    if (!actor.alive || !action || action.act !== "call" || actor.stage < 5) return;
    const listeners = Object.values(room.actors).filter(other => other.alive && other.id !== actor.id && other.zone === actor.zone);
    listeners.forEach(listener => {
      addAffinity(actor, listener, 5);
      if (room.turnSummaries[listener.id]) {
        const previousEvent = room.turnSummaries[listener.id].event || "";
        const heardCall = `${actor.name}の鳴き声が聞こえ、親密度+5。`;
        room.turnSummaries[listener.id].event = previousEvent === "特になし" ? heardCall : `${previousEvent} ${heardCall}`.trim();
      }
    });
    room.turnSummaries[actor.id].action = listeners.length
      ? `【鳴く】エリアの${listeners.length}匹に協力を呼びかけた。（それぞれ親密度+5）`
      : "【鳴く】声を響かせたが、同じエリアに仲間はいなかった。";
  });
};

const originalResolvePredators = resolvePredators;
resolvePredators = function(room, logs) {
  const protectedActors = [];
  (room.huddleProtected || new Set()).forEach(id => {
    const actor = room.actors[id];
    if (actor && actor.alive) { actor.alive = false; protectedActors.push(actor); }
  });
  originalResolvePredators(room, logs);
  protectedActors.forEach(actor => { actor.alive = true; });
};

// Score-aware NPC policy: evaluates expected public outcomes with the same resolution formulas.
decideNpcActions = function(room) {
  const living = Object.values(room.actors).filter(actor => actor.alive);
  const minStage = [1, 1, 3, 4, 5];
  const turnsLeft = Math.max(1, TOTAL_TURNS - room.turn + 1);
  const hasTrait = (npc, points) => npc.trait === String.fromCodePoint(...points);
  const bigEater = npc => hasTrait(npc, [0x5927, 0x98df, 0x6f22]);
  const highMetabolism = npc => hasTrait(npc, [0x9ad8, 0x4ee3, 0x8b1d]);
  const sturdy = npc => hasTrait(npc, [0x9811, 0x5f37]);
  const light = npc => hasTrait(npc, [0x8eab, 0x8efd]);
  const cautious = npc => hasTrait(npc, [0x614e, 0x91cd]);
  const foodDrain = npc => (bigEater(npc) ? 14 : 10) + (room.weather === WEATHERS[3] ? 4 : 0);
  const waterDrain = (npc, zone) => {
    let drain = zone === 4 ? 18 : zone === 3 ? 8 : 0;
    if (room.weather === WEATHERS[2] || room.weather === WEATHERS[4]) drain = 0;
    if (room.weather === WEATHERS[0] && zone === 4) drain = Math.round(drain * 1.5);
    if (room.weather === WEATHERS[3]) drain = Math.round(drain * 2);
    return sturdy(npc) ? Math.round(drain * 0.6) : drain;
  };
  const staminaValue = value => Math.min(50, Math.max(0, value)) * 0.7 + Math.max(0, value - 50) * 0.35;
  const levelsFromExp = (npc, gain) => {
    let exp = npc.exp + gain, level = npc.level, levels = 0;
    let needed = getExpReq(level);
    if (highMetabolism(npc)) needed = Math.round(needed * 0.8);
    while (exp >= needed && levels < 5) {
      exp -= needed;
      level += 1;
      levels += 1;
      needed = getExpReq(level);
      if (highMetabolism(npc)) needed = Math.round(needed * 0.8);
    }
    return levels;
  };
  const simulate = (npc, zone, action, success = true) => {
    let hp = npc.hp, food = npc.food, water = npc.water, stamina = npc.stamina;
    let levelPoints = 0, eggsPoints = 0, killPoints = 0;
    if (action.act === "feed") {
      stamina = Math.max(0, stamina - 10);
      if (success) {
        let gainFood = action.prey.food;
        let gainExp = Math.round(action.prey.exp * EXP_GAIN_MULTIPLIER);
        if (bigEater(npc)) { gainFood = Math.round(gainFood * 1.2); gainExp = Math.round(gainExp * 1.2); }
        food = Math.min(100, food + gainFood);
        levelPoints = levelsFromExp(npc, gainExp) * 200;
      }
    } else if (action.act === "water") {
      water = 100;
      stamina = Math.min(100, stamina + 10);
    } else if (action.act === "rest") {
      hp = Math.min(100, hp + 20);
      stamina = Math.min(100, stamina + 35);
    } else if (action.act === "huddle") {
      water = Math.min(100, water + 15);
    } else if (action.act === "mate") {
      stamina = Math.max(0, stamina - 50);
      eggsPoints = action.eggs * 50;
    } else if (action.act === "attack") {
      killPoints = action.killPoints;
    }

    const drainFood = foodDrain(npc), drainWater = waterDrain(npc, zone);
    food = Math.max(0, food - drainFood);
    water = Math.max(0, water - drainWater);
    let damage = 0;
    if (food <= 0) damage += highMetabolism(npc) ? 22 : 15;
    if (water <= 0) damage += highMetabolism(npc) ? 25 : 18;
    hp -= damage;
    const metabolismDeath = hp <= 0;
    let predatorDeath = 0;
    if (!metabolismDeath && action.act !== "rest" && room.weather !== WEATHERS[4]) {
      const alerted = room.predatorThreats && room.predatorThreats[zone] === true;
      const attackChance = alerted ? [0.08, 0.12, 0.20, 0.28, 0.36][zone] : [0.005, 0.008, 0.012, 0.016, 0.02][zone];
      const zoneCount = living.filter(actor => actor.zone === zone).length;
      const victimShare = 1 / Math.max(1, Math.ceil(zoneCount * 0.75));
      const lethalChance = Math.max(0, Math.min(16, 91 - hp)) / 16;
      predatorDeath = attackChance * victimShare * lethalChance * (light(npc) ? 0.75 : 1);
    }
    const deathChance = metabolismDeath ? 1 : Math.min(1, predatorDeath);
    const respawns = npc.eggs > 0 && npc.stage < 4;
    let deathPenalty = 0;
    if (deathChance > 0) {
      if (respawns) {
        deathPenalty = deathChance * 200;
        if (metabolismDeath) { hp = 100; food = 70; water = 100; stamina = 100; levelPoints = 0; }
      } else {
        const atRisk = 100 * Math.max(0, turnsLeft - 1) + 1500;
        deathPenalty = deathChance * atRisk;
      }
    }
    const foodTurns = drainFood ? food / drainFood : 2.5;
    const waterTurns = drainWater ? water / drainWater : 2.5;
    const reserve = Math.min(2.5, Math.max(0, foodTurns), Math.max(0, waterTurns)) * 100;
    const stateValue = reserve + staminaValue(stamina) + Math.min(100, Math.max(0, hp)) * 0.35;
    const aliveAfterTurn = respawns ? 1 : 1 - deathChance;
    return stateValue * aliveAfterTurn + levelPoints * (1 - deathChance) + eggsPoints + killPoints - deathPenalty + aliveAfterTurn * 100;
  };
  const expectedEggs = affinity => affinity >= 70 ? 53 : affinity >= 40 ? 38 : affinity >= 20 ? 25.5 : 18;
  const setEventChoice = (npc, personalityIndex) => {
    const event = room.eventsByActor && room.eventsByActor[npc.id];
    if (event && event.choices && event.choices.length) {
      room.eventChoices[npc.id] = personalityIndex === 1 || personalityIndex === 2
        ? event.choices[event.choices.length - 1].id : event.choices[0].id;
    } else room.eventChoices[npc.id] = "none";
  };

  living.filter(npc => !npc.isPlayer).forEach(npc => {
    const personality = PERSONALITIES.indexOf(npc.personality);
    if (room.coopAccepted && room.coopAccepted[npc.id]) {
      setEventChoice(npc, personality);
      return;
    }
    const zones = [npc.zone - 1, npc.zone, npc.zone + 1].filter(zone => zone >= 0 && zone <= 4 && npc.stage >= minStage[zone]);
    const candidates = [];
    zones.forEach(zone => {
      (PREY_MASTER[zone] || PREY_MASTER[0]).forEach(prey => {
        const chance = calculateFeedChance(npc, prey) / 100;
        const action = { act: "feed", prey };
        const expected = chance * simulate(npc, zone, action, true) + (1 - chance) * simulate(npc, zone, action, false);
        candidates.push({ act: "feed", zone, prey, score: expected, kind: "feed" });
      });
      candidates.push({ act: "water", zone, score: simulate(npc, zone, { act: "water" }), kind: "water" });
      candidates.push({ act: "rest", zone, score: simulate(npc, zone, { act: "rest" }), kind: "rest" });
      candidates.push({ act: "huddle", zone, score: simulate(npc, zone, { act: "huddle" }), kind: "huddle" });
      if (npc.stage >= 5) {
        const nearby = living.filter(target => target.id !== npc.id && target.zone === zone);
        const callValue = nearby.reduce((total, target) => {
          if (target.isPlayer || target.stage < 6 || target.gender === npc.gender) return total;
          const affinity = (npc.affinity && npc.affinity[target.id]) || 0;
          return total + Math.max(0, expectedEggs(affinity + 5) - expectedEggs(affinity)) * 50 * 0.15;
        }, 0);
        if (nearby.length) candidates.push({ act: "call", zone, score: simulate(npc, zone, { act: "call" }) + callValue, kind: "call" });
      }
      living.filter(target => target.id !== npc.id && target.zone === zone).forEach(target => {
        const damage = Math.max(5, Math.min(40, 20 + ((npc.level || 1) - (target.level || 1)) * 3));
        if (target.hp <= damage) {
          const killPoints = 2000 * 0.5; // Do not inspect the target's unsubmitted action.
          candidates.push({ act: "attack", zone, targetId: target.id, score: simulate(npc, zone, { act: "attack", killPoints }), kind: "attack" });
        }
      });
      if (npc.stage >= 6 && npc.stamina >= 50) {
        living.filter(target => !target.isPlayer && target.id !== npc.id && target.zone === zone && target.stage >= 6 && target.gender !== npc.gender && !(room.coopAccepted && room.coopAccepted[target.id]))
          .forEach(target => {
            const affinity = (npc.affinity && npc.affinity[target.id]) || 0;
            const eggs = expectedEggs(affinity);
            candidates.push({ act: "mate", zone, targetId: target.id, eggs, score: simulate(npc, zone, { act: "mate", eggs }), kind: "mate" });
          });
      }
    });
    candidates.forEach(candidate => {
      if (personality === 0 && candidate.kind === "mate") candidate.score *= 1.025;
      if (personality === 1 && candidate.kind === "feed") candidate.score *= 1.02;
      if (personality === 2 && candidate.kind === "attack") candidate.score *= 1.025;
      if (personality === 3 && (candidate.kind === "rest" || candidate.kind === "water")) candidate.score *= 1.025;
      if (cautious(npc) && candidate.kind === "rest" && room.predatorThreats && room.predatorThreats[candidate.zone]) candidate.score *= 1.03;
    });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const window = best ? Math.max(10, Math.abs(best.score) * 0.025) : 0;
    const nearBest = candidates.filter(candidate => best && candidate.score >= best.score - window);
    const chosen = nearBest[Math.floor(Math.random() * nearBest.length)] || { act: "rest", zone: npc.zone };
    room.actions[npc.id] = { moveZone: chosen.zone, act: chosen.act, targetPreyId: chosen.prey && chosen.prey.id, targetId: chosen.targetId || null };
    if (chosen.act === "mate" && chosen.targetId) {
      room.coopAccepted[npc.id] = { partnerId: chosen.targetId, initiatorId: npc.id, type: "mate" };
      room.coopAccepted[chosen.targetId] = { partnerId: npc.id, initiatorId: npc.id, type: "mate" };
    }
    setEventChoice(npc, personality);
  });
};
server.listen(PORT, () => {
  console.log(`FROG LIFE Server running on port ${PORT}`);
});
