import { Body, Controller, HttpException, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("game-sessions")
export class GameSessionsController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Post()
  async create(@Body() body: { playerId?: string }): Promise<{ sessionId: string }> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      throw new HttpException(
        { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
    if (!playerId || !uuidPattern.test(playerId)) {
      throw new HttpException({ error: "playerId must be a valid UUID" }, HttpStatus.BAD_REQUEST);
    }
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from("game_sessions")
        .insert({ player_id: playerId })
        .select("id")
        .single();
      if (error) {
        throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const row = data as { id: string } | null;
      if (!row?.id) {
        throw new HttpException({ error: "No session id returned" }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return { sessionId: row.id };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new HttpException({ error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch(":id")
  async endSession(
    @Param("id") sessionId: string,
    @Body()
    body: {
      actionsCount?: number;
      expGained?: number;
      killsOctopus?: number;
      killsStingray?: number;
      ghostPratsCaptured?: number;
      disconnectedUnexpectedly?: boolean;
    }
  ): Promise<{ success: boolean }> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      throw new HttpException(
        { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (!sessionId || !uuidPattern.test(sessionId)) {
      throw new HttpException({ error: "Invalid session id" }, HttpStatus.BAD_REQUEST);
    }
    const actionsCount = Math.max(0, Math.floor(Number(body.actionsCount) || 0));
    const expGained = Math.max(0, Math.floor(Number(body.expGained) || 0));
    const killsOctopus = Math.max(0, Math.floor(Number(body.killsOctopus) || 0));
    const killsStingray = Math.max(0, Math.floor(Number(body.killsStingray) || 0));
    const ghostPratsCaptured = Math.max(0, Math.floor(Number(body.ghostPratsCaptured) || 0));
    const disconnectedUnexpectedly = Boolean(body.disconnectedUnexpectedly);
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { error } = await supabase
        .from("game_sessions")
        .update({
          ended_at: new Date().toISOString(),
          actions_count: actionsCount,
          exp_gained: expGained,
          kills_octopus: killsOctopus,
          kills_stingray: killsStingray,
          ghost_prats_captured: ghostPratsCaptured,
          disconnected_unexpectedly: disconnectedUnexpectedly,
        })
        .eq("id", sessionId);
      if (error) {
        throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return { success: true };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new HttpException({ error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
