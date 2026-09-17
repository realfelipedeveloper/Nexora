import { Module } from "@nestjs/common";
import { ContentFieldValidator } from "./content-field-validator.js";

@Module({
  exports: [ContentFieldValidator],
  providers: [ContentFieldValidator],
})
export class ContentModule {}
