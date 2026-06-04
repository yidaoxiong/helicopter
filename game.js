const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const currentDistanceEl = document.getElementById("currentDistance");
const bestDistanceEl = document.getElementById("bestDistance");
const currentNeedleEl = document.getElementById("currentNeedle");
const bestNeedleEl = document.getElementById("bestNeedle");
const startOverlayEl = document.getElementById("startOverlay");
const gameOverOverlayEl = document.getElementById("gameOverOverlay");
const finalDistanceTextEl = document.getElementById("finalDistanceText");
const speedBadgeEl = document.getElementById("speedBadge");
const statusBadgeEl = document.getElementById("statusBadge");
const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-button"));

const BEST_SCORE_KEY = "helicopter-run-best-distance-v2";

const DIFFICULTY_PRESETS = {
  easy: {
    label: "轻松",
    gapBaseScale: 0.36,
    gapMinScale: 0.29,
    gapMaxScale: 0.42
  },
  normal: {
    label: "标准",
    gapBaseScale: 0.3,
    gapMinScale: 0.23,
    gapMaxScale: 0.35
  },
  hard: {
    label: "极限",
    gapBaseScale: 0.25,
    gapMinScale: 0.19,
    gapMaxScale: 0.3
  }
};

function readBestScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_SCORE_KEY) || "{}");
    return {
      easy: Number.parseInt(raw.easy || "0", 10) || 0,
      normal: Number.parseInt(raw.normal || "0", 10) || 0,
      hard: Number.parseInt(raw.hard || "0", 10) || 0
    };
  } catch {
    return {
      easy: 0,
      normal: 0,
      hard: 0
    };
  }
}

const state = {
  phase: "ready",
  selectedDifficulty: "normal",
  width: 1280,
  height: 720,
  dpr: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
  time: 0,
  distance: 0,
  bestScores: readBestScores(),
  bestDistance: 0,
  cameraX: 0,
  scrollSpeed: 260,
  terrain: [],
  obstacles: [],
  particles: [],
  lastTimestamp: 0,
  lastObstacleX: 0,
  rotorAngle: 0,
  audioUnlocked: false,
  heli: {
    x: 0,
    y: 0,
    velocityY: 0,
    width: 86,
    height: 32,
    tilt: 0
  }
};

state.bestDistance = state.bestScores[state.selectedDifficulty];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.beat = 0;
    this.intervalId = null;
  }

  async unlock() {
    if (!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) {
        return;
      }

      this.ctx = new Context();
      this.master = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.master.gain.value = 0.18;
      this.musicGain.gain.value = 0.42;
      this.sfxGain.gain.value = 0.75;

      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(this.ctx.destination);

      this.startDrone();
      this.startSequence();
    }

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  startDrone() {
    if (!this.ctx) {
      return;
    }

    const osc = this.ctx.createOscillator();
    const low = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const lowGain = this.ctx.createGain();

    osc.type = "triangle";
    osc.frequency.value = 196;
    low.type = "sine";
    low.frequency.value = 98;
    filter.type = "lowpass";
    filter.frequency.value = 840;
    filter.Q.value = 2;
    gain.gain.value = 0.03;
    lowGain.gain.value = 0.02;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    low.connect(lowGain);
    lowGain.connect(this.musicGain);

    osc.start();
    low.start();
  }

  startSequence() {
    if (this.intervalId) {
      return;
    }

    this.intervalId = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== "running") {
        return;
      }

      const start = this.ctx.currentTime + 0.05;
      const bassPattern = [130.81, null, 146.83, null, 164.81, null, 146.83, null];
      const leadPattern = [523.25, 659.25, 587.33, 493.88, 659.25, 783.99, 587.33, 440];
      const accentPattern = [null, 783.99, null, 698.46, null, 880, null, 659.25];
      const index = this.beat % bassPattern.length;

      if (bassPattern[index]) {
        this.playTone({
          start,
          duration: 0.26,
          frequency: bassPattern[index],
          type: "triangle",
          gain: 0.055
        });
      }

      this.playTone({
        start,
        duration: 0.2,
        frequency: leadPattern[index],
        type: "sine",
        gain: 0.035
      });

      if (accentPattern[index]) {
        this.playTone({
          start: start + 0.07,
          duration: 0.14,
          frequency: accentPattern[index],
          type: "square",
          gain: 0.02
        });
      }

      this.beat += 1;
    }, 240);
  }

  playTone({ start, duration, frequency, type, gain }) {
    if (!this.ctx) {
      return;
    }

    const osc = this.ctx.createOscillator();
    const toneGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(type === "square" ? 1500 : 2200, start);
    toneGain.gain.setValueAtTime(0.0001, start);
    toneGain.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(filter);
    filter.connect(toneGain);
    toneGain.connect(this.musicGain);

    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  crash() {
    if (!this.ctx) {
      return;
    }

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.28);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(900, now);
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.35);

    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(0.12, now + 0.12);
    this.musicGain.gain.linearRampToValueAtTime(0.42, now + 1.1);
  }
}

