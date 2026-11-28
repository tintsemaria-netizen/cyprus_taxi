TITLE = "IL-Y taxi app — briefing for the lawyer and the accountant"
SUB = "Do I need a company, and which one? What the app does, how money moves, what rules apply, and the questions I need answered."
META = "Prepared 28 November 2026 for the owner of IL-Y (il-y.taxi), Cyprus. Draft for discussion."
DISCLAIMER = ("This paper was prepared with an AI assistant from public sources and from the app itself. It is not legal or tax "
              "advice. Figures are simplified examples for the 2026 tax year and must be checked by the accountant; legal points "
              "must be checked by the lawyer. Proposed laws mentioned below may change or may already have changed.")

C = [
 ('h1', '1. What I want from this meeting'),
 ('ul', [
  "A clear answer: should I run IL-Y as a sole trader (self-employed) for now, or open a company (Ltd), and when.",
  "What registrations, licences and contracts I need before taking money from drivers.",
  "How to collect money without passing passengers' fares through my own accounts and without ever holding drivers' money.",
  "A list of what I must do and by when (tax, VAT, social insurance, data protection, taxi rules).",
 ]),

 ('h1', '2. The app in short'),
 ('p', "IL-Y is a taxi booking app for Cyprus. It runs today as a web app (beta) at il-y.taxi; Android and iPhone apps are planned. "
       "There are no paying customers yet and no turnover yet."),
 ('ul', [
  "<b>Passengers</b> book a taxi now or for later, see the price before booking, follow the car on a map, and pay the driver.",
  "<b>Drivers</b> are licensed taxi drivers with their own (or a fleet's) licensed taxi. They go online in the app, get ride offers, accept or decline them, and drive with the phone's GPS on.",
  "<b>Fleet owners</b> can see their own cars and drivers.",
  "<b>Administration</b> (me): checks drivers' documents by hand, sets prices and zones, sees reports.",
 ]),
 ('p', "Things the app decides by itself (important for the legal questions):"),
 ('ul', [
  "It <b>calculates and shows the fare</b> (fixed price or a price range) from distance, time and tariff rules I set.",
  "It <b>chooses which driver gets the offer</b> automatically (the nearest by real road time). The offer expires after a few seconds; if the driver declines, it goes to the next driver.",
  "It sets <b>pickup points</b> at airports and ports, keeps <b>ratings / reliability</b> of drivers, and can pair two passengers going the same way (<b>shared ride</b>, each pays a part).",
  "Drivers are free to go online or offline when they want and may decline any offer.",
 ]),

 ('h1', '3. How money moves'),
 ('table', [
  ["Money", "From → to", "Through IL-Y?"],
  ["Fare (cash)", "Passenger → driver", "No"],
  ["Fare (card)", "Passenger → driver's own card terminal / account", "No"],
  ["IL-Y fee (planned)", "Driver or fleet owner → IL-Y, fixed monthly fee per car (example: €100)", "Yes — this is my only income"],
  ["Commission per ride", "—", "None (0 %)"],
 ]),
 ('p', "My wish: never collect passengers' money and never hold drivers' money. A future option is online card payment "
       "straight into each driver's own account (for example Stripe Connect with 'direct charges'), where IL-Y never holds the fare. "
       "I do not want a system where IL-Y collects all fares and pays drivers weekly."),

 ('h1', '4. Data the app holds'),
 ('ul', [
  "Passengers: phone number, name, optional e-mail, pickup / drop-off addresses, trip history, live position of the car during the trip.",
  "Drivers: name, phone, e-mail, ID or passport, driving licence, taxi driver licence, vehicle papers, insurance, photos, IBAN, emergency contact, GPS position while on duty, ratings.",
  "Services used: Google Maps (maps, routes, addresses), Twilio (SMS codes), Cloudflare (website protection), a rented server, and later an e-mail service (Resend) for receipts.",
 ]),

 ('h1', '5. Why a company may be needed — reasons for and against'),
 ('p', "<b>Reasons to open a company (Ltd):</b>"),
 ('ul', [
  "<b>Apple.</b> Apple often refuses apps that handle sensitive data (live location, identity documents) when they are published by a private person; it asks for a developer account 'enrolled as an organization'. An organization account needs a legal entity (and a D-U-N-S number). This may block the iPhone app without a company.",
  "<b>Limited liability.</b> If a passenger or driver sues after an accident, a data breach or a dispute, a company protects my personal assets (subject to the lawyer's view).",
  "<b>New taxi rules.</b> The proposed taxi reform would create a register of booking platforms at the Road Transport Department, with a compliance officer and fines up to €50,000 (see section 6). A company may be expected or more practical for this.",
  "<b>Tax at higher profit.</b> From 2026 company tax is 15 % and dividends to a Cyprus-domiciled resident have 5 % (plus 2.65 % GESY). Above a certain profit this is cheaper than personal tax up to 35 % plus 16.6 % social insurance and 4 % GESY (example below).",
  "<b>Contracts and trust.</b> Drivers, fleet owners, airports, Google, Apple and payment providers prefer to contract with a company. A company can later take investors or be sold.",
 ]),
 ('p', "<b>Reasons not to open it yet:</b>"),
 ('ul', [
  "No turnover yet. A company has fixed yearly costs (accountant, audited accounts, registrar fees, registered office) — roughly a few thousand euro a year (accountant to confirm).",
  "At low profit, self-employment is cheaper (example below).",
 ]),

 ('h2', 'Simplified example (2026 rates, before any reliefs or deductions)'),
 ('table', [
  ["", "A: 20 cars", "B: 100 cars"],
  ["Fees from drivers per year (without VAT)", "€24,000", "€120,000"],
  ["Running costs (assumed)", "€12,000", "€30,000"],
  ["Profit", "€12,000", "€90,000"],
  ["<b>Self-employed</b>: income tax", "€0", "€19,800"],
  ["Social insurance 16.6 % (ceiling about €68,900)", "€1,992", "€11,438"],
  ["GESY 4 %", "€480", "€3,600"],
  ["<b>Left for me — self-employed</b>", "<b>≈ €9,500</b>", "<b>≈ €55,200</b>"],
  ["<b>Company</b>: extra company costs (assumed)", "€3,000", "€3,000"],
  ["Company tax 15 %", "€1,350", "€13,050"],
  ["All profit paid as dividend: 5 % SDC + 2.65 % GESY", "€585", "€5,658"],
  ["<b>Left for me — company</b>", "<b>≈ €7,100</b>", "<b>≈ €68,300</b>"],
 ]),
 ('note', "In both examples the fees are above €15,600 a year, so VAT registration (19 %) is needed either way. The example ignores salary "
          "from the company, deductions, the minimum social insurance for my occupation, and whether directors must pay social insurance. "
          "The accountant should redo it with real figures."),

 ('h1', '6. Rules that affect the app'),
 ('ul', [
  "<b>Taxi reform bill (proposal, 2026).</b> Press reports from June 2026 describe a bill amending the road transport law: a register of booking platforms ('intermediaries') at the Road Transport Department, a compliance officer for each platform, work only with licensed taxis, electronic records of pre-bookings, a pre-booking receipt for airport and port pickups, and fines (up to €50,000 for not appointing a compliance officer, €1,500 per illegal operation). An earlier report also mentioned a mandatory state platform for all licensed taxis. Status not confirmed.",
  "<b>'Pirate taxi' law (approved April 2026).</b> Higher penalties for carrying passengers without a taxi licence. IL-Y must only accept licensed drivers and cars.",
  "<b>Platform Work Directive (EU 2024/2831).</b> Must be in national law by 2 December 2026. Cyprus published two draft bills (consultation until 24 September 2026): a person working through a platform is presumed to be an employee if the platform exercises direction and control; the platform must prove otherwise. Rules on automated decisions (offers, ratings, blocking) and penalties up to €5,500 and/or six months' imprisonment.",
  "<b>DAC7 (tax reporting by digital platforms).</b> In Cyprus since November 2023. Platforms that help sellers provide 'personal services' for a price the platform knows must register with the Tax Department before they start and report the sellers' income every year. Our app knows each fare, so taxi rides may be reportable.",
  "<b>EU court, Uber Spain (C-434/15, 2017).</b> A ride app that sets prices and controls the service was treated as a transport service, not only an 'information society service'. Our app sets the fares and assigns drivers.",
  "<b>GDPR.</b> We process location and identity documents. We probably need a data-protection impact assessment, contracts with our service providers, a privacy notice (draft exists at il-y.taxi/privacy) and possibly registration questions with the Commissioner.",
  "<b>Tax reform 2026.</b> Company tax 15 %; dividend SDC 5 %; deemed dividend distribution abolished for profits after 2025; personal tax-free band €22,000; all residents aged 25–70 must file a tax return.",
 ]),

 ('h1', '7. Questions for the lawyer'),
 ('ol', [
  "Do I need a company to run IL-Y legally, or can I start as a self-employed person? What changes if the taxi reform bill passes?",
  "Is IL-Y a transport operator or only an intermediary / information society service, given that the app sets the fare and chooses the driver? What licence or registration does that require?",
  "What exactly must a booking platform do today at the Road Transport Department? Is there a licence for online platforms now? Who would be the compliance officer?",
  "Are the drivers my employees under the Platform Work Directive and the Cyprus draft law? How should the driver contract, the offer system, ratings and blocking be designed so that they stay independent?",
  "May the app show a fixed price or a price range when Cyprus taxis have official tariffs and meters? Do shared rides (two passengers, split price) need any permission?",
  "What contracts do I need: terms for passengers, contract with drivers and fleet owners, data-processing agreements with Google, Twilio, Cloudflare and the server host?",
  "GDPR: do we need a data protection officer, an impact assessment for GPS tracking, and how long may we keep documents and trips?",
  "Liability: accident, lost item, overcharge, data breach — who is responsible, and what insurance should IL-Y have (professional / cyber liability)?",
  "If I take card payments later straight into drivers' accounts (Stripe Connect), does IL-Y need any payment licence? What must I avoid so that I never 'hold' money?",
  "Trademark: should I register 'IL-Y' in Cyprus / the EU?",
  "If I open a company: which type, who should be shareholders and directors, what does it cost and how long does it take? Can the company use the app I built personally (transfer of rights)?",
 ]),

 ('h1', '8. Questions for the accountant'),
 ('ol', [
  "With my real numbers, at what profit does a company become better than self-employment? Please redo the example in section 5.",
  "Self-employed: what is the minimum social insurance for my occupation, what can I deduct, and do I need audited accounts (the new limit is €120,000 turnover)?",
  "Company: yearly costs (audit, accountant, registrar, any levy), best mix of salary and dividends, and do I pay social insurance as a director?",
  "VAT: is the monthly fee to drivers 19 % VAT? From which month must I register? Can drivers reclaim it? Should my price of €100 include VAT?",
  "Do I need to register for DAC7 and report drivers' income? What data must I collect from drivers for that (tax number, address, IBAN)?",
  "Invoices: how should I invoice the monthly fee (to driver or fleet owner), which invoicing system or software, and how long to keep records?",
  "Bank and payments: which bank or payment provider for the fees (card, direct debit, bank transfer)? Should the business have a separate account even as self-employed?",
  "Costs from abroad (Google, Apple, Twilio, Cloudflare, server): reverse-charge VAT and how to book them.",
  "When the app pays for itself: can I pay myself monthly, and how is it taxed?",
  "Deadlines: tax returns, VAT returns, social insurance and GESY payments — a calendar for my first year.",
 ]),

 ('h1', '9. What I will bring'),
 ('ul', [
  "This paper and a short demo of the app on my phone.",
  "Planned price list for drivers and the expected number of cars in year 1.",
  "Expected monthly costs (hosting, Google Maps, SMS, e-mail, Apple and Google developer fees, insurance).",
  "Drafts of the passenger terms and privacy notice (il-y.taxi/terms and il-y.taxi/privacy).",
  "My ID, tax number, address and bank details.",
 ]),

 ('h1', 'Sources (checked 28 November 2026)'),
 ('src', [
  "Cyprus tax reform 2026 — EY Global Tax News, 7 Jan 2026: globaltaxnews.ey.com/news/2026-0140",
  "Personal income tax bands 2026 — businessincyprus.gov.cy and PwC tax summaries (taxsummaries.pwc.com/cyprus)",
  "Social insurance 2026 (16.6 % self-employed, ceiling €5,742/month) — KPMG Cyprus, Jan 2026; Andersen Cyprus",
  "VAT threshold €15,600 — European Commission SME VAT rules (sme-vat-rules.ec.europa.eu)",
  "DAC7 in Cyprus — EY Tax News 2023-1888; Cyprus Tax Department DAC7 user guide",
  "Taxi reform bill — Filenews via talanews.blogspot.com, 16 Jun 2026; Politis English, 14 Apr 2026",
  "Pirate taxi law — Cyprus Mail, 16 Apr 2026",
  "Platform workers draft bills — Politis English, 24 Aug 2026; Directive (EU) 2024/2831",
  "Apple guideline 5.1.1(ix) organisation accounts — Apple Developer Forums",
  "CJEU C-434/15 Asociación Profesional Elite Taxi v Uber Systems Spain, 20 Dec 2017",
 ]),
]
