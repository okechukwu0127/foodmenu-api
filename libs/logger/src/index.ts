import { Logger } from "@nestjs/common";
export * from "./logger.module";

export const createAppLogger = (context: string) => new Logger(context);