const audio = new AudioEngine();

function resizeCanvas() {
  state.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const rect = canvas.getBoundingClientRect();
  state.width = Math.max(320, Math.floor(rect.width));
  state.height = Math.max(420, Math.floor(rect.height));
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.heli.x = state.width * 0.24;
}

function saveBestScores() {
  localStorage.setItem(BEST_SCORE_KEY, JSON.stringify(state.bestScores));
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatDistance(distance) {
  return String(Math.floor(distance)).padStart(4, "0");
}

function meterAngle(distance) {
  const normalized = Math.min(distance, 9999) / 9999;
  return -130 + normalized * 260;
}

function updateMeters() {
  currentDistanceEl.textContent = formatDistance(state.distance);
  bestDistanceEl.textContent = formatDistance(state.bestDistance);
  currentNeedleEl.style.transform = `translate(-8px, -50%) rotate(${meterAngle(state.distance)}deg)`;
  bestNeedleEl.style.transform = `translate(-8px, -50%) rotate(${meterAngle(state.bestDistance)}deg)`;
}

function setOverlayVisibility(element, visible) {
  element.classList.toggle("overlay-visible", visible);
}

function setStatus(text) {
  statusBadgeEl.textContent = text;
}

function updateDifficultyButtons() {
  for (const button of difficultyButtons) {
    const isActive = button.dataset.difficulty === state.selectedDifficulty;
    button.classList.toggle("is-active", isActive);
    button.disabled = state.phase === "running";
  }
}

function setDifficulty(level) {
  if (!DIFFICULTY_PRESETS[level] || state.phase === "running") {
    return;
  }

  state.selectedDifficulty = level;
  state.bestDistance = state.bestScores[level] || 0;
  updateDifficultyButtons();
  updateMeters();
  initializeTerrain();
  state.heli.y = state.height * 0.5;
  render();
  setStatus(`${DIFFICULTY_PRESETS[level].label}难度，等待起飞`);
}

function initializeTerrain() {
  const preset = DIFFICULTY_PRESETS[state.selectedDifficulty];
  const minGap = Math.max(112, state.height * preset.gapMinScale);
  const maxGap = Math.max(minGap + 22, state.height * preset.gapMaxScale);
  const baseGap = clamp(state.height * preset.gapBaseScale, minGap, maxGap);

  state.terrain = [{
    x: 0,
    center: state.height * 0.5,
    gap: baseGap
  }];
  state.lastObstacleX = state.width;
  generateTerrain(state.width * 3);
  state.obstacles = [];
  generateObstacles(state.width * 2.6);
}

function generateTerrain(untilX) {
  let last = state.terrain[state.terrain.length - 1];
  let drift = 0;
  const preset = DIFFICULTY_PRESETS[state.selectedDifficulty];
  const minGap = Math.max(112, state.height * preset.gapMinScale);
  const maxGap = Math.max(minGap + 22, state.height * preset.gapMaxScale);

  while (last.x < untilX) {
    const distanceFactor = Math.min(1, last.x / 8000);
    const step = random(90, 150);
    drift = clamp(drift + random(-36, 36), -58, 58);

    const nextGap = clamp(
      last.gap + random(-20, 20) - distanceFactor * 10,
      minGap,
      maxGap
    );
    const margin = 84;
    const centerMin = margin + nextGap / 2;
    const centerMax = state.height - margin - nextGap / 2;
    const nextCenter = clamp(last.center + drift, centerMin, centerMax);

    last = {
      x: last.x + step,
      center: nextCenter,
      gap: nextGap
    };
    state.terrain.push(last);
  }
}

function getTunnelAt(worldX) {
  let index = 0;

  while (
    index < state.terrain.length - 2 &&
    state.terrain[index + 1].x <= worldX
  ) {
    index += 1;
  }

  const current = state.terrain[index];
  const next = state.terrain[Math.min(index + 1, state.terrain.length - 1)];
  const span = Math.max(1, next.x - current.x);
  const t = clamp((worldX - current.x) / span, 0, 1);
  const center = lerp(current.center, next.center, t);
  const gap = lerp(current.gap, next.gap, t);

  return {
    center,
    gap,
    top: center - gap / 2,
    bottom: center + gap / 2
  };
}

function generateObstacles(untilX) {
  while (state.lastObstacleX < untilX) {
    const spacing = random(260, 420);
    const x = state.lastObstacleX + spacing;
    const tunnel = getTunnelAt(x);
    const minPassage = Math.max(92, tunnel.gap * 0.42);
    const maxHeight = tunnel.gap - minPassage - 22;

    state.lastObstacleX = x;

    if (maxHeight < 48) {
      continue;
    }

    const fromTop = Math.random() < 0.5;
    const width = random(46, 92);
    const height = random(48, maxHeight);
    const obstacle = {
      x,
      y: fromTop ? tunnel.top : tunnel.bottom - height,
      width,
      height,
      fromTop
    };

    state.obstacles.push(obstacle);
  }
}

function resetGame() {
  state.phase = "running";
  state.time = 0;
  state.distance = 0;
  state.cameraX = 0;
  state.scrollSpeed = 260;
  state.rotorAngle = 0;
  state.particles = [];
  state.heli.y = state.height * 0.5;
  state.heli.velocityY = 0;
  state.heli.tilt = 0;
  initializeTerrain();
  updateMeters();
  updateDifficultyButtons();
  setOverlayVisibility(startOverlayEl, false);
  setOverlayVisibility(gameOverOverlayEl, false);
  setStatus(`${DIFFICULTY_PRESETS[state.selectedDifficulty].label}难度飞行中`);
}

function spawnSparks(x, y, intensity = 20) {
  for (let i = 0; i < intensity; i += 1) {
    const angle = random(-Math.PI * 0.95, Math.PI * 0.95);
    const speed = random(90, 360);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: random(0.28, 0.66),
      age: 0,
      size: random(2, 4.4),
      hue: random(18, 48)
    });
  }
}

