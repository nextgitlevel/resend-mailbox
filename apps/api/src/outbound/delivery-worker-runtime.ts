import type { Pool } from "pg";
import { OutboundDeliveryWorker } from "./outbound-delivery-worker.js";

export const runDeliveryWorker = async (input: {
  worker: OutboundDeliveryWorker;
  pool: Pool;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}) => {
  const interval = input.pollIntervalMs ?? 1_000;
  while (!input.signal?.aborted) {
    const delivered = await input.worker.deliverNext();
    if (!delivered) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval);
        input.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
  await input.pool.end();
};
