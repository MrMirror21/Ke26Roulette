"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Matter from "matter-js";

// ─── Constants ──────────────────────────────────────────────
const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 5000;
const BALL_RADIUS = 14;
const FINISH_Y = WORLD_HEIGHT - 120;
const PARTICIPANT_NAMES = [
  "민수", "지영", "현우", "수빈", "태희",
  "동현", "예린", "성민", "하늘", "재원",
  "소연", "준혁", "미나", "우진", "다은",
];

const BALL_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
  "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  "#F1948A", "#82E0AA", "#F8C471", "#AED6F1", "#D7BDE2",
];

// Commentary templates
const COMMENTARY_TEMPLATES = {
  collision: [
    "💥 {id}번 공이 장애물에 부딪혔습니다!",
    "🔥 {id}번, 강력한 충돌! 방향이 크게 바뀌었습니다!",
    "⚡ {id}번 공이 튕겨나갑니다!",
    "🎯 {id}번, 장애물에 맞고 새로운 경로로!",
  ],
  leading: [
    "🏆 현재 {id}번이 가장 앞서고 있습니다!",
    "🚀 {id}번, 선두를 달리고 있습니다!",
    "⭐ {id}번이 독주 체제입니다!",
  ],
  trailing: [
    "😰 {id}번이 가장 뒤처져 있습니다... 커피 위기!",
    "☕ {id}번, 현재 꼴찌! 커피를 살 위기입니다!",
    "🐢 {id}번, 느릿느릿... 위험합니다!",
  ],
  overtake: [
    "🔄 {id}번이 {other}번을 추월했습니다!",
    "⚡ 역전! {id}번이 {other}번 앞으로!",
  ],
  finish: [
    "🏁 {id}번이 골인했습니다! {rank}등!",
    "✅ {id}번, {rank}등으로 도착!",
  ],
  lastFinish: [
    "☕☕☕ {id}번이 최종 꼴찌! 오늘 커피는 {id}번이 삽니다! ☕☕☕",
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface BallState {
  name: string;
  number: number;
  color: string;
  x: number;
  y: number;
  rank: number | null;
  finished: boolean;
  body: Matter.Body;
}

interface CommentaryItem {
  id: number;
  text: string;
  timestamp: number;
}

// ─── Obstacle creation helpers ──────────────────────────────
function createObstacles(world: Matter.World, Composite: typeof Matter.Composite, Bodies: typeof Matter.Bodies, Body: typeof Matter.Body, Constraint: typeof Matter.Constraint) {
  const obstacles: Matter.Body[] = [];
  const constraints: Matter.Constraint[] = [];

  // Walls
  const wallOpts = { isStatic: true, friction: 0.1, restitution: 0.5, render: { fillStyle: "#333" }, label: "wall" };
  const leftWall = Bodies.rectangle(0, WORLD_HEIGHT / 2, 30, WORLD_HEIGHT, wallOpts);
  const rightWall = Bodies.rectangle(WORLD_WIDTH, WORLD_HEIGHT / 2, 30, WORLD_HEIGHT, wallOpts);
  Composite.add(world, [leftWall, rightWall]);

  // Funnel at top
  const funnelLeft = Bodies.rectangle(150, 150, 300, 15, { isStatic: true, angle: Math.PI / 6, restitution: 0.4, label: "obstacle", render: { fillStyle: "#555" } });
  const funnelRight = Bodies.rectangle(WORLD_WIDTH - 150, 150, 300, 15, { isStatic: true, angle: -Math.PI / 6, restitution: 0.4, label: "obstacle", render: { fillStyle: "#555" } });
  Composite.add(world, [funnelLeft, funnelRight]);

  // Layout: alternating single ramps (left/right), spaced 250px apart vertically
  // Each row has ONE obstacle only - never two at the same height
  const obstacleRows: { x: number; y: number; type: string; w?: number; angle?: number; r?: number }[] = [];
  let rowY = 400;
  let side = 0; // 0=left, 1=center, 2=right
  const pattern = ["ramp", "spinner", "ramp", "bumper", "ramp", "spinner", "ramp", "bumper"];
  let patIdx = 0;

  while (rowY < WORLD_HEIGHT - 300) {
    const type = pattern[patIdx % pattern.length];
    let x: number;
    if (side === 0) x = 150 + Math.random() * 150;
    else if (side === 2) x = WORLD_WIDTH - 150 - Math.random() * 150;
    else x = 350 + Math.random() * 200;

    if (type === "ramp") {
      const angle = side === 0 ? 0.35 + Math.random() * 0.1 : side === 2 ? -(0.35 + Math.random() * 0.1) : (Math.random() > 0.5 ? 0.3 : -0.3);
      obstacleRows.push({ x, y: rowY, type: "ramp", w: 150, angle });
    } else if (type === "spinner") {
      obstacleRows.push({ x, y: rowY, type: "spinner", w: 160 });
    } else {
      obstacleRows.push({ x, y: rowY, type: "bumper", r: 25 });
    }

    rowY += 250;
    side = (side + 1) % 3;
    patIdx++;
  }

  // Place obstacles
  const exclusionZones: { x: number; y: number; r: number }[] = [];

  obstacleRows.forEach((row) => {
    if (row.type === "spinner") {
      const w = row.w || 160;
      exclusionZones.push({ x: row.x, y: row.y, r: w / 2 + 50 });
      const bar = Bodies.rectangle(row.x, row.y, w, 12, {
        isStatic: false, restitution: 0.9, friction: 0.05, density: 0.01,
        label: "spinner", render: { fillStyle: "#ff6600" },
      });
      const pivot = Constraint.create({
        pointA: { x: row.x, y: row.y }, bodyB: bar,
        pointB: { x: 0, y: 0 }, stiffness: 1, length: 0,
      });
      Body.setAngularVelocity(bar, (Math.random() - 0.5) * 0.1);
      obstacles.push(bar);
      constraints.push(pivot);
      Composite.add(world, [bar, pivot]);
    } else if (row.type === "ramp") {
      const w = row.w || 150;
      exclusionZones.push({ x: row.x, y: row.y, r: w / 2 + 50 });
      const ramp = Bodies.rectangle(row.x, row.y, w, 10, {
        isStatic: true, angle: row.angle || 0.35, restitution: 0.4, friction: 0.03,
        label: "ramp", render: { fillStyle: "#4a9eff" },
      });
      obstacles.push(ramp);
      Composite.add(world, ramp);
    } else if (row.type === "bumper") {
      const r = row.r || 25;
      exclusionZones.push({ x: row.x, y: row.y, r: r + 50 });
      const bumper = Bodies.circle(row.x, row.y, r, {
        isStatic: true, restitution: 1.3, friction: 0,
        label: "bumper", render: { fillStyle: "#ff3366" },
      });
      obstacles.push(bumper);
      Composite.add(world, bumper);
    }
  });

  // Peg rows - only where no obstacles exist
  for (let row = 0; row < 50; row++) {
    const y = 350 + row * 90;
    const cols = row % 2 === 0 ? 7 : 6;
    const offsetX = row % 2 === 0 ? 80 : 130;
    for (let col = 0; col < cols; col++) {
      const x = offsetX + col * 115;
      if (x <= 40 || x >= WORLD_WIDTH - 40) continue;

      const tooClose = exclusionZones.some((zone) => {
        const dx = x - zone.x;
        const dy = y - zone.y;
        return Math.sqrt(dx * dx + dy * dy) < zone.r;
      });
      if (tooClose) continue;

      const peg = Bodies.circle(x, y, 8, {
        isStatic: true, restitution: 0.9, friction: 0.03,
        label: "peg", render: { fillStyle: "#666" },
      });
      obstacles.push(peg);
      Composite.add(world, peg);
    }
  }

  // Finish line
  const finishLine = Bodies.rectangle(WORLD_WIDTH / 2, FINISH_Y + 40, WORLD_WIDTH - 60, 20, {
    isStatic: true,
    isSensor: true,
    label: "finish",
    render: { fillStyle: "#ffcc00" },
  });
  Composite.add(world, finishLine);

  return { obstacles, constraints };
}

// ─── Main Component ─────────────────────────────────────────
export default function PinballGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const ballStatesRef = useRef<BallState[]>([]);
  const [commentary, setCommentary] = useState<CommentaryItem[]>([]);
  const [rankings, setRankings] = useState<{ number: number; color: string; rank: number }[]>([]);
  const [gamePhase, setGamePhase] = useState<"ready" | "running" | "finished">("ready");
  const [loser, setLoser] = useState<string | null>(null);
  const [cameraTarget, setCameraTarget] = useState<string>("");
  const [cameraMode, setCameraMode] = useState<string>("전체 조감");
  const finishCountRef = useRef(0);
  const commentaryIdRef = useRef(0);
  const cameraRef = useRef({ x: WORLD_WIDTH / 2, y: 300, zoom: 1 });
  const lastLeaderRef = useRef<string>("");
  const lastTrailerRef = useRef<string>("");
  const animFrameRef = useRef<number>(0);
  const runnerRef = useRef<Matter.Runner | null>(null);

  const addCommentary = useCallback((text: string) => {
    const id = ++commentaryIdRef.current;
    setCommentary((prev) => [{ id, text, timestamp: Date.now() }, ...prev].slice(0, 8));
  }, []);

  const startGame = useCallback(() => {
    // Clean up previous game
    if (engineRef.current) {
      if (runnerRef.current) {
        Matter.Runner.stop(runnerRef.current);
      }
      Matter.Engine.clear(engineRef.current);
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    finishCountRef.current = 0;
    lastLeaderRef.current = "";
    lastTrailerRef.current = "";
    setRankings([]);
    setLoser(null);
    setCommentary([]);
    setGamePhase("running");

    const { Engine, Runner, Bodies, Composite, Body, Events, Constraint } = Matter;
    const engine = Engine.create({
      gravity: { x: 0, y: 1.2, scale: 0.001 },
    });
    engineRef.current = engine;

    // Create obstacles
    createObstacles(engine.world, Composite, Bodies, Body, Constraint);

    // Create balls with random starting positions
    const shuffledStartX = Array.from({ length: PARTICIPANT_NAMES.length }, (_, i) =>
      50 + Math.random() * (WORLD_WIDTH - 100)
    );
    const balls: BallState[] = PARTICIPANT_NAMES.map((name, i) => {
      const num = i + 1;
      const x = shuffledStartX[i];
      const body = Bodies.circle(x, 30 + Math.random() * 50, BALL_RADIUS, {
        restitution: 0.6,
        friction: 0.05,
        density: 0.002,
        frictionAir: 0.001,
        label: `ball_${num}`,
        render: { fillStyle: BALL_COLORS[i] },
      });
      Composite.add(engine.world, body);
      return {
        name,
        number: num,
        color: BALL_COLORS[i],
        x: body.position.x,
        y: body.position.y,
        rank: null,
        finished: false,
        body,
      };
    });
    ballStatesRef.current = balls;

    addCommentary("🎬 커피 핀볼 룰렛이 시작됩니다! 15개의 공이 출발합니다!");
    setTimeout(() => addCommentary("🎯 가장 늦게 도착하는 사람이 커피를 삽니다!"), 1500);

    // Collision events for commentary
    let lastCommentTime = 0;
    Events.on(engine, "collisionStart", (event) => {
      const now = Date.now();
      if (now - lastCommentTime < 2000) return;

      for (const pair of event.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        const ballLabel = labels.find((l) => l.startsWith("ball_"));
        const otherLabel = labels.find((l) => !l.startsWith("ball_"));

        if (ballLabel && otherLabel) {
          const ballNum = ballLabel.replace("ball_", "");
          if (otherLabel === "bumper" || otherLabel === "spinner") {
            lastCommentTime = now;
            addCommentary(pickRandom(COMMENTARY_TEMPLATES.collision).replace("{id}", ballNum));
          }
        }
      }
    });

    // Anti-stuck: track each ball's last Y position
    const lastBallY: number[] = balls.map(() => 0);
    const stuckTimers: number[] = balls.map(() => 0);

    // Camera tracking variables
    let cameraSwitchTime = 0;
    let currentCameraMode = 0; // 0=leader, 1=trailer, 2=pack, 3=overview
    const cameraModes = ["선두 추적", "꼴찌 추적", "중간 집단", "전체 조감"];

    // Runner
    const runner = Runner.create({ delta: 1000 / 60 });
    runnerRef.current = runner;
    Runner.run(runner, engine);

    // Render loop
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastStuckCheck = Date.now();

    const render = () => {
      const now = Date.now();

      // Anti-stuck detection: every 2 seconds, check if balls moved
      if (now - lastStuckCheck > 2000) {
        lastStuckCheck = now;
        for (let i = 0; i < balls.length; i++) {
          const ball = balls[i];
          if (ball.finished) continue;
          const dy = Math.abs(ball.body.position.y - lastBallY[i]);
          const speed = ball.body.speed;
          if (dy < 5 && speed < 0.5) {
            stuckTimers[i]++;
            if (stuckTimers[i] >= 2) {
              // Ball is stuck - give it a random nudge
              Body.applyForce(ball.body, ball.body.position, {
                x: (Math.random() - 0.5) * 0.005,
                y: 0.003 + Math.random() * 0.003,
              });
              stuckTimers[i] = 0;
            }
          } else {
            stuckTimers[i] = 0;
          }
          lastBallY[i] = ball.body.position.y;
        }
      }

      // Update ball states
      let allFinished = true;
      const activeBalls = balls.filter((b) => !b.finished);

      for (const ball of balls) {
        ball.x = ball.body.position.x;
        ball.y = ball.body.position.y;

        if (!ball.finished && ball.y >= FINISH_Y) {
          ball.finished = true;
          finishCountRef.current++;
          ball.rank = finishCountRef.current;

          setRankings((prev) => [...prev, { number: ball.number, color: ball.color, rank: ball.rank! }]);

          if (finishCountRef.current < PARTICIPANT_NAMES.length) {
            addCommentary(
              pickRandom(COMMENTARY_TEMPLATES.finish)
                .replace("{id}", String(ball.number))
                .replace("{rank}", String(ball.rank))
            );
          } else {
            // Last one!
            addCommentary(
              pickRandom(COMMENTARY_TEMPLATES.lastFinish).replace(/\{id\}/g, String(ball.number))
            );
            setLoser(String(ball.number));
            setGamePhase("finished");
          }
        }

        if (!ball.finished) allFinished = false;
      }

      // Leader/trailer commentary
      if (activeBalls.length > 1 && now - lastCommentTime > 3000) {
        const sorted = [...activeBalls].sort((a, b) => b.y - a.y);
        const leader = sorted[0];
        const trailer = sorted[sorted.length - 1];
        const leaderId = String(leader.number);
        const trailerId = String(trailer.number);

        if (leaderId !== lastLeaderRef.current && Math.random() < 0.3) {
          lastLeaderRef.current = leaderId;
          addCommentary(pickRandom(COMMENTARY_TEMPLATES.leading).replace("{id}", leaderId));
        } else if (trailerId !== lastTrailerRef.current && Math.random() < 0.3) {
          lastTrailerRef.current = trailerId;
          addCommentary(pickRandom(COMMENTARY_TEMPLATES.trailing).replace("{id}", trailerId));
        }
      }

      // Camera logic - switch mode every 4 seconds
      if (now - cameraSwitchTime > 4000 && activeBalls.length > 0) {
        cameraSwitchTime = now;
        currentCameraMode = (currentCameraMode + 1) % cameraModes.length;
        setCameraMode(cameraModes[currentCameraMode]);
      }

      // Calculate camera target
      let targetX = WORLD_WIDTH / 2;
      let targetY = WORLD_HEIGHT / 2;
      let targetZoom = 0.2;
      let trackingName = "";

      if (activeBalls.length > 0) {
        const sorted = [...activeBalls].sort((a, b) => b.y - a.y);

        switch (currentCameraMode) {
          case 0: { // Leader
            const leader = sorted[0];
            targetX = leader.x;
            targetY = leader.y;
            targetZoom = 0.7;
            trackingName = `#${leader.number}`;
            break;
          }
          case 1: { // Trailer (danger zone!)
            const trailer = sorted[sorted.length - 1];
            targetX = trailer.x;
            targetY = trailer.y;
            targetZoom = 0.7;
            trackingName = `#${trailer.number}`;
            break;
          }
          case 2: { // Pack - follow middle group
            const mid = Math.floor(sorted.length / 2);
            const packBalls = sorted.slice(Math.max(0, mid - 2), mid + 3);
            const avgX = packBalls.reduce((s, b) => s + b.x, 0) / packBalls.length;
            const avgY = packBalls.reduce((s, b) => s + b.y, 0) / packBalls.length;
            targetX = avgX;
            targetY = avgY;
            targetZoom = 0.5;
            trackingName = "중간 집단";
            break;
          }
          case 3: { // Overview
            const minY = Math.min(...activeBalls.map((b) => b.y));
            const maxY = Math.max(...activeBalls.map((b) => b.y));
            targetX = WORLD_WIDTH / 2;
            targetY = (minY + maxY) / 2;
            const spread = maxY - minY + 400;
            targetZoom = Math.max(0.15, Math.min(0.5, (canvas.height) / spread));
            trackingName = "전체";
            break;
          }
        }
      }

      setCameraTarget(trackingName);

      // Smooth camera
      const cam = cameraRef.current;
      cam.x += (targetX - cam.x) * 0.05;
      cam.y += (targetY - cam.y) * 0.05;
      cam.zoom += (targetZoom - cam.zoom) * 0.05;

      // Draw
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, "#0a0a2e");
      bgGrad.addColorStop(0.5, "#1a1a3e");
      bgGrad.addColorStop(1, "#0a0a2e");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      // Apply camera transform
      ctx.translate(w / 2, h / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      // Draw finish line
      ctx.fillStyle = "rgba(255, 204, 0, 0.3)";
      ctx.fillRect(15, FINISH_Y + 30, WORLD_WIDTH - 30, 20);
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.strokeRect(15, FINISH_Y + 30, WORLD_WIDTH - 30, 20);
      ctx.setLineDash([]);

      // "FINISH" text
      ctx.fillStyle = "#ffcc00";
      ctx.font = "bold 28px Arial";
      ctx.textAlign = "center";
      ctx.fillText("🏁 FINISH LINE 🏁", WORLD_WIDTH / 2, FINISH_Y + 20);

      // Draw obstacles from world bodies
      const allBodies = Matter.Composite.allBodies(engine.world);
      for (const body of allBodies) {
        if (body.label.startsWith("ball_")) continue;
        if (body.label === "finish") continue;

        const vertices = body.vertices;
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let j = 1; j < vertices.length; j++) {
          ctx.lineTo(vertices[j].x, vertices[j].y);
        }
        ctx.closePath();

        if (body.label === "peg") {
          const pegGrad = ctx.createRadialGradient(body.position.x, body.position.y, 0, body.position.x, body.position.y, 12);
          pegGrad.addColorStop(0, "#999");
          pegGrad.addColorStop(1, "#444");
          ctx.fillStyle = pegGrad;
        } else if (body.label === "spinner") {
          ctx.fillStyle = "#ff6600";
          ctx.shadowColor = "#ff6600";
          ctx.shadowBlur = 10;
        } else if (body.label === "bumper") {
          const bGrad = ctx.createRadialGradient(body.position.x, body.position.y, 0, body.position.x, body.position.y, 35);
          bGrad.addColorStop(0, "#ff6688");
          bGrad.addColorStop(1, "#cc2244");
          ctx.fillStyle = bGrad;
          ctx.shadowColor = "#ff3366";
          ctx.shadowBlur = 15;
        } else if (body.label === "ramp") {
          ctx.fillStyle = "#4a9eff";
          ctx.shadowColor = "#4a9eff";
          ctx.shadowBlur = 5;
        } else if (body.label === "gate") {
          ctx.fillStyle = "#44aa88";
        } else if (body.label === "wall") {
          ctx.fillStyle = "#333";
        } else {
          ctx.fillStyle = "#555";
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw balls
      for (const ball of balls) {
        if (ball.finished) continue;

        const bx = ball.x;
        const by = ball.y;

        // Glow
        ctx.shadowColor = ball.color;
        ctx.shadowBlur = 20;

        // Ball body
        const grad = ctx.createRadialGradient(bx - 4, by - 4, 0, bx, by, BALL_RADIUS);
        grad.addColorStop(0, "#fff");
        grad.addColorStop(0.3, ball.color);
        grad.addColorStop(1, ball.color + "88");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Number label on ball
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ball.number), bx, by);

        // Number tag above
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        const tagText = `#${ball.number}`;
        const tagWidth = ctx.measureText(tagText).width + 10;
        ctx.fillRect(bx - tagWidth / 2, by - BALL_RADIUS - 20, tagWidth, 16);
        ctx.fillStyle = ball.color;
        ctx.font = "bold 10px Arial";
        ctx.fillText(tagText, bx, by - BALL_RADIUS - 12);
      }

      ctx.restore();

      if (!allFinished) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);
  }, [addCommentary]);

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Top broadcast bar */}
      <div className="absolute top-0 left-0 right-0 h-11 bg-gradient-to-r from-red-900/90 via-red-800/90 to-red-900/90 flex items-center px-4 z-10 border-b border-red-600/50">
        <div className="flex items-center gap-2 shrink-0">
          <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse whitespace-nowrap">LIVE</span>
          <span className="text-white font-bold text-xs whitespace-nowrap">☕ COFFEE PINBALL</span>
        </div>
        {gamePhase === "running" && (
          <div className="ml-auto flex items-center gap-2 text-[10px] text-white/80 shrink-0">
            <span className="bg-white/10 px-2 py-1 rounded whitespace-nowrap">📷 {cameraMode}</span>
            <span className="bg-white/10 px-2 py-1 rounded whitespace-nowrap">🎯 {cameraTarget}</span>
            <span className="bg-yellow-600/80 px-2 py-1 rounded font-bold whitespace-nowrap">{rankings.length}/{PARTICIPANT_NAMES.length} 골인</span>
          </div>
        )}
      </div>

      {/* Commentary panel - left side */}
      {gamePhase === "running" && (
        <div className="absolute left-3 top-14 z-10" style={{ width: "min(320px, 40vw)" }}>
          <div className="bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-900/80 to-purple-900/80 px-3 py-2 border-b border-white/10">
              <span className="text-white text-xs font-bold whitespace-nowrap">💬 실시간 중계</span>
            </div>
            <div className="p-3 max-h-48 overflow-hidden">
              {commentary.map((c, i) => (
                <div
                  key={c.id}
                  className="text-[11px] leading-relaxed py-1 border-b border-white/5 last:border-0"
                  style={{
                    opacity: 1 - i * 0.15,
                    color: i === 0 ? "#fff" : "#aaa",
                    fontWeight: i === 0 ? "bold" : "normal",
                  }}
                >
                  {c.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rankings panel - right side */}
      {gamePhase === "running" && rankings.length > 0 && (
        <div className="absolute right-3 top-14 z-10" style={{ width: "min(200px, 30vw)" }}>
          <div className="bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden">
            <div className="bg-gradient-to-r from-yellow-900/80 to-orange-900/80 px-3 py-2 border-b border-white/10">
              <span className="text-white text-xs font-bold whitespace-nowrap">🏆 골인 순서</span>
            </div>
            <div className="p-2 max-h-64 overflow-y-auto">
              {rankings.map((r) => (
                <div
                  key={r.number}
                  className="flex items-center gap-2 py-1.5 text-xs border-b border-white/5 last:border-0 whitespace-nowrap"
                >
                  <span className="w-7 text-center font-bold shrink-0" style={{ color: r.rank <= 3 ? "#ffd700" : "#888" }}>
                    {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `${r.rank}등`}
                  </span>
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="text-white">#{r.number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Start screen */}
      {gamePhase === "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gradient-to-b from-[#0a0a2e] to-[#1a0a2e] px-6">
          <div className="text-center max-w-lg">
            <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-red-400 to-pink-400 mb-4 leading-tight">
              ☕ COFFEE PINBALL
            </h1>
            <p className="text-base sm:text-lg text-white/60 mb-1">누가 커피를 살까? 핀볼로 결정하자!</p>
            <p className="text-sm text-white/40 mb-8">15명의 공이 떨어집니다. 꼴찌가 커피를 삽니다!</p>

            <div className="flex flex-wrap justify-center gap-2.5 mb-10 max-w-md mx-auto">
              {BALL_COLORS.map((color, i) => (
                <span
                  key={i}
                  className="w-10 h-10 rounded-full text-sm font-bold text-white flex items-center justify-center shadow-md"
                  style={{ backgroundColor: color + "CC" }}
                >
                  {i + 1}
                </span>
              ))}
            </div>

            <button
              onClick={startGame}
              className="px-12 py-4 bg-gradient-to-r from-red-600 to-orange-500 text-white text-xl font-black rounded-full hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-red-500/30 cursor-pointer"
            >
              🎰 게임 시작!
            </button>
          </div>
        </div>
      )}

      {/* Finish screen */}
      {gamePhase === "finished" && loser && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/80 backdrop-blur-sm px-4">
          <div className="text-center py-8 px-8 sm:px-10 bg-gradient-to-b from-[#1a0a2e] to-[#0a0a2e] rounded-2xl border border-yellow-500/30 shadow-2xl shadow-yellow-500/20 w-full max-w-sm sm:max-w-md">
            <div className="text-6xl mb-3">☕</div>
            <h2 className="text-3xl font-black text-yellow-400 mb-2">게임 종료!</h2>
            <p className="text-lg text-white/80 mb-5">오늘 커피는...</p>
            <div
              className="inline-block px-8 py-4 rounded-2xl text-5xl font-black text-white mb-3"
              style={{
                backgroundColor: BALL_COLORS[Number(loser) - 1] + "DD",
                boxShadow: `0 0 40px ${BALL_COLORS[Number(loser) - 1]}66`,
              }}
            >
              #{loser}
            </div>
            <p className="text-lg text-yellow-300 mb-6">번이 커피를 삽니다! 🎉</p>

            {/* Full ranking */}
            <div className="bg-black/50 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
              <p className="text-[11px] text-white/50 mb-2 font-bold">최종 순위</p>
              {rankings.map((r) => (
                <div
                  key={r.number}
                  className="flex items-center gap-2 py-1.5 text-sm whitespace-nowrap"
                  style={{ color: String(r.number) === loser ? "#ff6666" : "#ccc" }}
                >
                  <span className="w-8 text-right font-bold shrink-0">
                    {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `${r.rank}등`}
                  </span>
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className={String(r.number) === loser ? "font-bold" : ""}>#{r.number}</span>
                  {String(r.number) === loser && <span className="ml-auto text-xs">☕ 커피 당첨!</span>}
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                setGamePhase("ready");
              }}
              className="px-10 py-3.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg font-bold rounded-full hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            >
              🔄 다시 하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