function endRun(collisionPoint) {
  if (state.phase !== "running") {
    return;
  }

  state.phase = "gameover";
  const score = Math.floor(state.distance);
  const difficulty = state.selectedDifficulty;
  state.bestScores[difficulty] = Math.max(state.bestScores[difficulty] || 0, score);
  state.bestDistance = state.bestScores[difficulty];
  saveBestScores();
  updateMeters();
  updateDifficultyButtons();
  finalDistanceTextEl.textContent = `${DIFFICULTY_PRESETS[difficulty].label}难度飞行 ${score} m`;
  setOverlayVisibility(gameOverOverlayEl, true);
  setStatus("坠毁，按空格重开");
  spawnSparks(collisionPoint.x, collisionPoint.y, 28);
  audio.crash();
}

function getHelicopterPoints() {
  const heli = state.heli;
  return [
    { x: heli.x - 32, y: heli.y },
    { x: heli.x - 14, y: heli.y - 14 },
    { x: heli.x + 4, y: heli.y - 15 },
    { x: heli.x + 28, y: heli.y - 4 },
    { x: heli.x + 34, y: heli.y },
    { x: heli.x + 26, y: heli.y + 8 },
    { x: heli.x + 6, y: heli.y + 15 },
    { x: heli.x - 16, y: heli.y + 14 }
  ];
}

function checkCollision() {
  const points = getHelicopterPoints();

  for (const point of points) {
    const worldX = state.cameraX + point.x;
    const tunnel = getTunnelAt(worldX);

    if (point.y <= tunnel.top + 4 || point.y >= tunnel.bottom - 4) {
      return { x: point.x, y: point.y };
    }

    for (const obstacle of state.obstacles) {
      if (
        point.x >= obstacle.x - state.cameraX &&
        point.x <= obstacle.x - state.cameraX + obstacle.width &&
        point.y >= obstacle.y &&
        point.y <= obstacle.y + obstacle.height
      ) {
        return { x: point.x, y: point.y };
      }
    }
  }

  return null;
}

function updateParticles(dt) {
  state.particles = state.particles.filter((particle) => {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.985;
    particle.vy += 540 * dt;
    return particle.age < particle.life;
  });
}

