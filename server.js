const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// publicフォルダのHTMLを画面として配信
app.use(express.static(path.join(__dirname, 'public')));

// 部屋ごとのデータを管理
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      turn: 1,
      timeLeft: 45,
      event: "【共通】流れてきた大ミミズをめぐる争い！",
      players: {},
      timer: null
    };
    startRoomTimer(roomId);
  }
  return rooms[roomId];
}

function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      resolveTurn(roomId);
    } else {
      broadcastState(roomId);
    }
  }, 1000);
}

function resolveTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // 全プレイヤーの行動を反映
  for (const pid in room.players) {
    const p = room.players[pid];
    if (p.action) {
      p.zone = p.action.moveZone;
    }
    p.ready = false;
    p.action = null;
  }

  room.turn++;
  room.timeLeft = 45;

  const events = [
    "【共通】激しい雨が降り注ぎ、虫が落ちてきた！",
    "【共通】上空にサギの影！水面が危険！",
    "【ペアイベント】定員1匹のハスの葉の奪い合いが発生！"
  ];
  room.event = events[room.turn % events.length];

  broadcastState(roomId);
}

function checkAllReady(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const playerList = Object.values(room.players);
  if (playerList.length > 0 && playerList.every(p => p.ready)) {
    resolveTurn(roomId);
  }
}

function broadcastState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const msg = JSON.stringify({
    type: "STATE_UPDATE",
    state: {
      turn: room.turn,
      timeLeft: room.timeLeft,
      event: room.event,
      players: room.players
    }
  });

  for (const pid in room.players) {
    const ws = room.players[pid].ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// WebSocket接続処理
wss.on('connection', (ws) => {
  let myRoomId = null;
  let myPlayerId = 'p_' + Math.random().toString(36).substring(2, 7);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "JOIN_ROOM") {
        myRoomId = data.roomId;
        const room = getOrCreateRoom(myRoomId);

        room.players[myPlayerId] = {
          id: myPlayerId,
          name: data.name || "カエル",
          zone: 1,
          ready: false,
          action: null,
          ws: ws
        };

        ws.send(JSON.stringify({ type: "INIT", myId: myPlayerId }));
        broadcastState(myRoomId);
      }

      if (data.type === "SUBMIT_ACTION" && myRoomId) {
        const room = rooms[myRoomId];
        if (room && room.players[myPlayerId]) {
          room.players[myPlayerId].ready = true;
          room.players[myPlayerId].action = data.action;
          broadcastState(myRoomId);
          checkAllReady(myRoomId);
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    if (myRoomId && rooms[myRoomId]) {
      delete rooms[myRoomId].players[myPlayerId];
      if (Object.keys(rooms[myRoomId].players).length === 0) {
        clearInterval(rooms[myRoomId].timer);
        delete rooms[myRoomId];
      } else {
        broadcastState(myRoomId);
        checkAllReady(myRoomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});