# KlassikernN – Shopify Rip & Ship-kø for Dokploy

Ferdig Bun-applikasjon (ingen avhengigheter) med Dockerfile, OBS Browser Source og passordbeskyttet køkontroll. **Krever tilkobling og konfigurering før produksjonsbruk.** Ingen direkte tilgang til Shopify Admin API er nødvendig for å motta webhook.

## Slik deployer du i Dokploy (Dockerfile + Bun)

1. Legg repoet i et **privat GitHub/Git-repository**. Ikke legg inn hemmeligheter i repoet. `Dockerfile` må ligge i repository-roten.
2. Opprett et prosjekt i Dokploy → **Application** → velg Git/GitHub som kilde og repository/branch. Under **Build Type** velger du **Dockerfile** (Docker File: `Dockerfile`, Docker Context Path: `.`). Bildet bygges fra `oven/bun` og starter med `bun run server.js`.
3. Legg inn alle variablene fra `.env.example` under Application → **Environment** i Dokploy. Bruk nye, lange tilfeldige hemmeligheter, og sett i tillegg `COOKIE_SECURE=true`. `SHOPIFY_CLIENT_SECRET` er signeringsnøkkelen for den aktuelle webhooken: for webhooks opprettet i Shopify Admin brukes butikkens webhook-signeringsecret, mens app-registrerte webhooks normalt bruker appens client secret. Sjekk Shopify hvor webhooken er opprettet; de er ikke nødvendigvis samme verdi.
4. Under Application → **Advanced → Volumes/Mounts**: legg til et **Volume Mount** med navn f.eks. `klassikernn_queue_data` og Mount Path **`/data`**. Uten dette mistes køen ved hver redeploy.
5. Deploy. Under Application → **Domains**: legg til `queue.klassikernn.no`, container-port **3000**, HTTPS med Let's Encrypt. DNS for `queue.klassikernn.no` må peke til serveren. Ikke publiser port 3000 direkte.
6. Kontroller at `https://queue.klassikernn.no/health` returnerer `{"ok":true}`. Åpne `/admin` og logg inn med `ADMIN_PASSWORD`. Test en manuelt opprettet bestilling.
7. I OBS → Sources → Browser Source: URL `https://queue.klassikernn.no/overlay?key=DIN_OVERLAY_KEY`, bredde 1920, høyde 1080. Plasser køen til høyre. **Ikke vis URL med nøkkel på stream.**
8. Shopify Admin → Settings → Notifications → Webhooks → Create webhook. Event **Order payment**, Format **JSON**, Delivery URL `https://queue.klassikernn.no/webhooks/orders-paid`, støttet API-versjon. Shopify-skjema kan variere. Sjekk at webhookens signeringsnøkkel er den du konfigurerte. Send en test fra Shopify, og utfør deretter en reell testordre.

## Hvordan køen fungerer

- Når Shopify sender en gyldig `orders/paid`-webhook fra din butikk, legges ordren i køen. Dubletter med samme Shopify-order-ID legges ikke inn flere ganger. Betalingsstatus valideres når oppgitt.
- OBS viser **kun** offentlig bestillingsreferanse og produktlinjer, aldri e-post, telefon eller leveringsadresse. Endre visningsnavn manuelt i admin til kundens Twitch-/TikTok-navn når det er avklart med kunden.
- Admin lar deg opprette testordre, flytte opp/ned, markere `Åpnes nå`, `Fullført`, endre visningsnavn. Køen oppdateres automatisk i OBS omtrent hvert tredje sekund.
- Varig data ligger i `/data/queue-data.json`, på volumet du monterte på `/data` i Dokploy. Ta backup av volumet jevnlig og **ikke** slett volumet ved redeploy.

## Kun Rip & Ship, ikke andre varer

**VIKTIG:** Alle kjøpte produkter inkluderes som standard. Før du åpner for reelle kjøp anbefaler vi å gi hver Rip & Ship-produktvariant en SKU som begynner på `RIP-`, og sette `RIP_SKU_PREFIX=RIP-` i Dokploy. Da ignoreres øvrige produktlinjer. Variant-SKU må være korrekt satt i Shopify. Hvis en ordre inneholder både Rip & Ship og vanlige varer, kommer bare Rip & Ship-linjene i køen. En ordre helt uten match registreres som behandlet, men vises ikke.

## Drift og begrensninger

- Én applikasjonsinstans / én replika. JSON-fil er ikke egnet til flere skrivende instanser.
- Admin er passordbeskyttet. Begrens admin-tilgang med VPN/tilgangsregler i tillegg hvis mulig. Ikke bruk en gjenbrukt butikkpassord.
- Shopify-webhooken verifiseres via HMAC mot **rå forespørselsbody**, butikkdomene og topic. Ordreduplikater avvises. Ikke legg Shopify-hemmeligheter i Git.
- Refusjoner og kanselleringer håndteres **ikke** automatisk. Kontroller slike ordre manuelt. Missede webhooks etter servernedetid hentes ikke automatisk. For produksjon med større trafikk bør vi legge til Shopify Admin API-avstemming.
- Store mengder bestillinger krever database, backup og overvåkning. Test ordreflyt før du begynner å selge.
- Browser Source-nøkkelen gir kun visningstilgang og kan roteres i Dokploy. Unngå å vise OBS-kildeegenskaper mens du streamer.

## Relevante dokumenter

- Dokploy applications: https://docs.dokploy.com/docs/core/applications
- Bun: https://bun.sh/docs
- Shopify webhook: https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks
- Shopify HMAC: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries

## Lokal kjøring

Krever [Bun](https://bun.sh). Kopier `.env.example` til `.env`, fyll inn verdier og kjør `./start.sh` (eller `bun run start` med variablene satt). For å teste containeren lokalt: `docker build -t klassikernn . && docker run --env-file .env -p 3000:3000 klassikernn`.
