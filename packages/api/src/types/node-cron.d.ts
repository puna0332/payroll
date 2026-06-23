declare module 'node-cron' {
  export interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
  }

  export interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy(): void;
  }

  function schedule(
    expression: string,
    task: () => void | Promise<void>,
    options?: ScheduleOptions,
  ): ScheduledTask;

  const cron: {
    schedule: typeof schedule;
  };

  export default cron;
}
