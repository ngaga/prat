import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { ApiRootController } from "./api-root.controller";
import { FeatureFlagsController } from "./feature-flags/feature-flags.controller";
import { GameSessionsController } from "./game-sessions/game-sessions.controller";
import { PlayersController } from "./players/players.controller";
import { SupabaseModule } from "./supabase/supabase.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), ".env.local"), join(process.cwd(), ".env")],
    }),
    SupabaseModule,
  ],
  controllers: [ApiRootController, FeatureFlagsController, PlayersController, GameSessionsController],
})
export class AppModule {}
