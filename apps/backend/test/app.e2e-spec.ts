import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";

describe("API (e2e)", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
