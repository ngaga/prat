import type { RealtimeChannel } from "@supabase/supabase-js";
import type { PlayerInput, SerializableGameState } from "@/lib/gameTypes";
import { playerIdToColor } from "@/lib/playerColor";
import { createClient } from "@/lib/supabase";

const CHANNEL_NAME = "prat-game";
const POSITION_BROADCAST_INTERVAL_MS = 33;

export interface RemotePlayer {
  id: string;
  name?: string;
  x: number;
  y: number;
  rotation: number;
  score: number;
  life: number;
  level: number;
  color: number;
  isGhost?: boolean;
  ghostPratsCaptured?: number;
}

export interface MultiplayerCallbacks {
  onRemotePlayerUpdate: (players: Map<string, RemotePlayer>) => void;
  onConnected?: () => void;
  onGameStateUpdate?: (state: SerializableGameState) => void;
  getLocalState: () => {
    x: number;
    y: number;
    rotation: number;
    score: number;
    life: number;
    level: number;
    name?: string;
  };
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

export class MultiplayerManager {
  private channel: RealtimeChannel | null = null;
  private playerId: string;
  private callbacks: MultiplayerCallbacks;
  private remotePlayers = new Map<string, RemotePlayer>();
  private positionBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private lastPosition = { x: 400, y: 300, rotation: 0 };
  private isConnected = false;
  private gameEventSource: EventSource | null = null;
  private gameStreamRoomId = "default";
  /** When false, boat positions come from the game server (SSE); skip Supabase position join/updates. */
  private useSupabaseForRemoteBoatPositions = true;

  constructor(callbacks: MultiplayerCallbacks) {
    this.playerId = getOrCreatePlayerId();
    this.callbacks = callbacks;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  /** Call before connect(). False when the Next game API streams authoritative player positions. */
  setUseSupabaseForRemoteBoatPositions(enabled: boolean): void {
    this.useSupabaseForRemoteBoatPositions = enabled;
  }

  getRemotePlayers(): Map<string, RemotePlayer> {
    return new Map(this.remotePlayers);
  }

  isActive(): boolean {
    return this.isConnected;
  }

  /**
   * Authoritative game state via Server-Sent Events (separate from Supabase realtime).
   */
  connectGameStream(roomId: string): void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    this.disconnectGameStream();
    this.gameStreamRoomId = roomId;
    const query = new URLSearchParams({
      roomId,
      playerId: this.playerId,
    });
    const url = `/api/game/stream?${query.toString()}`;
    this.gameEventSource = new EventSource(url);
    this.gameEventSource.onmessage = (event: MessageEvent<string>) => {
      try {
        const state = JSON.parse(event.data) as SerializableGameState;
        this.callbacks.onGameStateUpdate?.(state);
      } catch {
        // Ignore malformed payloads
      }
    };
  }

  disconnectGameStream(): void {
    this.gameEventSource?.close();
    this.gameEventSource = null;
  }

  sendGameInput(input: PlayerInput): Promise<{ ok?: boolean }> {
    const body = JSON.stringify({
      roomId: this.gameStreamRoomId,
      playerId: this.playerId,
      input,
    });
    return fetch("/api/game/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).then(async (response) => {
      try {
        return (await response.json()) as { ok?: boolean };
      } catch {
        return {};
      }
    });
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
        if (!this.useSupabaseForRemoteBoatPositions) return;
        const { playerId, x, y, rotation, score, life, level, name } = payload.payload;
        if (playerId === this.playerId) return;
        const existing = this.remotePlayers.get(playerId);
        const color = existing?.color ?? playerIdToColor(playerId);
        this.remotePlayers.set(playerId, {
          id: playerId,
          name: name ?? existing?.name,
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
        if (!this.useSupabaseForRemoteBoatPositions) return;
        const { playerId, x, y, rotation, score, life, level, name } = payload.payload;
        if (playerId === this.playerId) return;
        const color = playerIdToColor(playerId);
        this.remotePlayers.set(playerId, {
          id: playerId,
          name,
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
        if (this.useSupabaseForRemoteBoatPositions) {
          this.remotePlayers.delete(playerId);
          this.callbacks.onRemotePlayerUpdate(this.getRemotePlayers());
        }
      })
      .subscribe((status) => {
        this.isConnected = status === "SUBSCRIBED";
        if (this.isConnected) {
          if (this.useSupabaseForRemoteBoatPositions) {
            this.broadcastJoin();
            this.startPositionBroadcast();
          }
          this.callbacks.onConnected?.();
        }
      });
  }

  private broadcastJoin(): void {
    const state = this.callbacks.getLocalState();
    this.channel?.send({
      type: "broadcast",
      event: "player-join",
      payload: {
        playerId: this.playerId,
        name: state.name,
        ...this.lastPosition,
        score: state.score ?? 0,
        life: state.life ?? 100,
        level: state.level ?? 1,
      },
    });
  }

  broadcastPosition(
    x: number,
    y: number,
    rotation: number,
    score: number,
    life: number,
    level: number,
    name?: string
  ): void {
    this.lastPosition = { x, y, rotation };
    this.channel?.send({
      type: "broadcast",
      event: "player-position",
      payload: {
        playerId: this.playerId,
        name,
        x,
        y,
        rotation,
        score,
        life,
        level,
      },
    });
  }

  private startPositionBroadcast(): void {
    this.positionBroadcastTimer = setInterval(() => {
      if (this.isConnected) {
        const state = this.callbacks.getLocalState();
        this.lastPosition = { x: state.x, y: state.y, rotation: state.rotation };
        this.broadcastPosition(state.x, state.y, state.rotation, state.score, state.life, state.level, state.name);
      }
    }, POSITION_BROADCAST_INTERVAL_MS);
  }

  disconnect(): void {
    this.disconnectGameStream();
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
