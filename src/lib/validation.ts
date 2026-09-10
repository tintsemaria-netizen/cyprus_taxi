import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

const coord = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  label: z.string().min(1).max(200),
});

export const phoneSchema = z
  .string()
  .min(5)
  .max(20)
  .transform((v, ctx) => {
    const parsed = parsePhoneNumberFromString(v);
    if (!parsed || !parsed.isValid()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid international phone number.' });
      return z.NEVER;
    }
    return parsed.number; // E.164
  });

export const createBookingSchema = z.object({
  pickup: coord,
  dropoff: coord,
  when: z.enum(['NOW', 'SCHEDULE']),
  scheduledAt: z.string().datetime().optional(),
  vClass: z.enum(['COMFORT', 'XL']),
  passengerCount: z.number().int().min(1).max(6),
  passengerName: z.string().min(1).max(100),
  phone: phoneSchema,
  note: z.string().max(1000).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const loginSchema = z.object({
  login: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const locationSampleSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyM: z.number().finite().min(0).max(100000),
  heading: z.number().finite().min(0).max(360).optional(),
  speed: z.number().finite().min(0).max(200).optional(),
  sampledAt: z.string().datetime(),
  gpsSession: z.string().min(8).max(64),
  sequence: z.number().int().min(0),
});

export const assignSchema = z.object({
  driverId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  acknowledgeNoGps: z.boolean().optional(),
});

export const statusSchema = z.object({
  to: z.enum(['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']),
  expectedRevision: z.number().int().min(0),
  reason: z.string().max(500).optional(),
});

export const driverSchema = z.object({
  login: z.string().min(3).max(100),
  publicName: z.string().min(1).max(100),
  phone: phoneSchema,
});

export const vehicleSchema = z.object({
  plate: z.string().min(1).max(20),
  make: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  color: z.string().min(1).max(30),
  vClass: z.enum(['COMFORT', 'XL']),
  seats: z.number().int().min(1).max(16),
});

// Flatten a ZodError into fieldErrors for the API envelope.
export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
