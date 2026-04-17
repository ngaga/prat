import { NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";

describe("API (e2e)", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api");
    await app.init();
  });

  it("/api/feature-flags/octopuses (GET)", () => {
    return request(app.getHttpServer())
      .get("/api/feature-flags/octopuses")
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveProperty("enabled");
      });
  });

  it("/api/feature-flags/stingrays (GET)", () => {
    return request(app.getHttpServer())
      .get("/api/feature-flags/stingrays")
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveProperty("enabled");
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
