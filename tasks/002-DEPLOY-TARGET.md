# Confirmed beta deployment target

User instruction, 2026-09-10:
- Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
- Hostname: cyprustaxi.ackedberryes.store
- Server IP: 92.39.53.229
- The user reports the hostname points to this IP and Claude is installed on the same server.
- Deploy the first working test version there after completing Task 001. This target overrides older missing-destination notes.

## Execute on the authorized server

1. Inspect hostname, interfaces, project directory, running services/containers, reverse proxy and port bindings. Verify this is the intended server. Do not output secrets. Do not assume the server is empty or globally change Docker/firewall settings.
2. Reuse the correct existing cyprus_taxi checkout; otherwise clone the specified repository into a separate project directory suitable for the local account. Inspect existing instructions and preserve work. Do not clone over another application.
3. Verify A/AAAA records for cyprustaxi.ackedberryes.store and detect stale IPv6 records. Confirm reachability and whether existing proxy handles 80/443. Preserve unrelated virtual hosts, certificates and services.
4. Configure an isolated app service and persistent PostgreSQL database with unique service/volume names and no public database port. Use available internal ports; route only this hostname through the existing proxy or a dedicated compatible proxy. Generate secrets securely, exclude them from Git and restrict file permissions.
5. Set APP_BASE_URL=https://cyprustaxi.ackedberryes.store. Configure HTTPS using the host's existing certificate tooling where possible. Validate proxy configuration before reload. Never disrupt other domains to obtain a certificate.
6. Build, migrate, bootstrap staff securely and start using the host's supported persistent process/container service. Configure readiness and restart policy. Use clearly labeled synthetic demo mode when map credentials or real fleet configuration are absent; never pretend simulator positions are real GPS.
7. Check remote HTTPS, login, persistent booking, assignment, driver updates, passenger tracking and completion. Verify database persistence across an app restart. Test foreground GPS on a physical phone only if one is available; report it unverified otherwise.
8. Record full commit SHA, commands, actual health/E2E results and rollback instructions in docs/BETA_RELEASE.md. Deliver URLs for /, /staff/login, /dispatch and /driver with secure access instructions. Do not publish passwords in committed documents.

Do not stop for another deployment permission request: this specific beta deployment has been requested. Respect actual environment permission controls. If local access is unavailable, complete implementation/deployment preparation and report the exact access blocker. Do not modify DNS at another provider without available authorized access. Do not claim DNS, TLS or release success without checking them.
