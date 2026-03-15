import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";

const CHANNEL_NAME = "prat-game";
const POSITION_BROADCAST_INTERVAL_MS = 33;

export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  rotation: number;
  score: number;
  life: number;
  level: number;
  color: number;
}

export interface PratCapturePayload {
  playerId: string;
  pratIndex: number;
  score: number;
}

export interface PlayerHitPayload {
  attackerId: string;
  targetId: string;
  damage: number;
}

export interface PlayerEliminatedPayload {
  victimId: string;
  attackerId: string;
  victimLevel: number;
}

export interface PlayerShotPayload {
  shooterId: string;
  targetId: string;
  startX: number;
  startY: number;
  directionX: number;
  directionY: number;
}

export interface MultiplayerCallbacks {
  onRemotePlayerUpdate: (players: Map<string, RemotePlayer>) => void;
  onPratCaptured: (pratIndex: number, playerId: string) => void;
  onPlayerHit?: (payload: PlayerHitPayload) => void;
  onPlayerShot?: (payload: PlayerShotPayload) => void;
  onPlayerEliminated?: (payload: PlayerEliminatedPayload) => void;
  onConnected?: () => void;
  getLocalState: () => { x: number; y: number; rotation: number; score: number; life: number; level: number };
}

function generatePlayerId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getOrCreatePlayerId(): string {
  const storageKey = "prat-player-id";
  let id = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
  if (!id) {
    id = generatePlayerId();
    localStorage.setItem(storageKey, id);
  }
  return id;
}

const PLAYER_COLORS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xdda0dd, 0x98d8c8];

function hashToColor(str: string): number {
  let hash = 0;
  for (let index = 0; index < str.length; index++) {
    hash = str.charCodeAt(index) + ((hash << 5) - hash);
  }
  return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
}

export class MultiplayerManager {
  private channel: RealtimeChannel | null = null;
  private playerId: string;
  private callbacks: MultiplayerCallbacks;
  private remotePlayers = new Map<string, RemotePlayer>();
  private positionBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private lastPosition = { x: 400, y: 300, rotation: 0 };
  private isConnected = false;

