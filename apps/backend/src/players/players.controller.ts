import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
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
    }
  ): Promise<{ success: boolean; error?: string }> {
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
    const exp = Number.isFinite(Number(body.exp)) ? Number(body.exp) : 0;
    const level = getLevelFromExperience(exp);
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { error } = await supabase.from("players").upsert(
        {
          name: trimmedName,
          exp,
          level,
          kills_octopus: body.kills_octopus ?? 0,
          kills_stingray: body.kills_stingray ?? 0,
          prats_captured: body.prats_captured ?? 0,
          prats: body.prats ?? 0,
          is_ghost: body.is_ghost ?? false,
          ghost_prats_captured: body.ghost_prats_captured ?? 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "name" }
      );
      if (error) {
        throw new HttpException({ success: false, error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return { success: true };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new HttpException({ success: false, error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(":name")
  async getByName(@Param("name") name: string, @Res({ passthrough: false }) res: Response): Promise<void> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      res.status(200).json(null);
      return;
    }
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from("players")
        .select(
          "id, name, exp, level, kills_octopus, kills_stingray, prats_captured, prats, is_ghost, ghost_prats_captured"
        )
        .eq("name", decodeURIComponent(name).trim())
        .maybeSingle();
      if (error || !data) {
        res.status(200).json(null);
        return;
      }
      const exp = Number.isFinite(Number(data.exp)) ? Number(data.exp) : 0;
      res.status(200).json({
        ...data,
        level: getLevelFromExperience(exp),
      });
    } catch {
      res.status(200).json(null);
    }
  }
}
