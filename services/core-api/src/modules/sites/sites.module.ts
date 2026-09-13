import { Module } from "@nestjs/common";
import { ConfigurationRegistry } from "./configuration-registry.js";

@Module({
  exports: [ConfigurationRegistry],
  providers: [ConfigurationRegistry],
})
export class SitesModule {}