function updateRunning(dt) {
  state.time += dt;
  state.scrollSpeed = Math.min(520, 260 + state.time * 6 + state.distance * 0.022);
  state.cameraX += state.scrollSpeed * dt;
  state.distance += state.scrollSpeed * dt * 0.07;
  state.rotorAngle += dt * 22;

  state.heli.velocityY += 1750 * dt;
  state.heli.velocityY = clamp(state.heli.velocityY, -420, 620);
  state.heli.y += state.heli.velocityY * dt;
  state.heli.tilt = clamp(state.heli.velocityY * 0.0015, -0.38, 0.58);

  generateTerrain(state.cameraX + state.width * 2.4);
  generateObstacles(state.cameraX + state.width * 2.2);

  state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.width > state.cameraX - 100);
  state.terrain = state.terrain.filter((segment) => segment.x >= state.cameraX - 300);

  updateMeters();
  speedBadgeEl.textContent = `速度 ${Math.round(state.scrollSpeed * 0.78)} km/h`;

  const collisionPoint = checkCollision();
  if (collisionPoint) {
    endRun(collisionPoint);
  }
}

function drawSky() {
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, "#5b6f96");
  gradient.addColorStop(0.45, "#3a4d73");
  gradient.addColorStop(1, "#191f31");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  const sunX = state.width * 0.76;
  const sunY = state.height * 0.2;
  const sunGradient = ctx.createRadialGradient(sunX, sunY, 20, sunX, sunY, 150);
  sunGradient.addColorStop(0, "rgba(255, 214, 150, 0.8)");
  sunGradient.addColorStop(0.4, "rgba(255, 153, 91, 0.34)");
  sunGradient.addColorStop(1, "rgba(255, 153, 91, 0)");
  ctx.fillStyle = sunGradient;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 150, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 5; i += 1) {
    const cloudX = ((state.cameraX * 0.1) + i * 230) % (state.width + 260) - 120;
    const cloudY = 90 + (i % 3) * 48;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.ellipse(cloudX, cloudY, 70, 22, 0, 0, Math.PI * 2);
    ctx.ellipse(cloudX + 42, cloudY - 10, 48, 18, 0, 0, Math.PI * 2);
    ctx.ellipse(cloudX - 36, cloudY - 6, 36, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function collectTunnelSamples() {
  const topPoints = [];
  const bottomPoints = [];
  const step = 22;

  for (let screenX = -step; screenX <= state.width + step; screenX += step) {
    const tunnel = getTunnelAt(state.cameraX + screenX);
    topPoints.push({ x: screenX, y: tunnel.top });
    bottomPoints.push({ x: screenX, y: tunnel.bottom });
  }

  return { topPoints, bottomPoints };
}

function drawTerrain() {
  const { topPoints, bottomPoints } = collectTunnelSamples();

  const topGradient = ctx.createLinearGradient(0, 0, 0, state.height * 0.5);
  topGradient.addColorStop(0, "#7d4f3d");
  topGradient.addColorStop(0.6, "#5d352c");
  topGradient.addColorStop(1, "#29161c");
  ctx.fillStyle = topGradient;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const point of topPoints) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.lineTo(state.width, 0);
  ctx.closePath();
  ctx.fill();

  const bottomGradient = ctx.createLinearGradient(0, state.height, 0, state.height * 0.44);
  bottomGradient.addColorStop(0, "#402826");
  bottomGradient.addColorStop(0.4, "#5d392d");
  bottomGradient.addColorStop(1, "#7d5641");
  ctx.fillStyle = bottomGradient;
  ctx.beginPath();
  ctx.moveTo(0, state.height);
  for (let i = bottomPoints.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(bottomPoints[i].x, bottomPoints[i].y);
  }
  ctx.lineTo(state.width, state.height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 206, 150, 0.36)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  topPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();

  ctx.beginPath();
  bottomPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();

  const mist = ctx.createLinearGradient(0, state.height * 0.18, 0, state.height * 0.88);
  mist.addColorStop(0, "rgba(120, 187, 255, 0.02)");
  mist.addColorStop(0.5, "rgba(255, 255, 255, 0.06)");
  mist.addColorStop(1, "rgba(255, 210, 150, 0.04)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 0, state.width, state.height);
}

function drawObstacles() {
  for (const obstacle of state.obstacles) {
    const x = obstacle.x - state.cameraX;
    const gradient = ctx.createLinearGradient(x, obstacle.y, x + obstacle.width, obstacle.y + obstacle.height);
    gradient.addColorStop(0, obstacle.fromTop ? "#6f3c33" : "#7a523d");
    gradient.addColorStop(1, obstacle.fromTop ? "#bc7850" : "#c88d58");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x, obstacle.y);
    ctx.lineTo(x + obstacle.width * 0.82, obstacle.y + obstacle.height * 0.16);
    ctx.lineTo(x + obstacle.width, obstacle.y + obstacle.height * 0.6);
    ctx.lineTo(x + obstacle.width * 0.7, obstacle.y + obstacle.height);
    ctx.lineTo(x + obstacle.width * 0.12, obstacle.y + obstacle.height * 0.88);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 226, 178, 0.2)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function drawHelicopter() {
  const heli = state.heli;

  ctx.save();
  ctx.translate(heli.x, heli.y);
  ctx.rotate(heli.tilt);

  ctx.strokeStyle = "rgba(22, 20, 28, 0.74)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, 20);
  ctx.lineTo(18, 20);
  ctx.moveTo(-20, 26);
  ctx.lineTo(12, 26);
  ctx.stroke();

  ctx.fillStyle = "#ffb041";
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.quadraticCurveTo(-10, -18, 24, -10);
  ctx.quadraticCurveTo(40, 0, 24, 12);
  ctx.quadraticCurveTo(-12, 18, -30, 0);
  ctx.fill();

  ctx.fillStyle = "#e06a3b";
  ctx.fillRect(-4, -12, 24, 8);

  ctx.fillStyle = "#12253d";
  ctx.beginPath();
  ctx.ellipse(0, -2, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d9eef8";
  ctx.beginPath();
  ctx.ellipse(2, -4, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1f2026";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -14);
  ctx.lineTo(-8, -28);
  ctx.stroke();

  ctx.save();
  ctx.translate(-8, -30);
  ctx.rotate(state.rotorAngle);
  ctx.strokeStyle = "rgba(233, 244, 255, 0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-34, 0);
  ctx.lineTo(34, 0);
  ctx.moveTo(0, -6);
  ctx.lineTo(0, 6);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-28, 2);
  ctx.lineTo(8, 10);
  ctx.stroke();

  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of state.particles) {
    const alpha = 1 - particle.age / particle.life;
    ctx.fillStyle = `hsla(${particle.hue}, 100%, 62%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawReticle() {
  if (state.phase !== "running") {
    return;
  }

  const tunnel = getTunnelAt(state.cameraX + state.heli.x + 150);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(state.heli.x + 92, tunnel.center - 18);
  ctx.lineTo(state.heli.x + 122, tunnel.center - 18);
  ctx.lineTo(state.heli.x + 122, tunnel.center + 18);
  ctx.lineTo(state.heli.x + 92, tunnel.center + 18);
  ctx.closePath();
  ctx.stroke();
}

function render() {
  ctx.clearRect(0, 0, state.width, state.height);
  drawSky();
  drawTerrain();
  drawObstacles();
  drawReticle();
  drawHelicopter();
  drawParticles();
}

function loop(timestamp) {
  if (!state.lastTimestamp) {
    state.lastTimestamp = timestamp;
  }

  const dt = Math.min(0.032, (timestamp - state.lastTimestamp) / 1000);
  state.lastTimestamp = timestamp;

  if (state.phase === "running") {
    updateRunning(dt);
  }

  updateParticles(dt);
  render();
  window.requestAnimationFrame(loop);
}

async function onPrimaryPress(event) {
  if (event.code !== "Space" || event.repeat) {
    return;
  }

  event.preventDefault();

  if (!state.audioUnlocked) {
    state.audioUnlocked = true;
    await audio.unlock();
  } else {
    await audio.unlock();
  }

  if (state.phase === "ready" || state.phase === "gameover") {
    resetGame();
  }

  state.heli.velocityY = Math.max(state.heli.velocityY - 235, -420);
  state.heli.tilt = clamp(state.heli.velocityY * 0.0015, -0.48, 0.58);
}

function boot() {
  resizeCanvas();
  initializeTerrain();
  state.heli.y = state.height * 0.5;
  updateMeters();
  updateDifficultyButtons();
  setOverlayVisibility(startOverlayEl, true);
  setOverlayVisibility(gameOverOverlayEl, false);
  speedBadgeEl.textContent = "速度 0 km/h";
  setStatus("标准难度，等待起飞");

  window.addEventListener("keydown", onPrimaryPress);
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
    }
  });
  for (const button of difficultyButtons) {
    button.addEventListener("click", () => setDifficulty(button.dataset.difficulty));
  }
  window.addEventListener("resize", () => {
    resizeCanvas();
    if (state.phase !== "running") {
      initializeTerrain();
      state.heli.y = state.height * 0.5;
      render();
    }
  });

  window.requestAnimationFrame(loop);
}

boot();
