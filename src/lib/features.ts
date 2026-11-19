// Passenger sign-in switches now come from the server config (launch fixes, 2026-11-19):
// PASSENGER_TEST_MODE=on → guest orders without phone, passenger SMS hidden (operator testing).
// Unset (default) → commercial rules: a real order needs an SMS-verified phone.
// Browser code reads the same value from GET /public/config → `passenger.testMode`.
export {};
