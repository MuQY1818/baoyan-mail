import { handleRequest } from "./routes";
import type { Env } from "./types";
import { requestSourceSync } from "./pipeline";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(requestSourceSync(env, "watchdog", new Date(controller.scheduledTime)));
  }
};
