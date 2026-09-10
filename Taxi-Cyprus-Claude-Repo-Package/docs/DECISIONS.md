# Initial decisions and assumptions

- Approved visual direction: dark graphite/lime.
- Operator-managed fleet and manual dispatch assumed for beta; operator model was not explicitly confirmed.
- Guest passenger booking, unverified phone, payment to driver.
- English beta; Europe/Nicosia display time, UTC storage, EUR when relevant.
- Foreground browser GPS only; no background-location guarantee.
- Adapt existing stack if present; default TypeScript/React/Next.js/PostgreSQL. Implementation must verify compatible releases.
- Default bounded polling; live integrations configurable and demo unmistakable.
- Native Android/iOS clients deferred, API designed for reuse.
- Beta hosting confirmed by user: 92.39.53.229 / cyprustaxi.ackedberryes.store. Verify actual access and DNS. Map credentials and operator business information remain to be configured.

Append implementation decisions with date, alternatives, chosen option and reason.
