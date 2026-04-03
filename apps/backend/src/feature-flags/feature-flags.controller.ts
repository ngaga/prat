import { Controller, Get, InternalServerErrorException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";

/**
 * Parse DB `value` once at this boundary; response JSON is always boolean.
 * Accepts boolean plus quoted strings if the column was ever text (dashboard / legacy).
 */
function parseStoredFeatureFlagBoolean(value: unknown): boolean {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  throw new InternalServerErrorException(
    "feature_flags.value must be boolean or \"true\"/\"false\"; check column type and row data.",
  );
}

@Controller("feature-flags")
export class FeatureFlagsController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get("octopuses")
  async getOctopuses(): Promise<{ enabled: boolean }> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      return { enabled: true };
    }
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from("feature_flags")
        .select("value")
        .eq("key", "octopuses_enabled")
        .single();
      if (error || data == null) {
        return { enabled: true };
      }
      return { enabled: parseStoredFeatureFlagBoolean(data.value) };
    } catch (caught) {
      if (caught instanceof InternalServerErrorException) {
        throw caught;
      }
      return { enabled: true };
    }
  }

  @Get("stingrays")
  async getStingrays(): Promise<{ enabled: boolean }> {
    if (!this.supabaseService.isDatabaseConfigured()) {
      return { enabled: true };
    }
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from("feature_flags")
        .select("value")
        .eq("key", "stingrays_enabled")
        .single();
      if (error || data == null) {
        return { enabled: true };
      }
      return { enabled: parseStoredFeatureFlagBoolean(data.value) };
    } catch (caught) {
      if (caught instanceof InternalServerErrorException) {
        throw caught;
      }
      return { enabled: true };
    }
  }

  /**
   * Bundled flags for the Next.js game engine refresh loop (same data as individual GETs).
   */
  @Get("server")
  async getServerFlags(): Promise<{
    octopusesEnabled: boolean;
    stingraysEnabled: boolean;
  }> {
    const octopuses = await this.getOctopuses();
    const stingrays = await this.getStingrays();
    return {
      octopusesEnabled: octopuses.enabled,
      stingraysEnabled: stingrays.enabled,
    };
  }
}
