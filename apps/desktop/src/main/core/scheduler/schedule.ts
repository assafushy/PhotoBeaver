import { z } from 'zod';

export const scheduleSchema = z.object({
  intervalSec: z.number().int().positive(),
  mode: z.enum(['poll', 'watch', 'manual']),
});

export type Schedule = z.infer<typeof scheduleSchema>;

/**
 * Parses a source's schedule_json, falling back to an hourly poll.
 *
 * @param json - Stored schedule JSON.
 * @returns The schedule.
 */
export function parseSchedule(json: string): Schedule {
  const parsed = scheduleSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : { intervalSec: 3600, mode: 'poll' };
}
