import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { getLevelFromExperience } from "../level.util";
import { SupabaseService } from "../supabase/supabase.service";

@Controller("players")
export class PlayersController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Post()
  async upsert(
    @Body()
    body: {
      name?: string;
      exp?: number;
      level?: number;
      kills_octopus?: number;
      kills_stingray?: number;
      prats_captured?: number;
      prats?: number;
      is_ghost?: boolean;
      ghost_prats_captured?: number;
      expected_updated_at?: string;
    }
  ): Promise<{ success: boolean; error?: string; conflict?: boolean; current_updated_at?: string }> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      throw new HttpException(
        { success: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    const trimmedName = typeof body.name === "string" ? body.name.trim() : "";
    if (!trimmedName) {
      throw new HttpException({ success: false, error: "name is required" }, HttpStatus.BAD_REQUEST);
    }
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data: existingPlayer, error: existingPlayerError } = await supabase
        .from("players")
        .select(
          "id, exp, kills_octopus, kills_stingray, prats_captured, prats, is_ghost, ghost_prats_captured, updated_at"
        )
        .eq("name", trimmedName)
        .maybeSingle();
      if (existingPlayerError) {
        throw new HttpException({ success: false, error: existingPlayerError.message }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const expectedUpdatedAt = typeof body.expected_updated_at === "string" ? body.expected_updated_at : undefined;
      const currentUpdatedAt =
        typeof existingPlayer?.updated_at === "string" ? existingPlayer.updated_at : undefined;
      if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
        throw new HttpException(
          {
            success: false,
            conflict: true,
            error: "profile version mismatch",
            current_updated_at: currentUpdatedAt,
          },
          HttpStatus.CONFLICT
        );
      }
      const exp =
        body.exp !== undefined
          ? Number.isFinite(Number(body.exp))
            ? Number(body.exp)
            : 0
          : Number.isFinite(Number(existingPlayer?.exp))
            ? Number(existingPlayer?.exp)
            : 0;
      const level = getLevelFromExperience(exp);
      const { data: upsertedPlayer, error } = await supabase
        .from("players")
        .upsert(
          {
            name: trimmedName,
            exp,
            level,
            kills_octopus: body.kills_octopus ?? existingPlayer?.kills_octopus ?? 0,
            kills_stingray: body.kills_stingray ?? existingPlayer?.kills_stingray ?? 0,
            prats_captured: body.prats_captured ?? existingPlayer?.prats_captured ?? 0,
            prats: body.prats ?? existingPlayer?.prats ?? 0,
            is_ghost: body.is_ghost ?? existingPlayer?.is_ghost ?? false,
            ghost_prats_captured: body.ghost_prats_captured ?? existingPlayer?.ghost_prats_captured ?? 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "name" }
        )
        .select("updated_at")
        .single();
      if (error) {
        throw new HttpException({ success: false, error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return {
        success: true,
        current_updated_at:
          typeof upsertedPlayer?.updated_at === "string" ? upsertedPlayer.updated_at : undefined,
      };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new HttpException({ success: false, error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(":name")
  async getByName(@Param("name") name: string, @Res({ passthrough: false }) res: FastifyReply): Promise<void> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      res.status(200).send(null);
      return;
    }
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from("players")
        .select(
          "id, name, exp, level, kills_octopus, kills_stingray, prats_captured, prats, is_ghost, ghost_prats_captured, updated_at"
        )
        .eq("name", decodeURIComponent(name).trim())
        .maybeSingle();
      if (error || !data) {
        res.status(200).send(null);
        return;
      }
      const exp = Number.isFinite(Number(data.exp)) ? Number(data.exp) : 0;
      res.status(200).send({
        ...data,
        level: getLevelFromExperience(exp),
      });
    } catch {
      res.status(200).send(null);
    }
  }
}
