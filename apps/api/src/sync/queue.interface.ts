// §2: "Implement the job queue behind a small interface (enqueue/dequeue/ack)
// so swapping the Postgres-backed implementation for Redis/RabbitMQ/SQS later
// is a backend change, not a rewrite." `work` bundles dequeue+ack: the handler
// resolving (or throwing) IS the ack/nack — that's how pg-boss, BullMQ, and
// SQS-with-a-consumer-loop all actually work under the hood.
export interface JobQueue {
  enqueue(queueName: string, data: object): Promise<string | null>;
  work<T extends object>(queueName: string, handler: (data: T) => Promise<void>): Promise<void>;
  createQueue(name: string, options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string }): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const JOB_QUEUE = Symbol('JOB_QUEUE');
