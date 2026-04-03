import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

function corsOrigin(): boolean | string[] {
  const raw = process.env.FRONTEND_ORIGIN?.trim();
  if (raw) {
    return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === "production") {
    // Reflect browser Origin when FRONTEND_ORIGIN is not set (simple Render setup).
    return true;
  }
  // Development: LAN URLs (e.g. http://192.168.x.x:3000) must be allowed or fetch fails with TypeError.
  return true;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: corsOrigin(),
    methods: ["GET", "POST", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Accept"],
  });
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.LISTEN_HOST ?? "0.0.0.0";
  await app.listen(port, host);
  const base = `http://127.0.0.1:${port}`;
  Logger.log(`API ready at ${base}/api (bound ${host}:${port})`);
}

void bootstrap();
