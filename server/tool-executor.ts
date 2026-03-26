import type { MetaEvent } from "./types.js";

export interface ToolExecutor {
  canHandle(name: string): boolean;
  execute(
    name: string,
    args: Record<string, unknown>,
    emit: (event: MetaEvent) => void
  ): Promise<string>;
}

export class ToolDispatcher {
  private executors: ToolExecutor[] = [];

  register(executor: ToolExecutor): void {
    this.executors.push(executor);
  }

  canHandle(name: string): boolean {
    return this.executors.some((e) => e.canHandle(name));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    emit: (event: MetaEvent) => void
  ): Promise<string> {
    const executor = this.executors.find((e) => e.canHandle(name));
    if (!executor) {
      return JSON.stringify({ error: `No executor found for tool: ${name}` });
    }
    return executor.execute(name, args, emit);
  }
}
