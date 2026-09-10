/**
 * Synthetic demo seed (SPEC §9). All names/phones are fictional. Creates staff,
 * drivers, vehicles, bindings and a couple of demo bookings so the beta is
 * explorable. Safe to run repeatedly. NEVER use in real-data mode.
 */
import { PrismaClient, VehicleClass } from '@prisma/client';
import bcrypt from 'bcryptjs';

try { (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile('.env'); } catch { /* env already set */ }

const prisma = new PrismaClient();
const DEMO_PW = process.env.DEMO_PASSWORD || 'demo-password-2026';

async function staff(login: string, role: 'ADMIN' | 'DISPATCHER' | 'DRIVER', displayName: string) {
  const passwordHash = await bcrypt.hash(DEMO_PW, 10);
  return prisma.staffUser.upsert({
    where: { login },
    update: { role, displayName, active: true },
    create: { login, role, displayName, passwordHash, active: true },
  });
}

async function main() {
  console.log('Seeding synthetic demo data…');

  await staff('admin', 'ADMIN', 'Demo Admin');
  await staff('dispatcher', 'DISPATCHER', 'Demo Dispatcher');

  const drivers = [
    { login: 'andreas', name: 'Andreas', phone: '+35799000001', plate: 'KXY 248', make: 'Mercedes', model: 'E-Class', color: 'Black', vClass: 'COMFORT' as VehicleClass, seats: 4 },
    { login: 'maria', name: 'Maria', phone: '+35799000002', plate: 'MCE 512', make: 'Toyota', model: 'Prius', color: 'Silver', vClass: 'COMFORT' as VehicleClass, seats: 4 },
    { login: 'petros', name: 'Petros', phone: '+35799000003', plate: 'VAN 900', make: 'Mercedes', model: 'Vito', color: 'Grey', vClass: 'XL' as VehicleClass, seats: 6 },
  ];

  for (const d of drivers) {
    const user = await staff(d.login, 'DRIVER', d.name);
    const driver = await prisma.driver.upsert({
      where: { userId: user.id },
      update: { publicName: d.name, phone: d.phone, active: true },
      create: { userId: user.id, publicName: d.name, phone: d.phone, active: true, onDuty: false, available: false },
    });
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: d.plate },
      update: { make: d.make, model: d.model, color: d.color, vClass: d.vClass, seats: d.seats, active: true },
      create: { plate: d.plate, make: d.make, model: d.model, color: d.color, vClass: d.vClass, seats: d.seats, active: true },
    });
    const existingBinding = await prisma.driverVehicleBinding.findFirst({
      where: { driverId: driver.id, vehicleId: vehicle.id, endedAt: null },
    });
    if (!existingBinding) {
      // clear any other active binding for this driver/vehicle first
      await prisma.driverVehicleBinding.updateMany({
        where: { OR: [{ activeDriverId: driver.id }, { activeVehicleId: vehicle.id }] },
        data: { endedAt: new Date(), activeDriverId: null, activeVehicleId: null },
      });
      await prisma.driverVehicleBinding.create({
        data: { driverId: driver.id, vehicleId: vehicle.id, activeDriverId: driver.id, activeVehicleId: vehicle.id },
      });
    }
  }

  // A couple of demo bookings in REQUESTED state so the dispatcher queue isn't empty.
  const demoBookings = [
    { ref: 'CY-DEMO-0001', pl: 'Limassol Marina', pLat: 34.6706, pLng: 33.0413, dl: 'Larnaca Airport (LCA)', dLat: 34.8751, dLng: 33.6249, name: 'Demo Passenger', phone: '+35796000001', vClass: 'COMFORT' as VehicleClass, pax: 2 },
    { ref: 'CY-DEMO-0002', pl: 'Paphos harbour', pLat: 34.7536, pLng: 32.4076, dl: 'Paphos Airport (PFO)', dLat: 34.718, dLng: 32.4857, name: 'Demo Traveller', phone: '+35796000002', vClass: 'XL' as VehicleClass, pax: 5 },
  ];
  for (const b of demoBookings) {
    const existing = await prisma.booking.findUnique({ where: { reference: b.ref } });
    if (existing) continue;
    await prisma.booking.create({
      data: {
        reference: b.ref, pickupLat: b.pLat, pickupLng: b.pLng, pickupLabel: b.pl,
        dropoffLat: b.dLat, dropoffLng: b.dLng, dropoffLabel: b.dl,
        passengerName: b.name, phone: b.phone, vClass: b.vClass, passengerCount: b.pax,
        status: 'REQUESTED',
        events: { create: { type: 'CREATED', actorType: 'SYSTEM', afterStatus: 'REQUESTED' } },
      },
    });
  }

  console.log('Demo seed complete. Staff logins: admin / dispatcher / andreas / maria / petros');
  console.log(`Demo password (all): ${DEMO_PW}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
