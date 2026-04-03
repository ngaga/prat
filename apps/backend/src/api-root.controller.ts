import { Controller, Get } from "@nestjs/common";

/**
 * GET /api — no DB; confirms the API process is up. Feature routes live under /api/feature-flags, etc.
 */
@Controller()
export class ApiRootController {
  @Get()
  getApiRoot(): { ok: boolean; service: string; hint: string } {
    return {
      ok: true,
      service: "prat-api",
      hint: "Try GET /api/feature-flags/octopuses",
    };
  }
}
