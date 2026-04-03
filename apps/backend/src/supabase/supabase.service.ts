import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService {
  constructor(private readonly configService: ConfigService) {}

  getAdminClient(): SupabaseClient {
    const supabaseUrl = this.configService.get<string>("SUPABASE_URL") ?? "";
    const serviceRoleKey = this.configService.get<string>("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    return createClient(supabaseUrl, serviceRoleKey);
  }

  isDatabaseConfigured(): boolean {
    const url = this.configService.get<string>("SUPABASE_URL");
    const key = this.configService.get<string>("SUPABASE_SERVICE_ROLE_KEY");
    return Boolean(url?.trim() && key?.trim());
  }
}