  constructor(callbacks: MultiplayerCallbacks) {
    this.playerId = getOrCreatePlayerId();
    this.callbacks = callbacks;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getRemotePlayers(): Map<string, RemotePlayer> {
    return new Map(this.remotePlayers);
  }

  isActive(): boolean {
    return this.isConnected;
  }

  connect(): void {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const supabase = createClient();
    this.channel = supabase.channel(CHANNEL_NAME);

    this.channel
      .on("broadcast", { event: "player-position" }, (payload) => {
        const { playerId, x, y, rotation, score, life, level } = payload.payload;
        if (playerId === this.playerId) return;
        const existing = this.remotePlayers.get(playerId);
        const color = existing?.color ?? hashToColor(playerId);
        this.remotePlayers.set(playerId, {
          id: playerId,
          x,
          y,
          rotation,
          score: score ?? existing?.score ?? 0,
          life: life ?? existing?.life ?? 100,
          level: level ?? existing?.level ?? 1,
          color,
        });
        this.callbacks.onRemotePlayerUpdate(this.getRemotePlayers());
      })
      .on("broadcast", { event: "player-join" }, (payload) => {
        const { playerId, x, y, rotation, score, life, level } = payload.payload;
        if (playerId === this.playerId) return;
        const color = hashToColor(playerId);
        this.remotePlayers.set(playerId, {
          id: playerId,
          x,
          y,
          rotation,
          score: score ?? 0,
          life: life ?? 100,
          level: level ?? 1,
          color,
        });
        this.callbacks.onRemotePlayerUpdate(this.getRemotePlayers());
      })
      .on("broadcast", { event: "player-leave" }, (payload) => {
        const { playerId } = payload.payload;
        this.remotePlayers.delete(playerId);
        this.callbacks.onRemotePlayerUpdate(this.getRemotePlayers());
      })
      .on("broadcast", { event: "player-hit" }, (payload) => {
        const data = payload.payload as PlayerHitPayload;
        this.callbacks.onPlayerHit?.(data);
      })
      .on("broadcast", { event: "player-eliminated" }, (payload) => {
        const data = payload.payload as PlayerEliminatedPayload;
        this.callbacks.onPlayerEliminated?.(data);
      })
      .on("broadcast", { event: "player-shot" }, (payload) => {
        const data = payload.payload as PlayerShotPayload;
        if (data.shooterId === this.playerId) return;
        this.callbacks.onPlayerShot?.(data);
      })
      .on("broadcast", { event: "prat-capture" }, (payload) => {
        const { pratIndex, playerId } = payload.payload as PratCapturePayload;
        this.callbacks.onPratCaptured(pratIndex, playerId);
        const existing = this.remotePlayers.get(playerId);
        if (existing) {
          existing.score = payload.payload.score;
          this.remotePlayers.set(playerId, existing);
          this.callbacks.onRemotePlayerUpdate(this.getRemotePlayers());
        }
      })
      .subscribe((status) => {
        this.isConnected = status === "SUBSCRIBED";
        if (this.isConnected) {
          this.broadcastJoin();
          this.startPositionBroadcast();
          this.callbacks.onConnected?.();
        }
      });
  }

  private broadcastJoin(): void {
    this.channel?.send({
      type: "broadcast",
      event: "player-join",
      payload: {
        playerId: this.playerId,
        ...this.lastPosition,
        score: 0,
        life: 100,
        level: 1,
      },
    });
  }

  broadcastPosition(x: number, y: number, rotation: number, score: number, life: number, level: number): void {
    this.lastPosition = { x, y, rotation };
    this.channel?.send({
      type: "broadcast",
      event: "player-position",
      payload: {
        playerId: this.playerId,
        x,
        y,
        rotation,
        score,
        life,
        level,
      },
    });
  }

  broadcastPlayerEliminated(attackerId: string, victimId: string, victimLevel: number): void {
    this.channel?.send({
      type: "broadcast",
      event: "player-eliminated",
      payload: {
        victimId,
        attackerId,
        victimLevel,
      },
    });
  }

  broadcastPlayerShot(targetId: string, startX: number, startY: number, directionX: number, directionY: number): void {
    this.channel?.send({
      type: "broadcast",
      event: "player-shot",
      payload: {
        shooterId: this.playerId,
        targetId,
        startX,
        startY,
        directionX,
        directionY,
      },
    });
  }

  broadcastPlayerHit(targetId: string, damage: number): void {
    this.channel?.send({
      type: "broadcast",
      event: "player-hit",
      payload: {
        attackerId: this.playerId,
        targetId,
        damage,
      },
    });
  }

  broadcastPratCapture(pratIndex: number, score: number): void {
    this.channel?.send({
      type: "broadcast",
      event: "prat-capture",
      payload: {
        playerId: this.playerId,
        pratIndex,
        score,
      },
    });
  }

  private startPositionBroadcast(): void {
    this.positionBroadcastTimer = setInterval(() => {
      if (this.isConnected) {
        const state = this.callbacks.getLocalState();
        this.lastPosition = { x: state.x, y: state.y, rotation: state.rotation };
        this.broadcastPosition(state.x, state.y, state.rotation, state.score, state.life, state.level);
      }
    }, POSITION_BROADCAST_INTERVAL_MS);
  }

  disconnect(): void {
    if (this.positionBroadcastTimer) {
      clearInterval(this.positionBroadcastTimer);
      this.positionBroadcastTimer = null;
    }
    this.channel?.send({
      type: "broadcast",
      event: "player-leave",
      payload: { playerId: this.playerId },
    });
    this.channel?.unsubscribe();
    this.channel = null;
    this.isConnected = false;
    this.remotePlayers.clear();
  }
}
